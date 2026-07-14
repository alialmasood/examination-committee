/**
 * بيانات عرض 5.B — خطط رسوم وأقساط وتحصيلات DEMO.
 * يُستدعى من seed-accounts-demo بعد seedStudentReceivablesDemo (idempotent عبر external_reference).
 */
import { query } from '../lib/db';
import {
  activateStudentBillingPlan,
  createStudentBillingPlan,
  listPlanInstallments,
} from '../lib/accounts/student-billing-plans';
import {
  createStudentCollection,
  postStudentCollection,
  voidStudentCollection,
} from '../lib/accounts/student-collections';
import { assignBankAccountUser } from '../lib/accounts/bank-accounts';
import { openCashSession } from '../lib/accounts/cash-box-sessions';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  acquireBanksLock,
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

const M = {
  studentUni: 'DEMO-STU-001',
  recvGl: 'DEMO-RECV-GL',
  feeTuition: 'DEMO-FEE-TUITION',
  cashBox: 'DEMO-CB-MAIN',
  cashAccount: 'DEMO-CASH',
  bankAccount: 'DEMO-BA-IQD',
  plan: 'DEMO-SBP-3INST',
  cashPosted: 'DEMO-SCL-CASH-POSTED',
  bankPosted: 'DEMO-SCL-BANK-POSTED',
  draft: 'DEMO-SCL-DRAFT',
  voided: 'DEMO-SCL-VOID',
  sessionNotes: 'DEMO-SESSION-BILLING-OPEN',
} as const;

async function findCollectionByExt(ref: string) {
  const r = await query(
    `SELECT id, status, version, updated_at, collection_number, amount::text AS amount
     FROM accounts.student_collections
     WHERE external_reference = $1
     LIMIT 1`,
    [ref]
  );
  return r.rows[0] as
    | {
        id: string;
        status: string;
        version: number;
        updated_at: string;
        collection_number: string;
        amount: string;
      }
    | undefined;
}

async function findPlanByExt(ref: string) {
  const r = await query(
    `SELECT id, status, version, updated_at, plan_number, total_amount::text AS total_amount
     FROM accounts.student_billing_plans
     WHERE external_reference = $1
     LIMIT 1`,
    [ref]
  );
  return r.rows[0] as
    | {
        id: string;
        status: string;
        version: number;
        updated_at: string;
        plan_number: string;
        total_amount: string;
      }
    | undefined;
}

