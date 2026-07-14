/**
 * بيانات عرض 5.C.1 — أنواع التخفيضات وطلبات DEMO.
 * idempotent عبر external_reference DEMO-SRL-* و codes DEMO-RELIEF-*
 */
import { query } from '../lib/db';
import {
  createStudentCharge,
  postStudentCharge,
} from '../lib/accounts/student-charges';
import {
  approveStudentRelief,
  createStudentRelief,
  postStudentRelief,
  rejectStudentRelief,
  submitStudentRelief,
  voidStudentRelief,
} from '../lib/accounts/student-reliefs';
import {
  createStudentReliefType,
  loadStudentReliefType,
} from '../lib/accounts/student-relief-types';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

const M = {
  studentUni: 'DEMO-STU-001',
  feeTuition: 'DEMO-FEE-TUITION',
  reliefExpGl: 'DEMO-RELIEF-EXP',
  types: {
    discount: 'DEMO-RELIEF-DISC',
    scholarship: 'DEMO-RELIEF-SCHOL',
    waiver: 'DEMO-RELIEF-WAIVER',
  },
  charge: 'DEMO-SCH-RELIEF-BASE',
  reliefs: {
    draft: 'DEMO-SRL-DRAFT',
    pending: 'DEMO-SRL-PENDING',
    approved: 'DEMO-SRL-APPROVED',
    posted: 'DEMO-SRL-POSTED-01',
    rejected: 'DEMO-SRL-REJECTED',
    voided: 'DEMO-SRL-VOID-POSTED',
  },
} as const;

async function ensureExpenseGl(userId: string): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE UPPER(code) = UPPER($1)`,
    [M.reliefExpGl]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code = 'EXPENSE'`
  );
  if (!type.rows[0]) throw new Error('نوع EXPENSE غير موجود');
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'DEMO relief expense 5.C.1')
     RETURNING id`,
    [
      M.reliefExpGl,
      'مصروف تخفيضات عرض DEMO',
      type.rows[0].id,
      type.rows[0].normal_balance,
      sort.rows[0].n,
      userId,
    ]
  );
  return ins.rows[0].id as string;
}

async function ensureReliefType(params: {
  code: string;
  nameAr: string;
  kind: 'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER';
  expenseGlId: string;
  userId: string;
  requiresApproval: boolean;
}): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.student_relief_types WHERE UPPER(code) = UPPER($1)`,
    [params.code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const created = await withTransaction((client) =>
    createStudentReliefType(client, {
      code: params.code,
      name_ar: params.nameAr,
      relief_kind: params.kind,
      calculation_type: 'FIXED_AMOUNT',
      default_value: '5000',
      gl_account_id: params.expenseGlId,
      requires_approval: params.requiresApproval,
      description: `نوع تخفيض DEMO — ${params.kind} على حساب EXPENSE`,
      created_by: params.userId,
    })
  );
  console.log(`✓ نوع تخفيض DEMO ${params.code}`);
  return created.id;
}

async function ensureReliefCharge(params: {
  accountId: string;
  feeTypeId: string;
  userId: string;
  entryDate: string;
}): Promise<string> {
  const existing = await query(
    `SELECT id, status, version, updated_at, outstanding_amount::text AS outstanding
     FROM accounts.student_charges
     WHERE external_reference = $1
     LIMIT 1`,
    [M.charge]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'DRAFT') {
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        await postStudentCharge(client, {
          id: existing.rows[0].id as string,
          userId: params.userId,
          version: existing.rows[0].version,
          updated_at: existing.rows[0].updated_at,
        });
      });
    }
    return existing.rows[0].id as string;
  }

  const draft = await withTransaction((client) =>
    createStudentCharge(client, {
      student_account_id: params.accountId,
      fee_type_id: params.feeTypeId,
      charge_date: params.entryDate,
      original_amount: '200000',
      description: 'مطالبة عرض تخفيضات 5.C.1',
      external_reference: M.charge,
      created_by: params.userId,
    })
  );
  const posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCharge(client, {
      id: draft.id,
      userId: params.userId,
      version: draft.version,
      updated_at: draft.updated_at,
    });
  });
  console.log(`✓ مطالبة تخفيض DEMO ${M.charge}`);
  return posted.charge.id;
}

