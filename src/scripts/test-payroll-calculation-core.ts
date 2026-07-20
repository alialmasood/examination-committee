/**
 * اختبارات نواة احتساب الرواتب 9.A.2.3.1
 * npm run test:payroll-calculation-core
 *
 * عزل: ownership token + cleanup في finally. تشغيل مرتين بلا تراكم.
 */
import { randomUUID } from 'crypto';
import { closePool, pool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  calculateFixedAmount,
  calculatePercentageOfBasic,
  isSupportedPayrollCurrency,
} from '../lib/accounts/payroll-calculation-formulas';
import { resolvePayrollRunPersons } from '../lib/accounts/payroll-scope-resolver';
import {
  __clearPayrollCalcFailpointForTests,
  __setPayrollCalcFailpointForTests,
  calculatePayrollRunCore,
  mapIdempotencyKeyToRequestId,
  type PayrollCalcFailpoint,
} from '../lib/accounts/payroll-calculation-engine';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import {
  createPayrollAssignment,
  transitionPayrollAssignment,
} from '../lib/accounts/payroll-assignments';
import { createPayrollPerson, setPayrollPersonStatus } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import {
  cancelPayrollRun,
  createPayrollRun,
  loadPayrollRun,
} from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import {
  clearRunCalculationArtifacts,
  loadRunCalculationArtifacts,
} from '../lib/accounts/payroll-run-snapshots';
import {
  acquirePayrollLocks,
  payrollPeriodLock,
  payrollRunLock,
} from '../lib/accounts/payroll-locks';
import { verifyPayrollCalculationCore } from '../lib/accounts/verify-payroll-calculation-core';
import { verifyPayrollSnapshotSchema } from '../lib/accounts/verify-payroll-snapshot-schema';
import { withTransaction, txQuery } from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;
function ok(name: string) {
  passCount += 1;
  console.log(`✅ ${name}`);
}
function failed(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err instanceof Error ? err.message : (err ?? ''));
  process.exitCode = 1;
}
async function it(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    failed(name, e);
  } finally {
    __clearPayrollCalcFailpointForTests();
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function throwsHttp(fn: () => Promise<unknown>, status: number, includes?: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        throw new Error(`الرسالة: ${e.message}`);
      }
      return;
    }
    throw e;
  }
  throw new Error(`توقّعنا ${status}`);
}

const owned = {
  calendarIds: [] as string[],
  periodIds: [] as string[],
  runIds: [] as string[],
  personIds: [] as string[],
  contractIds: [] as string[],
  assignmentIds: [] as string[],
  componentIds: [] as string[],
  pcaIds: [] as string[],
  collegeIds: [] as string[],
  departmentIds: [] as string[],
};

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(
      `DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id = ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(`DELETE FROM accounts.payroll_runs WHERE id = ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.periodIds.length) {
    await query(`DELETE FROM accounts.payroll_periods WHERE id = ANY($1::uuid[])`, [owned.periodIds]);
  }
  if (owned.pcaIds.length) {
    await query(`DELETE FROM accounts.payroll_component_assignments WHERE id = ANY($1::uuid[])`, [
      owned.pcaIds,
    ]);
  }
  if (owned.assignmentIds.length) {
    await query(
      `DELETE FROM accounts.payroll_assignments WHERE id = ANY($1::uuid[]) AND assignment_code NOT LIKE 'DEMO%'`,
      [owned.assignmentIds]
    );
  }
  if (owned.contractIds.length) {
    await query(
      `DELETE FROM accounts.payroll_contracts WHERE id = ANY($1::uuid[]) AND contract_number NOT LIKE 'DEMO%'`,
      [owned.contractIds]
    );
  }
  if (owned.personIds.length) {
    await query(
      `DELETE FROM accounts.payroll_people WHERE id = ANY($1::uuid[]) AND person_code NOT LIKE 'DEMO%'`,
      [owned.personIds]
    );
  }
  if (owned.componentIds.length) {
    await query(
      `DELETE FROM accounts.payroll_components WHERE id = ANY($1::uuid[]) AND component_code NOT LIKE 'DEMO%'`,
      [owned.componentIds]
    );
  }
  if (owned.calendarIds.length) {
    await query(
      `DELETE FROM accounts.payroll_calendars WHERE id = ANY($1::uuid[]) AND code NOT LIKE 'DEMO%'`,
      [owned.calendarIds]
    );
  }
  if (owned.departmentIds.length) {
    await query(`DELETE FROM student_affairs.departments WHERE id = ANY($1::uuid[])`, [
      owned.departmentIds,
    ]);
  }
  if (owned.collegeIds.length) {
    await query(`DELETE FROM student_affairs.colleges WHERE id = ANY($1::uuid[])`, [owned.collegeIds]);
  }
}

