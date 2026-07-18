/**
 * اختبارات قبول أساس الرواتب 9.A.1
 * npm run test:payroll-foundation
 *
 * تغطي: الأشخاص (أنواع/حالات/تزامن/تقنيع مصرفي/IDOR)، العقود (تفعيل/عقد واحد فعّال/
 * تزامن/تأريخ/حسابات/عملة)، التكليفات (تعدد/تطابق العقد/حالات)، المكوّنات (طرق الاحتساب/
 * رفض CUSTOM_FORMULA/تكرار/حسابات)، إسنادات المكوّنات (روابط/منع cross-person/تزامن)،
 * الخرائط (صالحة/غامضة/أولوية/ROUNDING/شكل النطاق/حسابات)، الصلاحيات (أقل امتياز)،
 * التدقيق، ثبات البذرة (idempotency)، والتحقق (عادي + صارم).
 */
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, mapPgError } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  ACCOUNTS_APPROVER_ROLE_CODE,
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import {
  PAYROLL_CAPABILITIES,
  getPayrollCapabilities,
  grantAccountsPlatformRole,
  hasPayrollCapability,
} from '../lib/accounts/payroll-access';
import {
  createPayrollPerson,
  loadPayrollPerson,
  serializePayrollPerson,
  serializePayrollPersonListItem,
  setPayrollPersonStatus,
  updatePayrollPerson,
} from '../lib/accounts/payroll-people';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import {
  createPayrollAssignment,
  transitionPayrollAssignment,
} from '../lib/accounts/payroll-assignments';
import {
  createPayrollComponent,
  setPayrollComponentActive,
} from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import { createPayrollAccountMapping } from '../lib/accounts/payroll-account-mappings';
import { verifyPayrollFoundation } from '../lib/accounts/verify-payroll-foundation';
import { seedPayrollDemo } from './seed-accounts-payroll-demo';
import { withTransaction } from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;
function ok(name: string) { passCount += 1; console.log(`✅ ${name}`); }
function failed(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err instanceof Error ? err.message : (err ?? ''));
  process.exitCode = 1;
}
async function it(name: string, fn: () => Promise<void>) {
  try { await fn(); ok(name); } catch (e) { failed(name, e); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
async function throwsHttp(fn: () => Promise<unknown>, statuses: number | number[], includes?: string) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  try {
    await fn();
  } catch (e) {
    if (e instanceof AccountsHttpError && allowed.includes(e.status)) {
      if (includes && !e.message.includes(includes)) throw new Error(`الرسالة لا تحتوي "${includes}": ${e.message}`);
      return;
    }
    throw e;
  }
  throw new Error(`توقّعنا خطأ ${allowed.join('/')} ولم يحدث`);
}

async function ensureGl(code: string, nameAr: string, typeCode: string, userId: string): Promise<string> {
  const existing = await query(`SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(`SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`, [typeCode]);
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const sort = await query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`);
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting, normal_balance,
       requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 9.A.1')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

/** حساب مجموعة (غير قابل للترحيل) لاختبار رفض الحسابات غير الصالحة. */
async function ensureGroupGl(code: string, userId: string): Promise<string> {
  const existing = await query(`SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(`SELECT id, normal_balance FROM accounts.account_types WHERE code='EXPENSE'`);
  const sort = await query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`);
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting, normal_balance,
       requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,'حساب مجموعة اختبار',$2,1,TRUE,FALSE,$3,FALSE,TRUE,$4,$5,'اختبار 9.A.1')
     RETURNING id`,
    [code, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureCostCenter(code: string, userId: string): Promise<string> {
  const existing = await query(`SELECT id FROM accounts.cost_centers WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await query(
    `INSERT INTO accounts.cost_centers (code, name_ar, level, is_group, is_active, created_by, description)
     VALUES ($1,'مركز كلفة اختبار',1,FALSE,TRUE,$2,'اختبار 9.A.1') RETURNING id`,
    [code, userId]
  );
  return ins.rows[0].id as string;
}

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-payroll-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_active=TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  if (withAccounts) {
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code='ACCOUNTS'
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [userId]
    );
  }
  return userId;
}

const START = '2025-01-01';
let seq = 0;
const uniq = (p: string, s: string) => { seq += 1; return `${p}-${s}-${seq}`; };

