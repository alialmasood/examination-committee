/**
 * بيانات عرض آمنة لنظام الحسابات (أكواد DEMO فقط).
 * لا يحذف ولا يعدّل بيانات غير DEMO.
 * لا يمس إعدادات فروقات الجرد إن كانت مهيأة مسبقاً.
 *
 * npm run seed:accounts-demo
 */
import { closePool, query } from '../lib/db';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import {
  activateCashBox,
  createCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import { adjustCashCountVariance } from '../lib/accounts/cash-count-adjustments';
import {
  closeCashSession,
  openCashSession,
  recordCashCount,
  startClosingCashSession,
} from '../lib/accounts/cash-box-sessions';
import {
  createCashVoucher,
  postCashVoucher,
} from '../lib/accounts/cash-vouchers';
import {
  createCashTransfer,
  dispatchCashTransfer,
  receiveCashTransfer,
} from '../lib/accounts/cash-transfers';
import { createBank } from '../lib/accounts/banks';
import { createBankBranch } from '../lib/accounts/bank-branches';
import {
  assignBankAccountUser,
  createBankAccount,
} from '../lib/accounts/bank-accounts';
import {
  createBankVoucher,
  postBankVoucher,
} from '../lib/accounts/bank-vouchers';
import {
  createBankTransfer,
  postBankTransfer,
} from '../lib/accounts/bank-transfers';
import {
  getCashVarianceSettings,
  setCashVarianceSettings,
  getCashInTransitAccountId,
  setCashInTransitAccount,
} from '../lib/accounts/cash-settings';
import { createDefaultSequencesForYear, pgDateOnly } from '../lib/accounts/document-sequences';
import { seedBankReconciliationDemo } from './seed-accounts-reconciliation-demo';
import { seedStudentBillingDemo } from './seed-accounts-student-billing-demo';
import { seedStudentReceivablesDemo } from './seed-accounts-student-receivables-demo';
import { seedStudentReliefsDemo } from './seed-accounts-student-reliefs-demo';
import { seedStudentCreditNotesRefundsDemo } from './seed-accounts-student-credit-notes-refunds-demo';
import { seedSupplierPayablesDemo } from './seed-accounts-supplier-payables-demo';
import { seedSupplierPaymentsExpensesDemo } from './seed-accounts-supplier-payments-expenses-demo';
import { seedPurchasingDemo } from './seed-accounts-purchasing-demo';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { normalizeMoneyInput } from '../lib/accounts/money';
import {
  acquireBanksLock,
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '../lib/accounts/with-transaction';

const DEMO = {
  costCenter: 'DEMO-CC-01',
  cashAccount: 'DEMO-CASH',
  gainAccount: 'DEMO-GAIN',
  lossAccount: 'DEMO-LOSS',
  contraAccount: 'DEMO-CONTRA',
  cashBox: 'DEMO-CB-MAIN',
  cashBoxDest: 'DEMO-CB-DEST',
  citAccount: 'DEMO-CIT',
  bank: 'DEMO-BANK',
  bankBranch: 'DEMO-BR-MAIN',
  bankAccountIqd: 'DEMO-BA-IQD',
  bankAccountUsd: 'DEMO-BA-USD',
  bankGl: 'DEMO-BANK-GL',
  bankGlUsd: 'DEMO-BANK-GL-USD',
  bankVoucherReceipt: 'DEMO-BV-RECEIPT',
  bankVoucherPayment: 'DEMO-BV-PAYMENT',
  bankVoucherDraft: 'DEMO-BV-DRAFT',
  bankAccountIqd2: 'DEMO-BA-IQD-2',
  bankGl2: 'DEMO-BANK-GL-2',
  bankFeeAccount: 'DEMO-BANK-FEE',
  bankTransferPlain: 'DEMO-BT-PLAIN',
  bankTransferFee: 'DEMO-BT-FEE',
  bankTransferDraft: 'DEMO-BT-DRAFT',
  bankAccountRecon: 'DEMO-BA-RECON',
  bankGlRecon: 'DEMO-BANK-GL-RECON',
  bankStmtDraft: 'DEMO-BST-DRAFT',
  bankStmtProgress: 'DEMO-BST-PROGRESS',
  bankStmtClosed: 'DEMO-BST-CLOSED',
  sessionZeroNotes: 'DEMO-SESSION-ZERO',
  sessionGainNotes: 'DEMO-SESSION-GAIN',
  sessionOpenNotes: 'DEMO-SESSION-OPEN',
  voucherReceiptNotes: 'DEMO-VOUCHER-RECEIPT',
  voucherPaymentNotes: 'DEMO-VOUCHER-PAYMENT',
  voucherDraftNotes: 'DEMO-VOUCHER-DRAFT',
  transferReceivedNotes: 'DEMO-TRANSFER-RECEIVED',
  transferDispatchedNotes: 'DEMO-TRANSFER-DISPATCHED',
  transferDraftNotes: 'DEMO-TRANSFER-DRAFT',
} as const;

async function ensureAccount(params: {
  code: string;
  nameAr: string;
  typeCode: string;
  userId: string;
}): Promise<{ id: string; created: boolean }> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code) = LOWER($1)`,
    [params.code]
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id as string, created: false };
  }
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code = $1`,
    [params.typeCode]
  );
  if (!type.rows[0]) throw new Error(`نوع حساب ${params.typeCode} غير موجود`);
  const nextSort = await query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n
     FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1, $2, $3, 1, FALSE, TRUE, $4, FALSE, TRUE, $5, $6,
             'حساب عرض DEMO — لا تستخدمه لبيانات حقيقية')
     RETURNING id`,
    [
      params.code,
      params.nameAr,
      type.rows[0].id,
      type.rows[0].normal_balance,
      nextSort.rows[0].n,
      params.userId,
    ]
  );
  return { id: ins.rows[0].id as string, created: true };
}

async function postJe(params: {
  userId: string;
  yearId: string;
  periodId: string;
  entryDate: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
}): Promise<string> {
  return withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await assertFiscalContextForEntry(client, {
      fiscalYearId: params.yearId,
      fiscalPeriodId: params.periodId,
      entryDate: params.entryDate,
    });
    const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
      client,
      [
        {
          account_id: params.debitAccountId,
          debit_amount: params.amount,
          credit_amount: '0',
          description: params.description,
        },
        {
          account_id: params.creditAccountId,
          debit_amount: '0',
          credit_amount: params.amount,
          description: 'مقابل DEMO',
        },
      ],
      'strict'
    );
    const entryNumber = await allocateJournalEntryNumber(client, params.yearId);
    const ins = await txQuery(
      client,
      `INSERT INTO accounts.journal_entries
        (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
         description, total_debit, total_credit, status, created_by, updated_by,
         posted_by, posted_at)
       VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'POSTED',$8,$8,$8,NOW())
       RETURNING id, entry_number`,
      [
        entryNumber,
        params.yearId,
        params.periodId,
        params.entryDate,
        params.description,
        totalDebit,
        totalCredit,
        params.userId,
      ]
    );
    await replaceJournalLines(client, ins.rows[0].id as string, lines);
    console.log(`  قيد مرحّل: ${ins.rows[0].entry_number}`);
    return ins.rows[0].id as string;
  });
}

async function main() {
  console.log('🌱 seed:accounts-demo — بيانات عرض DEMO فقط\n');

  const user = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
     ORDER BY u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    throw new Error('لا يوجد مستخدم ACCOUNTS — شغّل npm run seed:accounts أولاً');
  }
  const userId = user.rows[0].id as string;
  console.log(`المستخدم: ${user.rows[0].username} (${userId})`);
  await grantAccountsAdminRole(userId);

  // سنة ACTIVE موجودة أو إنشاء DEMO-FY
  let year = await query(
    `SELECT id, code, start_date::text AS start_date
     FROM accounts.fiscal_years WHERE status = 'ACTIVE'
     ORDER BY is_default DESC LIMIT 1`
  );
  let yearCreated = false;
  if (!year.rows[0]) {
    const insY = await query(
      `INSERT INTO accounts.fiscal_years
        (code, name_ar, start_date, end_date, status, is_default, created_by)
       VALUES ('DEMO-FY','سنة عرض DEMO','2026-01-01','2026-12-31','ACTIVE',TRUE,$1)
       RETURNING id, code, start_date::text AS start_date`,
      [userId]
    );
    year = insY;
    yearCreated = true;
    await query(
      `INSERT INTO accounts.fiscal_periods
        (fiscal_year_id, period_number, code, name_ar, start_date, end_date, status, created_by)
       VALUES ($1,1,'DEMO-P01','فترة عرض','2026-01-01','2026-12-31','OPEN',$2)`,
      [insY.rows[0].id, userId]
    );
    await withTransaction(async (client) => {
      await createDefaultSequencesForYear(client, insY.rows[0].id as string);
    });
    console.log('✓ أُنشئت سنة DEMO-FY + فترة DEMO-P01 + تسلسلات');
  } else {
    console.log(`✓ سنة فعالة موجودة: ${year.rows[0].code}`);
  }
  const yearId = year.rows[0].id as string;

  const period = await query(
    `SELECT id, code, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1 AND status = 'OPEN'
     ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN للسنة الفعالة');
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  console.log(`✓ فترة مفتوحة: ${period.rows[0].code} · تاريخ القيد/الجلسة: ${entryDate}`);

  // تسلسلات إن ناقصة
  const seq = await query(
    `SELECT 1 FROM accounts.document_sequences
     WHERE fiscal_year_id = $1 AND document_type = 'JOURNAL_ENTRY'`,
    [yearId]
  );
  if (!seq.rows[0]) {
    await withTransaction(async (client) => {
      await createDefaultSequencesForYear(client, yearId);
    });
    console.log('✓ أُنشئت تسلسلات المستندات للسنة');
  }

  // مركز كلفة
  let cc = await query(`SELECT id FROM accounts.cost_centers WHERE LOWER(code)=LOWER($1)`, [
    DEMO.costCenter,
  ]);
  if (!cc.rows[0]) {
    cc = await query(
      `INSERT INTO accounts.cost_centers
        (code, name_ar, level, is_group, is_active, created_by, description)
       VALUES ($1,'مركز كلفة عرض DEMO',1,FALSE,TRUE,$2,'DEMO')
       RETURNING id`,
      [DEMO.costCenter, userId]
    );
    console.log(`✓ مركز كلفة: ${DEMO.costCenter}`);
  } else {
    console.log(`✓ مركز كلفة موجود: ${DEMO.costCenter}`);
  }

  // حسابات DEMO
  const cashAcc = await ensureAccount({
    code: DEMO.cashAccount,
    nameAr: 'صندوق نقد DEMO',
    typeCode: 'ASSET',
    userId,
  });
  const gainAcc = await ensureAccount({
    code: DEMO.gainAccount,
    nameAr: 'زيادة جرد DEMO',
    typeCode: 'REVENUE',
    userId,
  });
  const lossAcc = await ensureAccount({
    code: DEMO.lossAccount,
    nameAr: 'عجز جرد DEMO',
    typeCode: 'EXPENSE',
    userId,
  });
  const contraAcc = await ensureAccount({
    code: DEMO.contraAccount,
    nameAr: 'مقابل قيود DEMO',
    typeCode: 'LIABILITY',
    userId,
  });
  console.log(
    `حسابات: ${DEMO.cashAccount}${cashAcc.created ? ' (جديد)' : ''} · ${DEMO.gainAccount} · ${DEMO.lossAccount} · ${DEMO.contraAccount}`
  );

  // أنواع الصناديق
  const boxType = await query(
    `SELECT code FROM accounts.cash_box_types WHERE UPPER(code)='MAIN' AND is_active`
  );
  if (!boxType.rows[0]) {
    throw new Error('نوع MAIN غير موجود — شغّل npm run seed:cash-box-types:execute');
  }

  // صندوق DEMO
  const box = await query(`SELECT id, status, version, updated_at FROM accounts.cash_boxes WHERE UPPER(code)=UPPER($1)`, [
    DEMO.cashBox,
  ]);
  let boxId: string;
  if (!box.rows[0]) {
    const created = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const b = await createCashBox(client, {
        code: DEMO.cashBox,
        name_ar: 'صندوق العرض الرئيسي DEMO',
        box_type_code: 'MAIN',
        account_id: cashAcc.id,
        cost_center_id: cc.rows[0].id,
        created_by: userId,
        description: 'صندوق عرض — DEMO',
      });
      await assignPrimaryCustodian(client, {
        cashBoxId: b.id,
        userId,
        createdBy: userId,
      });
      return activateCashBox(client, b.id, {
        version: b.version,
        updated_at: b.updated_at,
        activated_by: userId,
      });
    });
    boxId = created.id;
    console.log(`✓ صندوق فعّال: ${DEMO.cashBox} · أمين: ${user.rows[0].username}`);
  } else {
    boxId = box.rows[0].id as string;
    console.log(`✓ صندوق موجود: ${DEMO.cashBox} (${box.rows[0].status})`);
  }

  // إعدادات الفروقات — فقط إن كانت فارغة
  const beforeVar = await getCashVarianceSettings();
  if (
    !beforeVar.cash_variance_gain_account_id ||
    !beforeVar.cash_variance_loss_account_id
  ) {
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id:
          beforeVar.cash_variance_gain_account_id || gainAcc.id,
        cash_variance_loss_account_id:
          beforeVar.cash_variance_loss_account_id || lossAcc.id,
        userId,
      });
    });
    console.log('✓ هُيّئت حسابات فروقات الجرد (كانت ناقصة)');
  } else {
    console.log('✓ حسابات فروقات الجرد مهيأة مسبقاً — لم تُغيَّر');
  }

  // رصيد افتتاحي للصندوق إن كان صفراً
  const bal = await getAccountBookBalance(cashAcc.id);
  if (Math.abs(Number(bal.balance)) < 0.0005) {
    console.log('إنشاء قيد رصيد افتتاحي DEMO (1000)…');
    await postJe({
      userId,
      yearId,
      periodId,
      entryDate,
      debitAccountId: cashAcc.id,
      creditAccountId: contraAcc.id,
      amount: '1000',
      description: 'DEMO رصيد افتتاحي لصندوق العرض',
    });
  } else {
    console.log(`✓ رصيد حساب الصندوق DEMO: ${bal.balance}`);
  }

  const live = await query(
    `SELECT id, status FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1 AND status IN ('OPEN','CLOSING') LIMIT 1`,
    [boxId]
  );
  if (live.rows[0]) {
    console.log(
      `\n⚠ توجد جلسة حية على صندوق DEMO (${live.rows[0].status}) — تخطّي إنشاء جلسات العرض.\n  الرابط: /accounts/cashbox/sessions/${live.rows[0].id}`
    );
  } else {
    // جلسة فرق صفر مغلقة
    const zeroExists = await query(
      `SELECT id FROM accounts.cash_box_sessions
       WHERE cash_box_id = $1 AND notes = $2 LIMIT 1`,
      [boxId, DEMO.sessionZeroNotes]
    );
    if (!zeroExists.rows[0]) {
      const zeroDate = entryDate;
      console.log('\nإنشاء جلسة عرض بفرق صفر…');
      let s = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return openCashSession(client, {
          cash_box_id: boxId,
          fiscal_year_id: yearId,
          fiscal_period_id: periodId,
          session_date: zeroDate,
          opened_by: userId,
          notes: DEMO.sessionZeroNotes,
        });
      });
      s = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return startClosingCashSession(client, {
          sessionId: s.id,
          userId,
          version: s.version,
          updated_at: s.updated_at,
        });
      });
      const book = await getAccountBookBalance(cashAcc.id);
      const counted = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return recordCashCount(client, {
          sessionId: s.id,
          userId,
          counted_amount: book.balance,
          version: s.version,
          updated_at: s.updated_at,
          notes: 'جرد DEMO بفرق صفر',
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
      console.log(`✓ جلسة فرق صفر مغلقة: /accounts/cashbox/sessions/${s.id}`);
    } else {
      console.log(`✓ جلسة فرق صفر موجودة: ${zeroExists.rows[0].id}`);
    }

    // جلسة بفرق + تسوية (GAIN)
    const gainExists = await query(
      `SELECT id FROM accounts.cash_box_sessions
       WHERE cash_box_id = $1 AND notes = $2 LIMIT 1`,
      [boxId, DEMO.sessionGainNotes]
    );
    if (!gainExists.rows[0]) {
      // تاريخ مختلف لتجنب uq_cash_box_sessions_box_date
      const d = new Date(`${entryDate}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      let gainDate = d.toISOString().slice(0, 10);
      const end = pgDateOnly(period.rows[0].end_date as string);
      if (gainDate > end) gainDate = end;

      console.log('\nإنشاء جلسة عرض بفرق + تسوية…');
      let s = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return openCashSession(client, {
          cash_box_id: boxId,
          fiscal_year_id: yearId,
          fiscal_period_id: periodId,
          session_date: gainDate,
          opened_by: userId,
          notes: DEMO.sessionGainNotes,
        });
      });
      s = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return startClosingCashSession(client, {
          sessionId: s.id,
          userId,
          version: s.version,
          updated_at: s.updated_at,
        });
      });
      const book = await getAccountBookBalance(cashAcc.id);
      const countedAmt = normalizeMoneyInput(String(Number(book.balance) + 50));
      const counted = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        return recordCashCount(client, {
          sessionId: s.id,
          userId,
          counted_amount: countedAmt,
          version: s.version,
          updated_at: s.updated_at,
          notes: 'جرد DEMO بزيادة 50',
        });
      });
      const adj = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        await acquireJournalEntriesLock(client);
        return adjustCashCountVariance(client, {
          sessionId: counted.session.id,
          userId,
          version: counted.session.version,
          updated_at: counted.session.updated_at,
          notes: 'تسوية عرض DEMO',
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
      console.log(
        `✓ جلسة تسوية (GAIN) مغلقة: /accounts/cashbox/sessions/${s.id}`
      );
      console.log(`  تسوية: ${adj.adjustment.id} · اتجاه ${adj.adjustment.direction}`);
    } else {
      console.log(`✓ جلسة التسوية موجودة: ${gainExists.rows[0].id}`);
    }
  }

  // ——— 3.D: جلسة مفتوحة + سندات DEMO ———
  {
    let openSessionId: string | null = null;
    const liveAgain = await query(
      `SELECT id, status, version, updated_at FROM accounts.cash_box_sessions
       WHERE cash_box_id = $1 AND status = 'OPEN' LIMIT 1`,
      [boxId]
    );
    if (liveAgain.rows[0]) {
      openSessionId = liveAgain.rows[0].id as string;
      console.log(`\n✓ جلسة مفتوحة موجودة للسندات: ${openSessionId}`);
    } else {
      const openExists = await query(
        `SELECT id FROM accounts.cash_box_sessions
         WHERE cash_box_id = $1 AND notes = $2 LIMIT 1`,
        [boxId, DEMO.sessionOpenNotes]
      );
      if (openExists.rows[0]) {
        // كانت موجودة ثم أُغلقت — افتح تاريخاً جديداً
      }
      const d = new Date(`${entryDate}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 3);
      let openDate = d.toISOString().slice(0, 10);
      const end = pgDateOnly(period.rows[0].end_date as string);
      if (openDate > end) openDate = end;
      // تجنّب تعارض تاريخ موجود
      const clash = await query(
        `SELECT 1 FROM accounts.cash_box_sessions
         WHERE cash_box_id = $1 AND session_date = $2::date LIMIT 1`,
        [boxId, openDate]
      );
      if (clash.rows[0]) {
        const d2 = new Date(`${openDate}T12:00:00.000Z`);
        d2.setUTCDate(d2.getUTCDate() + 1);
        openDate = d2.toISOString().slice(0, 10);
        if (openDate > end) openDate = end;
      }
      try {
        const s = await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return openCashSession(client, {
            cash_box_id: boxId,
            fiscal_year_id: yearId,
            fiscal_period_id: periodId,
            session_date: openDate,
            opened_by: userId,
            notes: DEMO.sessionOpenNotes,
          });
        });
        openSessionId = s.id;
        console.log(`\n✓ جلسة مفتوحة للسندات: /accounts/cashbox/sessions/${s.id}`);
      } catch (e) {
        console.log('\n⚠ تعذر فتح جلسة سندات DEMO:', e instanceof Error ? e.message : e);
      }
    }

    if (openSessionId) {
      const sessRow = await query(
        `SELECT id, version, updated_at FROM accounts.cash_box_sessions WHERE id = $1`,
        [openSessionId]
      );
      const hasReceipt = await query(
        `SELECT id FROM accounts.cash_vouchers
         WHERE cash_box_session_id = $1 AND description = $2 LIMIT 1`,
        [openSessionId, DEMO.voucherReceiptNotes]
      );
      if (!hasReceipt.rows[0]) {
        const created = await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_RECEIPT',
            cash_box_id: boxId,
            cash_box_session_id: openSessionId!,
            counter_account_id: gainAcc.id,
            voucher_date: entryDate,
            amount: '150',
            party_name: 'طالب عرض DEMO',
            description: DEMO.voucherReceiptNotes,
            created_by: userId,
          });
        });
        await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return postCashVoucher(client, {
            id: created.id,
            userId,
            version: created.version,
            updated_at: created.updated_at,
          });
        });
        console.log(`✓ سند قبض POSTED: ${created.voucher_number}`);
      } else {
        console.log('✓ سند قبض DEMO موجود');
      }

      const hasPayment = await query(
        `SELECT id FROM accounts.cash_vouchers
         WHERE cash_box_session_id = $1 AND description = $2 LIMIT 1`,
        [openSessionId, DEMO.voucherPaymentNotes]
      );
      if (!hasPayment.rows[0]) {
        const created = await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_PAYMENT',
            cash_box_id: boxId,
            cash_box_session_id: openSessionId!,
            counter_account_id: lossAcc.id,
            voucher_date: entryDate,
            amount: '40',
            party_name: 'مورد عرض DEMO',
            description: DEMO.voucherPaymentNotes,
            created_by: userId,
          });
        });
        await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return postCashVoucher(client, {
            id: created.id,
            userId,
            version: created.version,
            updated_at: created.updated_at,
          });
        });
        console.log(`✓ سند صرف POSTED: ${created.voucher_number}`);
      } else {
        console.log('✓ سند صرف DEMO موجود');
      }

      const hasDraft = await query(
        `SELECT id FROM accounts.cash_vouchers
         WHERE cash_box_session_id = $1 AND description = $2 LIMIT 1`,
        [openSessionId, DEMO.voucherDraftNotes]
      );
      if (!hasDraft.rows[0]) {
        const created = await withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashVoucher(client, {
            voucher_type: 'CASH_RECEIPT',
            cash_box_id: boxId,
            cash_box_session_id: openSessionId!,
            counter_account_id: gainAcc.id,
            voucher_date: entryDate,
            amount: '25',
            party_name: 'مسودة DEMO',
            description: DEMO.voucherDraftNotes,
            created_by: userId,
          });
        });
        console.log(`✓ سند مسودة DRAFT: ${created.voucher_number}`);
      } else {
        console.log('✓ سند مسودة DEMO موجود');
      }
      void sessRow;
    }
  }

  // ——— 3.E: صندوق مستلم + CIT + تحويلات DEMO ———
  {
    const citAcc = await ensureAccount({
      code: DEMO.citAccount,
      nameAr: 'نقد بالطريق DEMO',
      typeCode: 'ASSET',
      userId,
    });
    const destCashAcc = await ensureAccount({
      code: 'DEMO-CASH-2',
      nameAr: 'صندوق نقدي فرعي DEMO',
      typeCode: 'ASSET',
      userId,
    });

    const citCurrent = await getCashInTransitAccountId();
    if (!citCurrent) {
      await withTransaction(async (client) => {
        await setCashInTransitAccount(client, {
          cash_in_transit_account_id: citAcc.id,
          userId,
        });
      });
      console.log(`✓ حساب CIT: ${DEMO.citAccount}`);
    } else {
      console.log('✓ حساب CIT مهيأ مسبقاً');
    }

    let destBoxId: string | null = null;
    const destExists = await query(
      `SELECT id, status FROM accounts.cash_boxes WHERE LOWER(code) = LOWER($1)`,
      [DEMO.cashBoxDest]
    );
    if (destExists.rows[0]) {
      destBoxId = destExists.rows[0].id as string;
      console.log(`✓ صندوق مستلم DEMO موجود: ${DEMO.cashBoxDest}`);
    } else {
      const created = await withTransaction(async (client) => {
        await acquireCashBoxesLock(client);
        const box = await createCashBox(client, {
          code: DEMO.cashBoxDest,
          name_ar: 'صندوق فرعي DEMO',
          box_type_code: 'MAIN',
          account_id: destCashAcc.id,
          created_by: userId,
        });
        await assignPrimaryCustodian(client, {
          cashBoxId: box.id,
          userId,
          createdBy: userId,
        });
        return activateCashBox(client, box.id, {
          version: box.version,
          updated_at: box.updated_at,
          activated_by: userId,
        });
      });
      destBoxId = created.id;
      console.log(`✓ صندوق مستلم DEMO: ${DEMO.cashBoxDest}`);
    }

    // جلسات مفتوحة للمرسل والمستلم
    let srcOpenId: string | null = null;
    const srcLive = await query(
      `SELECT id FROM accounts.cash_box_sessions
       WHERE cash_box_id = $1 AND status = 'OPEN' LIMIT 1`,
      [boxId]
    );
    if (srcLive.rows[0]) srcOpenId = srcLive.rows[0].id as string;

    let dstOpenId: string | null = null;
    if (destBoxId) {
      const dstLive = await query(
        `SELECT id FROM accounts.cash_box_sessions
         WHERE cash_box_id = $1 AND status = 'OPEN' LIMIT 1`,
        [destBoxId]
      );
      if (dstLive.rows[0]) {
        dstOpenId = dstLive.rows[0].id as string;
      } else {
        const d = new Date(`${entryDate}T12:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 5);
        let destDate = d.toISOString().slice(0, 10);
        const end = pgDateOnly(period.rows[0].end_date as string);
        if (destDate > end) destDate = end;
        try {
          const s = await withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            return openCashSession(client, {
              cash_box_id: destBoxId!,
              fiscal_year_id: yearId,
              fiscal_period_id: periodId,
              session_date: destDate,
              opened_by: userId,
              notes: 'DEMO-SESSION-DEST-OPEN',
            });
          });
          dstOpenId = s.id;
          console.log(`✓ جلسة مستلم مفتوحة: /accounts/cashbox/sessions/${s.id}`);
        } catch (e) {
          console.log('⚠ جلسة المستلم:', e instanceof Error ? e.message : e);
        }
      }
    }

    if (srcOpenId && destBoxId && dstOpenId) {
      const hasReceived = await query(
        `SELECT id FROM accounts.cash_transfers WHERE description = $1 LIMIT 1`,
        [DEMO.transferReceivedNotes]
      );
      if (!hasReceived.rows[0]) {
        try {
          const t = await withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            const created = await createCashTransfer(client, {
              source_cash_box_id: boxId,
              source_session_id: srcOpenId!,
              destination_cash_box_id: destBoxId!,
              transfer_date: entryDate,
              amount: '30',
              description: DEMO.transferReceivedNotes,
              created_by: userId,
            });
            await acquireJournalEntriesLock(client);
            const d = await dispatchCashTransfer(client, {
              id: created.id,
              userId,
              version: created.version,
              updated_at: created.updated_at,
            });
            return receiveCashTransfer(client, {
              id: d.transfer.id,
              userId,
              version: d.transfer.version,
              updated_at: d.transfer.updated_at,
              destination_session_id: dstOpenId!,
            });
          });
          console.log(`✓ تحويل RECEIVED: ${t.transfer.transfer_number}`);
        } catch (e) {
          console.log('⚠ تحويل RECEIVED:', e instanceof Error ? e.message : e);
        }
      } else console.log('✓ تحويل RECEIVED DEMO موجود');

      const hasDisp = await query(
        `SELECT id FROM accounts.cash_transfers WHERE description = $1 LIMIT 1`,
        [DEMO.transferDispatchedNotes]
      );
      if (!hasDisp.rows[0]) {
        try {
          const t = await withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            const created = await createCashTransfer(client, {
              source_cash_box_id: boxId,
              source_session_id: srcOpenId!,
              destination_cash_box_id: destBoxId!,
              transfer_date: entryDate,
              amount: '20',
              description: DEMO.transferDispatchedNotes,
              created_by: userId,
            });
            await acquireJournalEntriesLock(client);
            return dispatchCashTransfer(client, {
              id: created.id,
              userId,
              version: created.version,
              updated_at: created.updated_at,
            });
          });
          console.log(`✓ تحويل DISPATCHED: ${t.transfer.transfer_number}`);
        } catch (e) {
          console.log('⚠ تحويل DISPATCHED:', e instanceof Error ? e.message : e);
        }
      } else console.log('✓ تحويل DISPATCHED DEMO موجود');

      const hasDraftT = await query(
        `SELECT id FROM accounts.cash_transfers WHERE description = $1 LIMIT 1`,
        [DEMO.transferDraftNotes]
      );
      if (!hasDraftT.rows[0]) {
        try {
          const t = await withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            return createCashTransfer(client, {
              source_cash_box_id: boxId,
              source_session_id: srcOpenId!,
              destination_cash_box_id: destBoxId!,
              transfer_date: entryDate,
              amount: '15',
              description: DEMO.transferDraftNotes,
              created_by: userId,
            });
          });
          console.log(`✓ تحويل DRAFT: ${t.transfer_number}`);
        } catch (e) {
          console.log('⚠ تحويل DRAFT:', e instanceof Error ? e.message : e);
        }
      } else console.log('✓ تحويل DRAFT DEMO موجود');
    } else {
      console.log('⚠ تخطّي تحويلات DEMO (يلزم جلسات مفتوحة للمرسل والمستلم)');
    }
  }

  // ——— 4.A: مصارف وحسابات DEMO ———
  {
    const bankGl = await ensureAccount({
      code: DEMO.bankGl,
      nameAr: 'حساب بنك تشغيلي DEMO',
      typeCode: 'ASSET',
      userId,
    });
    const bankGlUsd = await ensureAccount({
      code: DEMO.bankGlUsd,
      nameAr: 'حساب بنك دولار DEMO',
      typeCode: 'ASSET',
      userId,
    });

    let bankId: string | null = null;
    const bankEx = await query(
      `SELECT id FROM accounts.banks WHERE LOWER(code)=LOWER($1)`,
      [DEMO.bank]
    );
    if (bankEx.rows[0]) {
      bankId = bankEx.rows[0].id as string;
      console.log(`✓ مصرف DEMO موجود: ${DEMO.bank}`);
    } else {
      const b = await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBank(client, {
          code: DEMO.bank,
          name_ar: 'مصرف الشرق التجريبي',
          name_en: 'Demo Orient Bank',
          short_name: 'شرق DEMO',
          swift_code: 'ORIEIQBA',
          country_code: 'IQ',
          created_by: userId,
        });
      });
      bankId = b.id;
      console.log(`✓ مصرف DEMO: ${DEMO.bank} → /accounts/banks`);
    }

    let branchId: string | null = null;
    if (bankId) {
      const brEx = await query(
        `SELECT id FROM accounts.bank_branches WHERE bank_id=$1 AND LOWER(code)=LOWER($2)`,
        [bankId, DEMO.bankBranch]
      );
      if (brEx.rows[0]) {
        branchId = brEx.rows[0].id as string;
        console.log(`✓ فرع DEMO موجود: ${DEMO.bankBranch}`);
      } else {
        const br = await withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankBranch(client, {
            bank_id: bankId!,
            code: DEMO.bankBranch,
            name_ar: 'فرع البصرة الرئيسي',
            city: 'البصرة',
            created_by: userId,
          });
        });
        branchId = br.id;
        console.log(`✓ فرع DEMO: ${DEMO.bankBranch}`);
      }
    }

    if (bankId && branchId) {
      const baEx = await query(
        `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
        [DEMO.bankAccountIqd]
      );
      if (baEx.rows[0]) {
        console.log(`✓ حساب بنكي IQD DEMO موجود: ${DEMO.bankAccountIqd}`);
        console.log(`  الرابط: /accounts/banks/${baEx.rows[0].id}`);
      } else {
        try {
          const ba = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: DEMO.bankAccountIqd,
              bank_id: bankId!,
              bank_branch_id: branchId!,
              account_name_ar: 'حساب كلية الشرق التشغيلي DEMO',
              account_name_en: 'College Operating Account DEMO',
              account_number: '001122334455',
              iban: 'IQ20ORIE001122334455667',
              currency_code: 'IQD',
              gl_account_id: bankGl.id,
              account_type: 'CURRENT',
              is_primary: true,
              allows_receipts: true,
              allows_payments: true,
              allows_transfers: true,
              allows_cheques: true,
              cheque_book_enabled: true,
              opening_balance_reference: '0',
              opening_balance_date: entryDate,
              notes: 'حساب عرض DEMO — رصيد مرجعي وليس قيداً',
              created_by: userId,
            });
          });
          console.log(`✓ حساب بنكي IQD: ${ba.code} → /accounts/banks/${ba.id}`);
        } catch (e) {
          console.log('⚠ حساب IQD:', e instanceof Error ? e.message : e);
        }
      }

      const baUsdEx = await query(
        `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
        [DEMO.bankAccountUsd]
      );
      if (baUsdEx.rows[0]) {
        console.log(`✓ حساب بنكي USD DEMO موجود: ${DEMO.bankAccountUsd}`);
      } else {
        try {
          const ba = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: DEMO.bankAccountUsd,
              bank_id: bankId!,
              bank_branch_id: branchId!,
              account_name_ar: 'حساب كلية الشرق دولار DEMO',
              account_number: '009988776655',
              currency_code: 'USD',
              gl_account_id: bankGlUsd.id,
              account_type: 'CURRENT',
              is_primary: true,
              allows_receipts: true,
              allows_payments: true,
              allows_transfers: true,
              allows_cheques: false,
              created_by: userId,
            });
          });
          console.log(`✓ حساب بنكي USD: ${ba.code} → /accounts/banks/${ba.id}`);
        } catch (e) {
          console.log('⚠ حساب USD:', e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // ——— 4.B: سندات بنكية DEMO ———
  {
    const baRow = await query(
      `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
      [DEMO.bankAccountIqd]
    );
    if (!baRow.rows[0]) {
      console.log('⚠ تخطّي سندات بنكية DEMO (DEMO-BA-IQD غير موجود)');
    } else {
      const demoBaId = baRow.rows[0].id as string;

      // تعيين مستخدم seed + accounts بصلاحيات كاملة (upsert)
      const assignIds = new Set<string>([userId]);
      const accountsUser = await query(
        `SELECT u.id FROM student_affairs.users u
         WHERE LOWER(u.username) = 'accounts' AND u.is_active LIMIT 1`
      );
      if (accountsUser.rows[0]) assignIds.add(accountsUser.rows[0].id as string);

      for (const uid of assignIds) {
        try {
          await withTransaction(async (client) => {
            await acquireBanksLock(client);
            return assignBankAccountUser(client, {
              bank_account_id: demoBaId,
              user_id: uid,
              can_view: true,
              can_prepare: true,
              can_post: true,
              can_reconcile: true,
              created_by: userId,
            });
          });
        } catch (e) {
          console.log('⚠ تعيين مستخدم بنك:', e instanceof Error ? e.message : e);
        }
      }
      console.log('✓ تعيين مستخدمي الحساب البنكي DEMO (view/prepare/post/reconcile)');

      // مقابل القبض: DEMO-GAIN · مقابل الصرف: DEMO-LOSS
      const gainAcc = await ensureAccount({
        code: DEMO.gainAccount,
        nameAr: 'إيراد فروق DEMO',
        typeCode: 'ASSET',
        userId,
      });
      const lossAcc = await ensureAccount({
        code: DEMO.lossAccount,
        nameAr: 'خسارة فروق DEMO',
        typeCode: 'ASSET',
        userId,
      });

      const hasBv = async (marker: string) => {
        const r = await query(
          `SELECT id, status, voucher_number FROM accounts.bank_vouchers
           WHERE description ILIKE '%' || $1 || '%'
              OR COALESCE(party_reference,'') = $1
           LIMIT 1`,
          [marker]
        );
        return r.rows[0] as
          | { id: string; status: string; voucher_number: string }
          | undefined;
      };

      // قبض مرحّل ~5000
      const existingReceipt = await hasBv(DEMO.bankVoucherReceipt);
      if (existingReceipt) {
        console.log(
          `✓ سند قبض بنكي DEMO موجود: ${existingReceipt.voucher_number} → /accounts/banks/vouchers/${existingReceipt.id}`
        );
      } else {
        try {
          const posted = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            const v = await createBankVoucher(client, {
              voucher_type: 'BANK_RECEIPT',
              bank_account_id: demoBaId,
              counter_account_id: gainAcc.id,
              voucher_date: entryDate,
              amount: '5000',
              party_name: 'عرض DEMO',
              party_reference: DEMO.bankVoucherReceipt,
              description: `${DEMO.bankVoucherReceipt} — قبض مصرفي تجريبي`,
              created_by: userId,
            });
            await acquireJournalEntriesLock(client);
            return postBankVoucher(client, {
              id: v.id,
              userId,
              version: v.version,
              updated_at: v.updated_at,
            });
          });
          console.log(
            `✓ سند قبض بنكي مرحّل: ${posted.voucher.voucher_number} → /accounts/banks/vouchers/${posted.voucher.id}`
          );
        } catch (e) {
          console.log('⚠ DEMO-BV-RECEIPT:', e instanceof Error ? e.message : e);
        }
      }

      // صرف مرحّل ~1000
      const existingPayment = await hasBv(DEMO.bankVoucherPayment);
      if (existingPayment) {
        console.log(
          `✓ سند صرف بنكي DEMO موجود: ${existingPayment.voucher_number} → /accounts/banks/vouchers/${existingPayment.id}`
        );
      } else {
        try {
          const posted = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            const v = await createBankVoucher(client, {
              voucher_type: 'BANK_PAYMENT',
              bank_account_id: demoBaId,
              counter_account_id: lossAcc.id,
              voucher_date: entryDate,
              amount: '1000',
              party_name: 'عرض DEMO',
              party_reference: DEMO.bankVoucherPayment,
              description: `${DEMO.bankVoucherPayment} — صرف مصرفي تجريبي`,
              created_by: userId,
            });
            await acquireJournalEntriesLock(client);
            return postBankVoucher(client, {
              id: v.id,
              userId,
              version: v.version,
              updated_at: v.updated_at,
            });
          });
          console.log(
            `✓ سند صرف بنكي مرحّل: ${posted.voucher.voucher_number} → /accounts/banks/vouchers/${posted.voucher.id}`
          );
        } catch (e) {
          console.log('⚠ DEMO-BV-PAYMENT:', e instanceof Error ? e.message : e);
        }
      }

      // مسودة
      const existingDraft = await hasBv(DEMO.bankVoucherDraft);
      if (existingDraft) {
        console.log(
          `✓ مسودة سند بنكي DEMO موجودة: ${existingDraft.voucher_number} → /accounts/banks/vouchers/${existingDraft.id}`
        );
      } else {
        try {
          const draft = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankVoucher(client, {
              voucher_type: 'BANK_RECEIPT',
              bank_account_id: demoBaId,
              counter_account_id: gainAcc.id,
              voucher_date: entryDate,
              amount: '250',
              party_name: 'عرض DEMO',
              party_reference: DEMO.bankVoucherDraft,
              description: `${DEMO.bankVoucherDraft} — مسودة قبض مصرفي`,
              created_by: userId,
            });
          });
          console.log(
            `✓ مسودة سند بنكي: ${draft.voucher_number} → /accounts/banks/vouchers/${draft.id}`
          );
        } catch (e) {
          console.log('⚠ DEMO-BV-DRAFT:', e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // ——— 4.C: تحويلات بنكية DEMO ———
  {
    const ba1 = await query(
      `SELECT id, bank_id, bank_branch_id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
      [DEMO.bankAccountIqd]
    );
    if (!ba1.rows[0]) {
      console.log('⚠ تخطّي تحويلات بنكية DEMO (DEMO-BA-IQD غير موجود)');
    } else {
      const sourceBaId = ba1.rows[0].id as string;
      const bankId = ba1.rows[0].bank_id as string;
      const branchId = ba1.rows[0].bank_branch_id as string | null;

      const bankGl2 = await ensureAccount({
        code: DEMO.bankGl2,
        nameAr: 'بنك GL ثانٍ DEMO',
        typeCode: 'ASSET',
        userId,
      });
      const feeAcc = await ensureAccount({
        code: DEMO.bankFeeAccount,
        nameAr: 'رسوم مصرفية DEMO',
        typeCode: 'EXPENSE',
        userId,
      });

      let destBaId: string | null = null;
      const ba2Ex = await query(
        `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
        [DEMO.bankAccountIqd2]
      );
      if (ba2Ex.rows[0]) {
        destBaId = ba2Ex.rows[0].id as string;
        console.log(`✓ حساب بنكي IQD ثانٍ DEMO موجود: ${DEMO.bankAccountIqd2}`);
      } else {
        try {
          const ba2 = await withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: DEMO.bankAccountIqd2,
              bank_id: bankId,
              bank_branch_id: branchId,
              account_name_ar: 'حساب كلية الشرق دينار ثانٍ DEMO',
              account_number: '112233445566',
              currency_code: 'IQD',
              gl_account_id: bankGl2.id,
              account_type: 'CURRENT',
              is_primary: false,
              allows_receipts: true,
              allows_payments: true,
              allows_transfers: true,
              allows_cheques: false,
              created_by: userId,
            });
          });
          destBaId = ba2.id;
          console.log(
            `✓ حساب بنكي IQD ثانٍ: ${ba2.code} → /accounts/banks/${ba2.id}`
          );
        } catch (e) {
          console.log('⚠ DEMO-BA-IQD-2:', e instanceof Error ? e.message : e);
        }
      }

      if (destBaId) {
        const assignIds = new Set<string>([userId]);
        const accountsUser = await query(
          `SELECT u.id FROM student_affairs.users u
           WHERE LOWER(u.username) = 'accounts' AND u.is_active LIMIT 1`
        );
        if (accountsUser.rows[0]) assignIds.add(accountsUser.rows[0].id as string);
        for (const uid of assignIds) {
          for (const baId of [sourceBaId, destBaId]) {
            try {
              await withTransaction(async (client) => {
                await acquireBanksLock(client);
                return assignBankAccountUser(client, {
                  bank_account_id: baId,
                  user_id: uid,
                  can_view: true,
                  can_prepare: true,
                  can_post: true,
                  can_reconcile: true,
                  created_by: userId,
                });
              });
            } catch {
              /* موجود مسبقاً */
            }
          }
        }

        const hasBt = async (marker: string) => {
          const r = await query(
            `SELECT id, status, transfer_number FROM accounts.bank_transfers
             WHERE description ILIKE '%' || $1 || '%'
                OR COALESCE(external_reference,'') = $1
             LIMIT 1`,
            [marker]
          );
          return r.rows[0] as
            | { id: string; status: string; transfer_number: string }
            | undefined;
        };

        const existingPlain = await hasBt(DEMO.bankTransferPlain);
        if (existingPlain) {
          console.log(
            `✓ تحويل بنكي بدون رسوم DEMO موجود: ${existingPlain.transfer_number} → /accounts/banks/transfers/${existingPlain.id}`
          );
        } else {
          try {
            const posted = await withTransaction(async (client) => {
              await acquireBanksLock(client);
              await acquireJournalEntriesLock(client);
              const t = await createBankTransfer(client, {
                source_bank_account_id: sourceBaId,
                destination_bank_account_id: destBaId,
                transfer_date: entryDate,
                amount: '800',
                fee_amount: '0',
                external_reference: DEMO.bankTransferPlain,
                description: `${DEMO.bankTransferPlain} — تحويل بدون رسوم`,
                created_by: userId,
              });
              const p = await postBankTransfer(client, {
                id: t.id,
                userId,
                version: t.version,
                updated_at: t.updated_at,
              });
              return p.transfer;
            });
            console.log(
              `✓ تحويل بدون رسوم: ${posted.transfer_number} → /accounts/banks/transfers/${posted.id}`
            );
          } catch (e) {
            console.log('⚠ DEMO-BT-PLAIN:', e instanceof Error ? e.message : e);
          }
        }

        const existingFee = await hasBt(DEMO.bankTransferFee);
        if (existingFee) {
          console.log(
            `✓ تحويل بنكي برسوم DEMO موجود: ${existingFee.transfer_number} → /accounts/banks/transfers/${existingFee.id}`
          );
        } else {
          try {
            const posted = await withTransaction(async (client) => {
              await acquireBanksLock(client);
              await acquireJournalEntriesLock(client);
              const t = await createBankTransfer(client, {
                source_bank_account_id: sourceBaId,
                destination_bank_account_id: destBaId,
                transfer_date: entryDate,
                amount: '300',
                fee_amount: '5',
                fee_expense_account_id: feeAcc.id,
                external_reference: DEMO.bankTransferFee,
                description: `${DEMO.bankTransferFee} — تحويل مع رسوم`,
                created_by: userId,
              });
              const p = await postBankTransfer(client, {
                id: t.id,
                userId,
                version: t.version,
                updated_at: t.updated_at,
              });
              return p.transfer;
            });
            console.log(
              `✓ تحويل مع رسوم: ${posted.transfer_number} → /accounts/banks/transfers/${posted.id}`
            );
          } catch (e) {
            console.log('⚠ DEMO-BT-FEE:', e instanceof Error ? e.message : e);
          }
        }

        const existingDraft = await hasBt(DEMO.bankTransferDraft);
        if (existingDraft) {
          console.log(
            `✓ مسودة تحويل بنكي DEMO موجودة: ${existingDraft.transfer_number} → /accounts/banks/transfers/${existingDraft.id}`
          );
        } else {
          try {
            const draft = await withTransaction(async (client) => {
              await acquireBanksLock(client);
              return createBankTransfer(client, {
                source_bank_account_id: sourceBaId,
                destination_bank_account_id: destBaId,
                transfer_date: entryDate,
                amount: '100',
                fee_amount: '0',
                external_reference: DEMO.bankTransferDraft,
                description: `${DEMO.bankTransferDraft} — مسودة تحويل`,
                created_by: userId,
              });
            });
            console.log(
              `✓ مسودة تحويل: ${draft.transfer_number} → /accounts/banks/transfers/${draft.id}`
            );
          } catch (e) {
            console.log('⚠ DEMO-BT-DRAFT:', e instanceof Error ? e.message : e);
          }
        }
      }
    }
  }

  // ——— 4.D: كشوف وتسوية ———
  try {
    const bankRow = await query(
      `SELECT id FROM accounts.banks WHERE LOWER(code)=LOWER($1)`,
      [DEMO.bank]
    );
    const branchRow = await query(
      `SELECT id FROM accounts.bank_branches WHERE LOWER(code)=LOWER($1)`,
      [DEMO.bankBranch]
    );
    const contra = await ensureAccount({
      code: DEMO.contraAccount,
      nameAr: 'حساب مقابل DEMO',
      typeCode: 'REVENUE',
      userId,
    });
    if (bankRow.rows[0] && branchRow.rows[0]) {
      await seedBankReconciliationDemo({
        userId,
        entryDate,
        bankId: bankRow.rows[0].id as string,
        branchId: branchRow.rows[0].id as string,
        ensureAccount,
        contraAccountId: contra.id,
      });
    }
  } catch (e) {
    console.log('⚠ 4.D seed:', e instanceof Error ? e.message : e);
  }

  try {
    await seedStudentReceivablesDemo({
      userId,
      entryDate,
      ensureAccount,
    });
  } catch (e) {
    console.log('⚠ 5.A seed:', e instanceof Error ? e.message : e);
  }

  try {
    await seedStudentBillingDemo({
      userId,
      entryDate,
      yearId,
      periodId,
    });
  } catch (e) {
    console.log('⚠ 5.B seed:', e instanceof Error ? e.message : e);
  }

  try {
    await seedStudentReliefsDemo({ userId, entryDate });
  } catch (e) {
    console.log('⚠ 5.C.1 seed:', e instanceof Error ? e.message : e);
  }

  try {
    await seedStudentCreditNotesRefundsDemo({ userId, entryDate });
  } catch (e) {
    console.log('⚠ 5.C.2 seed:', e instanceof Error ? e.message : e);
  }

  try {
    await seedSupplierPayablesDemo({
      userId,
      entryDate,
      ensureAccount,
    });
  } catch (e) {
    console.log('⚠ 6.A seed:', e instanceof Error ? e.message : e);
  }
  try {
    await seedSupplierPaymentsExpensesDemo({ userId, entryDate, ensureAccount });
  } catch (e) {
    console.log('⚠ 6.B seed:', e instanceof Error ? e.message : e);
  }
  try {
    await seedPurchasingDemo({ userId, entryDate, ensureAccount });
  } catch (e) {
    console.log('⚠ 7.A seed:', e instanceof Error ? e.message : e);
  }

  console.log('\n——— ملخص العرض ———');
  console.log(`صناديق: ${DEMO.cashBox} → ${DEMO.cashBoxDest}`);
  console.log(
    `مصرف: ${DEMO.bank} / ${DEMO.bankBranch} / ${DEMO.bankAccountIqd} → ${DEMO.bankAccountIqd2}`
  );
  console.log(
    `سندات بنكية: ${DEMO.bankVoucherReceipt} · ${DEMO.bankVoucherPayment} · ${DEMO.bankVoucherDraft}`
  );
  console.log(
    `تحويلات بنكية: ${DEMO.bankTransferPlain} · ${DEMO.bankTransferFee} · ${DEMO.bankTransferDraft}`
  );
  console.log(
    `تسوية: ${DEMO.bankStmtDraft} · ${DEMO.bankStmtProgress} · ${DEMO.bankStmtClosed} (${DEMO.bankAccountRecon})`
  );
  console.log(
    `حسابات: ${DEMO.cashAccount} / ${DEMO.citAccount} / ${DEMO.bankGl} / ${DEMO.bankFeeAccount}`
  );
  console.log(
    'صفحات: /accounts/cashbox · /accounts/cashbox/transfers · /accounts/banks · /accounts/banks/vouchers · /accounts/banks/transfers · /accounts/banks/reconciliation · /accounts/students'
  );
  console.log(
    yearCreated
      ? 'ملاحظة: أُنشئت سنة DEMO-FY لأنها لم تكن موجودة.'
      : 'ملاحظة: استُخدمت السنة الفعالة الحالية دون حذف بيانات.'
  );
  console.log('✅ انتهى seed:accounts-demo');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
