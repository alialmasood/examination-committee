/**
 * بيانات عرض آمنة لنظام الحسابات (أكواد DEMO فقط).
 * لا يحذف ولا يعدّل بيانات غير DEMO.
 * لا يمس إعدادات فروقات الجرد إن كانت مهيأة مسبقاً.
 *
 * npm run seed:accounts-demo
 */
import { closePool, query } from '../lib/db';
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
  getCashVarianceSettings,
  setCashVarianceSettings,
} from '../lib/accounts/cash-settings';
import { createDefaultSequencesForYear, pgDateOnly } from '../lib/accounts/document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { normalizeMoneyInput } from '../lib/accounts/money';
import {
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
  sessionZeroNotes: 'DEMO-SESSION-ZERO',
  sessionGainNotes: 'DEMO-SESSION-GAIN',
  sessionOpenNotes: 'DEMO-SESSION-OPEN',
  voucherReceiptNotes: 'DEMO-VOUCHER-RECEIPT',
  voucherPaymentNotes: 'DEMO-VOUCHER-PAYMENT',
  voucherDraftNotes: 'DEMO-VOUCHER-DRAFT',
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

  console.log('\n——— ملخص العرض ———');
  console.log(`صندوق: ${DEMO.cashBox}`);
  console.log(`حسابات: ${DEMO.cashAccount} / ${DEMO.gainAccount} / ${DEMO.lossAccount}`);
  console.log(
    'صفحات: /accounts · /accounts/cashbox · /accounts/cashbox/sessions · /accounts/cashbox/vouchers'
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