async function reliefExists(ext: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM accounts.student_reliefs WHERE external_reference = $1 LIMIT 1`,
    [ext]
  );
  return Boolean(r.rows[0]);
}

export async function seedStudentReliefsDemo(params: {
  userId: string;
  entryDate: string;
}): Promise<void> {
  console.log('\n——— 5.C.1: خصومات ومنح وإعفاءات DEMO ———');

  const student = await query(
    `SELECT s.id, sa.id AS account_id
     FROM student_affairs.students s
     JOIN accounts.student_accounts sa ON sa.student_id = s.id
     WHERE s.university_id = $1
     LIMIT 1`,
    [M.studentUni]
  );
  if (!student.rows[0]) {
    console.log(`⚠ ${M.studentUni} غير موجود — تخطّي seed 5.C.1`);
    return;
  }

  const fee = await query(
    `SELECT id FROM accounts.student_fee_types WHERE UPPER(code) = UPPER($1)`,
    [M.feeTuition]
  );
  if (!fee.rows[0]) {
    console.log(`⚠ ${M.feeTuition} غير موجود — تخطّي seed 5.C.1`);
    return;
  }

  const expenseGlId = await ensureExpenseGl(params.userId);
  const discountTypeId = await ensureReliefType({
    code: M.types.discount,
    nameAr: 'خصم عرض DEMO',
    kind: 'DISCOUNT',
    expenseGlId,
    userId: params.userId,
    requiresApproval: true,
  });
  const scholarshipTypeId = await ensureReliefType({
    code: M.types.scholarship,
    nameAr: 'منحة عرض DEMO',
    kind: 'SCHOLARSHIP',
    expenseGlId,
    userId: params.userId,
    requiresApproval: true,
  });
  const waiverTypeId = await ensureReliefType({
    code: M.types.waiver,
    nameAr: 'إعفاء عرض DEMO',
    kind: 'WAIVER',
    expenseGlId,
    userId: params.userId,
    requiresApproval: false,
  });

  const chargeId = await ensureReliefCharge({
    accountId: student.rows[0].account_id as string,
    feeTypeId: fee.rows[0].id as string,
    userId: params.userId,
    entryDate: params.entryDate,
  });

  // DRAFT
  if (!(await reliefExists(M.reliefs.draft))) {
    await withTransaction((client) =>
      createStudentRelief(client, {
        student_charge_id: chargeId,
        relief_type_id: discountTypeId,
        relief_date: params.entryDate,
        requested_amount: '3000',
        reason: 'مسودة خصم DEMO',
        external_reference: M.reliefs.draft,
        requested_by: params.userId,
      })
    );
    console.log(`✓ مسودة ${M.reliefs.draft}`);
  } else {
    console.log(`✓ ${M.reliefs.draft} موجود`);
  }

  // PENDING_APPROVAL
  if (!(await reliefExists(M.reliefs.pending))) {
    await withTransaction(async (client) => {
      const row = await createStudentRelief(client, {
        student_charge_id: chargeId,
        relief_type_id: scholarshipTypeId,
        relief_date: params.entryDate,
        requested_amount: '8000',
        reason: 'منحة بانتظار الاعتماد DEMO',
        external_reference: M.reliefs.pending,
        requested_by: params.userId,
      });
      await submitStudentRelief(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      });
    });
    console.log(`✓ بانتظار الاعتماد ${M.reliefs.pending}`);
  } else {
    console.log(`✓ ${M.reliefs.pending} موجود`);
  }

  // APPROVED (not posted)
  if (!(await reliefExists(M.reliefs.approved))) {
    await withTransaction(async (client) => {
      const row = await createStudentRelief(client, {
        student_charge_id: chargeId,
        relief_type_id: discountTypeId,
        relief_date: params.entryDate,
        requested_amount: '4000',
        reason: 'خصم معتمد غير مرحّل DEMO',
        external_reference: M.reliefs.approved,
        requested_by: params.userId,
      });
      const submitted = await submitStudentRelief(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      });
      if (submitted.status === 'PENDING_APPROVAL') {
        await approveStudentRelief(client, {
          id: submitted.id,
          userId: params.userId,
          version: submitted.version,
          updated_at: submitted.updated_at,
        });
      }
    });
    console.log(`✓ معتمد ${M.reliefs.approved}`);
  } else {
    console.log(`✓ ${M.reliefs.approved} موجود`);
  }

  // POSTED partial
  if (!(await reliefExists(M.reliefs.posted))) {
    const approved = await withTransaction(async (client) => {
      const row = await createStudentRelief(client, {
        student_charge_id: chargeId,
        relief_type_id: waiverTypeId,
        relief_date: params.entryDate,
        requested_amount: '15000',
        reason: 'إعفاء مرحّل جزئي DEMO',
        external_reference: M.reliefs.posted,
        requested_by: params.userId,
      });
      return submitStudentRelief(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      });
    });
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const rt = await loadStudentReliefType(client, waiverTypeId, false);
      let ready = approved;
      if (rt.requires_approval && ready.status === 'PENDING_APPROVAL') {
        ready = await approveStudentRelief(client, {
          id: ready.id,
          userId: params.userId,
          version: ready.version,
          updated_at: ready.updated_at,
        });
      }
      await postStudentRelief(client, {
        id: ready.id,
        userId: params.userId,
        version: ready.version,
        updated_at: ready.updated_at,
      });
    });
    console.log(`✓ مرحّل ${M.reliefs.posted}`);
  } else {
    console.log(`✓ ${M.reliefs.posted} موجود`);
  }

  // REJECTED
  if (!(await reliefExists(M.reliefs.rejected))) {
    await withTransaction(async (client) => {
      const row = await createStudentRelief(client, {
        student_charge_id: chargeId,
        relief_type_id: scholarshipTypeId,
        relief_date: params.entryDate,
        requested_amount: '2000',
        reason: 'منحة مرفوضة DEMO',
        external_reference: M.reliefs.rejected,
        requested_by: params.userId,
      });
      const submitted = await submitStudentRelief(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      });
      await rejectStudentRelief(client, {
        id: submitted.id,
        userId: params.userId,
        version: submitted.version,
        updated_at: submitted.updated_at,
        reason: 'رفض عرض DEMO',
      });
    });
    console.log(`✓ مرفوض ${M.reliefs.rejected}`);
  } else {
    console.log(`✓ ${M.reliefs.rejected} موجود`);
  }

  // POSTED then VOID
  {
    const voidPeek = await query(
      `SELECT id, status, version, updated_at
       FROM accounts.student_reliefs
       WHERE external_reference = $1 LIMIT 1`,
      [M.reliefs.voided]
    );
    if (!voidPeek.rows[0]) {
      await withTransaction(async (client) => {
        const row = await createStudentRelief(client, {
          student_charge_id: chargeId,
          relief_type_id: waiverTypeId,
          relief_date: params.entryDate,
          requested_amount: '5000',
          reason: 'إعفاء سيُلغى DEMO',
          external_reference: M.reliefs.voided,
          requested_by: params.userId,
        });
        const submitted = await submitStudentRelief(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        });
        await acquireJournalEntriesLock(client);
        const posted = await postStudentRelief(client, {
          id: submitted.id,
          userId: params.userId,
          version: submitted.version,
          updated_at: submitted.updated_at,
        });
        await voidStudentRelief(client, {
          id: posted.relief.id,
          userId: params.userId,
          version: posted.relief.version,
          updated_at: posted.relief.updated_at,
          reason: 'إلغاء عرض DEMO مع قيد عكسي',
        });
      });
      console.log(`✓ VOID بعد POST ${M.reliefs.voided}`);
    } else if (voidPeek.rows[0].status === 'POSTED') {
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        await voidStudentRelief(client, {
          id: voidPeek.rows[0].id as string,
          userId: params.userId,
          version: voidPeek.rows[0].version,
          updated_at: voidPeek.rows[0].updated_at,
          reason: 'إلغاء عرض DEMO مع قيد عكسي',
        });
      });
      console.log(`✓ إكمال VOID لـ ${M.reliefs.voided}`);
    } else {
      console.log(`✓ ${M.reliefs.voided} موجود (${voidPeek.rows[0].status})`);
    }
  }

  const postedRow = await query(
    `SELECT id FROM accounts.student_reliefs WHERE external_reference = $1 LIMIT 1`,
    [M.reliefs.posted]
  );
  console.log('✓ صفحات العرض 5.C.1:');
  console.log('  /accounts/students/reliefs');
  console.log('  /accounts/students/relief-types');
  if (postedRow.rows[0]) {
    console.log(`  /accounts/students/reliefs/${postedRow.rows[0].id}`);
    console.log(`  /accounts/students/reliefs/${postedRow.rows[0].id}/print`);
  }
}
