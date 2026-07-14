/**
 * بيانات عرض 5.A — حسابات طلبة ومستحقات DEMO.
 * يُستدعى من seed-accounts-demo (idempotent عبر university_id / fee code / external_reference).
 */
import { query } from '../lib/db';
import { createStudentAccount } from '../lib/accounts/student-accounts';
import {
  createStudentCharge,
  postStudentCharge,
  voidStudentCharge,
} from '../lib/accounts/student-charges';
import { createStudentFeeType } from '../lib/accounts/student-fee-types';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

const M = {
  students: [
    { university_id: 'DEMO-STU-001', name: 'طالب عرض أول DEMO' },
    { university_id: 'DEMO-STU-002', name: 'طالب عرض ثانٍ DEMO' },
    { university_id: 'DEMO-STU-003', name: 'طالب عرض ثالث DEMO' },
  ],
  recvGl: 'DEMO-RECV-GL',
  revTuition: 'DEMO-REV-TUITION',
  revReg: 'DEMO-REV-REG',
  revLab: 'DEMO-REV-LAB',
  feeTuition: 'DEMO-FEE-TUITION',
  feeReg: 'DEMO-FEE-REG',
  feeLab: 'DEMO-FEE-LAB',
  chargePosted: 'DEMO-SCH-POSTED',
  chargeDraft: 'DEMO-SCH-DRAFT',
  chargeVoid: 'DEMO-SCH-VOID',
} as const;

async function ensureDemoStudent(params: {
  university_id: string;
  full_name_ar: string;
}): Promise<string> {
  const existing = await query(
    `SELECT id FROM student_affairs.students
     WHERE university_id = $1 OR student_number = $1
     LIMIT 1`,
    [params.university_id]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1, $1, $2, 'active', 'paid')
     RETURNING id`,
    [params.university_id, params.full_name_ar]
  );
  console.log(`✓ طالب DEMO: ${params.university_id}`);
  return ins.rows[0].id as string;
}

async function ensureFeeType(params: {
  code: string;
  name_ar: string;
  category: 'TUITION' | 'REGISTRATION' | 'LAB';
  revenue_gl_account_id: string;
  default_amount: string;
  userId: string;
  is_tuition?: boolean;
}): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.student_fee_types WHERE LOWER(code)=LOWER($1)`,
    [params.code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const row = await withTransaction((client) =>
    createStudentFeeType(client, {
      code: params.code,
      name_ar: params.name_ar,
      category: params.category,
      revenue_gl_account_id: params.revenue_gl_account_id,
      default_amount: params.default_amount,
      is_tuition: params.is_tuition ?? params.category === 'TUITION',
      created_by: params.userId,
    })
  );
  console.log(`✓ نوع رسم: ${params.code}`);
  return row.id;
}

async function ensureStudentAccount(params: {
  studentId: string;
  receivableGlId: string;
  userId: string;
  notes: string;
}): Promise<{ id: string; account_number: string }> {
  const existing = await query(
    `SELECT id, account_number FROM accounts.student_accounts
     WHERE student_id = $1::uuid AND currency_code = 'IQD'
     LIMIT 1`,
    [params.studentId]
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id as string,
      account_number: existing.rows[0].account_number as string,
    };
  }
  const row = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: params.studentId,
      receivable_gl_account_id: params.receivableGlId,
      notes: params.notes,
      created_by: params.userId,
    })
  );
  console.log(`✓ حساب طالب: ${row.account_number}`);
  return { id: row.id, account_number: row.account_number };
}