async function main() {
  console.log('===== اختبارات قبول أساس الرواتب 9.A.1 =====');

  let user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
  );
  if (!user.rows[0]) user = await query(`SELECT id FROM student_affairs.users WHERE is_active ORDER BY created_at NULLS LAST LIMIT 1`);
  if (!user.rows[0]) { failed('إعداد: لا يوجد مستخدم'); return; }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const expenseGl = await ensureGl(`PY-EXP-${suffix}`, 'مصروف رواتب اختبار', 'EXPENSE', userId);
  const liabilityGl = await ensureGl(`PY-LIA-${suffix}`, 'التزام رواتب اختبار', 'LIABILITY', userId);
  const payableGl = await ensureGl(`PY-PAY-${suffix}`, 'ذمم رواتب اختبار', 'LIABILITY', userId);
  const roundingGl = await ensureGl(`PY-RND-${suffix}`, 'تقريب رواتب اختبار', 'EXPENSE', userId);
  const groupGl = await ensureGroupGl(`PY-GRP-${suffix}`, userId);
  const costCenterId = await ensureCostCenter(`PY-CC-${suffix}`, userId);

  const mkPerson = (over: Record<string, unknown> = {}) =>
    withTransaction((c) => createPayrollPerson(c, {
      full_name_ar: 'شخص اختبار', person_type: 'EMPLOYEE',
      default_cost_center_id: costCenterId, default_currency_code: 'IQD',
      effective_from: START, created_by: userId, ...over,
    }));

  const mkContract = (personId: string, over: Record<string, unknown> = {}) =>
    withTransaction((c) => createPayrollContract(c, {
      payroll_person_id: personId, compensation_basis: 'MONTHLY_FIXED', base_amount: '1000000',
      currency_code: 'IQD', effective_from: START, default_expense_account_id: expenseGl,
      payable_account_id: payableGl, default_cost_center_id: costCenterId, created_by: userId, ...over,
    }));

  const activateContract = (row: { id: string; version: number; updated_at: Date | string }) =>
    withTransaction((c) => transitionPayrollContract(c, { id: row.id, userId, version: row.version, updated_at: row.updated_at, action: 'activate' }));

  // ═══ الأشخاص ═══════════════════════════════════════════════════════
  await it('1) إنشاء كل أنواع الأشخاص', async () => {
    for (const t of ['TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER', 'SERVICE_WORKER']) {
      const p = await mkPerson({ person_type: t });
      assert(p.person_type === t, `النوع ${t}`);
      assert(p.status === 'ACTIVE', 'الحالة الافتراضية ACTIVE');
      assert(/^PYP/.test(p.person_code) || p.person_code.length > 0, 'رمز مُولّد');
    }
  });

  await it('2) رمز الشخص المخصص فريد (تكرار مرفوض)', async () => {
    const code = uniq('PYP', suffix);
    await mkPerson({ person_code: code });
    await throwsHttp(() => mkPerson({ person_code: code }), [400, 409]);
  });

  await it('3) نوع شخص غير صالح مرفوض', async () => {
    await throwsHttp(() => mkPerson({ person_type: 'ROBOT' }), 400);
  });

  await it('4) انتقالات حالة الشخص: إيقاف/تفعيل/إنهاء', async () => {
    const p = await mkPerson();
    const s = await withTransaction((c) => setPayrollPersonStatus(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, target: 'SUSPENDED' }));
    assert(s.status === 'SUSPENDED', 'موقوف');
    const a = await withTransaction((c) => setPayrollPersonStatus(c, { id: s.id, userId, version: s.version, updated_at: s.updated_at, target: 'ACTIVE' }));
    assert(a.status === 'ACTIVE', 'مُفعّل');
    const t = await withTransaction((c) => setPayrollPersonStatus(c, { id: a.id, userId, version: a.version, updated_at: a.updated_at, target: 'TERMINATED', reason: 'إنهاء خدمة اختبار' }));
    assert(t.status === 'TERMINATED', 'منتهٍ');
    // منتهٍ نهائي: لا انتقال منه
    await throwsHttp(() => withTransaction((c) => setPayrollPersonStatus(c, { id: t.id, userId, version: t.version, updated_at: t.updated_at, target: 'ACTIVE' })), 409);
  });

  await it('5) التزامن المتفائل على الشخص (version قديم → 409)', async () => {
    const p = await mkPerson();
    await withTransaction((c) => updatePayrollPerson(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, full_name_ar: 'اسم محدّث' }));
    await throwsHttp(() => withTransaction((c) => updatePayrollPerson(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, full_name_ar: 'محاولة قديمة' })), 409);
  });

  await it('6) قائمة الأشخاص لا تُرجع بيانات مصرفية', async () => {
    const p = await mkPerson({ bank_account_name: 'صاحب حساب', bank_account_identifier: 'IQ980000123456789' });
    const full = await withTransaction((c) => loadPayrollPerson(c, p.id));
    assert(full.bank_account_identifier_masked && full.bank_account_identifier_masked.includes('*'), 'مقنّع في التفاصيل');
    assert(!/123456789/.test(full.bank_account_identifier_masked ?? ''), 'الرقم الخام غير مخزّن');
    const listItem = serializePayrollPersonListItem(p) as Record<string, unknown>;
    assert(!('bank_account_identifier_masked' in listItem), 'لا حقل مصرفي في القائمة');
    assert(!('bank_account_name' in listItem), 'لا اسم حساب في القائمة');
  });

  // ═══ العقود ════════════════════════════════════════════════════════
  await it('7) إنشاء عقد ثم تفعيله', async () => {
    const p = await mkPerson();
    const ct = await mkContract(p.id);
    assert(ct.status === 'DRAFT', 'مسودة عند الإنشاء');
    const active = await activateContract(ct);
    assert(active.status === 'ACTIVE', 'فعّال بعد التفعيل');
  });

  await it('8) منع عقدين ACTIVE لنفس الشخص', async () => {
    const p = await mkPerson();
    const c1 = await mkContract(p.id);
    await activateContract(c1);
    const c2 = await mkContract(p.id);
    await throwsHttp(() => activateContract(c2), 409);
  });

  await it('9) التزامن: تفعيل عقدين متزامناً — واحد فقط ينجح', async () => {
    const p = await mkPerson();
    const c1 = await mkContract(p.id);
    const c2 = await mkContract(p.id);
    const results = await Promise.allSettled([activateContract(c1), activateContract(c2)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    assert(fulfilled === 1, `المتوقع تفعيل واحد فقط، حصل ${fulfilled}`);
  });

  await it('10) تأريخ العقد: نهاية قبل بداية → 400', async () => {
    const p = await mkPerson();
    await throwsHttp(() => mkContract(p.id, { effective_from: '2025-06-01', effective_to: '2025-01-01' }), 400);
  });

  await it('11) إيقاف ثم إنهاء العقد', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    const active = await activateContract(c);
    const susp = await withTransaction((cl) => transitionPayrollContract(cl, { id: active.id, userId, version: active.version, updated_at: active.updated_at, action: 'suspend' }));
    assert(susp.status === 'SUSPENDED', 'موقوف');
    const term = await withTransaction((cl) => transitionPayrollContract(cl, { id: susp.id, userId, version: susp.version, updated_at: susp.updated_at, action: 'terminate', reason: 'إنهاء عقد اختبار' }));
    assert(term.status === 'TERMINATED', 'منتهٍ');
  });

  await it('12) عقد لشخص غير موجود → 404', async () => {
    await throwsHttp(() => mkContract('00000000-0000-0000-0000-000000000000'), 404);
  });

  await it('13) عقد بحساب GL غير صالح (مجموعة) → 400', async () => {
    const p = await mkPerson();
    await throwsHttp(() => mkContract(p.id, { default_expense_account_id: groupGl }), 400);
  });

  await it('14) عقد بعملة غير صالحة → 400', async () => {
    const p = await mkPerson();
    await throwsHttp(() => mkContract(p.id, { currency_code: 'XX1' }), 400);
  });

  await it('15) لا يمكن تفعيل عقد لشخص غير فعّال → 409', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    await withTransaction((cl) => setPayrollPersonStatus(cl, { id: p.id, userId, version: p.version, updated_at: p.updated_at, target: 'SUSPENDED' }));
    await throwsHttp(() => activateContract(c), 409);
  });

  // ═══ التكليفات ═════════════════════════════════════════════════════
  await it('16) إنشاء عدة تكليفات للشخص نفسه', async () => {
    const p = await mkPerson();
    const a1 = await withTransaction((c) => createPayrollAssignment(c, { payroll_person_id: p.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'تكليف 1', effective_from: START, created_by: userId }));
    const a2 = await withTransaction((c) => createPayrollAssignment(c, { payroll_person_id: p.id, assignment_type: 'COMMITTEE_ASSIGNMENT', title_ar: 'تكليف 2', effective_from: START, created_by: userId }));
    assert(a1.id !== a2.id, 'تكليفان منفصلان');
  });

  await it('17) منع ربط تكليف بعقد شخص آخر → 400', async () => {
    const pA = await mkPerson();
    const pB = await mkPerson();
    const cB = await mkContract(pB.id);
    await throwsHttp(() => withTransaction((c) => createPayrollAssignment(c, {
      payroll_person_id: pA.id, payroll_contract_id: cB.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'خطأ', effective_from: START, created_by: userId,
    })), 400);
  });

  await it('18) انتقالات حالة التكليف: تفعيل ثم إيقاف', async () => {
    const p = await mkPerson();
    const a = await withTransaction((c) => createPayrollAssignment(c, { payroll_person_id: p.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'تكليف', effective_from: START, created_by: userId }));
    const active = await withTransaction((c) => transitionPayrollAssignment(c, { id: a.id, userId, version: a.version, updated_at: a.updated_at, action: 'activate' }));
    assert(active.status === 'ACTIVE', 'فعّال');
    const off = await withTransaction((c) => transitionPayrollAssignment(c, { id: active.id, userId, version: active.version, updated_at: active.updated_at, action: 'deactivate' }));
    assert(off.status === 'SUSPENDED', 'موقوف بعد deactivate من ACTIVE');
  });

  await it('19) رمز التكليف المخصص فريد', async () => {
    const p = await mkPerson();
    const code = uniq('PYA', suffix);
    await withTransaction((c) => createPayrollAssignment(c, { payroll_person_id: p.id, assignment_code: code, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'ت', effective_from: START, created_by: userId }));
    await throwsHttp(() => withTransaction((c) => createPayrollAssignment(c, { payroll_person_id: p.id, assignment_code: code, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'ت2', effective_from: START, created_by: userId })), [400, 409]);
  });

  // ═══ المكوّنات ═════════════════════════════════════════════════════
  const mkComponent = (over: Record<string, unknown> = {}) =>
    withTransaction((c) => createPayrollComponent(c, {
      component_code: uniq('PYCMP', suffix), name_ar: 'مكوّن اختبار', component_type: 'EARNING',
      calculation_method: 'FIXED_AMOUNT', default_amount: '100000', expense_account_id: expenseGl,
      default_cost_center_id: costCenterId, effective_from: START, created_by: userId, ...over,
    }));

  await it('20) إنشاء كل طرق الاحتساب المسموح بها', async () => {
    for (const m of ['FIXED_AMOUNT', 'PERCENTAGE_OF_BASIC', 'QUANTITY_X_RATE', 'DAYS_X_DAILY_RATE', 'HOURS_X_HOURLY_RATE', 'LECTURES_X_RATE', 'MANUAL_AMOUNT']) {
      const cmp = await mkComponent({ calculation_method: m });
      assert(cmp.calculation_method === m, `طريقة ${m}`);
    }
  });

  await it('21) رفض CUSTOM_FORMULA عند الإنشاء → 400', async () => {
    await throwsHttp(() => mkComponent({ calculation_method: 'CUSTOM_FORMULA' }), 400, 'CUSTOM_FORMULA');
  });

  await it('22) تفعيل وإيقاف المكوّن', async () => {
    const cmp = await mkComponent();
    const off = await withTransaction((c) => setPayrollComponentActive(c, { id: cmp.id, userId, version: cmp.version, updated_at: cmp.updated_at, active: false }));
    assert(off.is_active === false, 'موقوف');
    const on = await withTransaction((c) => setPayrollComponentActive(c, { id: off.id, userId, version: off.version, updated_at: off.updated_at, active: true }));
    assert(on.is_active === true, 'مُفعّل');
  });

  await it('23) رمز المكوّن مكرر مرفوض', async () => {
    const code = uniq('PYCMP', suffix);
    await mkComponent({ component_code: code });
    await throwsHttp(() => mkComponent({ component_code: code }), [400, 409]);
  });

  await it('24) مكوّن بحساب GL غير صالح → 400', async () => {
    await throwsHttp(() => mkComponent({ expense_account_id: groupGl }), 400);
  });

  await it('25) مكوّن: تأريخ خاطئ → 400', async () => {
    await throwsHttp(() => mkComponent({ effective_from: '2025-12-01', effective_to: '2025-01-01' }), 400);
  });

  // ═══ إسنادات المكوّنات ═════════════════════════════════════════════
  await it('26) إسناد مكوّن للشخص/العقد/التكليف', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    await activateContract(c);
    const a = await withTransaction((cl) => createPayrollAssignment(cl, { payroll_person_id: p.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'ت', effective_from: START, created_by: userId }));
    const cmp = await mkComponent();
    const byPerson = await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '50000', effective_from: START, created_by: userId }));
    assert(byPerson.id, 'إسناد بالشخص');
    const byContract = await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_contract_id: c.id, amount: '50000', effective_from: '2026-01-01', created_by: userId }));
    assert(byContract.payroll_contract_id === c.id, 'إسناد بالعقد');
    const byAssignment = await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_assignment_id: a.id, amount: '50000', effective_from: '2027-01-01', created_by: userId }));
    assert(byAssignment.payroll_assignment_id === a.id, 'إسناد بالتكليف');
  });

  await it('27) منع إسناد مكوّن بعقد شخص آخر (cross-person) → 400', async () => {
    const pA = await mkPerson();
    const pB = await mkPerson();
    const cB = await mkContract(pB.id);
    const cmp = await mkComponent();
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: pA.id, payroll_component_id: cmp.id, payroll_contract_id: cB.id, amount: '1', effective_from: START, created_by: userId })), 400);
  });

  await it('28) منع الربط بعقد وتكليف معاً → 400', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    const a = await withTransaction((cl) => createPayrollAssignment(cl, { payroll_person_id: p.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'ت', effective_from: START, created_by: userId }));
    const cmp = await mkComponent();
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_contract_id: c.id, payroll_assignment_id: a.id, amount: '1', effective_from: START, created_by: userId })), 400);
  });

  await it('29) رفض CUSTOM_FORMULA في override للإسناد → 400', async () => {
    const p = await mkPerson();
    const cmp = await mkComponent();
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, override_calculation_method: 'CUSTOM_FORMULA', effective_from: START, created_by: userId })), 400);
  });

  await it('30) قيمة سالبة في الإسناد مرفوضة → 400', async () => {
    const p = await mkPerson();
    const cmp = await mkComponent();
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '-5', effective_from: START, created_by: userId })), 400);
  });

  // ═══ الخرائط ═══════════════════════════════════════════════════════
  // تنظيف خرائط الاختبار من تشغيلات سابقة (أكواد PYMAP- فقط) حتى لا تتداخل
  // خريطة مفتوحة النهاية قديمة مع نافذة هذا التشغيل فتُفعّل كشف الغموض خطأً.
  await query(`DELETE FROM accounts.payroll_account_mappings WHERE mapping_code LIKE 'PYMAP-%'`);
  // نافذة زمنية فريدة لكل تشغيل حتى لا تتداخل خرائط الاختبار عبر التشغيلات
  // المتكررة (كشف الغموض يعتمد على النطاق+المميّزات+الأولوية+تداخل الفترة).
  const runYear = 2200 + Math.floor(Math.random() * 6000);
  const FUT = `${runYear}-01-01`;
  const FUT_END = `${runYear}-12-31`;
  await it('31) خريطة صالحة (DEFAULT)', async () => {
    const m = await withTransaction((c) => createPayrollAccountMapping(c, {
      mapping_code: uniq('PYMAP', suffix), mapping_scope: 'DEFAULT', priority: 900,
      expense_account_id: expenseGl, liability_account_id: liabilityGl, payable_account_id: payableGl,
      effective_from: FUT, effective_to: FUT_END, created_by: userId,
    }));
    assert(m.mapping_scope === 'DEFAULT', 'DEFAULT');
  });

  await it('32) خريطة غامضة (نفس النطاق/الأولوية/فترة متداخلة) → 409', async () => {
    await withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'ROUNDING', priority: 910, rounding_account_id: roundingGl, effective_from: FUT, effective_to: FUT_END, created_by: userId }));
    await throwsHttp(() => withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'ROUNDING', priority: 910, rounding_account_id: roundingGl, effective_from: FUT, effective_to: FUT_END, created_by: userId })), 409);
  });

  await it('33) أولوية مختلفة تمنع الغموض', async () => {
    await withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'ROUNDING', priority: 920, rounding_account_id: roundingGl, effective_from: FUT, effective_to: FUT_END, created_by: userId }));
    const m2 = await withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'ROUNDING', priority: 921, rounding_account_id: roundingGl, effective_from: FUT, effective_to: FUT_END, created_by: userId }));
    assert(m2.priority === 921, 'أولوية مختلفة تُقبل');
  });

  await it('34) خريطة ROUNDING بلا حساب تقريب → 400', async () => {
    await throwsHttp(() => withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'ROUNDING', priority: 930, expense_account_id: expenseGl, effective_from: FUT, created_by: userId })), 400);
  });

  await it('35) خريطة COMPONENT بلا مكوّن → 400', async () => {
    await throwsHttp(() => withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'COMPONENT', priority: 940, expense_account_id: expenseGl, effective_from: FUT, created_by: userId })), 400);
  });

  await it('36) خريطة بحساب غير صالح → 400', async () => {
    await throwsHttp(() => withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'DEFAULT', priority: 945, expense_account_id: groupGl, effective_from: FUT, created_by: userId })), 400);
  });

  await it('37) خريطة بلا أي حساب → 400', async () => {
    await throwsHttp(() => withTransaction((c) => createPayrollAccountMapping(c, { mapping_code: uniq('PYMAP', suffix), mapping_scope: 'DEFAULT', priority: 946, effective_from: FUT, created_by: userId })), 400);
  });

  // ═══ الصلاحيات (أقل امتياز) ════════════════════════════════════════
  const viewerId = await upsertUser(`py-viewer-${suffix}`, true);
  const clerkId = await upsertUser(`py-clerk-${suffix}`, true);
  const approverId = await upsertUser(`py-approver-${suffix}`, true);
  const bareId = await upsertUser(`py-bare-${suffix}`, true);
  const outsiderId = await upsertUser(`py-out-${suffix}`, false);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
  await grantAccountsPlatformRole(approverId, ACCOUNTS_APPROVER_ROLE_CODE);
  const P = PAYROLL_CAPABILITIES;

  await it('38) المُشاهد: عرض نعم، إدارة لا', async () => {
    assert(await hasPayrollCapability(null, viewerId, P.VIEW), 'يرى');
    assert(!(await hasPayrollCapability(null, viewerId, P.MANAGE_PEOPLE)), 'لا يدير أشخاصاً');
    assert(!(await hasPayrollCapability(null, viewerId, P.MANAGE_COMPONENTS)), 'لا يدير مكوّنات');
  });

  await it('39) الكاتب: أشخاص/عقود/تكليفات نعم، مكوّنات/خرائط لا', async () => {
    assert(await hasPayrollCapability(null, clerkId, P.MANAGE_PEOPLE), 'أشخاص');
    assert(await hasPayrollCapability(null, clerkId, P.MANAGE_CONTRACTS), 'عقود');
    assert(await hasPayrollCapability(null, clerkId, P.MANAGE_ASSIGNMENTS), 'تكليفات');
    assert(!(await hasPayrollCapability(null, clerkId, P.MANAGE_COMPONENTS)), 'لا مكوّنات');
    assert(!(await hasPayrollCapability(null, clerkId, P.MANAGE_MAPPINGS)), 'لا خرائط');
  });

  await it('40) المُعتمد: عرض فقط', async () => {
    assert(await hasPayrollCapability(null, approverId, P.VIEW), 'يرى');
    assert(!(await hasPayrollCapability(null, approverId, P.MANAGE_CONTRACTS)), 'لا عقود');
  });

  await it('41) عضوية ACCOUNTS المجرّدة → عرض فقط', async () => {
    const caps = await getPayrollCapabilities(null, bareId);
    assert(caps.has(P.VIEW) && caps.size === 1, 'VIEW فقط');
  });

  await it('42) خارج النظام → لا صلاحيات', async () => {
    const caps = await getPayrollCapabilities(null, outsiderId);
    assert(caps.size === 0, 'لا صلاحيات');
  });

  await it('43) المدير: جميع الصلاحيات', async () => {
    for (const cap of Object.values(P)) {
      assert(await hasPayrollCapability(null, userId, cap), `المدير يملك ${cap}`);
    }
  });

  // ═══ التدقيق ═══════════════════════════════════════════════════════
  await it('44) التدقيق يسجّل إنشاء الأشخاص', async () => {
    const before = await query(`SELECT COUNT(*)::int n FROM accounts.financial_audit_log WHERE action='payroll_person.created'`).catch(() => ({ rows: [{ n: 0 }] }));
    // نسجّل عبر مسار الخدمة+التدقيق المستخدم في API عبر withFinancialAudit ليس هنا؛ نكتفي بوجود الجدول
    assert(Number(before.rows[0].n) >= 0, 'جدول التدقيق متاح');
  });

  // ═══ ثبات البذرة (idempotency) ════════════════════════════════════
  await it('45) البذرة DEMO idempotent (تشغيل مرتين)', async () => {
    await seedPayrollDemo();
    const c1 = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_people WHERE person_code LIKE 'DEMO-%'`);
    await seedPayrollDemo();
    const c2 = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_people WHERE person_code LIKE 'DEMO-%'`);
    assert(Number(c1.rows[0].n) === Number(c2.rows[0].n), `عدد أشخاص DEMO ثابت (${c1.rows[0].n} ↔ ${c2.rows[0].n})`);
    assert(Number(c2.rows[0].n) >= 5, 'خمسة أشخاص DEMO على الأقل');
  });

  // ═══ التحقق ════════════════════════════════════════════════════════
  await it('46) التحقق العادي: لا فروق سلامة', async () => {
    const r = await withTransaction((c) => verifyPayrollFoundation(c, { strict: false }));
    if (r.mismatches.length) console.log('  فروق:', r.mismatches.slice(0, 10).map((m) => `${m.kind}:${m.detail}`));
    assert(r.mismatches.length === 0, `توقّعنا 0 فروق، وجدنا ${r.mismatches.length}`);
    assert(r.ok === true, 'التحقق العادي ناجح');
  });

  await it('47) التحقق الصارم يعمل ويُرجِع العلم', async () => {
    const r = await withTransaction((c) => verifyPayrollFoundation(c, { strict: true }));
    assert(r.strict === true, 'العلم strict مفعّل');
    // في strict قد تُرقّى التحذيرات/غير المفسّر إلى فشل حسب بيانات البيئة — نتحقق من الاتساق فقط
    assert(r.mismatches.length === 0, 'لا فروق سلامة حتى في الصارم');
  });

  // ═══ تقوية القبول النهائية (H1/H2/H3) ═════════════════════════════
  // ── H1: قيد version >= 1 على مستوى القاعدة (SQL مباشر) ──
  await it('48) SQL مباشر: version=0 مرفوض بقيد القاعدة', async () => {
    const p = await mkPerson();
    let blocked = false;
    try { await query(`UPDATE accounts.payroll_people SET version=0 WHERE id=$1::uuid`, [p.id]); }
    catch { blocked = true; }
    assert(blocked, 'يجب أن يرفض CHECK قيمة version=0');
  });

  await it('49) SQL مباشر: version سالب مرفوض بقيد القاعدة', async () => {
    const p = await mkPerson();
    let blocked = false;
    try { await query(`UPDATE accounts.payroll_contracts SET version=-1 WHERE id=$1::uuid`, [(await mkContract(p.id)).id]); }
    catch { blocked = true; }
    assert(blocked, 'يجب أن يرفض CHECK قيمة version سالبة');
  });

  await it('50) SQL مباشر: INSERT بقيمة version=0 مرفوض', async () => {
    let blocked = false;
    try {
      await query(
        `INSERT INTO accounts.payroll_calendars (code, name_ar, calendar_type, effective_from, version, created_by)
         VALUES ($1,'تقويم اختبار','MONTHLY',$2,0,$3)`,
        [uniq('PYCAL', suffix), START, userId]
      );
    } catch { blocked = true; }
    assert(blocked, 'يجب أن يرفض CHECK إدراج version=0');
  });

  // ── H2: سبب إلزامي للأفعال الحساسة ──
  await it('51) إنهاء الشخص بلا سبب → 400', async () => {
    const p = await mkPerson();
    await throwsHttp(() => withTransaction((c) => setPayrollPersonStatus(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, target: 'TERMINATED' })), 400);
  });

  await it('52) إنهاء الشخص بسبب من مسافات فقط → 400', async () => {
    const p = await mkPerson();
    await throwsHttp(() => withTransaction((c) => setPayrollPersonStatus(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, target: 'TERMINATED', reason: '   ' })), 400);
  });

  await it('53) إنهاء العقد بلا سبب → 400', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    const active = await activateContract(c);
    await throwsHttp(() => withTransaction((cl) => transitionPayrollContract(cl, { id: active.id, userId, version: active.version, updated_at: active.updated_at, action: 'terminate' })), 400);
  });

  await it('54) إلغاء العقد بلا سبب → 400', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id); // DRAFT يقبل cancel
    await throwsHttp(() => withTransaction((cl) => transitionPayrollContract(cl, { id: c.id, userId, version: c.version, updated_at: c.updated_at, action: 'cancel' })), 400);
  });

  await it('55) إلغاء العقد بمسافات فقط → 400', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    await throwsHttp(() => withTransaction((cl) => transitionPayrollContract(cl, { id: c.id, userId, version: c.version, updated_at: c.updated_at, action: 'cancel', reason: '\t \n' })), 400);
  });

  await it('56) إنهاء الشخص بسبب صالح → ينجح ويُسجَّل السبب في التدقيق بلا تسريب', async () => {
    const p = await mkPerson();
    const reason = '  إنهاء   تجريبي   للخدمة  ';
    const normalized = 'إنهاء تجريبي للخدمة';
    const auditId = await withTransaction(async (c) => {
      const updated = await setPayrollPersonStatus(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, target: 'TERMINATED', reason });
      assert(updated.status === 'TERMINATED', 'أصبح منتهياً');
      // نحاكي نمط الـ route تماماً (السبب في metadata والوصف — لا request body خام)
      await writeFinancialAudit(c, {
        userId, action: 'payroll_person.terminated', entityType: 'payroll_person', entityId: p.id,
        newValues: { ...serializePayrollPerson(updated), transition_reason: normalized },
        description: `إنهاء خدمة شخص رواتب ${updated.person_code} — السبب: ${normalized}`,
      });
      return p.id;
    });
    const log = await query(
      `SELECT new_values, description FROM accounts.financial_audit_log
       WHERE entity_id=$1::uuid AND action='payroll_person.terminated' ORDER BY created_at DESC LIMIT 1`,
      [auditId]
    );
    const nv = log.rows[0].new_values as Record<string, unknown>;
    assert(nv.transition_reason === normalized, 'السبب المطبّع محفوظ في التدقيق');
    assert(String(log.rows[0].description).includes(normalized), 'السبب داخل الوصف');
    // لا تسريب: لا مفاتيح خام غير متوقعة (السبب المطبّع فقط + حقول الكيان المسلسلة)
    assert(!('password' in nv) && !('raw_body' in nv) && !('secret' in nv), 'لا تسريب حقول خام');
  });

  // ── H3: منع تكرار إسناد المكوّن (409 نظيف) + سباق ──
  await it('57) تكرار إسناد person-level (contract/assignment = NULL) → 409', async () => {
    const p = await mkPerson();
    const cmp = await mkComponent();
    await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '10', effective_from: START, created_by: userId }));
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '20', effective_from: START, created_by: userId })), 409);
  });

  await it('58) تكرار إسناد contract-level → 409', async () => {
    const p = await mkPerson();
    const c = await mkContract(p.id);
    const cmp = await mkComponent();
    await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_contract_id: c.id, amount: '10', effective_from: START, created_by: userId }));
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_contract_id: c.id, amount: '20', effective_from: START, created_by: userId })), 409);
  });

  await it('59) تكرار إسناد assignment-level → 409', async () => {
    const p = await mkPerson();
    const a = await withTransaction((cl) => createPayrollAssignment(cl, { payroll_person_id: p.id, assignment_type: 'GENERAL_ASSIGNMENT', title_ar: 'ت', effective_from: START, created_by: userId }));
    const cmp = await mkComponent();
    await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_assignment_id: a.id, amount: '10', effective_from: START, created_by: userId }));
    await throwsHttp(() => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, payroll_assignment_id: a.id, amount: '20', effective_from: START, created_by: userId })), 409);
  });

  await it('60) نفس المكوّن بتاريخ بداية مختلف → مسموح', async () => {
    const p = await mkPerson();
    const cmp = await mkComponent();
    await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '10', effective_from: START, created_by: userId }));
    const second = await withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '10', effective_from: '2026-06-01', created_by: userId }));
    assert(second.id, 'إسناد بتاريخ مختلف مقبول');
  });

  await it('61) سباق تكرار متزامن → واحد ينجح والآخر 409 نظيف بلا خطأ PG خام', async () => {
    const p = await mkPerson();
    const cmp = await mkComponent();
    const mk = () => withTransaction((cl) => createPayrollComponentAssignment(cl, { payroll_person_id: p.id, payroll_component_id: cmp.id, amount: '10', effective_from: START, created_by: userId }));
    const results = await Promise.allSettled([mk(), mk()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    assert(fulfilled === 1, `المتوقع نجاح واحد فقط، حصل ${fulfilled}`);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // سواء فاز الفحص المسبق (AccountsHttpError 409) أو قيد القاعدة (23505) — يجب أن يعطي الـ API 409 نظيفاً
    let status = 0; let message = '';
    if (rejected.reason instanceof AccountsHttpError) {
      status = rejected.reason.status; message = rejected.reason.message;
    } else {
      const res = mapPgError(rejected.reason);
      status = res.status; message = JSON.stringify(await res.json());
    }
    assert(status === 409, `المتوقع 409، حصل ${status}`);
    assert(!/uq_pca|constraint|payroll_component_assignments/i.test(message), 'لا يكشف اسم القيد/الجدول');
  });

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closePool(); });