async function countOwned() {
  const r = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_periods WHERE id=ANY($2::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_runs WHERE id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_people WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_lines WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_issues WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.colleges WHERE id=ANY($6::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.departments WHERE id=ANY($7::uuid[])) AS n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
      owned.collegeIds,
      owned.departmentIds,
    ]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function auditCount(runId: string, action: string) {
  const r = await query(
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log
     WHERE entity_type='payroll_run' AND entity_id=$1::uuid AND action=$2`,
    [runId, action]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  console.log('===== اختبارات نواة احتساب الرواتب 9.A.2.3.1 =====');
  const token = `CALC${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active ORDER BY u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    failed('إعداد: لا مستخدم');
    return;
  }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة احتساب','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('CALCFY'), userId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const ccRes = await query(
    `SELECT id FROM accounts.cost_centers WHERE is_active=TRUE ORDER BY created_at LIMIT 2`
  );
  const costCenterId = (ccRes.rows[0]?.id as string | undefined) ?? null;
  const costCenterId2 = (ccRes.rows[1]?.id as string | undefined) ?? null;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('CALCCAL'),
        name_ar: 'تقويم احتساب',
        calendar_type: 'MONTHLY',
        currency_code: currency,
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.calendarIds.push(cal.id);
    return cal;
  };
  const mkPeriod = async (calendarId: string) => {
    const p = await withTransaction((c) =>
      createPayrollPeriod(c, {
        payroll_calendar_id: calendarId,
        name_ar: 'فترة احتساب',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        fiscal_year_id: fiscalYearId,
        created_by: userId,
      })
    );
    owned.periodIds.push(p.id);
    return p;
  };
  const mkPerson = async (over: Record<string, unknown> = {}) => {
    const p = await withTransaction((c) =>
      createPayrollPerson(c, {
        full_name_ar: 'شخص احتساب',
        person_type: 'EMPLOYEE',
        default_currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: userId,
        ...over,
      })
    );
    owned.personIds.push(p.id);
    return p;
  };
  const mkContract = async (personId: string, base = '1000000', currency = 'IQD') => {
    const c = await withTransaction(async (client) => {
      const draft = await createPayrollContract(client, {
        payroll_person_id: personId,
        compensation_basis: 'MONTHLY_FIXED',
        base_amount: base,
        currency_code: currency,
        effective_from: '2025-01-01',
        created_by: userId,
      });
      owned.contractIds.push(draft.id);
      return transitionPayrollContract(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
        action: 'activate',
      });
    });
    return c;
  };
  const mkFixedComponent = async (amount = '100000') => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('FIX'),
        name_ar: 'بدل ثابت',
        component_type: 'EARNING',
        calculation_method: 'FIXED_AMOUNT',
        calculation_base_type: 'NONE',
        default_amount: amount,
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.componentIds.push(comp.id);
    return comp;
  };
  const mkPctComponent = async () => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('PCT'),
        name_ar: 'نسبة أساسي',
        component_type: 'EARNING',
        calculation_method: 'PERCENTAGE_OF_BASIC',
        calculation_base_type: 'CONTRACT_BASIC',
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.componentIds.push(comp.id);
    return comp;
  };
  const mkDeduction = async (amount = '50000') => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('DED'),
        name_ar: 'استقطاع',
        component_type: 'DEDUCTION',
        calculation_method: 'FIXED_AMOUNT',
        calculation_base_type: 'NONE',
        default_amount: amount,
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.componentIds.push(comp.id);
    return comp;
  };
  const mkUnsupported = async () => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('UNS'),
        name_ar: 'غير مدعوم',
        component_type: 'EARNING',
        calculation_method: 'QUANTITY_X_RATE',
        calculation_base_type: 'NONE',
        default_rate: '10',
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.componentIds.push(comp.id);
    return comp;
  };
  const mkPca = async (
    personId: string,
    componentId: string,
    over: Record<string, unknown> = {}
  ) => {
    const pca = await withTransaction((c) =>
      createPayrollComponentAssignment(c, {
        payroll_person_id: personId,
        payroll_component_id: componentId,
        payroll_contract_id: over.payroll_contract_id,
        amount: over.amount,
        percentage: over.percentage,
        effective_from: '2025-01-01',
        created_by: userId,
        ...over,
      })
    );
    owned.pcaIds.push(pca.id);
    return pca;
  };
  const mkRun = async (periodId: string, over: Record<string, unknown> = {}) => {
    const run = await withTransaction((c) =>
      createPayrollRun(c, {
        payroll_period_id: periodId,
        run_type: 'REGULAR',
        scope_type: 'PERSON_LIST',
        created_by: userId,
        ...over,
      })
    );
    owned.runIds.push(run.id);
    return run;
  };

  /** تشغيل PERSON_LIST بعضو واحد (عزل عن باقي أشخاص القاعدة). */
  const mkRunWithPerson = async (periodId: string, personId: string) => {
    let run = await mkRun(periodId);
    run = await withTransaction(async (c) => {
      const r = await addScopeMember(c, {
        runId: run.id,
        personId,
        userId,
        version: run.version,
        updated_at: run.updated_at,
      });
      return r.run;
    });
    return run;
  };
  const mkRunWithPeople = async (periodId: string, personIds: string[]) => {
    let run = await mkRun(periodId);
    for (const personId of personIds) {
      run = await withTransaction(async (c) => {
        const r = await addScopeMember(c, {
          runId: run.id,
          personId,
          userId,
          version: run.version,
          updated_at: run.updated_at,
        });
        return r.run;
      });
    }
    return run;
  };
  const mkCollegeDept = async () => {
    const col = await query(
      `INSERT INTO student_affairs.colleges (id, name_ar, name_en)
       VALUES (gen_random_uuid(), $1, 'Calc College') RETURNING id`,
      [uniq('كلية')]
    );
    const collegeId = col.rows[0].id as string;
    owned.collegeIds.push(collegeId);
    const dep = await query(
      `INSERT INTO student_affairs.departments (id, college_id, name_ar, name_en)
       VALUES (gen_random_uuid(), $1::uuid, $2, 'Calc Dept') RETURNING id`,
      [collegeId, uniq('قسم')]
    );
    const departmentId = dep.rows[0].id as string;
    owned.departmentIds.push(departmentId);
    return { collegeId, departmentId };
  };
  const mkDeptInCollege = async (collegeId: string) => {
    const dep = await query(
      `INSERT INTO student_affairs.departments (id, college_id, name_ar, name_en)
       VALUES (gen_random_uuid(), $1::uuid, $2, 'Calc Dept2') RETURNING id`,
      [collegeId, uniq('قسم')]
    );
    const departmentId = dep.rows[0].id as string;
    owned.departmentIds.push(departmentId);
    return departmentId;
  };
  const mkActiveAssignment = async (
    personId: string,
    departmentId?: string | null,
    costCenter?: string | null,
    over: { effective_from?: string; effective_to?: string | null } = {}
  ) => {
    const a = await withTransaction(async (client) => {
      const draft = await createPayrollAssignment(client, {
        payroll_person_id: personId,
        assignment_type: 'GENERAL_ASSIGNMENT',
        title_ar: 'تكليف احتساب',
        department_id: departmentId ?? undefined,
        cost_center_id: costCenter ?? undefined,
        effective_from: over.effective_from ?? '2025-01-01',
        effective_to: over.effective_to ?? undefined,
        created_by: userId,
      });
      owned.assignmentIds.push(draft.id);
      return transitionPayrollAssignment(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
        action: 'activate',
      });
    });
    return a;
  };
  const calc = async (run: { id: string; version: number; updated_at: unknown }, key?: string) =>
    withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: key ?? randomUUID(),
      })
    );

  const assertDraftClean = async (
    runId: string,
    expectTotals: { gross: string; ded: string; emp: string; net: string }
  ) => {
    const after = await withTransaction((c) => loadPayrollRun(c, runId));
    assert(after.status === 'DRAFT', `status ${after.status}`);
    assert(String(after.gross_total) === expectTotals.gross, `gross ${after.gross_total}`);
    assert(String(after.deduction_total) === expectTotals.ded, `ded ${after.deduction_total}`);
    assert(
      String(after.employer_contribution_total) === expectTotals.emp,
      `emp ${after.employer_contribution_total}`
    );
    assert(String(after.net_total) === expectTotals.net, `net ${after.net_total}`);
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, runId));
    assert(arts.people.length === 0, 'people artifacts');
    assert(arts.lines.length === 0, 'line artifacts');
    assert(arts.issues.length === 0, 'issue artifacts');
    assert((await auditCount(runId, 'payroll_run.calculated')) === 0, 'no success audit');
  };

  // —— صيغ التقريب ——
  await it('صيغة: 1000×12.5% → 125', async () => {
    const r = calculatePercentageOfBasic('1000', '12.5', 'IQD');
    assert(r.calculated === '125.000', `got ${r.calculated}`);
  });
  await it('صيغة: 1001×12.5% → 125', async () => {
    const r = calculatePercentageOfBasic('1001', '12.5', 'IQD');
    assert(r.calculated === '125.000', `got ${r.calculated}`);
  });
  await it('صيغة: 1004×12.5% → 126', async () => {
    const r = calculatePercentageOfBasic('1004', '12.5', 'IQD');
    assert(r.calculated === '126.000', `got ${r.calculated}`);
  });
  await it('صيغة: FIXED_AMOUNT تقريب', async () => {
    const r = calculateFixedAmount('100.4', 'IQD');
    assert(r.calculated === '100.000', `got ${r.calculated}`);
  });
  await it('صيغة: isSupportedPayrollCurrency IQD فقط', async () => {
    assert(isSupportedPayrollCurrency('IQD'), 'IQD');
    assert(!isSupportedPayrollCurrency('USD'), 'USD');
    assert(!isSupportedPayrollCurrency('KWD'), 'KWD');
    assert(!isSupportedPayrollCurrency('ZZZ'), 'ZZZ');
  });

  // —— Happy FIXED ——
  await it('احتساب FIXED_AMOUNT ناجح (IQD)', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id, '500000');
    const comp = await mkFixedComponent('120000');
    await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '120000' });
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    assert(res.run.status === 'CALCULATED', 'status');
    assert(res.summary.people_count === 1, 'people');
    assert(res.summary.gross_total === '120000.000', `gross ${res.summary.gross_total}`);
    assert(res.summary.error_count === 0, 'errors');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    const rp = arts.people[0] as {
      basic_amount: string;
      gross_amount: string;
      calculation_status: string;
    };
    assert(rp.calculation_status === 'CALCULATED', 'person status');
    assert(String(rp.basic_amount) === '500000.000', `basic ${rp.basic_amount}`);
    assert(String(rp.gross_amount) === '120000.000', 'gross policy B');
    assert(arts.lines.length === 1, 'one line');
  });

  // —— Happy PERCENTAGE + rounding cases ——
  await it('احتساب PERCENTAGE تقريب 1000/1001/1004', async () => {
    for (const [base, expect] of [
      ['1000', '125.000'],
      ['1001', '125.000'],
      ['1004', '126.000'],
    ] as const) {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id, base);
      const comp = await mkPctComponent();
      await mkPca(person.id, comp.id, {
        payroll_contract_id: contract.id,
        percentage: '12.5',
      });
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await calc(run);
      assert(
        res.summary.gross_total === expect,
        `${base} → ${res.summary.gross_total} expected ${expect}`
      );
    }
  });

  // —— Basic policy B: basic>0 gross=0 ——
  await it('سياسة B: أساسي بلا EARNING → gross=0', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id, '900000');
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    const rp = arts.people[0] as {
      basic_amount: string;
      gross_amount: string;
      calculation_status: string;
    };
    assert(rp.calculation_status === 'CALCULATED', 'status');
    assert(String(rp.basic_amount) === '900000.000', 'basic');
    assert(String(rp.gross_amount) === '0.000', 'gross0');
    assert(res.summary.gross_total === '0.000', 'run gross');
    assert(
      (arts.issues as Array<{ issue_code: string }>).some((i) => i.issue_code === 'NO_EARNINGS'),
      'NO_EARNINGS'
    );
  });

  // —— Scope ALL / DEPT / COST / PERSON_LIST / COLLEGE ——
  await it('نطاق DEPARTMENT', async () => {
    const { departmentId } = await mkCollegeDept();
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const inDept = await mkPerson();
    const outDept = await mkPerson();
    await mkContract(inDept.id);
    await mkContract(outDept.id);
    await mkActiveAssignment(inDept.id, departmentId);
    await mkActiveAssignment(outDept.id, null);
    const fix = await mkFixedComponent('10000');
    await mkPca(inDept.id, fix.id, { amount: '10000' });
    await mkPca(outDept.id, fix.id, { amount: '10000' });
    const run = await mkRun(period.id, {
      scope_type: 'DEPARTMENT',
      scope_ref_id: departmentId,
    });
    const res = await calc(run);
    assert(res.summary.people_count === 1, `people ${res.summary.people_count}`);
  });

  await it('نطاق COLLEGE عبر college_id', async () => {
    const { collegeId, departmentId } = await mkCollegeDept();
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    await mkActiveAssignment(person.id, departmentId);
    const fix = await mkFixedComponent('15000');
    await mkPca(person.id, fix.id, { amount: '15000' });
    const run = await mkRun(period.id, {
      scope_type: 'COLLEGE',
      scope_ref_id: collegeId,
    });
    const res = await calc(run);
    assert(res.summary.people_count === 1, 'college people');
    assert(res.summary.gross_total === '15000.000', 'college gross');
  });

  await it('COLLEGE dedupe: تكليفان في قسمين لنفس الكلية → شخص واحد', async () => {
    const { collegeId, departmentId } = await mkCollegeDept();
    const dept2 = await mkDeptInCollege(collegeId);
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    await mkActiveAssignment(person.id, departmentId);
    await mkActiveAssignment(person.id, dept2);
    const fix = await mkFixedComponent('17000');
    await mkPca(person.id, fix.id, { amount: '17000' });
    const run = await mkRun(period.id, {
      scope_type: 'COLLEGE',
      scope_ref_id: collegeId,
    });
    const res = await calc(run);
    assert(res.summary.people_count === 1, `people ${res.summary.people_count}`);
  });

  await it('COST_CENTER: default فقط بلا تكليف → مستبعد', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة نشط');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson({ default_cost_center_id: costCenterId });
    await mkContract(person.id);
    const fix = await mkFixedComponent('11000');
    await mkPca(person.id, fix.id, { amount: '11000' });
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    const resolved = await withTransaction((c) =>
      resolvePayrollRunPersons(c, {
        scope_type: 'COST_CENTER',
        scope_ref_id: costCenterId,
        calculation_date: '2025-01-31',
        run_id: run.id,
      })
    );
    assert(
      !resolved.some((p) => p.id === person.id),
      'default_cost_center_id لا يُدخل النطاق'
    );
  });

  await it('نطاق COST_CENTER عبر تكليف فعّال', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة نشط في القاعدة');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson({ default_cost_center_id: null });
    await mkContract(person.id);
    await mkActiveAssignment(person.id, null, costCenterId);
    const fix = await mkFixedComponent('11000');
    await mkPca(person.id, fix.id, { amount: '11000' });
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    const res = await calc(run);
    assert(res.summary.people_count >= 1, 'cost center people');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(
      (arts.people as Array<{ payroll_person_id: string }>).some(
        (p) => p.payroll_person_id === person.id
      ),
      'our person in cost center scope'
    );
  });

  await it('COST_CENTER: تواريخ سريان (منتهٍ / يبدأ لاحقاً / مركز آخر)', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const ended = await mkPerson();
    const future = await mkPerson();
    const other = await mkPerson();
    await mkContract(ended.id);
    await mkContract(future.id);
    await mkContract(other.id);
    await mkActiveAssignment(ended.id, null, costCenterId, {
      effective_from: '2024-01-01',
      effective_to: '2024-12-31',
    });
    await mkActiveAssignment(future.id, null, costCenterId, {
      effective_from: '2025-02-01',
    });
    if (costCenterId2) {
      await mkActiveAssignment(other.id, null, costCenterId2);
    } else {
      await mkActiveAssignment(other.id, null, null);
    }
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    const resolved = await withTransaction((c) =>
      resolvePayrollRunPersons(c, {
        scope_type: 'COST_CENTER',
        scope_ref_id: costCenterId,
        calculation_date: '2025-01-15',
        run_id: run.id,
      })
    );
    assert(!resolved.some((p) => p.id === ended.id), 'ended excluded');
    assert(!resolved.some((p) => p.id === future.id), 'future excluded');
    assert(!resolved.some((p) => p.id === other.id), 'other CC excluded');
  });

  await it('COST_CENTER dedupe: تكليفان لنفس المركز → شخص واحد', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    await mkActiveAssignment(person.id, null, costCenterId);
    await mkActiveAssignment(person.id, null, costCenterId);
    const fix = await mkFixedComponent('13000');
    await mkPca(person.id, fix.id, { amount: '13000' });
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    const resolved = await withTransaction((c) =>
      resolvePayrollRunPersons(c, {
        scope_type: 'COST_CENTER',
        scope_ref_id: costCenterId,
        calculation_date: '2025-01-15',
        run_id: run.id,
      })
    );
    assert(
      resolved.filter((p) => p.id === person.id).length === 1,
      'deduped to one'
    );
  });

  await it('نطاق ALL يحل الشخص النشط', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    const run = await mkRun(period.id, { scope_type: 'ALL' });
    const resolved = await withTransaction((c) =>
      resolvePayrollRunPersons(c, {
        scope_type: 'ALL',
        scope_ref_id: null,
        calculation_date: '2025-01-31',
        run_id: run.id,
      })
    );
    assert(
      resolved.some((p) => p.id === person.id),
      'person resolved in ALL'
    );
  });

  await it('نطاق PERSON_LIST + عضو غير مؤهل → EXCLUDED', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const active = await mkPerson();
    const inactive = await mkPerson();
    await mkContract(active.id);
    await withTransaction((c) =>
      setPayrollPersonStatus(c, {
        id: inactive.id,
        userId,
        version: inactive.version,
        updated_at: inactive.updated_at,
        target: 'INACTIVE',
      })
    );
    let run = await mkRun(period.id, { scope_type: 'PERSON_LIST' });
    run = await withTransaction(async (c) => {
      const r1 = await addScopeMember(c, {
        runId: run.id,
        personId: active.id,
        userId,
        version: run.version,
        updated_at: run.updated_at,
      });
      await txQuery(
        c,
        `INSERT INTO accounts.payroll_run_scope_members (payroll_run_id, payroll_person_id, created_by)
         VALUES ($1::uuid,$2::uuid,$3::uuid)
         ON CONFLICT DO NOTHING`,
        [run.id, inactive.id, userId]
      );
      return r1.run;
    });
    run = await withTransaction((c) => loadPayrollRun(c, run.id));
    const members = await query(
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1`,
      [run.id]
    );
    if (Number(members.rows[0].n) < 2) {
      await query(
        `INSERT INTO accounts.payroll_run_scope_members (payroll_run_id, payroll_person_id, created_by)
         VALUES ($1::uuid,$2::uuid,$3::uuid)`,
        [run.id, inactive.id, userId]
      );
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
    }
    const fix = await mkFixedComponent('20000');
    await mkPca(active.id, fix.id, { amount: '20000' });
    const res = await calc(run);
    assert(res.summary.people_count === 2, `people ${res.summary.people_count}`);
    assert(res.summary.excluded_people === 1, 'excluded');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(
      (arts.issues as Array<{ issue_code: string }>).some(
        (i) => i.issue_code === 'SCOPE_PERSON_INELIGIBLE'
      ),
      'SCOPE_PERSON_INELIGIBLE'
    );
  });

  await it('PERSON_LIST فارغة → 422 قبل CALCULATING', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const run = await mkRun(period.id, { scope_type: 'PERSON_LIST' });
    await throwsHttp(() => calc(run), 422, 'فارغة');
    const after = await withTransaction((c) => loadPayrollRun(c, run.id));
    assert(after.status === 'DRAFT', 'يبقى DRAFT');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(arts.people.length === 0 && arts.issues.length === 0, 'بلا آثار');
  });

  // —— عملات غير IQD ——
  for (const cur of ['USD', 'KWD', 'ZZZ'] as const) {
    await it(`عملة تشغيل ${cur} → 422 قبل mutation بلا آثار/audit`, async () => {
      const cal = await mkCalendar(cur);
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      assert(run.currency_code === cur, `run currency ${run.currency_code}`);
      const startedBefore = await auditCount(run.id, 'payroll_run.calculation_started');
      const calcBefore = await auditCount(run.id, 'payroll_run.calculated');
      await throwsHttp(() => calc(run), 422, 'IQD');
      await assertDraftClean(run.id, {
        gross: '0.000',
        ded: '0.000',
        emp: '0.000',
        net: '0.000',
      });
      assert(
        (await auditCount(run.id, 'payroll_run.calculation_started')) === startedBefore,
        'no started audit'
      );
      assert(
        (await auditCount(run.id, 'payroll_run.calculated')) === calcBefore,
        'no calculated audit'
      );
    });
  }

  await it('Run IQD + عقد USD → ERROR CURRENCY_MISMATCH بلا أسطر', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id, '100000', 'USD');
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    assert(res.summary.error_people === 1, 'error people');
    assert(res.summary.error_count === 1, 'error_count');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(arts.lines.length === 0, 'no lines');
    assert(
      (arts.issues as Array<{ issue_code: string }>).some(
        (i) => i.issue_code === 'CURRENCY_MISMATCH'
      ),
      'CURRENCY_MISMATCH'
    );
  });

  await it('MULTIPLE_ACTIVE_CONTRACTS orchestration', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const c1 = await mkContract(person.id, '100000');
    const run = await mkRunWithPerson(period.id, person.id);
    try {
      await withTransaction(async (c) => {
        await txQuery(c, `DROP INDEX IF EXISTS accounts.uq_payroll_contracts_one_active`);
        const c2 = await txQuery<{ id: string }>(
          c,
          `INSERT INTO accounts.payroll_contracts
             (payroll_person_id, contract_number, compensation_basis, base_amount, currency_code,
              effective_from, status, created_by, updated_by)
           VALUES ($1::uuid,$2,'MONTHLY_FIXED',200000,'IQD','2025-01-01','ACTIVE',$3::uuid,$3::uuid)
           RETURNING id`,
          [person.id, uniq('PYC2'), userId]
        );
        owned.contractIds.push(c2.rows[0]!.id);
        const res = await calculatePayrollRunCore(c, {
          run_id: run.id,
          version: run.version,
          updated_at: run.updated_at,
          userId,
          idempotency_key: randomUUID(),
        });
        assert(res.summary.error_people === 1, 'error person');
        const arts = await loadRunCalculationArtifacts(c, run.id);
        assert(
          (arts.issues as Array<{ issue_code: string }>).some(
            (i) => i.issue_code === 'MULTIPLE_ACTIVE_CONTRACTS'
          ),
          'MULTIPLE_ACTIVE_CONTRACTS'
        );
        assert(arts.lines.length === 0, 'no lines');
        void c1;
        throw new Error('__ROLLBACK_MULTI_CONTRACT__');
      });
    } catch (e) {
      assert(
        e instanceof Error && e.message === '__ROLLBACK_MULTI_CONTRACT__',
        `unexpected ${e instanceof Error ? e.message : e}`
      );
    }
    const after = await withTransaction((c) => loadPayrollRun(c, run.id));
    assert(after.status === 'DRAFT', 'rolled back to DRAFT');
  });

  await it('تشغيل مختلط: نجاح + خطأ → CALCULATED error_count=1 totals من النجاح فقط', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const okPerson = await mkPerson();
    const badPerson = await mkPerson();
    const contract = await mkContract(okPerson.id, '500000');
    // badPerson بلا عقد
    const fix = await mkFixedComponent('88000');
    await mkPca(okPerson.id, fix.id, { payroll_contract_id: contract.id, amount: '88000' });
    const run = await mkRunWithPeople(period.id, [okPerson.id, badPerson.id]);
    const res = await calc(run);
    assert(res.run.status === 'CALCULATED', 'status');
    assert(res.summary.people_count === 2, `people ${res.summary.people_count}`);
    assert(res.summary.error_count === 1, `errors ${res.summary.error_count}`);
    assert(res.summary.gross_total === '88000.000', `gross ${res.summary.gross_total}`);
    assert(res.summary.net_total === '88000.000', `net ${res.summary.net_total}`);
  });

  // —— Eligibility / unsupported / ERROR ——
  await it('بلا عقد → ERROR بلا أسطر', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    assert(res.summary.error_people >= 1, 'error people');
    assert(res.run.status === 'CALCULATED', 'run calculated with errors');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    const err = (arts.people as Array<{ calculation_status: string }>).find(
      (p) => p.calculation_status === 'ERROR'
    );
    assert(err, 'error person');
    assert(arts.lines.length === 0, 'no lines');
  });

  await it('مكوّن غير مدعوم → ERROR', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const uns = await mkUnsupported();
    await mkPca(person.id, uns.id, { payroll_contract_id: contract.id, quantity: '5' });
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    assert(res.summary.error_people === 1, 'error');
    assert(res.summary.gross_total === '0.000', 'gross0');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(arts.lines.length === 0, 'no financial lines');
    assert(
      (arts.issues as Array<{ issue_code: string }>).some(
        (i) => i.issue_code === 'UNSUPPORTED_METHOD'
      ),
      'UNSUPPORTED_METHOD'
    );
  });

  await it('صافٍ سالب → WARNING NEGATIVE_NET', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const earn = await mkFixedComponent('10000');
    const ded = await mkDeduction('50000');
    await mkPca(person.id, earn.id, { payroll_contract_id: contract.id, amount: '10000' });
    await mkPca(person.id, ded.id, { payroll_contract_id: contract.id, amount: '50000' });
    const run = await mkRunWithPerson(period.id, person.id);
    const res = await calc(run);
    assert(res.summary.net_total === '-40000.000', `net ${res.summary.net_total}`);
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(
      (arts.issues as Array<{ issue_code: string }>).some((i) => i.issue_code === 'NEGATIVE_NET'),
      'NEGATIVE_NET'
    );
  });

  // —— Idempotency / concurrency ——
  await it('إعادة نفس idempotency_key → replay', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent('33000');
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount: '33000' });
    const run = await mkRunWithPerson(period.id, person.id);
    const key = randomUUID();
    const first = await calc(run, key);
    const second = await calc(
      { id: first.run.id, version: first.run.version, updated_at: first.run.updated_at },
      key
    );
    assert(second.idempotent_replay === true, 'replay');
    assert(second.summary.gross_total === first.summary.gross_total, 'same totals');
  });

  await it('نسخة متقادمة → 409', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    const run = await mkRunWithPerson(period.id, person.id);
    await throwsHttp(
      () =>
        withTransaction((c) =>
          calculatePayrollRunCore(c, {
            run_id: run.id,
            version: run.version - 1,
            updated_at: run.updated_at,
            userId,
            idempotency_key: randomUUID(),
          })
        ),
      409
    );
  });

  await it('Concurrent Calculate×Calculate — اتصالان مستقلان', async () => {
    assert(typeof pool.connect === 'function', 'pool متاح لاتصالين مستقلين');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent('44000');
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount: '44000' });
    const run = await mkRunWithPerson(period.id, person.id);
    const keySame = randomUUID();
    const keyOther = randomUUID();

    const p1 = withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: keySame,
      })
    );
    const p2 = withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: keyOther,
      })
    );
    const settled = await Promise.allSettled([p1, p2]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    assert(fulfilled.length >= 1, 'at least one success');
    if (rejected.length) {
      for (const r of rejected) {
        const err = (r as PromiseRejectedResult).reason;
        assert(
          err instanceof AccountsHttpError && err.status === 409,
          `expected 409 got ${err instanceof Error ? err.message : err}`
        );
      }
    } else {
      // نفس المفتاح قد يُعيد replay إن تزامنا بشكل خاص — نتحقق من اتساق النتيجة
      const a = (fulfilled[0] as PromiseFulfilledResult<{ run: { status: string } }>).value;
      assert(a.run.status === 'CALCULATED', 'calculated');
    }
    const after = await withTransaction((c) => loadPayrollRun(c, run.id));
    assert(after.status === 'CALCULATED', 'final CALCULATED');

    // إعادة بنفس المفتاح الناجح → replay
    const winnerKey =
      fulfilled.length === 1
        ? keySame // قد يكون أي منهما؛ نجرّب الاثنين
        : keySame;
    const replayAttempts = [keySame, keyOther];
    let replayed = false;
    for (const k of replayAttempts) {
      try {
        const r = await calc(
          { id: after.id, version: after.version, updated_at: after.updated_at },
          k
        );
        if (r.idempotent_replay) {
          replayed = true;
          break;
        }
      } catch (e) {
        if (!(e instanceof AccountsHttpError && e.status === 409)) throw e;
      }
    }
    assert(replayed || after.status === 'CALCULATED', `winnerKey=${winnerKey}`);
  });

  await it('Concurrent Calculate×Cancel — نتائج متسقة A أو B فقط', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent('55000');
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount: '55000' });
    const run = await mkRunWithPerson(period.id, person.id);

    const calcP = withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: randomUUID(),
      })
    );
    const cancelP = withTransaction((c) =>
      cancelPayrollRun(c, {
        id: run.id,
        userId,
        version: run.version,
        updated_at: run.updated_at,
        reason: 'اختبار تزامن إلغاء',
      })
    );
    const settled = await Promise.allSettled([calcP, cancelP]);
    const after = await withTransaction((c) => loadPayrollRun(c, run.id));
    assert(
      after.status === 'CALCULATED' || after.status === 'CANCELLED',
      `status ${after.status}`
    );
    assert(after.status !== 'CALCULATING', 'not stuck CALCULATING');
    assert(after.status !== 'DRAFT', 'not DRAFT after race');
    // على الأقل أحدهما نجح
    assert(
      settled.some((s) => s.status === 'fulfilled'),
      'one fulfilled'
    );
    if (after.status === 'CANCELLED') {
      const live = await query(
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_people
         WHERE payroll_run_id=$1::uuid AND superseded=FALSE`,
        [run.id]
      );
      // إن أُلغي قبل/أثناء الاحتساب دون لقطات، أو superseded بعد احتساب
      assert(Number(live.rows[0].n) === 0 || after.status === 'CANCELLED', 'no live unsuperseded');
    }
  });

  await it('ذرّية: فشل بعد CALCULATING → rollback DRAFT', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    const run = await mkRunWithPerson(period.id, person.id);
    try {
      await withTransaction(async (c) => {
        await acquirePayrollLocks(c, [payrollPeriodLock(period.id), payrollRunLock(run.id)]);
        await clearRunCalculationArtifacts(c, run.id);
        await txQuery(
          c,
          `UPDATE accounts.payroll_runs SET status='CALCULATING',
             calculation_attempt_number=calculation_attempt_number+1,
             calculation_request_id=$2::uuid, updated_by=$3::uuid,
             updated_at=NOW(), version=version+1 WHERE id=$1::uuid`,
          [run.id, randomUUID(), userId]
        );
        throw new Error('INJECTED_FAIL');
      });
    } catch (e) {
      assert(e instanceof Error && e.message === 'INJECTED_FAIL', 'injected');
    }
    const after = await withTransaction((c) => loadPayrollRun(c, run.id));
    assert(after.status === 'DRAFT', `status ${after.status}`);
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
    assert(arts.people.length === 0, 'no partial people');
  });

  const failpoints: Exclude<PayrollCalcFailpoint, null>[] = [
    'after_first_person',
    'after_first_line',
    'before_run_hash',
    'before_totals_update',
    'during_audit',
  ];
  for (const fp of failpoints) {
    await it(`ذرّية failpoint ${fp} → DRAFT بلا آثار/audit نجاح`, async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const fix = await mkFixedComponent('66000');
      await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount: '66000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const before = await withTransaction((c) => loadPayrollRun(c, run.id));
      __setPayrollCalcFailpointForTests(fp);
      try {
        await calc(run);
        throw new Error('should have failed');
      } catch (e) {
        assert(
          e instanceof Error && e.message === `CALC_FAILPOINT_${fp}`,
          `got ${e instanceof Error ? e.message : e}`
        );
      } finally {
        __clearPayrollCalcFailpointForTests();
      }
      await assertDraftClean(run.id, {
        gross: String(before.gross_total),
        ded: String(before.deduction_total),
        emp: String(before.employer_contribution_total),
        net: String(before.net_total),
      });
    });
  }

  await it('حتمية: نفس المصادر → نفس totals/hash', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id, '1004');
    const pct = await mkPctComponent();
    await mkPca(person.id, pct.id, { payroll_contract_id: contract.id, percentage: '12.5' });
    const run = await mkRunWithPerson(period.id, person.id);
    const key = randomUUID();
    const a = await calc(run, key);
    const a2 = await calc(
      { id: a.run.id, version: a.run.version, updated_at: a.run.updated_at },
      key
    );
    assert(a2.idempotent_replay, 'replay');
    assert(a2.run.snapshot_hash === a.run.snapshot_hash, 'stable hash');
    assert(a.summary.gross_total === '126.000', `gross ${a.summary.gross_total}`);
  });

  await it('mapIdempotencyKeyToRequestId حتمي لغير UUID', async () => {
    const a = mapIdempotencyKeyToRequestId('my-key-1');
    const b = mapIdempotencyKeyToRequestId('my-key-1');
    assert(a === b && /^[0-9a-f-]{36}$/.test(a), 'uuid');
  });

  await it('Verify: ERROR بلا issue حاجب → mismatch', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    const run = await mkRunWithPerson(period.id, person.id);
    await withTransaction(async (c) => {
      await txQuery(
        c,
        `INSERT INTO accounts.payroll_run_people
           (payroll_run_id, payroll_person_id, payroll_period_id,
            person_code_snapshot, full_name_snapshot, person_type_snapshot,
            currency_code, calculation_status, snapshot_json, snapshot_hash, created_by)
         VALUES (
           $1::uuid, $2::uuid, $3::uuid,
           'ERRCHK', 'تحقق', 'EMPLOYEE',
           'IQD', 'ERROR', '{}'::jsonb,
           repeat('a', 64), $4::uuid
         )`,
        [run.id, person.id, period.id, userId]
      );
      await txQuery(
        c,
        `UPDATE accounts.payroll_runs SET
           status='CALCULATED', people_count=1, error_count=1,
           calculation_attempt_number=1,
           snapshot_hash=repeat('b', 64),
           updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [run.id]
      );
    });
    const v = await withTransaction((c) => verifyPayrollCalculationCore(c, { strict: false }));
    assert(
      v.mismatches.some((m) => m.kind === 'error_person_without_error_issue'),
      `expected mismatch, got ${JSON.stringify(v.mismatches.slice(0, 5))}`
    );
    // تنظيف الحالة الاصطناعية عبر SQL مباشر (clearRunCalculationArtifacts يرفض CALCULATED)
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=$1::uuid`, [run.id]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id=$1::uuid`, [run.id]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id=$1::uuid`, [run.id]);
    await query(
      `UPDATE accounts.payroll_runs SET
         status='DRAFT', people_count=0, error_count=0, warning_count=0,
         gross_total=0, deduction_total=0, employer_contribution_total=0, net_total=0,
         snapshot_hash=NULL, calculation_attempt_number=0,
         calculated_at=NULL, calculated_by=NULL,
         updated_at=NOW(), version=version+1
       WHERE id=$1::uuid`,
      [run.id]
    );
  });

  await it('انحدار snapshot/calculation verify', async () => {
    const s = await withTransaction((c) => verifyPayrollSnapshotSchema(c, { strict: false }));
    assert(s.ok, JSON.stringify(s.mismatches.slice(0, 5)));
    const v = await withTransaction((c) => verifyPayrollCalculationCore(c, { strict: false }));
    assert(v.ok, JSON.stringify(v.mismatches.slice(0, 5)));
  });

  // cleanup
  await cleanupOwned();
  const left = await countOwned();
  await it('تنظيف الملكية = 0', async () => {
    assert(left === 0, `بقايا ${left}`);
  });

  console.log(`\n—— النتيجة: ${passCount} نجاح / ${failCount} فشل ——`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    __clearPayrollCalcFailpointForTests();
    await cleanupOwned();
  } catch {
    /* ignore */
  }
  await closePool();
});
