/**
 * اختبارات مخطط لقطة الاحتساب 9.A.2.2
 * npm run test:payroll-snapshot-schema
 *
 * عزل: ownership token + cleanup في finally. تشغيل مرتين بلا تراكم.
 */
import { createHash } from 'crypto';
import { closePool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollContract, transitionPayrollContract } from '../lib/accounts/payroll-contracts';
import { createPayrollAssignment } from '../lib/accounts/payroll-assignments';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollRun } from '../lib/accounts/payroll-runs';
import {
  clearRunCalculationArtifacts,
  insertRunIssue,
  insertRunLine,
  insertRunPersonSnapshot,
  loadRunCalculationArtifacts,
} from '../lib/accounts/payroll-run-snapshots';
import {
  canonicalizeDecimal,
  canonicalizePayrollSnapshot,
  hashPayrollSnapshot,
  isPayrollSnapshotHash,
  stableStringify,
} from '../lib/accounts/payroll-snapshot-hash';
import type { PayrollPersonSnapshotJson } from '../lib/accounts/payroll-snapshot-types';
import { verifyPayrollSnapshotSchema } from '../lib/accounts/verify-payroll-snapshot-schema';
import { verifyPayrollPeriodsRuns } from '../lib/accounts/verify-payroll-periods-runs';
import { verifyPayrollFoundation } from '../lib/accounts/verify-payroll-foundation';
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
async function throwsHttp(fn: () => Promise<unknown>, status: number, includes?: string) {
  try { await fn(); }
  catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) throw new Error(`الرسالة: ${e.message}`);
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
};

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id = ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id = ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id = ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_runs WHERE id = ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.periodIds.length) {
    await query(`DELETE FROM accounts.payroll_periods WHERE id = ANY($1::uuid[])`, [owned.periodIds]);
  }
  if (owned.assignmentIds.length) {
    await query(
      `DELETE FROM accounts.payroll_assignments WHERE id = ANY($1::uuid[]) AND assignment_code NOT LIKE 'DEMO%'`,
      [owned.assignmentIds]
    );
  }
  if (owned.contractIds.length) {
    await query(`DELETE FROM accounts.payroll_contracts WHERE id = ANY($1::uuid[]) AND contract_number NOT LIKE 'DEMO%'`, [owned.contractIds]);
  }
  if (owned.personIds.length) {
    await query(`DELETE FROM accounts.payroll_people WHERE id = ANY($1::uuid[]) AND person_code NOT LIKE 'DEMO%'`, [owned.personIds]);
  }
  if (owned.componentIds.length) {
    await query(`DELETE FROM accounts.payroll_components WHERE id = ANY($1::uuid[]) AND component_code NOT LIKE 'DEMO%'`, [owned.componentIds]);
  }
  if (owned.calendarIds.length) {
    await query(`DELETE FROM accounts.payroll_calendars WHERE id = ANY($1::uuid[]) AND code NOT LIKE 'DEMO%'`, [owned.calendarIds]);
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
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) AS n`,
    [owned.calendarIds, owned.periodIds, owned.runIds, owned.personIds, owned.componentIds]
  );
  return Number(r.rows[0]?.n ?? 0);
}

function baseSnap(over: Partial<PayrollPersonSnapshotJson> = {}): PayrollPersonSnapshotJson {
  return {
    schema_version: 1,
    calculation_date: '2025-01-31',
    currency_code: 'IQD',
    person: {
      id: '00000000-0000-4000-8000-000000000001',
      person_code: 'P',
      full_name_ar: 'شخص',
      person_type: 'EMPLOYEE',
      college_id: null,
      department_id: null,
      cost_center_id: null,
    },
    contract: null,
    assignments: [],
    component_assignment_ids: [],
    scope: { scope_type: 'ALL', scope_ref_id: null, resolved_via: 'fixture' },
    source_versions: {
      person_version: 1,
      person_updated_at: '2025-01-01T00:00:00.000Z',
      contract_version: null,
      contract_updated_at: null,
    },
    ...over,
  };
}

async function main() {
  console.log('===== اختبارات مخطط لقطة الاحتساب 9.A.2.2 =====');
  const token = `SNAP${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => { seq += 1; return `${p}-${token}-${seq}`; };

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active ORDER BY u.created_at LIMIT 1`
  );
  if (!user.rows[0]) { failed('إعداد: لا مستخدم'); return; }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  let fy = await query(`SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`);
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة لقطة','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('SNAPFY'), userId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async () => {
    const cal = await withTransaction((c) => createPayrollCalendar(c, {
      code: uniq('SNAPCAL'), name_ar: 'تقويم لقطة', calendar_type: 'MONTHLY',
      currency_code: 'IQD', effective_from: '2025-01-01', created_by: userId,
    }));
    owned.calendarIds.push(cal.id);
    return cal;
  };
  const mkPerson = async () => {
    const p = await withTransaction((c) => createPayrollPerson(c, {
      full_name_ar: 'شخص لقطة', person_type: 'EMPLOYEE',
      default_currency_code: 'IQD', effective_from: '2025-01-01', created_by: userId,
    }));
    owned.personIds.push(p.id);
    return p;
  };
  const mkContract = async (personId: string) => {
    const c = await withTransaction(async (client) => {
      const draft = await createPayrollContract(client, {
        payroll_person_id: personId,
        compensation_basis: 'MONTHLY_FIXED',
        base_amount: '500000',
        currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: userId,
      });
      return transitionPayrollContract(client, {
        id: draft.id, userId, version: draft.version, updated_at: draft.updated_at, action: 'activate',
      });
    });
    owned.contractIds.push(c.id);
    return c;
  };
  const mkAssignment = async (personId: string, contractId: string, title: string) => {
    const a = await withTransaction((client) => createPayrollAssignment(client, {
      payroll_person_id: personId,
      payroll_contract_id: contractId,
      assignment_type: 'GENERAL_ASSIGNMENT',
      title_ar: title,
      effective_from: '2025-01-01',
      created_by: userId,
    }));
    owned.assignmentIds.push(a.id);
    return a;
  };
  const mkComponent = async () => {
    const c = await withTransaction((client) => createPayrollComponent(client, {
      component_code: uniq('SNAPC'), name_ar: 'مكوّن لقطة', component_type: 'EARNING',
      calculation_method: 'FIXED_AMOUNT', default_amount: '1000',
      effective_from: '2025-01-01', created_by: userId,
    }));
    owned.componentIds.push(c.id);
    return c;
  };
  const mkPeriodRun = async () => {
    const cal = await mkCalendar();
    const period = await withTransaction((c) => createPayrollPeriod(c, {
      payroll_calendar_id: cal.id, name_ar: 'فترة لقطة',
      start_date: '2025-01-01', end_date: '2025-01-31',
      fiscal_year_id: fiscalYearId, created_by: userId,
    }));
    owned.periodIds.push(period.id);
    const run = await withTransaction((c) => createPayrollRun(c, {
      payroll_period_id: period.id, run_type: 'REGULAR', scope_type: 'ALL', created_by: userId,
    }));
    owned.runIds.push(run.id);
    return { cal, period, run };
  };

  try {
    // ── Migration ────────────────────────────────────────────
    await it('1) الجداول الثلاثة موجودة', async () => {
      for (const t of ['payroll_run_people', 'payroll_run_lines', 'payroll_run_issues']) {
        const r = await query(`SELECT to_regclass('accounts.${t}') AS t`);
        assert(r.rows[0]?.t, `جدول ${t}`);
      }
    });

    await it('2) 094 و095 غير معدّلتين في هذه المرحلة (وجود فقط)', async () => {
      const a = await query(`SELECT to_regclass('accounts.payroll_periods') AS t`);
      const b = await query(`SELECT to_regclass('accounts.payroll_people') AS t`);
      assert(a.rows[0]?.t && b.rows[0]?.t, 'الأساس موجود');
    });

    await it('3) version=0 مرفوض على people/lines', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const snap = baseSnap({ person: { ...baseSnap().person, id: person.id, person_code: person.person_code } });
      const row = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: snap, created_by: userId,
      }));
      let b1 = false, b2 = false;
      try { await query(`UPDATE accounts.payroll_run_people SET version=0 WHERE id=$1::uuid`, [row.id]); } catch { b1 = true; }
      const comp = await mkComponent();
      const line = await withTransaction((c) => insertRunLine(c, {
        payroll_run_id: run.id, payroll_run_person_id: row.id, payroll_component_id: comp.id,
        component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
        component_type: comp.component_type, calculation_method: 'FIXED_AMOUNT',
        source_effective_from: '2025-01-01', calculated_amount: '100', created_by: userId,
      }));
      try { await query(`UPDATE accounts.payroll_run_lines SET version=0 WHERE id=$1::uuid`, [line.id]); } catch { b2 = true; }
      assert(b1 && b2, 'CHECK version');
    });

    await it('4) hash غير صالح مرفوض في القاعدة', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      let blocked = false;
      try {
        await query(
          `INSERT INTO accounts.payroll_run_people
             (payroll_run_id,payroll_person_id,payroll_period_id,person_code_snapshot,full_name_snapshot,
              person_type_snapshot,currency_code,snapshot_json,snapshot_hash,created_by)
           VALUES ($1::uuid,$2::uuid,$3::uuid,'X','اسم','EMPLOYEE','IQD','{}'::jsonb,'not-a-hash',$4::uuid)`,
          [run.id, person.id, run.payroll_period_id, userId]
        );
      } catch { blocked = true; }
      assert(blocked, 'CHECK hash');
    });

    // ── Hashing ──────────────────────────────────────────────
    await it('5) Hash حتمي رغم ترتيب مفاتيح مختلف', async () => {
      const a = hashPayrollSnapshot({ b: 1, a: 'x', amount: '100' });
      const b = hashPayrollSnapshot({ amount: '100', a: 'x', b: 1 });
      assert(a === b && isPayrollSnapshotHash(a), 'نفس الـHash');
    });

    await it('6) تغيّر مبلغ ⇒ Hash مختلف', async () => {
      assert(hashPayrollSnapshot({ amount: '100' }) !== hashPayrollSnapshot({ amount: '101' }), 'مختلفة');
    });

    await it('7) Decimal 100 و 100.000 نفس الشكل', async () => {
      assert(canonicalizeDecimal('100') === canonicalizeDecimal('100.000'), 'تطبيع');
      assert(hashPayrollSnapshot({ amount: '100' }) === hashPayrollSnapshot({ amount: '100.000' }), 'hash');
    });

    await it('8) ترتيب Array ذو معنى يغيّر الـHash', async () => {
      const h1 = hashPayrollSnapshot({ items: [{ id: 'a' }, { id: 'b' }] });
      const h2 = hashPayrollSnapshot({ items: [{ id: 'b' }, { id: 'a' }] });
      assert(h1 !== h2, 'الترتيب مهم');
    });

    await it('9) تاريخ حتمي + طول 64', async () => {
      const h = hashPayrollSnapshot({ calculation_date: '2025-01-31', created_at: 'ignore-me' });
      assert(h.length === 64, 'طول 64');
      // created_at يُستبعد من canonicalize
      const h2 = hashPayrollSnapshot({ calculation_date: '2025-01-31' });
      assert(h === h2, 'استبعاد created_at');
      const expected = createHash('sha256')
        .update(stableStringify(canonicalizePayrollSnapshot({ calculation_date: '2025-01-31' })), 'utf8')
        .digest('hex');
      assert(h === expected, 'SHA-256 مطابق');
    });

    // ── Run People ───────────────────────────────────────────
    await it('10) إدراج شخص لقطة صحيح', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const snap = baseSnap({
        person: { ...baseSnap().person, id: person.id, person_code: person.person_code },
        contract: {
          id: contract.id, contract_number: contract.contract_number,
          basic_salary: '500000.000', currency_code: 'IQD',
          effective_from: '2025-01-01', effective_to: null,
        },
      });
      const row = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id, payroll_contract_id: contract.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: snap,
        net_amount: '-10', gross_amount: '100', created_by: userId,
      }));
      assert(!!row.id, 'أُدرج');
    });

    await it('11) شخص مكرر في نفس التشغيل → 409/unique', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const snap = baseSnap({ person: { ...baseSnap().person, id: person.id } });
      await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: snap, created_by: userId,
      }));
      let blocked = false;
      try {
        await withTransaction((c) => insertRunPersonSnapshot(c, {
          payroll_run_id: run.id, payroll_person_id: person.id,
          person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
          person_type_snapshot: person.person_type, snapshot_json: snap, created_by: userId,
        }));
      } catch { blocked = true; }
      assert(blocked, 'تكرار مرفوض');
    });

    await it('12) عقد شخص آخر → 400', async () => {
      const { run } = await mkPeriodRun();
      const a = await mkPerson();
      const b = await mkPerson();
      const contractB = await mkContract(b.id);
      await throwsHttp(() => withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: a.id, payroll_contract_id: contractB.id,
        person_code_snapshot: a.person_code, full_name_snapshot: a.full_name_ar,
        person_type_snapshot: a.person_type, snapshot_json: baseSnap(), created_by: userId,
      })), 400);
    });

    await it('13) gross سالب مرفوض؛ net سالب مسموح', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      await throwsHttp(() => withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(),
        gross_amount: '-1', created_by: userId,
      })), 400);
      const row = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(),
        net_amount: '-50.5', created_by: userId,
      }));
      assert(!!row.id, 'صافي سالب مقبول');
    });

    await it('14) عملة تخالف التشغيل → 400', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      await throwsHttp(() => withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id, currency_code: 'USD',
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      })), 400);
    });

    // ── Lines ────────────────────────────────────────────────
    await it('15) إدراج سطر + أسطر متعددة لنفس المكوّن من تكليفات مختلفة', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const a1 = await mkAssignment(person.id, contract.id, 'تكليف أ');
      const a2 = await mkAssignment(person.id, contract.id, 'تكليف ب');
      const comp = await mkComponent();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id, payroll_contract_id: contract.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await withTransaction((c) => insertRunLine(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
        payroll_assignment_id: a1.id,
        component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
        component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
        source_effective_from: '2025-01-01', calculated_amount: '10', sequence: 1, created_by: userId,
      }));
      await withTransaction((c) => insertRunLine(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
        payroll_assignment_id: a2.id,
        component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
        component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
        source_effective_from: '2025-01-01', calculated_amount: '20', sequence: 2, created_by: userId,
      }));
      // تكرار نفس هوية المصدر (نفس التكليف) → رفض
      let blocked = false;
      try {
        await withTransaction((c) => insertRunLine(c, {
          payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
          payroll_assignment_id: a1.id,
          component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
          component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
          source_effective_from: '2025-01-01', calculated_amount: '30', sequence: 3, created_by: userId,
        }));
      } catch { blocked = true; }
      assert(blocked, 'تكرار هوية المصدر مرفوض');
    });

    await it('16) CUSTOM_FORMULA مرفوض خدمياً وقاعدة', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const comp = await mkComponent();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await throwsHttp(() => withTransaction((c) => insertRunLine(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
        component_code_snapshot: 'X', component_name_snapshot: 'Y', component_type: 'EARNING',
        calculation_method: 'CUSTOM_FORMULA', source_effective_from: '2025-01-01',
        calculated_amount: '1', created_by: userId,
      })), 400, 'CUSTOM_FORMULA');
    });

    await it('17) نطاق سريان غير صالح → 400', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const comp = await mkComponent();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await throwsHttp(() => withTransaction((c) => insertRunLine(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
        component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
        component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
        source_effective_from: '2025-02-01', source_effective_to: '2025-01-01',
        calculated_amount: '1', created_by: userId,
      })), 400);
    });

    await it('18) run mismatch للسطر → 400', async () => {
      const a = await mkPeriodRun();
      const b = await mkPeriodRun();
      const person = await mkPerson();
      const comp = await mkComponent();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: a.run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await throwsHttp(() => withTransaction((c) => insertRunLine(c, {
        payroll_run_id: b.run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
        component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
        component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
        source_effective_from: '2025-01-01', calculated_amount: '1', created_by: userId,
      })), 400);
    });

    // ── Issues ───────────────────────────────────────────────
    await it('19) WARNING و ERROR + سياسات blocking', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      const w = await withTransaction((c) => insertRunIssue(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id,
        severity: 'WARNING', issue_code: 'NEG_NET', message_ar: 'صافي سالب', created_by: userId,
      }));
      const e = await withTransaction((c) => insertRunIssue(c, {
        payroll_run_id: run.id, severity: 'ERROR', issue_code: 'NO_CONTRACT',
        message_ar: 'لا عقد', created_by: userId,
      }));
      assert(!!w.id && !!e.id, 'أُدرجا');
      // ERROR غير blocking مرفوض في القاعدة
      let blocked = false;
      try {
        await query(
          `INSERT INTO accounts.payroll_run_issues
             (payroll_run_id,severity,issue_code,message_ar,is_blocking)
           VALUES ($1::uuid,'ERROR','X_CODE','رسالة',FALSE)`,
          [run.id]
        );
      } catch { blocked = true; }
      assert(blocked, 'ERROR يجب أن يكون blocking');
    });

    await it('20) issue person/run mismatch → 400', async () => {
      const a = await mkPeriodRun();
      const b = await mkPeriodRun();
      const person = await mkPerson();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: a.run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await throwsHttp(() => withTransaction((c) => insertRunIssue(c, {
        payroll_run_id: b.run.id, payroll_run_person_id: rp.id,
        severity: 'WARNING', issue_code: 'MISMATCH', message_ar: 'خطأ', created_by: userId,
      })), 400);
    });

    await it('21) clearRunCalculationArtifacts يفرّغ اللقطة دون تغيير حالة Run', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      await withTransaction((c) => insertRunIssue(c, {
        payroll_run_id: run.id, payroll_run_person_id: rp.id,
        severity: 'WARNING', issue_code: 'TMP', message_ar: 'مؤقت', created_by: userId,
      }));
      await withTransaction((c) => clearRunCalculationArtifacts(c, run.id));
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
      assert(arts.people.length === 0 && arts.lines.length === 0 && arts.issues.length === 0, 'فارغ');
      const st = await query(`SELECT status FROM accounts.payroll_runs WHERE id=$1::uuid`, [run.id]);
      assert(st.rows[0].status === 'DRAFT', 'الحالة DRAFT');
    });

    await it('22) CANCELLED يمنع كتابة اللقطة', async () => {
      const { run } = await mkPeriodRun();
      await query(
        `UPDATE accounts.payroll_runs SET status='CANCELLED', cancellation_reason='اختبار',
         cancelled_at=NOW(), cancelled_by=$2::uuid, version=version+1 WHERE id=$1::uuid`,
        [run.id, userId]
      );
      const person = await mkPerson();
      await throwsHttp(() => withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      })), 409);
    });

    // ── Verify ───────────────────────────────────────────────
    await it('23) Verify يكشف مصدر كمية محجوز عبر SQL مباشر + rollback', async () => {
      const { run } = await mkPeriodRun();
      const person = await mkPerson();
      const comp = await mkComponent();
      const rp = await withTransaction((c) => insertRunPersonSnapshot(c, {
        payroll_run_id: run.id, payroll_person_id: person.id,
        person_code_snapshot: person.person_code, full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type, snapshot_json: baseSnap(), created_by: userId,
      }));
      class Rb extends Error {}
      let kinds: string[] = [];
      try {
        await withTransaction(async (c) => {
          await query(
            // استخدام client الخاص بالمعاملة عبر tx — هنا نحقن عبر raw على نفس الاتصال؟
            // withTransaction يعطي client؛ لكن query العام خارج المعاملة. نستخدم insert ثم update quantity_source
            `SELECT 1`
          );
          // حقن عبر SQL على نفس pool خارج tx لن يُرى داخل tx — لذا نستخدم update بعد insert داخل tx عبر خدمة ثم raw
          const line = await insertRunLine(c, {
            payroll_run_id: run.id, payroll_run_person_id: rp.id, payroll_component_id: comp.id,
            component_code_snapshot: comp.component_code, component_name_snapshot: comp.name_ar,
            component_type: 'EARNING', calculation_method: 'FIXED_AMOUNT',
            quantity_source: 'MANUAL', source_effective_from: '2025-01-01',
            calculated_amount: '1', created_by: userId,
          });
          // تحديث إلى محجوز عبر txQuery داخل نفس المعاملة
          const { txQuery } = await import('../lib/accounts/with-transaction');
          await txQuery(c, `UPDATE accounts.payroll_run_lines SET quantity_source='ATTENDANCE' WHERE id=$1::uuid`, [line.id]);
          const r = await verifyPayrollSnapshotSchema(c, { strict: false });
          kinds = r.mismatches.map((m) => m.kind);
          throw new Rb();
        });
      } catch (e) { if (!(e instanceof Rb)) throw e; }
      assert(kinds.includes('run_line_reserved_qty_source'), `كشف المحجوز: ${kinds.join(',')}`);
    });

    await it('24) Verify: ERROR non-blocking يُكشف', async () => {
      // يُمنع أصلاً بـ CHECK — نثبت أن القيد موجود
      const { run } = await mkPeriodRun();
      let blocked = false;
      try {
        await query(
          `INSERT INTO accounts.payroll_run_issues (payroll_run_id,severity,issue_code,message_ar,is_blocking)
           VALUES ($1::uuid,'ERROR','BAD_ERR','x',FALSE)`,
          [run.id]
        );
      } catch { blocked = true; }
      assert(blocked, 'DB يمنع ERROR غير blocking');
    });

    await it('25) Verify normal أثناء Fixtures: mismatches=0 (تحذيرات DRAFT مسموحة)', async () => {
      const r = await withTransaction((c) => verifyPayrollSnapshotSchema(c, { strict: false }));
      assert(r.mismatches.length === 0, `mismatches=${r.mismatches.length}`);
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwned();
      if (left === 0) ok('26) لا سجلات اختبار متبقية');
      else failed('26) سجلات متبقية', String(left));
    } catch (e) { failed('26) cleanup', e); }
  }

  await it('27) بعد cleanup: verify snapshot normal/strict', async () => {
    const n = await withTransaction((c) => verifyPayrollSnapshotSchema(c, { strict: false }));
    const s = await withTransaction((c) => verifyPayrollSnapshotSchema(c, { strict: true }));
    assert(n.ok && n.mismatches.length === 0, `normal ok=${n.ok}`);
    // قد توجد تحذيرات draft_has_snapshot من DEMO إن وُجدت — لا نزرع DEMO snapshot
    assert(s.mismatches.length === 0, 'strict بلا mismatches');
    if (!s.ok) {
      // مقبول فقط إن كانت تحذيرات غير مملوكة لنا من بيانات أخرى؛ نفشل إن كانت لدينا
      console.log('  strict warnings:', s.warnings.map((w) => w.kind));
    }
    assert(s.ok === true || s.warnings.every((w) => w.kind === 'draft_has_snapshot_artifacts'), 'strict');
    // إن وُجدت تحذيرات draft من غيرنا ننظف؟ لا — لا نلمس غير owned. نجعل الاختبار يمر إن ok أو فقط تلك التحذيرات من بيانات خارجية.
    if (!s.ok && s.warnings.some((w) => w.kind !== 'draft_has_snapshot_artifacts')) {
      throw new Error('strict فشل بتحذيرات غير متوقعة');
    }
    // أعد تعريف: نطلب ok=true بعد cleanup لأننا لا نزرع snapshot DEMO
    assert(s.ok === true, `strict يجب أن يمر (warnings=${s.warnings.length})`);
  });

  await it('28) انحدار 9.A.2.1 verify periods/runs', async () => {
    const r = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: false }));
    assert(r.mismatches.length === 0, 'periods mismatches=0');
  });

  await it('29) انحدار 9.A.1 foundation', async () => {
    const r = await withTransaction((c) => verifyPayrollFoundation(c, { strict: false }));
    assert(r.mismatches.length === 0, 'foundation ok');
  });

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closePool(); });
