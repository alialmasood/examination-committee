/**
 * بيانات عرض الرواتب 9.A.1 — DEMO فقط، idempotent (تشغيل مرتين بلا تكرار).
 *
 * الاستخدام:
 *  - npm run seed:accounts-payroll-demo
 *  - npx tsx src/scripts/seed-accounts-payroll-demo.ts
 *
 * الثبات (idempotency):
 *  - كل كيان محروس برمزٍ ثابت (code/number) بأكواد DEMO — يُنشأ مرة واحدة فقط.
 *  - لا يحذف ولا يعدّل أي بيانات غير DEMO. لا يلمس Mapping حقيقياً.
 *  - لا يفشل إذا كانت بيانات DEMO موجودة جزئياً (يتخطّى الموجود).
 */
import { closePool, query } from '../lib/db';
import { withTransaction } from '../lib/accounts/with-transaction';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollContract, transitionPayrollContract } from '../lib/accounts/payroll-contracts';
import { createPayrollAssignment, transitionPayrollAssignment } from '../lib/accounts/payroll-assignments';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import { createPayrollAccountMapping } from '../lib/accounts/payroll-account-mappings';

async function resolveUserId(): Promise<string> {
  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('لا يوجد مستخدم ACCOUNTS فعّال — شغّل seed:accounts أولاً');
  return user.rows[0].id as string;
}