async function ensureOpenCashSession(params: {
  userId: string;
  yearId: string;
  periodId: string;
  entryDate: string;
}): Promise<{ boxId: string; sessionId: string } | null> {
  const box = await query(
    `SELECT id FROM accounts.cash_boxes WHERE UPPER(code) = UPPER($1) LIMIT 1`,
    [M.cashBox]
  );
  if (!box.rows[0]) {
    console.log(`⚠ صندوق ${M.cashBox} غير موجود — تخطّي تحصيلات نقدية DEMO`);
    return null;
  }
  const boxId = box.rows[0].id as string;

  const live = await query(
    `SELECT id FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1::uuid AND status = 'OPEN'
     LIMIT 1`,
    [boxId]
  );
  if (live.rows[0]) {
    return { boxId, sessionId: live.rows[0].id as string };
  }

  const existing = await query(
    `SELECT id FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1::uuid AND notes = $2
     LIMIT 1`,
    [boxId, M.sessionNotes]
  );
  if (existing.rows[0]) {
    console.log(
      `⚠ لا جلسة OPEN على ${M.cashBox} (جلسة ${M.sessionNotes} موجودة لكنها ليست مفتوحة) — تخطّي تحصيلات نقدية DEMO`
    );
    return null;
  }

  let sessionDate = pgDateOnly(params.entryDate);
  const clash = await query(
    `SELECT 1 FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1::uuid AND session_date = $2::date LIMIT 1`,
    [boxId, sessionDate]
  );
  if (clash.rows[0]) {
    const d = new Date(`${sessionDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    sessionDate = d.toISOString().slice(0, 10);
  }

  try {
    const s = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: boxId,
        fiscal_year_id: params.yearId,
        fiscal_period_id: params.periodId,
        session_date: sessionDate,
        opened_by: params.userId,
        notes: M.sessionNotes,
      });
    });
    console.log(`✓ جلسة نقد مفتوحة للتحصيل DEMO: /accounts/cashbox/sessions/${s.id}`);
    return { boxId, sessionId: s.id };
  } catch (e) {
    console.log(
      '⚠ تعذر فتح جلسة نقد DEMO للتحصيل:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

export async function seedStudentBillingDemo(params: {
  userId: string;
  entryDate: string;
  yearId: string;
  periodId: string;
}): Promise<void> {
  const { userId, entryDate, yearId, periodId } = params;
  console.log('\n——— 5.B: خطط رسوم وتحصيلات DEMO ———');

  const student = await query(
    `SELECT s.id FROM student_affairs.students s
     WHERE s.university_id = $1 OR s.student_number = $1
     LIMIT 1`,
    [M.studentUni]
  );
  if (!student.rows[0]) {
    console.log(`⚠ ${M.studentUni} غير موجود — شغّل seedStudentReceivablesDemo أولاً`);
    return;
  }

  const account = await query(
    `SELECT sa.id, sa.account_number
     FROM accounts.student_accounts sa
     WHERE sa.student_id = $1::uuid AND sa.currency_code = 'IQD'
     LIMIT 1`,
    [student.rows[0].id]
  );
  if (!account.rows[0]) {
    console.log(`⚠ حساب مالي لـ ${M.studentUni} غير موجود`);
    return;
  }
  const accountId = account.rows[0].id as string;
  const accountNumber = account.rows[0].account_number as string;

  const feeType = await query(
    `SELECT id FROM accounts.student_fee_types WHERE LOWER(code) = LOWER($1)`,
    [M.feeTuition]
  );
  if (!feeType.rows[0]) {
    console.log(`⚠ نوع رسم ${M.feeTuition} غير موجود`);
    return;
  }

  let plan = await findPlanByExt(M.plan);
  if (!plan) {
    const created = await withTransaction(async (client) =>
      createStudentBillingPlan(client, {
        student_account_id: accountId,
        fee_type_id: feeType.rows[0].id as string,
        total_amount: '900000',
        installment_count: 3,
        first_due_date: entryDate,
        description: 'خطة عرض DEMO — 3 أقساط متساوية',
        external_reference: M.plan,
        created_by: userId,
      })
    );
    plan = {
      id: created.plan.id,
      status: created.plan.status,
      version: created.plan.version,
      updated_at: String(created.plan.updated_at),
      plan_number: created.plan.plan_number,
      total_amount: String(created.plan.total_amount),
    };
    console.log(`✓ خطة مسودة: ${M.plan} (${plan.plan_number})`);
  } else {
    console.log(`✓ خطة موجودة: ${M.plan} (${plan.plan_number}) · ${plan.status}`);
  }

  if (plan.status === 'DRAFT') {
    try {
      const activated = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return activateStudentBillingPlan(client, {
          id: plan!.id,
          userId,
          version: plan!.version,
          updated_at: plan!.updated_at,
          activation_date: entryDate,
        });
      });
      plan = {
        id: activated.plan.id,
        status: activated.plan.status,
        version: activated.plan.version,
        updated_at: String(activated.plan.updated_at),
        plan_number: activated.plan.plan_number,
        total_amount: String(activated.plan.total_amount),
      };
      console.log(`✓ تفعيل خطة: ${plan.plan_number} → ACTIVE`);
    } catch (e) {
      const refreshed = await findPlanByExt(M.plan);
      if (refreshed?.status === 'ACTIVE') {
        plan = refreshed;
        console.log(`✓ خطة مفعّلة مسبقاً: ${plan.plan_number}`);
      } else {
        console.log(
          '⚠ تعذر تفعيل خطة DEMO:',
          e instanceof Error ? e.message : e
        );
        return;
      }
    }
  }

  const installments = await withTransaction((client) =>
    listPlanInstallments(client, plan!.id)
  );
  const inst1 = installments.find((i) => i.installment_number === 1);
  const inst2 = installments.find((i) => i.installment_number === 2);
  if (!inst1 || !inst2) {
    console.log('⚠ أقساط الخطة غير مكتملة — تخطّي التحصيلات');
    return;
  }

  const cashCtx = await ensureOpenCashSession({ userId, yearId, periodId, entryDate });

  const bankRow = await query(
    `SELECT id FROM accounts.bank_accounts WHERE LOWER(code) = LOWER($1) LIMIT 1`,
    [M.bankAccount]
  );
  const bankAccountId: string | null =
    (bankRow.rows[0]?.id as string | undefined) ?? null;
  if (bankAccountId) {
    try {
      await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return assignBankAccountUser(client, {
          bank_account_id: bankAccountId!,
          user_id: userId,
          can_view: true,
          can_prepare: true,
          can_post: true,
          can_reconcile: true,
          created_by: userId,
        });
      });
    } catch {
      /* موجود */
    }
  } else {
    console.log(`⚠ حساب ${M.bankAccount} غير موجود — تخطّي تحصيل مصرفي DEMO`);
  }

  // قبض نقدي مرحّل — سداد القسط 1 بالكامل
  let cashCol = await findCollectionByExt(M.cashPosted);
  if (!cashCol) {
    if (!cashCtx) {
      console.log(`⚠ تخطّي ${M.cashPosted} — لا جلسة نقد OPEN`);
    } else {
      const posted = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const { collection } = await createStudentCollection(client, {
          student_account_id: accountId,
          collection_date: entryDate,
          amount: inst1.amount,
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          payer_name: 'طالب DEMO',
          external_reference: M.cashPosted,
          description: `قبض DEMO — قسط 1 (${M.cashPosted})`,
          auto_allocate: true,
          created_by: userId,
        });
        const p = await postStudentCollection(client, {
          id: collection.id,
          userId,
          version: collection.version,
          updated_at: collection.updated_at,
        });
        return p.collection;
      });
      cashCol = {
        id: posted.id,
        status: posted.status,
        version: posted.version,
        updated_at: String(posted.updated_at),
        collection_number: posted.collection_number,
        amount: String(posted.amount),
      };
      console.log(`✓ تحصيل نقدي POSTED: ${M.cashPosted} (${cashCol.collection_number})`);
    }
  } else {
    console.log(`✓ تحصيل نقدي موجود: ${M.cashPosted} (${cashCol.collection_number})`);
  }

  // قبض مصرفي جزئي — القسط 2
  let bankCol = await findCollectionByExt(M.bankPosted);
  if (!bankCol) {
    if (!bankAccountId) {
      console.log(`⚠ تخطّي ${M.bankPosted}`);
    } else {
      const partial = '150000';
      const posted = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const { collection } = await createStudentCollection(client, {
          student_account_id: accountId,
          collection_date: entryDate,
          amount: partial,
          payment_method: 'BANK',
          bank_account_id: bankAccountId,
          payer_name: 'طالب DEMO',
          external_reference: M.bankPosted,
          description: `قبض مصرفي جزئي DEMO (${M.bankPosted})`,
          auto_allocate: true,
          created_by: userId,
        });
        const p = await postStudentCollection(client, {
          id: collection.id,
          userId,
          version: collection.version,
          updated_at: collection.updated_at,
        });
        return p.collection;
      });
      bankCol = {
        id: posted.id,
        status: posted.status,
        version: posted.version,
        updated_at: String(posted.updated_at),
        collection_number: posted.collection_number,
        amount: String(posted.amount),
      };
      console.log(`✓ تحصيل مصرفي POSTED جزئي: ${M.bankPosted} (${bankCol.collection_number})`);
    }
  } else {
    console.log(`✓ تحصيل مصرفي موجود: ${M.bankPosted} (${bankCol.collection_number})`);
  }

  // مسودة
  let draftCol = await findCollectionByExt(M.draft);
  if (!draftCol) {
    if (!cashCtx) {
      console.log(`⚠ تخطّي ${M.draft} — لا جلسة نقد OPEN`);
    } else {
      const draft = await withTransaction(async (client) =>
        createStudentCollection(client, {
          student_account_id: accountId,
          collection_date: entryDate,
          amount: '50000',
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          payer_name: 'مسودة DEMO',
          external_reference: M.draft,
          description: `مسودة تحصيل DEMO (${M.draft})`,
          auto_allocate: true,
          created_by: userId,
        })
      );
      draftCol = {
        id: draft.collection.id,
        status: draft.collection.status,
        version: draft.collection.version,
        updated_at: String(draft.collection.updated_at),
        collection_number: draft.collection.collection_number,
        amount: String(draft.collection.amount),
      };
      console.log(`✓ تحصيل DRAFT: ${M.draft} (${draftCol.collection_number})`);
    }
  } else {
    console.log(`✓ تحصيل DRAFT موجود: ${M.draft} (${draftCol.collection_number})`);
  }

  // مرحّل ثم ملغى
  let voidCol = await findCollectionByExt(M.voided);
  if (!voidCol) {
    if (!cashCtx) {
      console.log(`⚠ تخطّي ${M.voided} — لا جلسة نقد OPEN`);
    } else {
      const row = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const { collection } = await createStudentCollection(client, {
          student_account_id: accountId,
          collection_date: entryDate,
          amount: '25000',
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          payer_name: 'VOID DEMO',
          external_reference: M.voided,
          description: `تحصيل يُلغى للعرض (${M.voided})`,
          auto_allocate: true,
          created_by: userId,
        });
        const posted = await postStudentCollection(client, {
          id: collection.id,
          userId,
          version: collection.version,
          updated_at: collection.updated_at,
        });
        const voided = await voidStudentCollection(client, {
          id: posted.collection.id,
          userId,
          version: posted.collection.version,
          updated_at: posted.collection.updated_at,
          reason: 'إلغاء عرض DEMO',
        });
        return voided;
      });
      voidCol = {
        id: row.id,
        status: row.status,
        version: row.version,
        updated_at: String(row.updated_at),
        collection_number: row.collection_number,
        amount: String(row.amount),
      };
      console.log(`✓ تحصيل VOID بعد POSTED: ${M.voided} (${voidCol.collection_number})`);
    }
  } else {
    console.log(`✓ تحصيل VOID موجود: ${M.voided} (${voidCol.collection_number}) · ${voidCol.status}`);
  }

  console.log('✓ صفحات العرض 5.B:');
  console.log(`  /accounts/students/billing-plans`);
  console.log(`  /accounts/students/billing-plans/${plan.id}`);
  console.log(`  /accounts/students/billing-plans/${plan.id}/print`);
  console.log(`  /accounts/students/collections`);
  if (cashCol) console.log(`  /accounts/students/collections/${cashCol.id}`);
  if (bankCol) console.log(`  /accounts/students/collections/${bankCol.id}`);
  if (draftCol) console.log(`  /accounts/students/collections/${draftCol.id}`);
  if (voidCol) console.log(`  /accounts/students/collections/${voidCol.id}`);
  console.log(`  /accounts/students/accounts/${accountId} (${accountNumber})`);
  console.log(`  /accounts/students/accounts/${accountId}/print`);
}