async function findChargeByExt(ref: string) {
  const r = await query(
    `SELECT id, status, version, updated_at, student_account_id, charge_number
     FROM accounts.student_charges
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
        student_account_id: string;
        charge_number: string;
      }
    | undefined;
}

export async function seedStudentReceivablesDemo(params: {
  userId: string;
  entryDate: string;
  ensureAccount: (p: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
}): Promise<void> {
  const { userId, entryDate, ensureAccount } = params;

  const recvGl = await ensureAccount({
    code: M.recvGl,
    nameAr: 'ذمم طلبة DEMO',
    typeCode: 'ASSET',
    userId,
  });
  const revTuition = await ensureAccount({
    code: M.revTuition,
    nameAr: 'إيراد أقساط دراسية DEMO',
    typeCode: 'REVENUE',
    userId,
  });
  const revReg = await ensureAccount({
    code: M.revReg,
    nameAr: 'إيراد تسجيل DEMO',
    typeCode: 'REVENUE',
    userId,
  });
  const revLab = await ensureAccount({
    code: M.revLab,
    nameAr: 'إيراد مختبرات DEMO',
    typeCode: 'REVENUE',
    userId,
  });

  const studentIds: string[] = [];
  for (const s of M.students) {
    studentIds.push(
      await ensureDemoStudent({
        university_id: s.university_id,
        full_name_ar: s.name,
      })
    );
  }

  const feeTuitionId = await ensureFeeType({
    code: M.feeTuition,
    name_ar: 'قسط دراسي DEMO',
    category: 'TUITION',
    revenue_gl_account_id: revTuition.id,
    default_amount: '500000',
    userId,
    is_tuition: true,
  });
  const feeRegId = await ensureFeeType({
    code: M.feeReg,
    name_ar: 'رسوم تسجيل DEMO',
    category: 'REGISTRATION',
    revenue_gl_account_id: revReg.id,
    default_amount: '50000',
    userId,
  });
  const feeLabId = await ensureFeeType({
    code: M.feeLab,
    name_ar: 'رسوم مختبر DEMO',
    category: 'LAB',
    revenue_gl_account_id: revLab.id,
    default_amount: '75000',
    userId,
  });

  const acc1 = await ensureStudentAccount({
    studentId: studentIds[0],
    receivableGlId: recvGl.id,
    userId,
    notes: 'DEMO-STU-001 رصيد بعد مطالبة مرحّلة',
  });
  const acc2 = await ensureStudentAccount({
    studentId: studentIds[1],
    receivableGlId: recvGl.id,
    userId,
    notes: 'DEMO-STU-002 مسودة فقط',
  });
  const acc3 = await ensureStudentAccount({
    studentId: studentIds[2],
    receivableGlId: recvGl.id,
    userId,
    notes: 'DEMO-STU-003 مرحّل ثم ملغى → رصيد صفر',
  });

  // POSTED على الطالب الأول → رصيد
  let posted = await findChargeByExt(M.chargePosted);
  if (!posted) {
    posted = await withTransaction(async (client) => {
      const c = await createStudentCharge(client, {
        student_account_id: acc1.id,
        fee_type_id: feeTuitionId,
        charge_date: entryDate,
        original_amount: '500000',
        description: 'قسط دراسي DEMO مرحّل',
        external_reference: M.chargePosted,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      const p = await postStudentCharge(client, {
        id: c.id,
        userId,
        version: c.version,
        updated_at: c.updated_at,
      });
      return {
        id: p.charge.id,
        status: p.charge.status,
        version: p.charge.version,
        updated_at: String(p.charge.updated_at),
        student_account_id: p.charge.student_account_id,
        charge_number: p.charge.charge_number,
      };
    });
    console.log(`✓ مطالبة مرحّلة: ${M.chargePosted} (${posted.charge_number})`);
  } else {
    console.log(`✓ مطالبة مرحّلة موجودة: ${M.chargePosted}`);
  }

  // DRAFT على الطالب الثاني
  let draft = await findChargeByExt(M.chargeDraft);
  if (!draft) {
    draft = await withTransaction(async (client) => {
      const c = await createStudentCharge(client, {
        student_account_id: acc2.id,
        fee_type_id: feeRegId,
        charge_date: entryDate,
        original_amount: '50000',
        description: 'رسوم تسجيل DEMO مسودة',
        external_reference: M.chargeDraft,
        created_by: userId,
      });
      return {
        id: c.id,
        status: c.status,
        version: c.version,
        updated_at: String(c.updated_at),
        student_account_id: c.student_account_id,
        charge_number: c.charge_number,
      };
    });
    console.log(`✓ مطالبة مسودة: ${M.chargeDraft} (${draft.charge_number})`);
  } else {
    console.log(`✓ مطالبة مسودة موجودة: ${M.chargeDraft}`);
  }

  // VOID: post ثم void على الطالب الثالث → رصيد صفر
  let voided = await findChargeByExt(M.chargeVoid);
  if (!voided) {
    voided = await withTransaction(async (client) => {
      const c = await createStudentCharge(client, {
        student_account_id: acc3.id,
        fee_type_id: feeLabId,
        charge_date: entryDate,
        original_amount: '75000',
        description: 'رسوم مختبر DEMO تُلغى',
        external_reference: M.chargeVoid,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      const p = await postStudentCharge(client, {
        id: c.id,
        userId,
        version: c.version,
        updated_at: c.updated_at,
      });
      const v = await voidStudentCharge(client, {
        id: p.charge.id,
        userId,
        version: p.charge.version,
        updated_at: p.charge.updated_at,
        reason: 'إلغاء عرض DEMO',
      });
      return {
        id: v.id,
        status: v.status,
        version: v.version,
        updated_at: String(v.updated_at),
        student_account_id: v.student_account_id,
        charge_number: v.charge_number,
      };
    });
    console.log(`✓ مطالبة ملغاة بعد ترحيل: ${M.chargeVoid} (${voided.charge_number})`);
  } else {
    console.log(`✓ مطالبة VOID موجودة: ${M.chargeVoid}`);
  }

  console.log('✓ صفحات العرض:');
  console.log(`  /accounts/students/accounts/${acc1.id}`);
  console.log(`  /accounts/students/accounts/${acc1.id}/print`);
  console.log(`  /accounts/students/accounts/${acc2.id}`);
  console.log(`  /accounts/students/accounts/${acc3.id}`);
  console.log(`  /accounts/students/charges`);
  console.log(`  /accounts/students/fee-types`);
}