/** ينشئ/يُعيد حساب GL تفصيلياً قابلاً للترحيل برصيدٍ طبيعي محدد. */
async function ensureGl(code: string, nameAr: string, typeCode: string, userId: string): Promise<string> {
  const normal = typeCode === 'REVENUE' || typeCode === 'LIABILITY' || typeCode === 'EQUITY' ? 'CREDIT' : 'DEBIT';
  const existing = await query(`SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) {
    await query(
      `UPDATE accounts.chart_of_accounts SET is_group=FALSE, allow_posting=TRUE, is_active=TRUE WHERE id=$1`,
      [existing.rows[0].id]
    );
    return existing.rows[0].id as string;
  }
  const type = await query(`SELECT id FROM accounts.account_types WHERE code=$1`, [typeCode]);
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'DEMO 9.A.1 Payroll')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, normal, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureCostCenter(code: string, nameAr: string, userId: string): Promise<string> {
  const existing = await query(`SELECT id FROM accounts.cost_centers WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await query(
    `INSERT INTO accounts.cost_centers (code, name_ar, level, is_group, is_active, created_by, description)
     VALUES ($1,$2,1,FALSE,TRUE,$3,'DEMO 9.A.1 Payroll') RETURNING id`,
    [code, nameAr, userId]
  );
  return ins.rows[0].id as string;
}

async function existsBy(sql: string, params: unknown[]): Promise<string | null> {
  const r = await query(sql, params);
  return r.rows[0]?.id ?? null;
}

const START = '2025-01-01';

export async function seedPayrollDemo(): Promise<void> {
  const userId = await resolveUserId();

  // ── حسابات ومركز كلفة DEMO ────────────────────────────────────────
  const expenseGl = await ensureGl('DEMO-PAY-EXPENSE', 'مصروف رواتب DEMO', 'EXPENSE', userId);
  const liabilityGl = await ensureGl('DEMO-PAY-LIABILITY', 'التزام رواتب DEMO', 'LIABILITY', userId);
  const payableGl = await ensureGl('DEMO-PAY-PAYABLE', 'ذمم رواتب دائنة DEMO', 'LIABILITY', userId);
  const roundingGl = await ensureGl('DEMO-PAY-ROUNDING', 'فروقات تقريب رواتب DEMO', 'EXPENSE', userId);
  const costCenterId = await ensureCostCenter('DEMO-PAY-CC', 'مركز كلفة رواتب DEMO', userId);

  // ── التقويمات ─────────────────────────────────────────────────────
  const calendars: Array<[string, string, string]> = [
    ['DEMO-MONTHLY', 'تقويم شهري DEMO', 'MONTHLY'],
    ['DEMO-LECTURER', 'تقويم محاضرين DEMO', 'LECTURER'],
    ['DEMO-DAILY', 'تقويم يومي DEMO', 'DAILY'],
  ];
  for (const [code, name, type] of calendars) {
    const found = await existsBy(`SELECT id FROM accounts.payroll_calendars WHERE code=$1`, [code]);
    if (found) continue;
    await withTransaction((c) => createPayrollCalendar(c, {
      code, name_ar: name, calendar_type: type, currency_code: 'IQD', effective_from: START, created_by: userId,
    }));
    console.log(`✓ تقويم: ${code}`);
  }

  // ── الأشخاص ───────────────────────────────────────────────────────
  const people: Array<{ code: string; name: string; type: string }> = [
    { code: 'DEMO-TEACHER', name: 'تدريسي عرض DEMO', type: 'TEACHING_STAFF' },
    { code: 'DEMO-LECTURER', name: 'محاضر خارجي عرض DEMO', type: 'EXTERNAL_LECTURER' },
    { code: 'DEMO-EMPLOYEE', name: 'موظف عرض DEMO', type: 'EMPLOYEE' },
    { code: 'DEMO-DAILY', name: 'عامل يومي عرض DEMO', type: 'DAILY_WORKER' },
    { code: 'DEMO-SERVICE', name: 'عامل خدمة عرض DEMO', type: 'SERVICE_WORKER' },
  ];
  const personId: Record<string, string> = {};
  for (const p of people) {
    let id = await existsBy(`SELECT id FROM accounts.payroll_people WHERE person_code=$1`, [p.code]);
    if (!id) {
      const row = await withTransaction((c) => createPayrollPerson(c, {
        person_code: p.code, full_name_ar: p.name, person_type: p.type,
        default_cost_center_id: costCenterId, default_currency_code: 'IQD',
        payment_method: 'BANK', bank_account_name: p.name,
        bank_account_identifier: `IQ98NBIQ00000000000${Math.floor(Math.random() * 9000 + 1000)}`,
        effective_from: START, created_by: userId,
      }));
      id = row.id;
      console.log(`✓ شخص: ${p.code}`);
    }
    personId[p.code] = id;
  }

  // ── العقود (وتفعيلها) ─────────────────────────────────────────────
  const contracts: Array<{ number: string; person: string; basis: string; base: string; rate?: string }> = [
    { number: 'DEMO-CT-TEACHER', person: 'DEMO-TEACHER', basis: 'MONTHLY_FIXED', base: '1500000' },
    { number: 'DEMO-CT-LECTURER', person: 'DEMO-LECTURER', basis: 'PER_LECTURE', base: '0', rate: '50000' },
    { number: 'DEMO-CT-EMPLOYEE', person: 'DEMO-EMPLOYEE', basis: 'MONTHLY_FIXED', base: '900000' },
    { number: 'DEMO-CT-DAILY', person: 'DEMO-DAILY', basis: 'DAILY', base: '0', rate: '40000' },
    { number: 'DEMO-CT-SERVICE', person: 'DEMO-SERVICE', basis: 'FIXED_SERVICE', base: '300000' },
  ];
  const contractId: Record<string, string> = {};
  for (const ct of contracts) {
    let id = await existsBy(`SELECT id FROM accounts.payroll_contracts WHERE contract_number=$1`, [ct.number]);
    if (!id) {
      await withTransaction(async (c) => {
        const row = await createPayrollContract(c, {
          payroll_person_id: personId[ct.person], contract_number: ct.number,
          compensation_basis: ct.basis, base_amount: ct.base, rate_amount: ct.rate,
          currency_code: 'IQD', effective_from: START,
          default_expense_account_id: expenseGl, payable_account_id: payableGl,
          default_cost_center_id: costCenterId, created_by: userId,
        });
        await transitionPayrollContract(c, { id: row.id, userId, version: row.version, updated_at: row.updated_at, action: 'activate' });
        id = row.id;
      });
      console.log(`✓ عقد (فعّال): ${ct.number}`);
    }
    contractId[ct.number] = id!;
  }

  // ── التكليفات (وتفعيلها) ──────────────────────────────────────────
  const assignments: Array<{ code: string; person: string; contract?: string; type: string; title: string }> = [
    { code: 'DEMO-DEPARTMENT-HEAD', person: 'DEMO-TEACHER', contract: 'DEMO-CT-TEACHER', type: 'ADDITIONAL_RESPONSIBILITY', title: 'رئاسة قسم DEMO' },
    { code: 'DEMO-LECTURE-ASSIGNMENT', person: 'DEMO-LECTURER', contract: 'DEMO-CT-LECTURER', type: 'LECTURER_ASSIGNMENT', title: 'تكليف محاضرة DEMO' },
    { code: 'DEMO-COMMITTEE', person: 'DEMO-EMPLOYEE', contract: 'DEMO-CT-EMPLOYEE', type: 'COMMITTEE_ASSIGNMENT', title: 'عضوية لجنة DEMO' },
  ];
  for (const a of assignments) {
    const found = await existsBy(`SELECT id FROM accounts.payroll_assignments WHERE assignment_code=$1`, [a.code]);
    if (found) continue;
    await withTransaction(async (c) => {
      const row = await createPayrollAssignment(c, {
        payroll_person_id: personId[a.person],
        payroll_contract_id: a.contract ? contractId[a.contract] : undefined,
        assignment_code: a.code, assignment_type: a.type, title_ar: a.title,
        cost_center_id: costCenterId, effective_from: START, created_by: userId,
      });
      await transitionPayrollAssignment(c, { id: row.id, userId, version: row.version, updated_at: row.updated_at, action: 'activate' });
    });
    console.log(`✓ تكليف (فعّال): ${a.code}`);
  }

  // ── المكوّنات ─────────────────────────────────────────────────────
  const components: Array<{ code: string; name: string; type: string; method: string; amount?: string; rate?: string; percentage?: string }> = [
    { code: 'DEMO-BASIC-SALARY', name: 'الراتب الأساسي DEMO', type: 'EARNING', method: 'FIXED_AMOUNT', amount: '1500000' },
    { code: 'DEMO-POSITION-ALLOWANCE', name: 'مخصصات منصب DEMO', type: 'EARNING', method: 'PERCENTAGE_OF_BASIC', percentage: '25' },
    { code: 'DEMO-LECTURE-FEE', name: 'أجر محاضرة DEMO', type: 'EARNING', method: 'LECTURES_X_RATE', rate: '50000' },
    { code: 'DEMO-DAILY-WAGE', name: 'أجر يومي DEMO', type: 'EARNING', method: 'DAYS_X_DAILY_RATE', rate: '40000' },
    { code: 'DEMO-SERVICE-FEE', name: 'أجر خدمة DEMO', type: 'EARNING', method: 'FIXED_AMOUNT', amount: '300000' },
    { code: 'DEMO-BONUS', name: 'مكافأة DEMO', type: 'EARNING', method: 'MANUAL_AMOUNT' },
    { code: 'DEMO-ABSENCE', name: 'استقطاع غياب DEMO', type: 'DEDUCTION', method: 'DAYS_X_DAILY_RATE', rate: '40000' },
    { code: 'DEMO-PENALTY', name: 'عقوبة DEMO', type: 'DEDUCTION', method: 'MANUAL_AMOUNT' },
    { code: 'DEMO-OTHER-DEDUCTION', name: 'استقطاع آخر DEMO', type: 'DEDUCTION', method: 'FIXED_AMOUNT', amount: '25000' },
  ];
  const componentId: Record<string, string> = {};
  for (const comp of components) {
    let id = await existsBy(`SELECT id FROM accounts.payroll_components WHERE component_code=$1`, [comp.code]);
    if (!id) {
      const row = await withTransaction((c) => createPayrollComponent(c, {
        component_code: comp.code, name_ar: comp.name, component_type: comp.type,
        calculation_method: comp.method, default_amount: comp.amount, default_rate: comp.rate,
        default_percentage: comp.percentage,
        // 9.A.2.1: «نسبة من الأساسي» تتطلب أساس احتساب CONTRACT_BASIC؛ البقية NONE
        calculation_base_type: comp.method === 'PERCENTAGE_OF_BASIC' ? 'CONTRACT_BASIC' : 'NONE',
        expense_account_id: comp.type === 'EARNING' ? expenseGl : undefined,
        liability_account_id: comp.type === 'DEDUCTION' ? liabilityGl : undefined,
        default_cost_center_id: costCenterId, effective_from: START, created_by: userId,
      }));
      id = row.id;
      console.log(`✓ مكوّن: ${comp.code}`);
    }
    componentId[comp.code] = id;
  }

  // ── إسنادات مكوّنات (عيّنة على التدريسي) ──────────────────────────
  const compAssignments: Array<{ person: string; component: string; contract?: string; amount?: string; percentage?: string; priority: number }> = [
    { person: 'DEMO-TEACHER', component: 'DEMO-BASIC-SALARY', contract: 'DEMO-CT-TEACHER', amount: '1500000', priority: 10 },
    { person: 'DEMO-TEACHER', component: 'DEMO-POSITION-ALLOWANCE', contract: 'DEMO-CT-TEACHER', percentage: '25', priority: 20 },
    { person: 'DEMO-EMPLOYEE', component: 'DEMO-BASIC-SALARY', contract: 'DEMO-CT-EMPLOYEE', amount: '900000', priority: 10 },
  ];
  for (const ca of compAssignments) {
    const found = await existsBy(
      `SELECT id FROM accounts.payroll_component_assignments
       WHERE payroll_person_id=$1 AND payroll_component_id=$2
         AND effective_from=$3::date`,
      [personId[ca.person], componentId[ca.component], START]
    );
    if (found) continue;
    await withTransaction((c) => createPayrollComponentAssignment(c, {
      payroll_person_id: personId[ca.person],
      payroll_component_id: componentId[ca.component],
      payroll_contract_id: ca.contract ? contractId[ca.contract] : undefined,
      amount: ca.amount, percentage: ca.percentage, priority: ca.priority,
      effective_from: START, created_by: userId,
    }));
    console.log(`✓ إسناد مكوّن: ${ca.person} ← ${ca.component}`);
  }

  // ── خرائط الحسابات ────────────────────────────────────────────────
  const mappings: Array<{ code: string; scope: string; component?: string; accounts: Record<string, string> }> = [
    { code: 'DEMO-MAP-DEFAULT', scope: 'DEFAULT', accounts: { expense_account_id: expenseGl, liability_account_id: liabilityGl, payable_account_id: payableGl } },
    { code: 'DEMO-MAP-COMPONENT-BASIC', scope: 'COMPONENT', component: 'DEMO-BASIC-SALARY', accounts: { expense_account_id: expenseGl } },
    { code: 'DEMO-MAP-ROUNDING', scope: 'ROUNDING', accounts: { rounding_account_id: roundingGl } },
  ];
  for (const m of mappings) {
    const found = await existsBy(`SELECT id FROM accounts.payroll_account_mappings WHERE mapping_code=$1`, [m.code]);
    if (found) continue;
    await withTransaction((c) => createPayrollAccountMapping(c, {
      mapping_code: m.code, mapping_scope: m.scope,
      payroll_component_id: m.component ? componentId[m.component] : undefined,
      cost_center_id: costCenterId, effective_from: START, created_by: userId,
      ...m.accounts,
    }));
    console.log(`✓ خريطة حسابات: ${m.code}`);
  }

  console.log('✓ بيانات الرواتب DEMO 9.A.1 جاهزة — القائمة: /accounts/payroll');
}

// ── تشغيل مباشر عبر tsx (بدون التأثير عند الاستيراد من الاختبارات) ──
const invokedDirectly = /seed-accounts-payroll-demo\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  seedPayrollDemo()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
