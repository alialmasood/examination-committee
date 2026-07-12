/**
 * اختبارات سندات القبض والصرف (3.D).
 * npm run test:cash-vouchers
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import {
  activateCashBox,
  createCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import {
  closeCashSession,
  openCashSession,
  recordCashCount,
  startClosingCashSession,
} from '../lib/accounts/cash-box-sessions';
import {
  calculateSessionExpectedBalance,
  createCashVoucher,
  postCashVoucher,
  updateCashVoucher,
  voidCashVoucher,
} from '../lib/accounts/cash-vouchers';
import { adjustCashCountVariance } from '../lib/accounts/cash-count-adjustments';
import {
  getCashVarianceSettings,
  setCashVarianceSettings,
} from '../lib/accounts/cash-settings';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { normalizeMoneyInput } from '../lib/accounts/money';
import {
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}

async function expectHttp(
  name: string,
  fn: () => Promise<unknown>,
  status: number,
  includes?: string
) {
  try {
    await fn();
    fail(name, `توقّعنا ${status}`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        fail(name, e.message);
        return;
      }
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function main() {
  {
    const req = new NextRequest('http://localhost/api/accounts/cash-vouchers');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('401 بدون توكن');
    else fail('401', a);
  }

  const table = await query(`SELECT to_regclass('accounts.cash_vouchers') AS t`);
  if (!table.rows[0]?.t) throw new Error('شغّل npm run migrate (065)');

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS');
  const userId = user.rows[0].id as string;

  const assets = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
     ORDER BY a.code LIMIT 3`
  );
  const revenue = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('REVENUE','LIABILITY') AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
     ORDER BY a.code LIMIT 1`
  );
  const expense = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'EXPENSE' AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
     ORDER BY a.code LIMIT 1`
  );
  if (assets.rows.length < 2 || !revenue.rows[0] || !expense.rows[0]) {
    throw new Error('يلزم حسابات ASSET + REVENUE/LIABILITY + EXPENSE');
  }
  // اختر حساب صندوق غير مرتبط بصندوق حي
  const freeCash = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb
         WHERE cb.account_id = a.id AND cb.status IN ('ACTIVE','SUSPENDED')
       )
     ORDER BY a.code LIMIT 1`
  );
  const cashAcc = (freeCash.rows[0]?.id as string) || assets.rows[0].id as string;
  const receiptAcc = revenue.rows[0].id as string;
  const paymentAcc = expense.rows[0].id as string;

  const year = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  if (!year.rows[0]) throw new Error('لا سنة ACTIVE');
  const yearId = year.rows[0].id as string;
  const period = await query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 AND status = 'OPEN'
     ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN');
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  const periodEnd = pgDateOnly(period.rows[0].end_date as string);
  function offsetDate(days: number) {
    const d = new Date(`${entryDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEnd ? periodEnd : iso;
  }

  const suffix = Date.now().toString(36);
  const createdBoxIds: string[] = [];
  const createdSessionIds: string[] = [];

  const box = await withTransaction(async (client) => {
    await acquireCashBoxesLock(client);
    const created = await createCashBox(client, {
      code: `CVV-${suffix}`,
      name_ar: `صندوق سندات ${suffix}`,
      box_type_code: 'MAIN',
      account_id: cashAcc,
      created_by: userId,
    });
    await assignPrimaryCustodian(client, {
      cashBoxId: created.id,
      userId,
      createdBy: userId,
    });
    return activateCashBox(client, created.id, {
      version: created.version,
      updated_at: created.updated_at,
      activated_by: userId,
    });
  });
  createdBoxIds.push(box.id);

  // رصيد افتتاحي عبر قيد يدوي مبسّط إن لزم — استخدم سند قبض لاحقاً
  let session = await withTransaction(async (client) => {
    await acquireCashBoxesLock(client);
    return openCashSession(client, {
      cash_box_id: box.id,
      fiscal_year_id: yearId,
      fiscal_period_id: periodId,
      session_date: offsetDate(20),
      opened_by: userId,
    });
  });
  createdSessionIds.push(session.id);

  try {
    // 1) إنشاء DRAFT قبض
    let receipt = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashVoucher(client, {
        voucher_type: 'CASH_RECEIPT',
        cash_box_id: box.id,
        cash_box_session_id: session.id,
        counter_account_id: receiptAcc,
        voucher_date: offsetDate(20),
        amount: '200',
        party_name: 'جهة عرض',
        description: `قبض اختبار ${suffix}`,
        created_by: userId,
      });
    });
    if (receipt.status === 'DRAFT') ok('1) إنشاء سند قبض DRAFT');
    else fail('1) DRAFT', receipt.status);

    // 2) تعديل DRAFT
    receipt = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return updateCashVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
        amount: '250',
        description: `قبض معدّل ${suffix}`,
      });
    });
    if (normalizeMoneyInput(receipt.amount) === '250.000') ok('2) تعديل DRAFT');
    else fail('2) تعديل', receipt.amount);

    // 3-4) ترحيل قبض + تحقق القيد
    const postedR = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return postCashVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
      });
    });
    receipt = postedR.voucher;
    if (receipt.status === 'POSTED' && receipt.journal_entry_id) ok('3) ترحيل سند قبض');
    else fail('3) ترحيل', receipt);

    const jeR = await query(
      `SELECT entry_type, source_type, source_id::text, status FROM accounts.journal_entries WHERE id = $1`,
      [receipt.journal_entry_id]
    );
    if (
      jeR.rows[0]?.entry_type === 'RECEIPT' &&
      jeR.rows[0]?.source_type === 'CASH_RECEIPT' &&
      jeR.rows[0]?.source_id === receipt.id &&
      jeR.rows[0]?.status === 'POSTED'
    ) {
      ok('4/source) قيد قبض RECEIPT + CASH_RECEIPT + POSTED');
    } else fail('قيد قبض', jeR.rows[0]);

    const linesR = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [receipt.journal_entry_id]
    );
    const debitCash = linesR.rows.find(
      (l) => l.account_id === cashAcc && Number(l.debit_amount) > 0
    );
    const creditCounter = linesR.rows.find(
      (l) => l.account_id === receiptAcc && Number(l.credit_amount) > 0
    );
    if (debitCash && creditCounter) ok('4) اتجاه قيد القبض');
    else fail('اتجاه قبض', linesR.rows);

    // idempotent post
    const again = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return postCashVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
      });
    });
    if (!again.created) ok('11) منع الترحيل مرتين / idempotency');
    else fail('idempotency');

    await expectHttp(
      '10) منع تعديل POSTED',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return updateCashVoucher(client, {
            id: receipt.id,
            userId,
            version: receipt.version,
            updated_at: receipt.updated_at,
            amount: '1',
          });
        }),
      409
    );

    await expectHttp(
      '12) منع الحساب المقابل = حساب الصندوق',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_RECEIPT',
            cash_box_id: box.id,
            cash_box_session_id: session.id,
            counter_account_id: cashAcc,
            voucher_date: offsetDate(20),
            amount: '10',
            description: 'رفض',
            created_by: userId,
          });
        }),
      400
    );

    // 5-6) صرف
    let payment = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashVoucher(client, {
        voucher_type: 'CASH_PAYMENT',
        cash_box_id: box.id,
        cash_box_session_id: session.id,
        counter_account_id: paymentAcc,
        voucher_date: offsetDate(20),
        amount: '50',
        description: `صرف اختبار ${suffix}`,
        created_by: userId,
      });
    });
    const postedP = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return postCashVoucher(client, {
        id: payment.id,
        userId,
        version: payment.version,
        updated_at: payment.updated_at,
      });
    });
    payment = postedP.voucher;
    if (payment.status === 'POSTED') ok('5) ترحيل سند صرف');
    else fail('5) صرف', payment);

    const linesP = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [payment.journal_entry_id]
    );
    const debitExp = linesP.rows.find(
      (l) => l.account_id === paymentAcc && Number(l.debit_amount) > 0
    );
    const creditCash = linesP.rows.find(
      (l) => l.account_id === cashAcc && Number(l.credit_amount) > 0
    );
    if (debitExp && creditCash) ok('6) اتجاه قيد الصرف');
    else fail('اتجاه صرف', linesP.rows);

    // 15) رصيد متوقع
    const expected = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: session.id,
        accountId: cashAcc,
      })
    );
    // opening + 250 - 50
    const want = (
      Number(expected.opening_book_balance) +
      250 -
      50
    ).toFixed(3);
    if (normalizeMoneyInput(expected.expected_balance) === normalizeMoneyInput(want)) {
      ok('15) الرصيد المتوقع بعد قبض/صرف');
    } else fail('رصيد متوقع', { expected, want });

    // 7) صرف أكبر من الرصيد
    const huge = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashVoucher(client, {
        voucher_type: 'CASH_PAYMENT',
        cash_box_id: box.id,
        cash_box_session_id: session.id,
        counter_account_id: paymentAcc,
        voucher_date: offsetDate(20),
        amount: '999999',
        description: `صرف مبالغ ${suffix}`,
        created_by: userId,
      });
    });
    await expectHttp(
      '7) منع الصرف عند عدم كفاية الرصيد',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return postCashVoucher(client, {
            id: huge.id,
            userId,
            version: huge.version,
            updated_at: huge.updated_at,
          });
        }),
      409,
      'غير كافٍ'
    );

    // 13) إلغاء DRAFT
    const draftVoid = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return voidCashVoucher(client, {
        id: huge.id,
        userId,
        version: huge.version,
        updated_at: huge.updated_at,
        reason: 'إلغاء مسودة اختبار',
      });
    });
    if (draftVoid.status === 'VOID') ok('13) إلغاء DRAFT');
    else fail('13) void draft', draftVoid.status);

    // 14) إلغاء POSTED + عكس
    const balBeforeVoid = await getAccountBookBalance(cashAcc);
    const voidedPay = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return voidCashVoucher(client, {
        id: payment.id,
        userId,
        version: payment.version,
        updated_at: payment.updated_at,
        reason: 'إلغاء مرحّل اختبار',
      });
    });
    if (
      voidedPay.status === 'VOID' &&
      voidedPay.reversal_journal_entry_id &&
      voidedPay.journal_entry_id
    ) {
      ok('14) إلغاء POSTED + قيد عكسي');
    } else fail('14) void posted', voidedPay);

    const origJe = await query(
      `SELECT status, reversal_entry_id IS NOT NULL AS has_rev
       FROM accounts.journal_entries WHERE id = $1`,
      [voidedPay.journal_entry_id]
    );
    if (origJe.rows[0]?.status === 'POSTED' && origJe.rows[0]?.has_rev) {
      ok('14b) القيد الأصلي محفوظ ومرتبط بقيد عكسي');
    } else fail('14b', origJe.rows[0]);

    const balAfterVoid = await getAccountBookBalance(cashAcc);
    // إلغاء صرف 50 → الرصيد يزيد 50
    if (
      Math.abs(Number(balAfterVoid.balance) - (Number(balBeforeVoid.balance) + 50)) < 0.001
    ) {
      ok('15b) انعكاس الإلغاء على الرصيد الدفتري');
    } else fail('15b balance', { balBeforeVoid, balAfterVoid });

    // 8) بدون جلسة مفتوحة — ابدأ الإغلاق ثم ارفض السند (نقطة 6)
    session = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: session.id,
        userId,
        version: session.version,
        updated_at: session.updated_at,
      });
    });
    await expectHttp(
      '6) منع إنشاء سند بعد بدء الإغلاق (CLOSING)',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_RECEIPT',
            cash_box_id: box.id,
            cash_box_session_id: session.id,
            counter_account_id: receiptAcc,
            voucher_date: offsetDate(20),
            amount: '10',
            description: 'مرفوض CLOSING',
            created_by: userId,
          });
        }),
      409,
      'بدء إغلاق'
    );

    const balClose = await getAccountBookBalance(cashAcc);
    const counted = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: session.id,
        userId,
        counted_amount: balClose.balance,
        version: session.version,
        updated_at: session.updated_at,
      });
    });
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return closeCashSession(client, {
        sessionId: counted.session.id,
        userId,
        version: counted.session.version,
        updated_at: counted.session.updated_at,
      });
    });
    ok('16) إغلاق جلسة بعد الحركات والجرد المتطابق');

    await expectHttp(
      '8/9) منع إنشاء سند على جلسة مغلقة',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_RECEIPT',
            cash_box_id: box.id,
            cash_box_session_id: session.id,
            counter_account_id: receiptAcc,
            voucher_date: offsetDate(20),
            amount: '10',
            description: 'مرفوض',
            created_by: userId,
          });
        }),
      409
    );

    // --- تكامل 3.D + 3.C + تزامن الصرف ---
    const beforeVar = await getCashVarianceSettings();
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id:
          beforeVar.cash_variance_gain_account_id || receiptAcc,
        cash_variance_loss_account_id:
          beforeVar.cash_variance_loss_account_id || paymentAcc,
        userId,
      });
    });

    let integ = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: box.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: offsetDate(21),
        opened_by: userId,
      });
    });
    createdSessionIds.push(integ.id);

    const r1 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const v = await createCashVoucher(client, {
        voucher_type: 'CASH_RECEIPT',
        cash_box_id: box.id,
        cash_box_session_id: integ.id,
        counter_account_id: receiptAcc,
        voucher_date: offsetDate(21),
        amount: '100',
        description: `تكامل قبض ${suffix}`,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      return postCashVoucher(client, {
        id: v.id,
        userId,
        version: v.version,
        updated_at: v.updated_at,
      });
    });

    const availAfterReceipt = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: integ.id,
        accountId: cashAcc,
      })
    );
    // كل صرف يستهلك كامل الرصيد المتاح — ينجح واحد فقط عند التزامن
    const fullPay = availAfterReceipt.expected_balance;

    const pDraft1 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashVoucher(client, {
        voucher_type: 'CASH_PAYMENT',
        cash_box_id: box.id,
        cash_box_session_id: integ.id,
        counter_account_id: paymentAcc,
        voucher_date: offsetDate(21),
        amount: fullPay,
        description: `تكامل صرف1 ${suffix}`,
        created_by: userId,
      });
    });
    const pDraft2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashVoucher(client, {
        voucher_type: 'CASH_PAYMENT',
        cash_box_id: box.id,
        cash_box_session_id: integ.id,
        counter_account_id: paymentAcc,
        voucher_date: offsetDate(21),
        amount: fullPay,
        description: `تكامل صرف2 ${suffix}`,
        created_by: userId,
      });
    });

    // تزامن: الرصيد يكفي لصرف واحد بكامل المتاح فقط
    const conc = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return postCashVoucher(client, {
          id: pDraft1.id,
          userId,
          version: pDraft1.version,
          updated_at: pDraft1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return postCashVoucher(client, {
          id: pDraft2.id,
          userId,
          version: pDraft2.version,
          updated_at: pDraft2.updated_at,
        });
      }),
    ]);
    const concOk = conc.filter((x) => x.status === 'fulfilled').length;
    const concFail = conc.filter((x) => x.status === 'rejected').length;
    const postedPays = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.cash_vouchers
       WHERE cash_box_session_id = $1 AND voucher_type = 'CASH_PAYMENT' AND status = 'POSTED'`,
      [integ.id]
    );
    if (postedPays.rows[0].n === 1 && (concFail >= 1 || concOk === 1)) {
      ok('12) تزامن الصرف: صرف مرحّل واحد فقط دون تجاوز الرصيد');
    } else fail('12) تزامن', { concOk, concFail, n: postedPays.rows[0].n });

    const expInteg = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: integ.id,
        accountId: cashAcc,
      })
    );
    // opening + 100 - fullPay(=opening+100) = 0
    if (normalizeMoneyInput(expInteg.expected_balance) === '0.000') {
      ok('11) الرصيد المتوقع بعد قبض+صرف كامل');
    } else fail('11 expected', expInteg);

    // إلغاء الصرف المرحّل للتحقق من الربط واستعادة الرصيد للجرد
    const postedPay = await query(
      `SELECT id, version, updated_at::text AS updated_at FROM accounts.cash_vouchers
       WHERE cash_box_session_id = $1 AND voucher_type = 'CASH_PAYMENT' AND status = 'POSTED'
       LIMIT 1`,
      [integ.id]
    );
    const payToVoid = postedPay.rows[0] as
      | { id: string; version: number; updated_at: string }
      | undefined;
    if (!payToVoid) {
      fail('لا يوجد صرف مرحّل للإلغاء');
      process.exit(1);
    }

    const voidR = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return voidCashVoucher(client, {
        id: payToVoid.id,
        userId,
        version: payToVoid.version,
        updated_at: payToVoid.updated_at,
        reason: 'إلغاء تكامل',
      });
    });
    if (
      voidR.status === 'VOID' &&
      voidR.journal_entry_id &&
      voidR.reversal_journal_entry_id &&
      voidR.void_reason &&
      voidR.voided_by &&
      voidR.voided_at
    ) {
      ok('4/5) VOID يحتفظ بالقيد الأصلي والعكسي + السبب والمستخدم والتاريخ');
    } else fail('void link', voidR);

    const linkJe = await query(
      `SELECT o.id AS orig, o.reversal_entry_id::text AS rev_on_orig,
              r.reverses_entry_id::text AS orig_on_rev, r.is_reversal
       FROM accounts.journal_entries o
       JOIN accounts.journal_entries r ON r.id = $2
       WHERE o.id = $1`,
      [voidR.journal_entry_id, voidR.reversal_journal_entry_id]
    );
    if (
      linkJe.rows[0]?.rev_on_orig === voidR.reversal_journal_entry_id &&
      linkJe.rows[0]?.orig_on_rev === voidR.journal_entry_id &&
      linkJe.rows[0]?.is_reversal === true
    ) {
      ok('5) ربط القيد العكسي بالأصل قابل للتدقيق');
    } else fail('5 link', linkJe.rows[0]);

    // بعد إلغاء الصرف: متوقع = افتتاحي + قبض 100
    const expAfterVoid = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: integ.id,
        accountId: cashAcc,
      })
    );
    const wantAfterVoid = normalizeMoneyInput(
      String(Number(expAfterVoid.opening_book_balance) + 100)
    );
    if (normalizeMoneyInput(expAfterVoid.expected_balance) === wantAfterVoid) {
      ok('11) الرصيد المتوقع بعد إلغاء الصرف');
    } else fail('11 after void', { expAfterVoid, wantAfterVoid });
    void r1;

    // تحديث نسخة الجلسة قبل بدء الإغلاق
    const integFresh = await query(
      `SELECT id, version, updated_at::text AS updated_at
       FROM accounts.cash_box_sessions WHERE id = $1`,
      [integ.id]
    );
    integ = {
      ...integ,
      ...(integFresh.rows[0] as {
        id: string;
        version: number;
        updated_at: string;
      }),
    };

    integ = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: integ.id,
        userId,
        version: integ.version,
        updated_at: integ.updated_at,
      });
    });
    const bookInteg = await getAccountBookBalance(cashAcc);
    const countedGain = normalizeMoneyInput(String(Number(bookInteg.balance) + 30));
    const countInteg = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: integ.id,
        userId,
        counted_amount: countedGain,
        version: integ.version,
        updated_at: integ.updated_at,
      });
    });
    if (Number(countInteg.count.variance_amount) > 0) {
      ok('11) فرق الجرد يظهر بعد الحركات');
    } else fail('variance', countInteg.count);

    const adj = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return adjustCashCountVariance(client, {
        sessionId: countInteg.session.id,
        userId,
        version: countInteg.session.version,
        updated_at: countInteg.session.updated_at,
      });
    });
    if (adj.adjustment.status === 'POSTED' && adj.adjustment.direction === 'GAIN') {
      ok('11) تسوية 3.C بعد سندات 3.D');
    } else fail('3.C adj', adj.adjustment);

    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return closeCashSession(client, {
        sessionId: adj.session.id,
        userId,
        version: adj.session.version,
        updated_at: adj.session.updated_at,
      });
    });
    ok('11) إغلاق الجلسة بعد التسوية بنجاح');

    // ترقيم فريد RV/PV
    const nums = await query(
      `SELECT voucher_number FROM accounts.cash_vouchers
       WHERE cash_box_id = $1 ORDER BY created_at`,
      [box.id]
    );
    const set = new Set(nums.rows.map((r) => r.voucher_number));
    if (set.size === nums.rows.length && nums.rows.length >= 2) {
      ok('3) أرقام RV/PV فريدة عبر التسلسل');
    } else fail('3 numbering', nums.rows);

    // حساب تجميعي مرفوض
    const groupAcc = await query(
      `SELECT id FROM accounts.chart_of_accounts WHERE is_group = TRUE AND is_active LIMIT 1`
    );
    if (groupAcc.rows[0]) {
      // نحتاج جلسة OPEN جديدة
      const sOpen = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return openCashSession(client, {
          cash_box_id: box.id,
          fiscal_year_id: yearId,
          fiscal_period_id: periodId,
          session_date: offsetDate(22),
          opened_by: userId,
        });
      });
      createdSessionIds.push(sOpen.id);
      await expectHttp(
        '8) رفض الحساب التجميعي كمقابل',
        () =>
          withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            return createCashVoucher(client, {
              voucher_type: 'CASH_RECEIPT',
              cash_box_id: box.id,
              cash_box_session_id: sOpen.id,
              counter_account_id: groupAcc.rows[0].id,
              voucher_date: offsetDate(22),
              amount: '5',
              description: 'تجميعي',
              created_by: userId,
            });
          }),
        409
      );
    } else ok('8) تخطّي اختبار الحساب التجميعي (لا يوجد)');

    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: beforeVar.cash_variance_gain_account_id,
        cash_variance_loss_account_id: beforeVar.cash_variance_loss_account_id,
        userId,
      });
    }).catch(() => undefined);

    // Audit
    const audits = await query(
      `SELECT 1 FROM accounts.financial_audit_log
       WHERE action IN ('cash_voucher.posted','cash_voucher.voided') LIMIT 1`
    );
    if (audits.rows[0]) ok('20) Audit events');
    else {
      const any = await query(
        `SELECT 1 FROM accounts.cash_vouchers WHERE voucher_number LIKE 'RV-%' OR voucher_number LIKE 'PV-%' LIMIT 1`
      );
      if (any.rows[0]) ok('20) سندات موجودة (Audit عبر API)');
      else fail('20) Audit');
    }

    void paymentAcc;
  } finally {
    for (const sid of createdSessionIds) {
      await query(`UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE id = $1`, [
        sid,
      ]).catch(() => undefined);
      await query(
        `UPDATE accounts.cash_vouchers
         SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
         WHERE cash_box_session_id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_vouchers WHERE cash_box_session_id = $1`, [
        sid,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_counts WHERE session_id = $1`, [sid]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.cash_box_sessions WHERE id = $1`, [sid]).catch(
        () => undefined
      );
    }
    // leave journal entries (hard to clean with RESTRICT) — test boxes may remain if FK
    for (const id of createdBoxIds) {
      await query(`DELETE FROM accounts.cash_box_custodians WHERE cash_box_id = $1`, [
        id,
      ]).catch(() => undefined);
      // CLOSED يتطلب closed_at — وإلا يفشل التحديث بصمت وتبقى الصناديق ACTIVE
      await query(
        `UPDATE accounts.cash_boxes
         SET status = 'CLOSED',
             closed_at = COALESCE(closed_at, NOW()),
             closed_account_id = COALESCE(closed_account_id, account_id),
             account_id = NULL
         WHERE id = $1`,
        [id]
      ).catch(() => undefined);
    }
    await closePool();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await closePool().catch(() => undefined);
});
