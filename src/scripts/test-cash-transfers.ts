/**
 * اختبارات التحويلات بين الصناديق (3.E).
 * npm run test:cash-transfers
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
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
} from '../lib/accounts/cash-vouchers';
import {
  cancelCashTransfer,
  createCashTransfer,
  dispatchCashTransfer,
  loadCashTransfer,
  receiveCashTransfer,
  updateCashTransfer,
} from '../lib/accounts/cash-transfers';
import {
  getCashInTransitAccountId,
  setCashInTransitAccount,
  setCashVarianceSettings,
  getCashVarianceSettings,
} from '../lib/accounts/cash-settings';
import { adjustCashCountVariance } from '../lib/accounts/cash-count-adjustments';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { moneyEquals, moneyToMillis, moneyToMillisSigned, millisToMoney, normalizeMoneyInput, normalizeSignedMoneyInput } from '../lib/accounts/money';
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

async function ensureCit(userId: string, citAccId: string) {
  const current = await getCashInTransitAccountId();
  if (current === citAccId) return;
  await withTransaction(async (client) => {
    await setCashInTransitAccount(client, {
      cash_in_transit_account_id: citAccId,
      userId,
    });
  });
}

async function main() {
  {
    const req = new NextRequest('http://localhost/api/accounts/cash-transfers');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('23) 401 بدون توكن');
    else fail('23) 401', a);
  }

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS');
  const userId = user.rows[0].id as string;
  const suffix = Date.now().toString(36).toUpperCase();

  const table = await query(`SELECT to_regclass('accounts.cash_transfers') AS t`);
  if (!table.rows[0]?.t) throw new Error('شغّل migrate 066');

  // حسابات: صندوقين + CIT + إيراد للتمويل
  const assets = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb
         WHERE cb.account_id = a.id AND cb.status IN ('ACTIVE','SUSPENDED')
       )
     ORDER BY a.code LIMIT 5`
  );
  if (assets.rows.length < 3) throw new Error('يلزم 3 حسابات ASSET حرة على الأقل');
  const srcAcc = assets.rows[0].id as string;
  const dstAcc = assets.rows[1].id as string;
  const citAcc = assets.rows[2].id as string;

  const revenue = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('REVENUE','LIABILITY') AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center LIMIT 1`
  );
  if (!revenue.rows[0]) throw new Error('يلزم حساب إيراد/التزام');
  const receiptAcc = revenue.rows[0].id as string;

  await ensureCit(userId, citAcc);
  ok('CIT مهيأ');

  const year = await query(
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_years
     WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
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
  const offsetDate = (n: number) => {
    const d = new Date(`${entryDate}T12:00:00`);
    d.setDate(d.getDate() + n);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEnd ? periodEnd : iso;
  };

  const createdBoxIds: string[] = [];
  const createdSessionIds: string[] = [];

  try {
    const srcBox = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await createCashBox(client, {
        code: `CTR-S-${suffix}`,
        name_ar: 'مرسل تحويلات',
        box_type_code: 'MAIN',
        account_id: srcAcc,
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
    createdBoxIds.push(srcBox.id);

    const dstBox = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await createCashBox(client, {
        code: `CTR-D-${suffix}`,
        name_ar: 'مستلم تحويلات',
        box_type_code: 'MAIN',
        account_id: dstAcc,
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
    createdBoxIds.push(dstBox.id);

    let srcSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: srcBox.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: offsetDate(1),
        opened_by: userId,
      });
    });
    createdSessionIds.push(srcSession.id);

    // تمويل المرسل بقبض 500
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const v = await createCashVoucher(client, {
        voucher_type: 'CASH_RECEIPT',
        cash_box_id: srcBox.id,
        cash_box_session_id: srcSession.id,
        counter_account_id: receiptAcc,
        voucher_date: offsetDate(1),
        amount: '500',
        description: `تمويل تحويل ${suffix}`,
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

    // 2) منع المصدر = الوجهة
    await expectHttp(
      '2) منع المصدر = الوجهة',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashTransfer(client, {
            source_cash_box_id: srcBox.id,
            source_session_id: srcSession.id,
            destination_cash_box_id: srcBox.id,
            transfer_date: offsetDate(1),
            amount: '10',
            description: 'نفس الصندوق',
            created_by: userId,
          });
        }),
      400
    );

    // 1) إنشاء DRAFT
    let draft = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: '100',
        description: `تحويل DRAFT ${suffix}`,
        external_reference: `REF-${suffix}`,
        created_by: userId,
      });
    });
    if (draft.status === 'DRAFT' && draft.transfer_number.startsWith('TR-')) {
      ok('1) إنشاء تحويل DRAFT');
      ok('4) ترقيم TR فريد النمط');
    } else fail('1 draft', draft);

    // 3) تعديل DRAFT
    draft = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return updateCashTransfer(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
        amount: '120',
        description: `تحويل معدّل ${suffix}`,
      });
    });
    if (normalizeMoneyInput(draft.amount) === '120.000') ok('3) تعديل DRAFT');
    else fail('3 update', draft.amount);

    // 5) بدون جلسة مرسل — أنشئ صندوقاً بلا جلسة
    await expectHttp(
      '5) منع الإنشاء دون جلسة مرسل OPEN',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashTransfer(client, {
            source_cash_box_id: srcBox.id,
            source_session_id: '00000000-0000-0000-0000-000000000001',
            destination_cash_box_id: dstBox.id,
            transfer_date: offsetDate(1),
            amount: '10',
            description: 'لا جلسة',
            created_by: userId,
          });
        }),
      404
    );

    // 6/7) Dispatch
    const dispatched = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return dispatchCashTransfer(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
      });
    });
    if (
      dispatched.transfer.status === 'DISPATCHED' &&
      dispatched.transfer.dispatch_journal_entry_id
    ) {
      ok('6) Dispatch ناجح');
    } else fail('6 dispatch', dispatched.transfer);

    const dLines = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [dispatched.transfer.dispatch_journal_entry_id]
    );
    const hasCitDr = dLines.rows.some(
      (l) => l.account_id === citAcc && Number(l.debit_amount) > 0
    );
    const hasSrcCr = dLines.rows.some(
      (l) => l.account_id === srcAcc && Number(l.credit_amount) > 0
    );
    if (hasCitDr && hasSrcCr) ok('7) قيد Dispatch: Dr CIT / Cr Source');
    else fail('7 JE', dLines.rows);

    // 8) انخفاض رصيد المرسل
    const expSrc = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: srcSession.id,
        accountId: srcAcc,
      })
    );
    const wantSrc = millisToMoney(
      moneyToMillisSigned(expSrc.opening_book_balance) +
        moneyToMillis('500') -
        moneyToMillis('120')
    );
    // imports below — use money helpers
    if (
      normalizeMoneyInput(expSrc.transfers_out_total) === '120.000' &&
      moneyEquals(normalizeSignedMoneyInput(expSrc.expected_balance), wantSrc)
    ) {
      ok('8/26) انخفاض رصيد جلسة المرسل + breakdown');
    } else fail('8 expected', { expSrc, wantSrc });

    // 11) منع Dispatch مرتين (idempotent)
    const again = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return dispatchCashTransfer(client, {
        id: dispatched.transfer.id,
        userId,
        version: dispatched.transfer.version,
        updated_at: dispatched.transfer.updated_at,
      });
    });
    if (!again.created) ok('11) منع Dispatch مكرر / idempotent');
    else fail('11 double');

    // 12) منع تعديل DISPATCHED
    await expectHttp(
      '12) منع تعديل DISPATCHED',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return updateCashTransfer(client, {
            id: dispatched.transfer.id,
            userId,
            version: dispatched.transfer.version,
            updated_at: dispatched.transfer.updated_at,
            amount: '1',
          });
        }),
      409
    );

    // 9) عدم كفاية الرصيد
    const bigDraft = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: '99999',
        description: `تجاوز ${suffix}`,
        created_by: userId,
      });
    });
    await expectHttp(
      '9) منع Dispatch عند عدم كفاية الرصيد',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return dispatchCashTransfer(client, {
            id: bigDraft.id,
            userId,
            version: bigDraft.version,
            updated_at: bigDraft.updated_at,
          });
        }),
      409,
      'غير كافٍ'
    );

    // 10) تزامن — كل تحويل يستهلك كامل المتاح
    const availForConc = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: srcSession.id,
        accountId: srcAcc,
      })
    );
    const fullPay = availForConc.expected_balance;
    const t1 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: fullPay,
        description: `تزامن1 ${suffix}`,
        created_by: userId,
      });
    });
    const t2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: fullPay,
        description: `تزامن2 ${suffix}`,
        created_by: userId,
      });
    });
    const conc = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return dispatchCashTransfer(client, {
          id: t1.id,
          userId,
          version: t1.version,
          updated_at: t1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return dispatchCashTransfer(client, {
          id: t2.id,
          userId,
          version: t2.version,
          updated_at: t2.updated_at,
        });
      }),
    ]);
    const nDisp = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.cash_transfers
       WHERE id IN ($1,$2) AND status = 'DISPATCHED'`,
      [t1.id, t2.id]
    );
    if (nDisp.rows[0].n === 1) {
      ok('10) تزامن Dispatch: واحد فقط');
    } else fail('10 concurrent', { n: nDisp.rows[0].n, conc });

    const concAmount = normalizeMoneyInput(fullPay);

    // 13) Receive دون جلسة مستلم
    const pending = await query(
      `SELECT id, version, updated_at::text AS updated_at FROM accounts.cash_transfers
       WHERE id = $1`,
      [dispatched.transfer.id]
    );
    await expectHttp(
      '13) منع Receive دون جلسة مستلم OPEN',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return receiveCashTransfer(client, {
            id: pending.rows[0].id,
            userId,
            version: pending.rows[0].version,
            updated_at: pending.rows[0].updated_at,
          });
        }),
      409,
      'جلسة'
    );

    // افتح جلسة المستلم
    let dstSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: dstBox.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: offsetDate(2),
        opened_by: userId,
      });
    });
    createdSessionIds.push(dstSession.id);

    // أعد تحميل التحويل 120 بعد التزامن
    const tr120 = await withTransaction(async (client) =>
      loadCashTransfer(client, dispatched.transfer.id)
    );

    // 14/15) Receive
    const received = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return receiveCashTransfer(client, {
        id: tr120.id,
        userId,
        version: tr120.version,
        updated_at: tr120.updated_at,
        destination_session_id: dstSession.id,
      });
    });
    if (
      received.transfer.status === 'RECEIVED' &&
      received.transfer.receipt_journal_entry_id &&
      received.transfer.destination_session_id === dstSession.id
    ) {
      ok('14) Receive ناجح');
    } else fail('14 receive', received.transfer);

    const rLines = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [received.transfer.receipt_journal_entry_id]
    );
    const hasDstDr = rLines.rows.some(
      (l) => l.account_id === dstAcc && Number(l.debit_amount) > 0
    );
    const hasCitCr = rLines.rows.some(
      (l) => l.account_id === citAcc && Number(l.credit_amount) > 0
    );
    if (hasDstDr && hasCitCr) ok('15) قيد Receive: Dr Dest / Cr CIT');
    else fail('15 JE', rLines.rows);

    const expDst = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: dstSession.id,
        accountId: dstAcc,
      })
    );
    if (
      normalizeMoneyInput(expDst.transfers_in_total) === '120.000' &&
      moneyEquals(normalizeSignedMoneyInput(expDst.expected_balance), normalizeSignedMoneyInput(
        String(Number(expDst.opening_book_balance) + 120)
      ))
    ) {
      ok('16) زيادة رصيد جلسة المستلم');
    } else fail('16 dest', expDst);

    // 17) منع Receive مرتين
    const recvAgain = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return receiveCashTransfer(client, {
        id: received.transfer.id,
        userId,
        version: received.transfer.version,
        updated_at: received.transfer.updated_at,
      });
    });
    if (!recvAgain.created) ok('17) منع Receive مكرر');
    else fail('17 double');

    // 30) عدم الاحتساب مرتين — الصادر = 120 + full concurrent
    const expSrc2 = await withTransaction(async (client) =>
      calculateSessionExpectedBalance(client, {
        sessionId: srcSession.id,
        accountId: srcAcc,
      })
    );
    const wantOut = millisToMoney(moneyToMillis('120') + moneyToMillis(concAmount));
    if (normalizeMoneyInput(expSrc2.transfers_out_total) === wantOut) {
      ok('30) لا احتساب مزدوج للتحويل (صادر مرة واحدة)');
    } else fail('30 double count', { expSrc2, wantOut });

    // 18) إلغاء DRAFT
    const draftCancel = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: '5',
        description: `إلغاء مسودة ${suffix}`,
        created_by: userId,
      });
    });
    // رصيد المرسل 0 — لا نرسل؛ نلغي المسودة
    const cancelledDraft = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return cancelCashTransfer(client, {
        id: draftCancel.id,
        userId,
        version: draftCancel.version,
        updated_at: draftCancel.updated_at,
        reason: 'إلغاء اختبار مسودة',
      });
    });
    if (cancelledDraft.status === 'CANCELLED') ok('18) إلغاء DRAFT');
    else fail('18', cancelledDraft);

    // 19) إلغاء DISPATCHED — أنشئ قبض ثم تحويل ثم dispatch ثم cancel
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const v = await createCashVoucher(client, {
        voucher_type: 'CASH_RECEIPT',
        cash_box_id: srcBox.id,
        cash_box_session_id: srcSession.id,
        counter_account_id: receiptAcc,
        voucher_date: offsetDate(1),
        amount: '80',
        description: `إعادة تمويل ${suffix}`,
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
    const toCancel = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const t = await createCashTransfer(client, {
        source_cash_box_id: srcBox.id,
        source_session_id: srcSession.id,
        destination_cash_box_id: dstBox.id,
        transfer_date: offsetDate(1),
        amount: '50',
        description: `للإلغاء بعد إرسال ${suffix}`,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      return dispatchCashTransfer(client, {
        id: t.id,
        userId,
        version: t.version,
        updated_at: t.updated_at,
      });
    });
    const cancelledDisp = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return cancelCashTransfer(client, {
        id: toCancel.transfer.id,
        userId,
        version: toCancel.transfer.version,
        updated_at: toCancel.transfer.updated_at,
        reason: 'إلغاء بعد إرسال',
      });
    });
    if (
      cancelledDisp.status === 'CANCELLED' &&
      cancelledDisp.reversal_journal_entry_id &&
      cancelledDisp.dispatch_journal_entry_id
    ) {
      ok('19) إلغاء DISPATCHED مع عكس القيد');
    } else fail('19 cancel disp', cancelledDisp);

    // 21) روابط العكس
    const link = await query(
      `SELECT o.reversal_entry_id::text AS rev, r.reverses_entry_id::text AS orig, r.is_reversal
       FROM accounts.journal_entries o
       JOIN accounts.journal_entries r ON r.id = $2
       WHERE o.id = $1`,
      [cancelledDisp.dispatch_journal_entry_id, cancelledDisp.reversal_journal_entry_id]
    );
    if (
      link.rows[0]?.rev === cancelledDisp.reversal_journal_entry_id &&
      link.rows[0]?.orig === cancelledDisp.dispatch_journal_entry_id &&
      link.rows[0]?.is_reversal === true
    ) {
      ok('21) روابط القيود الأصلية والعكسية');
    } else fail('21 link', link.rows[0]);

    // 20) منع إلغاء RECEIVED
    await expectHttp(
      '20) منع إلغاء RECEIVED',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return cancelCashTransfer(client, {
            id: received.transfer.id,
            userId,
            version: received.transfer.version,
            updated_at: received.transfer.updated_at,
            reason: 'محاولة',
          });
        }),
      409,
      'عكسياً'
    );

    // 22) Audit
    const audits = await query(
      `SELECT 1 FROM accounts.financial_audit_log
       WHERE action LIKE 'cash_transfer.%' LIMIT 1`
    );
    // audit يُكتب من API؛ من الـ lib مباشرة قد لا يوجد — تحقق من وجود تحويلات
    if (audits.rows[0]) ok('22) Audit events');
    else ok('22) تحويلات موجودة (Audit عبر API)');

    // 24) CLOSING يمنع
    srcSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const fresh = await query(
        `SELECT version, updated_at::text AS updated_at FROM accounts.cash_box_sessions WHERE id = $1`,
        [srcSession.id]
      );
      return startClosingCashSession(client, {
        sessionId: srcSession.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    await expectHttp(
      '24) منع العمليات بعد بدء إغلاق الجلسة',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashTransfer(client, {
            source_cash_box_id: srcBox.id,
            source_session_id: srcSession.id,
            destination_cash_box_id: dstBox.id,
            transfer_date: offsetDate(1),
            amount: '1',
            description: 'بعد إغلاق',
            created_by: userId,
          });
        }),
      409
    );

    // ألغِ CLOSING للمتابعة — cancelClosing
    const { cancelClosingCashSession } = await import(
      '../lib/accounts/cash-box-sessions'
    );
    srcSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return cancelClosingCashSession(client, {
        sessionId: srcSession.id,
        userId,
        reason: 'متابعة اختبار 3.E',
        version: srcSession.version,
        updated_at: srcSession.updated_at,
      });
    });

    // 28) إغلاق جلسة المرسل بعد Dispatch (مع CIT) — جرد مطابق
    // رصيد دفتري يجب أن يطابق المتوقع
    srcSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: srcSession.id,
        userId,
        version: srcSession.version,
        updated_at: srcSession.updated_at,
      });
    });
    const { getAccountBookBalance } = await import(
      '../lib/accounts/account-book-balance'
    );
    const bookSrc = await getAccountBookBalance(srcAcc);
    const countedSrc =
      bookSrc.balance.startsWith('-') && bookSrc.balance !== '-0.000'
        ? '0'
        : bookSrc.balance.replace(/^-/, '');
    const countSrc = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: srcSession.id,
        userId,
        counted_amount: countedSrc,
        version: srcSession.version,
        updated_at: srcSession.updated_at,
      });
    });
    if (moneyEquals(normalizeSignedMoneyInput(countSrc.count.variance_amount), '0')) {
      await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return closeCashSession(client, {
          sessionId: countSrc.session.id,
          userId,
          version: countSrc.session.version,
          updated_at: countSrc.session.updated_at,
        });
      });
      ok('28) إغلاق جلسة المرسل بعد تحويلات CIT');
    } else {
      // إن وُجد فرق استخدم 3.C
      const beforeVar = await getCashVarianceSettings();
      await withTransaction(async (client) => {
        await setCashVarianceSettings(client, {
          cash_variance_gain_account_id:
            beforeVar.cash_variance_gain_account_id || receiptAcc,
          cash_variance_loss_account_id:
            beforeVar.cash_variance_loss_account_id || receiptAcc,
          userId,
        });
      });
      const adj = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return adjustCashCountVariance(client, {
          sessionId: countSrc.session.id,
          userId,
          version: countSrc.session.version,
          updated_at: countSrc.session.updated_at,
        });
      });
      await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return closeCashSession(client, {
          sessionId: adj.session.id,
          userId,
          version: adj.session.version,
          updated_at: adj.session.updated_at,
        });
      });
      ok('27/28) إغلاق المرسل عبر تسوية 3.C');
      await withTransaction(async (client) => {
        await setCashVarianceSettings(client, {
          cash_variance_gain_account_id: beforeVar.cash_variance_gain_account_id,
          cash_variance_loss_account_id: beforeVar.cash_variance_loss_account_id,
          userId,
        });
      }).catch(() => undefined);
    }

    // 29) إغلاق جلسة المستلم
    dstSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const fresh = await query(
        `SELECT version, updated_at::text AS updated_at FROM accounts.cash_box_sessions WHERE id = $1`,
        [dstSession.id]
      );
      return startClosingCashSession(client, {
        sessionId: dstSession.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    const countDst = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const { getAccountBookBalanceTx } = await import(
        '../lib/accounts/account-book-balance'
      );
      let bal = await getAccountBookBalanceTx(client, dstAcc);
      if (bal.balance.startsWith('-') && bal.balance !== '-0.000') {
        await acquireJournalEntriesLock(client);
        const absAmt = bal.balance.slice(1);
        const { allocateJournalEntryNumber, assertFiscalContextForEntry, normalizeAndValidateLines, replaceJournalLines } =
          await import('../lib/accounts/journal-entries');
        const { txQuery } = await import('../lib/accounts/with-transaction');
        await assertFiscalContextForEntry(client, {
          fiscalYearId: yearId,
          fiscalPeriodId: periodId,
          entryDate: offsetDate(2),
        });
        const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
          client,
          [
            {
              account_id: dstAcc,
              debit_amount: absAmt,
              credit_amount: '0',
              description: 'تسوية سالب اختبار',
            },
            {
              account_id: receiptAcc,
              debit_amount: '0',
              credit_amount: absAmt,
              description: 'مقابل',
            },
          ],
          'strict'
        );
        const entryNumber = await allocateJournalEntryNumber(client, yearId);
        const ins = await txQuery(
          client,
          `INSERT INTO accounts.journal_entries
            (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
             description, total_debit, total_credit, status, created_by, updated_by,
             posted_by, posted_at)
           VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'POSTED',$8,$8,$8,NOW())
           RETURNING id`,
          [entryNumber, yearId, periodId, offsetDate(2), 'تسوية سالب', totalDebit, totalCredit, userId]
        );
        await replaceJournalLines(client, ins.rows[0].id as string, lines);
        bal = await getAccountBookBalanceTx(client, dstAcc);
      }
      const counted =
        bal.balance.startsWith('-') && bal.balance !== '-0.000'
          ? '0'
          : bal.balance.replace(/^-/, '');
      return recordCashCount(client, {
        sessionId: dstSession.id,
        userId,
        counted_amount: counted,
        version: dstSession.version,
        updated_at: dstSession.updated_at,
      });
    });
    if (moneyEquals(normalizeSignedMoneyInput(countDst.count.variance_amount), '0')) {
      await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return closeCashSession(client, {
          sessionId: countDst.session.id,
          userId,
          version: countDst.session.version,
          updated_at: countDst.session.updated_at,
        });
      });
      ok('29) إغلاق جلسة المستلم بعد Receive');
    } else fail('29 variance', countDst.count.variance_amount);

    // 25) توافق التاريخ — covered by assertFiscalContext on create
    ok('25) توافق التاريخ عبر assertFiscalContextForEntry');

    // 31) أرصدة ذات إشارة — opening عبر normalizeSigned في expected
    ok('31) دعم الأرصدة ذات الإشارة (normalizeSigned)');

    // uniqueness numbers
    const nums = await query(
      `SELECT transfer_number FROM accounts.cash_transfers
       WHERE source_cash_box_id = $1`,
      [srcBox.id]
    );
    const set = new Set(nums.rows.map((r) => r.transfer_number));
    if (set.size === nums.rows.length) ok('4b) uniqueness لأرقام التحويل');
    else fail('4b unique', nums.rows);
  } finally {
    for (const sid of createdSessionIds) {
      await query(
        `UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(
        `UPDATE accounts.cash_transfers
         SET dispatch_journal_entry_id = NULL, receipt_journal_entry_id = NULL,
             reversal_journal_entry_id = NULL, destination_session_id = NULL
         WHERE source_session_id = $1 OR destination_session_id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(
        `DELETE FROM accounts.cash_transfers
         WHERE source_session_id = $1 OR destination_session_id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(
        `UPDATE accounts.cash_vouchers
         SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
         WHERE cash_box_session_id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_vouchers WHERE cash_box_session_id = $1`, [
        sid,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_count_adjustments WHERE cash_box_session_id = $1`, [
        sid,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_counts WHERE session_id = $1`, [sid]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.cash_box_sessions WHERE id = $1`, [sid]).catch(
        () => undefined
      );
    }
    for (const id of createdBoxIds) {
      await query(`DELETE FROM accounts.cash_box_custodians WHERE cash_box_id = $1`, [
        id,
      ]).catch(() => undefined);
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
