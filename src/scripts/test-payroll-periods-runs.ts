/**
 * اختبارات قبول فترات/تشغيلات الرواتب 9.A.2.1 (+ Hardening H1–H6)
 * npm run test:payroll-periods-runs
 *
 * عزل البيانات: ownership token فريد لكل تشغيل + cleanup في finally.
 * لا يترك سجلات اختبار متراكمة؛ لا يمس DEMO ولا بيانات حقيقية.
 */
import bcrypt from 'bcrypt';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  ACCOUNTS_APPROVER_ROLE_CODE,
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import {
  PAYROLL_CAPABILITIES,
  assertPayrollCapability,
  getPayrollCapabilities,
  grantAccountsPlatformRole,
  hasPayrollCapability,
} from '../lib/accounts/payroll-access';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollPerson, setPayrollPersonStatus } from '../lib/accounts/payroll-people';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import {
  cancelPayrollPeriod,
  closePayrollPeriod,
  createPayrollPeriod,
  loadPayrollPeriod,
  reopenPayrollPeriod,
  serializePayrollPeriod,
  updatePayrollPeriod,
} from '../lib/accounts/payroll-periods';
import {
  cancelPayrollRun,
  createPayrollRun,
  loadPayrollRun,
  updatePayrollRun,
} from '../lib/accounts/payroll-runs';
import {
  addScopeMember,
  removeScopeMember,
  replaceScopeMembers,
} from '../lib/accounts/payroll-run-scope';
import { verifyPayrollPeriodsRuns } from '../lib/accounts/verify-payroll-periods-runs';
import { verifyPayrollFoundation } from '../lib/accounts/verify-payroll-foundation';
import { seedPayrollPeriodsDemo } from './seed-accounts-payroll-periods-demo';
import { withTransaction } from '../lib/accounts/with-transaction';

import { GET as periodsGet, POST as periodsPost } from '../../app/api/accounts/payroll/periods/route';
import { GET as periodGet, PATCH as periodPatch } from '../../app/api/accounts/payroll/periods/[id]/route';
import { POST as periodReopen } from '../../app/api/accounts/payroll/periods/[id]/reopen/route';
import { GET as runsGet, POST as runsPost } from '../../app/api/accounts/payroll/runs/route';
import { POST as runCancel } from '../../app/api/accounts/payroll/runs/[id]/cancel/route';

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
  try { await fn(); }
  catch (e) {
    if (e instanceof AccountsHttpError && allowed.includes(e.status)) {
      if (includes && !e.message.includes(includes)) throw new Error(`الرسالة لا تحتوي "${includes}": ${e.message}`);
      return;
    }
    throw e;
  }
  throw new Error(`توقّعنا خطأ ${allowed.join('/')} ولم يحدث`);
}

/** ملكية تشغيل الاختبار — تُحذف فقط هذه المعرّفات في finally. */
const owned = {
  calendarIds: [] as string[],
  periodIds: [] as string[],
  runIds: [] as string[],
  personIds: [] as string[],
  componentIds: [] as string[],
};

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-pr-pass', 10);
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

async function ensureFiscalYear(userId: string): Promise<string> {
  const code = 'TEST-FY-2025';
  const existing = await query(`SELECT id FROM accounts.fiscal_years WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await query(
    `INSERT INTO accounts.fiscal_years (code, name_ar, start_date, end_date, status, is_default, notes, created_by)
     VALUES ($1,'سنة مالية اختبار 2025','2025-01-01','2025-12-31','ACTIVE',FALSE,'اختبار 9.A.2.1',$2)
     RETURNING id`,
    [code, userId]
  );
  return ins.rows[0].id as string;
}

async function cleanupOwned(): Promise<void> {
  if (owned.runIds.length) {
    await query(`DELETE FROM accounts.payroll_runs WHERE id = ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.periodIds.length) {
    await query(`DELETE FROM accounts.payroll_periods WHERE id = ANY($1::uuid[])`, [owned.periodIds]);
  }
  if (owned.calendarIds.length) {
    await query(
      `DELETE FROM accounts.payroll_calendars
       WHERE id = ANY($1::uuid[])
         AND code NOT LIKE 'DEMO%'`,
      [owned.calendarIds]
    );
  }
  if (owned.personIds.length) {
    await query(
      `DELETE FROM accounts.payroll_people
       WHERE id = ANY($1::uuid[])
         AND person_code NOT LIKE 'DEMO%'`,
      [owned.personIds]
    );
  }
  if (owned.componentIds.length) {
    await query(
      `DELETE FROM accounts.payroll_components
       WHERE id = ANY($1::uuid[])
         AND component_code NOT LIKE 'DEMO%'`,
      [owned.componentIds]
    );
  }
}

async function countOwnedRemaining(): Promise<number> {
  const r = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM accounts.payroll_calendars WHERE id = ANY($1::uuid[])) +
       (SELECT COUNT(*)::int FROM accounts.payroll_periods WHERE id = ANY($2::uuid[])) +
       (SELECT COUNT(*)::int FROM accounts.payroll_runs WHERE id = ANY($3::uuid[])) +
       (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id = ANY($4::uuid[])) +
       (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id = ANY($5::uuid[])) AS n`,
    [owned.calendarIds, owned.periodIds, owned.runIds, owned.personIds, owned.componentIds]
  );
  return Number(r.rows[0]?.n ?? 0);
}

function authReq(url: string, userId: string, username: string, init?: {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}): NextRequest {
  const token = generateAccessToken(userId, username);
  const headers: Record<string, string> = {
    cookie: `access_token=${token}`,
    ...(init?.headers ?? {}),
  };
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json';
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

async function main() {
  console.log('===== اختبارات قبول فترات/تشغيلات الرواتب 9.A.2.1 (+ Hardening) =====');
  const runToken = `PR${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => { seq += 1; return `${p}-${runToken}-${seq}`; };

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
  const fiscalYearId = await ensureFiscalYear(userId);

  const mkCalendar = async (type = 'MONTHLY') => {
    const cal = await withTransaction((c) => createPayrollCalendar(c, {
      code: uniq('PRCAL'), name_ar: 'تقويم اختبار', calendar_type: type,
      currency_code: 'IQD', effective_from: '2025-01-01', created_by: userId,
    }));
    owned.calendarIds.push(cal.id);
    return cal;
  };

  const mkPerson = async () => {
    const person = await withTransaction((c) => createPayrollPerson(c, {
      full_name_ar: 'شخص نطاق اختبار', person_type: 'EMPLOYEE',
      default_currency_code: 'IQD', effective_from: '2025-01-01', created_by: userId,
    }));
    owned.personIds.push(person.id);
    return person;
  };

  const mkPeriod = async (calendarId: string, over: Record<string, unknown> = {}) => {
    const p = await withTransaction((c) => createPayrollPeriod(c, {
      payroll_calendar_id: calendarId, name_ar: 'فترة اختبار',
      start_date: '2025-01-01', end_date: '2025-01-31',
      fiscal_year_id: fiscalYearId, created_by: userId, ...over,
    }));
    owned.periodIds.push(p.id);
    return p;
  };

  const mkRun = async (periodId: string, over: Record<string, unknown> = {}) => {
    const run = await withTransaction((c) => createPayrollRun(c, {
      payroll_period_id: periodId, run_type: 'REGULAR', scope_type: 'ALL', created_by: userId, ...over,
    }));
    owned.runIds.push(run.id);
    return run;
  };

  const mkComponent = async (over: Record<string, unknown> = {}) => {
    const comp = await withTransaction((c) => createPayrollComponent(c, {
      component_code: uniq('PRC'), name_ar: 'مكوّن اختبار', component_type: 'EARNING',
      calculation_method: 'FIXED_AMOUNT', default_amount: '1000', effective_from: '2025-01-01',
      created_by: userId, ...over,
    }));
    owned.componentIds.push(comp.id);
    return comp;
  };

  try {
    // ═══ الترحيل: calculation_base_type + القيود ═══════════════════════
    await it('1) القيمة الافتراضية calculation_base_type = NONE على المكوّن', async () => {
      const comp = await mkComponent();
      assert(comp.calculation_base_type === 'NONE', 'الافتراضي NONE');
    });

    await it('2) PERCENTAGE_OF_BASIC يتطلب CONTRACT_BASIC (NONE مرفوض)', async () => {
      await throwsHttp(() => withTransaction((c) => createPayrollComponent(c, {
        component_code: uniq('PRC'), name_ar: 'نسبة', component_type: 'EARNING',
        calculation_method: 'PERCENTAGE_OF_BASIC', calculation_base_type: 'NONE',
        default_percentage: '10', effective_from: '2025-01-01', created_by: userId,
      })), 400);
    });

    await it('3) PERCENTAGE_OF_BASIC + CONTRACT_BASIC مقبول', async () => {
      const comp = await mkComponent({
        calculation_method: 'PERCENTAGE_OF_BASIC', calculation_base_type: 'CONTRACT_BASIC',
        default_percentage: '10', default_amount: undefined,
      });
      assert(comp.calculation_base_type === 'CONTRACT_BASIC', 'CONTRACT_BASIC مقبول');
    });

    await it('4) أساس احتساب محجوز مرفوض خدمياً', async () => {
      for (const reserved of ['GROSS_EARNINGS', 'SELECTED_COMPONENTS', 'COMPONENT_REFERENCE']) {
        await throwsHttp(() => withTransaction((c) => createPayrollComponent(c, {
          component_code: uniq('PRC'), name_ar: 'محجوز', component_type: 'EARNING',
          calculation_method: 'FIXED_AMOUNT', calculation_base_type: reserved,
          default_amount: '1', effective_from: '2025-01-01', created_by: userId,
        })), 400, 'محجوز');
      }
    });

    await it('5) SQL مباشر: قيمة base_type غير موجودة مرفوضة بقيد القاعدة', async () => {
      const comp = await mkComponent({ default_amount: '1' });
      let blocked = false;
      try { await query(`UPDATE accounts.payroll_components SET calculation_base_type='BOGUS' WHERE id=$1::uuid`, [comp.id]); }
      catch { blocked = true; }
      assert(blocked, 'CHECK يرفض القيمة غير الصالحة');
    });

    await it('6) SQL مباشر: version=0 مرفوض على الفترة والتشغيل', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const run = await mkRun(period.id);
      let b1 = false, b2 = false;
      try { await query(`UPDATE accounts.payroll_periods SET version=0 WHERE id=$1::uuid`, [period.id]); } catch { b1 = true; }
      try { await query(`UPDATE accounts.payroll_runs SET version=0 WHERE id=$1::uuid`, [run.id]); } catch { b2 = true; }
      assert(b1 && b2, 'CHECK version>=1 يعمل على الطبقتين');
    });

    // ═══ الفترات ═══════════════════════════════════════════════════════
    await it('7) إنشاء فترة (OPEN) بكود مُولّد', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      assert(p.status === 'OPEN', 'OPEN عند الإنشاء');
      assert(/^PYPR/.test(p.period_code), 'كود PYPR مُولّد');
      assert(p.currency_code === 'IQD', 'عملة من التقويم');
    });

    await it('8) منع تداخل فترتين لنفس التقويم', async () => {
      const cal = await mkCalendar();
      await mkPeriod(cal.id, { start_date: '2025-01-01', end_date: '2025-01-31' });
      await throwsHttp(() => mkPeriod(cal.id, { start_date: '2025-01-15', end_date: '2025-02-15' }), 409, 'تتداخل');
    });

    await it('9) أكثر من فترة OPEN غير متداخلة لنفس التقويم مسموح', async () => {
      const cal = await mkCalendar();
      const a = await mkPeriod(cal.id, { start_date: '2025-01-01', end_date: '2025-01-31' });
      const b = await mkPeriod(cal.id, { start_date: '2025-02-01', end_date: '2025-02-28' });
      assert(a.status === 'OPEN' && b.status === 'OPEN', 'كلاهما OPEN بلا تداخل');
    });

    await it('10) CANCELLED لا تمنع فترة جديدة متداخلة', async () => {
      const cal = await mkCalendar();
      const a = await mkPeriod(cal.id, { start_date: '2025-03-01', end_date: '2025-03-31' });
      await withTransaction((c) => cancelPayrollPeriod(c, { id: a.id, userId, version: a.version, updated_at: a.updated_at, reason: 'إلغاء اختبار' }));
      const b = await mkPeriod(cal.id, { start_date: '2025-03-10', end_date: '2025-03-20' });
      assert(b.status === 'OPEN', 'فترة جديدة رغم وجود ملغاة متداخلة');
    });

    await it('11) تداخل متزامن: واحدة تنجح والأخرى 409', async () => {
      const cal = await mkCalendar();
      const results = await Promise.allSettled([
        mkPeriod(cal.id, { start_date: '2025-04-01', end_date: '2025-04-30', name_ar: 'متزامنة أ' }),
        mkPeriod(cal.id, { start_date: '2025-04-10', end_date: '2025-04-20', name_ar: 'متزامنة ب' }),
      ]);
      const okCount = results.filter((r) => r.status === 'fulfilled').length;
      const rej = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      assert(okCount === 1, `واحدة فقط تنجح (نجح ${okCount})`);
      assert(rej.every((r) => r.reason instanceof AccountsHttpError && r.reason.status === 409), 'الأخرى 409 نظيف');
    });

    await it('12) تعديل الفترة (اسم) وهي OPEN', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const u = await withTransaction((c) => updatePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, name_ar: 'اسم محدّث' }));
      assert(u.name_ar === 'اسم محدّث' && u.version === p.version + 1, 'الاسم محدّث والإصدار ارتفع');
    });

    await it('13) تعديل الحقول الحساسة مرفوض بوجود تشغيل غير ملغى', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      await mkRun(p.id);
      await throwsHttp(() => withTransaction((c) => updatePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, end_date: '2025-02-10' })), 409);
    });

    await it('14) الإغلاق مرفوض بوجود تشغيل DRAFT', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      await mkRun(p.id);
      await throwsHttp(() => withTransaction((c) => closePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at })), 409);
    });

    await it('15) الإغلاق ينجح دون تشغيلات ثم إعادة الفتح بسبب', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const closed = await withTransaction((c) => closePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at }));
      assert(closed.status === 'CLOSED' && closed.closed_at, 'مغلقة مع ختم زمني');
      await throwsHttp(() => withTransaction((c) => reopenPayrollPeriod(c, { id: closed.id, userId, version: closed.version, updated_at: closed.updated_at, reason: '' })), 400);
      const reopened = await withTransaction((c) => reopenPayrollPeriod(c, { id: closed.id, userId, version: closed.version, updated_at: closed.updated_at, reason: 'مراجعة اختبار' }));
      assert(reopened.status === 'OPEN' && reopened.transition_reason === 'مراجعة اختبار', 'مفتوحة مع سبب');
    });

    await it('16) الإلغاء يتطلب سبباً وإلغاء التشغيلات أولاً', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id);
      await throwsHttp(() => withTransaction((c) => cancelPayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, reason: '' })), 400);
      await throwsHttp(() => withTransaction((c) => cancelPayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, reason: 'محاولة' })), 409);
      await withTransaction((c) => cancelPayrollRun(c, { id: run.id, userId, version: run.version, updated_at: run.updated_at, reason: 'إلغاء تشغيل' }));
      const cancelled = await withTransaction((c) => cancelPayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, reason: 'إلغاء فترة' }));
      assert(cancelled.status === 'CANCELLED', 'الفترة ملغاة بعد إلغاء التشغيل');
    });

    await it('17) التزامن المتفائل على الفترة (version قديم → 409)', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      await withTransaction((c) => updatePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, name_ar: 'أول' }));
      try {
        await withTransaction((c) => updatePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at, name_ar: 'قديم' }));
        throw new Error('توقّعنا 409');
      } catch (err) {
        if (!(err instanceof AccountsHttpError) || err.status !== 409) throw err;
        assert(err.message.includes('الفترة') || err.message.includes('السجل'), `رسالة رواتب: ${err.message}`);
        assert(!err.message.includes('الجلسة'), 'لا تقول الجلسة');
      }
    });

    // ═══ H1: ترتيب الأقفال — Update Period × Create Run ═══════════════
    await it('17b) H1: تزامن update Period الحساس مع create Run — بلا Deadlock', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id, { start_date: '2025-05-01', end_date: '2025-05-31' });
      const results = await Promise.allSettled([
        withTransaction((c) => updatePayrollPeriod(c, {
          id: p.id, userId, version: p.version, updated_at: p.updated_at,
          end_date: '2025-05-30', name_ar: 'محدّثة متزامنة',
        })),
        mkRun(p.id, { run_type: 'CORRECTION', scope_type: 'ALL' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      assert(fulfilled >= 1, `واحد على الأقل ينجح (نجح ${fulfilled})`);
      assert(
        rejected.every((r) => r.reason instanceof AccountsHttpError && [409, 400].includes(r.reason.status)),
        'الرفض إن وُجد يكون 409/400 نظيفاً بلا Deadlock'
      );
      // لا lost update: إن نجح التعديل فالاسم محدّث
      const latest = await withTransaction((c) => loadPayrollPeriod(c, p.id));
      assert(latest.version >= p.version, 'version لم ينخفض');
    });

    // ═══ التشغيلات ═════════════════════════════════════════════════════
    await it('18) إنشاء كل أنواع التشغيل', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      for (const t of ['REGULAR', 'CORRECTION', 'SUPPLEMENTAL', 'TERMINATION', 'MANUAL']) {
        const run = await mkRun(p.id, { run_type: t });
        assert(run.run_type === t && run.status === 'DRAFT', `النوع ${t} DRAFT`);
        assert(/^PYR/.test(run.run_number), 'كود PYR مُولّد');
      }
    });

    await it('19) قواعد النطاق: ALL/PERSON_LIST بلا مرجع، الباقي بمرجع', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      await throwsHttp(() => mkRun(p.id, { run_type: 'CORRECTION', scope_type: 'ALL', scope_ref_id: '00000000-0000-0000-0000-000000000001' }), 400);
      await throwsHttp(() => mkRun(p.id, { run_type: 'SUPPLEMENTAL', scope_type: 'DEPARTMENT' }), 400);
    });

    await it('20) منع تشغيل حيّ مكافئ مكرّر (نفس الفترة/النوع/النطاق)', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      await mkRun(p.id, { run_type: 'REGULAR', scope_type: 'ALL' });
      await throwsHttp(() => mkRun(p.id, { run_type: 'REGULAR', scope_type: 'ALL' }), 409);
    });

    await it('21) تشغيل مكرّر متزامن: واحد ينجح والآخر 409', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const results = await Promise.allSettled([
        mkRun(p.id, { run_type: 'REGULAR', scope_type: 'ALL' }),
        mkRun(p.id, { run_type: 'REGULAR', scope_type: 'ALL' }),
      ]);
      const okCount = results.filter((r) => r.status === 'fulfilled').length;
      const rej = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      assert(okCount === 1, `واحد فقط ينجح (نجح ${okCount})`);
      assert(rej.every((r) => r.reason instanceof AccountsHttpError && r.reason.status === 409), 'الآخر 409 نظيف');
    });

    await it('22) إنشاء التشغيل مرفوض إذا كانت الفترة غير OPEN', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const closed = await withTransaction((c) => closePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at }));
      await throwsHttp(() => mkRun(closed.id), 409);
    });

    await it('23) تعديل التشغيل يُسمح فقط وهو DRAFT', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { run_type: 'CORRECTION', scope_type: 'ALL' });
      const u = await withTransaction((c) => updatePayrollRun(c, { id: run.id, userId, version: run.version, updated_at: run.updated_at, run_type: 'MANUAL' }));
      assert(u.run_type === 'MANUAL', 'تعديل النوع نجح');
      const cancelled = await withTransaction((c) => cancelPayrollRun(c, { id: u.id, userId, version: u.version, updated_at: u.updated_at, reason: 'إلغاء' }));
      await throwsHttp(() => withTransaction((c) => updatePayrollRun(c, { id: cancelled.id, userId, version: cancelled.version, updated_at: cancelled.updated_at, run_type: 'REGULAR' })), 409);
    });

    await it('24) إلغاء التشغيل يتطلب سبباً + تزامن متفائل', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id);
      await throwsHttp(() => withTransaction((c) => cancelPayrollRun(c, { id: run.id, userId, version: run.version, updated_at: run.updated_at, reason: '' })), 400);
      await throwsHttp(() => withTransaction((c) => cancelPayrollRun(c, { id: run.id, userId, version: run.version + 5, updated_at: run.updated_at, reason: 'سبب' })), 409);
      const cancelled = await withTransaction((c) => cancelPayrollRun(c, { id: run.id, userId, version: run.version, updated_at: run.updated_at, reason: 'سبب إلغاء' }));
      assert(cancelled.status === 'CANCELLED' && cancelled.cancellation_reason === 'سبب إلغاء', 'ملغى مع سبب');
    });

    await it('25) SQL مباشر: supersedes ذاتي مرفوض بقيد القاعدة', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id);
      let blocked = false;
      try { await query(`UPDATE accounts.payroll_runs SET supersedes_run_id=id WHERE id=$1::uuid`, [run.id]); }
      catch { blocked = true; }
      assert(blocked, 'CHECK يمنع الإشارة الذاتية');
    });

    // ═══ H3: UUID غير صالح ════════════════════════════════════════════
    await it('25b) H3: UUID مشوّه → 400 على الفترة والتشغيل', async () => {
      await throwsHttp(() => withTransaction((c) => loadPayrollPeriod(c, 'not-a-uuid')), 400, 'غير صالح');
      await throwsHttp(() => withTransaction((c) => loadPayrollRun(c, '%%%%')), 400, 'غير صالح');
      const missing = '00000000-0000-4000-8000-000000000099';
      await throwsHttp(() => withTransaction((c) => loadPayrollPeriod(c, missing)), 404);
      await throwsHttp(() => withTransaction((c) => loadPayrollRun(c, missing)), 404);
    });

    // ═══ أعضاء النطاق ══════════════════════════════════════════════════
    await it('26) إضافة/إزالة عضو نطاق لتشغيل PERSON_LIST', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const person = await mkPerson();
      const r1 = await withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: run.version, updated_at: run.updated_at }));
      assert(r1.members.length === 1, 'عضو واحد بعد الإضافة');
      assert(r1.run.version === run.version + 1, 'إصدار التشغيل ارتفع');
      const r2 = await withTransaction((c) => removeScopeMember(c, { runId: run.id, personId: person.id, userId, version: r1.run.version, updated_at: r1.run.updated_at }));
      assert(r2.members.length === 0, 'لا أعضاء بعد الإزالة');
    });

    await it('27) عضو مكرّر مرفوض 409', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const person = await mkPerson();
      const r1 = await withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: run.version, updated_at: run.updated_at }));
      await throwsHttp(() => withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: r1.run.version, updated_at: r1.run.updated_at })), 409);
    });

    await it('28) استبدال قائمة الأعضاء', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const a = await mkPerson(); const b = await mkPerson(); const c2 = await mkPerson();
      const r1 = await withTransaction((c) => addScopeMember(c, { runId: run.id, personId: a.id, userId, version: run.version, updated_at: run.updated_at }));
      const r2 = await withTransaction((c) => replaceScopeMembers(c, { runId: run.id, personIds: [b.id, c2.id], userId, version: r1.run.version, updated_at: r1.run.updated_at }));
      assert(r2.members.length === 2, 'عضوان بعد الاستبدال');
      assert(!r2.members.some((m) => m.payroll_person_id === a.id), 'العضو القديم أزيل');
    });

    await it('29) شخص غير فعّال لا يُضاف للنطاق', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const person = await mkPerson();
      await withTransaction((c) => setPayrollPersonStatus(c, { id: person.id, userId, version: person.version, updated_at: person.updated_at, target: 'SUSPENDED' }));
      await throwsHttp(() => withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: run.version, updated_at: run.updated_at })), 400);
    });

    await it('30) أعضاء النطاق ممنوعون لغير PERSON_LIST', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'ALL' });
      const person = await mkPerson();
      await throwsHttp(() => withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: run.version, updated_at: run.updated_at })), 409);
    });

    await it('31) أعضاء النطاق ممنوعون لغير DRAFT', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const person = await mkPerson();
      const cancelled = await withTransaction((c) => cancelPayrollRun(c, { id: run.id, userId, version: run.version, updated_at: run.updated_at, reason: 'إلغاء' }));
      await throwsHttp(() => withTransaction((c) => addScopeMember(c, { runId: run.id, personId: person.id, userId, version: cancelled.version, updated_at: cancelled.updated_at })), 409);
    });

    await it('32) تزامن متفائل على تعديل النطاق (version قديم → 409)', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id);
      const run = await mkRun(p.id, { scope_type: 'PERSON_LIST' });
      const a = await mkPerson(); const b = await mkPerson();
      await withTransaction((c) => addScopeMember(c, { runId: run.id, personId: a.id, userId, version: run.version, updated_at: run.updated_at }));
      await throwsHttp(() => withTransaction((c) => addScopeMember(c, { runId: run.id, personId: b.id, userId, version: run.version, updated_at: run.updated_at })), 409);
    });

    // ═══ التسلسلات المتزامنة ═══════════════════════════════════════════
    await it('33) ترقيم فترات متزامن بلا تكرار', async () => {
      const cals = await Promise.all([mkCalendar(), mkCalendar(), mkCalendar(), mkCalendar()]);
      const created = await Promise.all(cals.map((cal) => mkPeriod(cal.id)));
      const codes = created.map((p) => p.period_code);
      assert(new Set(codes).size === codes.length, `أكواد فريدة (${codes.join(',')})`);
    });

    await it('34) ترقيم تشغيلات متزامن بلا تكرار', async () => {
      const cal = await mkCalendar();
      const periods = await Promise.all([
        mkPeriod(cal.id, { start_date: '2025-06-01', end_date: '2025-06-30' }),
        mkPeriod(cal.id, { start_date: '2025-07-01', end_date: '2025-07-31' }),
        mkPeriod(cal.id, { start_date: '2025-08-01', end_date: '2025-08-31' }),
      ]);
      const runs = await Promise.all(periods.map((p) => mkRun(p.id)));
      const nums = runs.map((r) => r.run_number);
      assert(new Set(nums).size === nums.length, `أرقام فريدة (${nums.join(',')})`);
    });

    // ═══ الصلاحيات (خدمة) + H5 Routes ═════════════════════════════════
    const viewerId = await upsertUser(`test-pr-viewer-${runToken.toLowerCase()}`, true);
    const clerkId = await upsertUser(`test-pr-clerk-${runToken.toLowerCase()}`, true);
    const approverId = await upsertUser(`test-pr-approver-${runToken.toLowerCase()}`, true);
    const bareId = await upsertUser(`test-pr-bare-${runToken.toLowerCase()}`, true);
    await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
    await grantAccountsPlatformRole(approverId, ACCOUNTS_APPROVER_ROLE_CODE);
    const P = PAYROLL_CAPABILITIES;
    const viewerUser = `test-pr-viewer-${runToken.toLowerCase()}`;
    const clerkUser = `test-pr-clerk-${runToken.toLowerCase()}`;
    const approverUser = `test-pr-approver-${runToken.toLowerCase()}`;
    const bareUser = `test-pr-bare-${runToken.toLowerCase()}`;
    const adminUser = (await query(`SELECT username FROM student_affairs.users WHERE id=$1::uuid`, [userId])).rows[0].username as string;

    await it('35) المُشاهد: عرض التشغيلات فقط', async () => {
      assert(await hasPayrollCapability(null, viewerId, P.VIEW_RUNS), 'يرى التشغيلات');
      assert(!(await hasPayrollCapability(null, viewerId, P.MANAGE_PERIODS)), 'لا يدير فترات');
      assert(!(await hasPayrollCapability(null, viewerId, P.CREATE_RUNS)), 'لا ينشئ تشغيلات');
    });

    await it('36) الكاتب: فترات وإنشاء تشغيلات، بلا احتساب/إلغاء', async () => {
      assert(await hasPayrollCapability(null, clerkId, P.MANAGE_PERIODS), 'يدير الفترات');
      assert(await hasPayrollCapability(null, clerkId, P.CREATE_RUNS), 'ينشئ التشغيلات');
      assert(!(await hasPayrollCapability(null, clerkId, P.CALCULATE)), 'لا احتساب');
      assert(!(await hasPayrollCapability(null, clerkId, P.CANCEL_RUNS)), 'لا إلغاء');
    });

    await it('37) المُعتمد: عرض التشغيلات فقط', async () => {
      assert(await hasPayrollCapability(null, approverId, P.VIEW_RUNS), 'يرى');
      assert(!(await hasPayrollCapability(null, approverId, P.CREATE_RUNS)), 'لا إنشاء');
    });

    await it('38) عضوية مجرّدة → عرض فقط (يشمل عرض التشغيلات)', async () => {
      const caps = await getPayrollCapabilities(null, bareId);
      assert(caps.has(P.VIEW_RUNS) && caps.has(P.VIEW), 'عرض السجل والتشغيلات');
      assert(!caps.has(P.MANAGE_PERIODS) && !caps.has(P.CREATE_RUNS), 'لا إدارة');
    });

    await it('39) المدير: يملك كل قدرات الطبقة الجديدة', async () => {
      for (const cap of [P.VIEW_RUNS, P.MANAGE_PERIODS, P.CREATE_RUNS, P.CALCULATE, P.CANCEL_RUNS]) {
        assert(await hasPayrollCapability(null, userId, cap), `المدير يملك ${cap}`);
      }
    });

    // H5 — HTTP route capability families
    await it('39b) H5: viewer GET periods ينجح و POST يُرفض 403', async () => {
      const getRes = await periodsGet(authReq('http://localhost/api/accounts/payroll/periods', viewerId, viewerUser));
      assert(getRes.status === 200, `GET viewer → ${getRes.status}`);
      const postRes = await periodsPost(authReq('http://localhost/api/accounts/payroll/periods', viewerId, viewerUser, {
        method: 'POST',
        body: JSON.stringify({ name_ar: 'x' }),
      }));
      assert(postRes.status === 403, `POST viewer → ${postRes.status} (متوقع 403)`);
    });

    await it('39c) H5: clerk ينشئ فترة (POST) ولا يلغي تشغيلاً (403)', async () => {
      const cal = await mkCalendar();
      const postRes = await periodsPost(authReq('http://localhost/api/accounts/payroll/periods', clerkId, clerkUser, {
        method: 'POST',
        body: JSON.stringify({
          payroll_calendar_id: cal.id, name_ar: 'فترة كاتب',
          start_date: '2025-09-01', end_date: '2025-09-30', fiscal_year_id: fiscalYearId,
        }),
      }));
      assert(postRes.status === 201, `clerk POST period → ${postRes.status}`);
      const body = await postRes.json() as { data?: { id: string } };
      if (body.data?.id) owned.periodIds.push(body.data.id);

      const period = await mkPeriod(cal.id, { start_date: '2025-10-01', end_date: '2025-10-31' });
      const run = await mkRun(period.id);
      const cancelRes = await runCancel(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/cancel`, clerkId, clerkUser, {
          method: 'POST',
          body: JSON.stringify({ version: run.version, updated_at: run.updated_at, reason: 'محاولة كاتب' }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(cancelRes.status === 403, `clerk cancel run → ${cancelRes.status}`);
    });

    await it('39d) H5: clerk لا يملك payroll_calculate → 403', async () => {
      await throwsHttp(() => assertPayrollCapability(null, clerkId, P.CALCULATE), 403);
    });

    await it('39e) H5: approver view فقط — POST runs → 403', async () => {
      const getRes = await runsGet(authReq('http://localhost/api/accounts/payroll/runs', approverId, approverUser));
      assert(getRes.status === 200, `approver GET → ${getRes.status}`);
      const postRes = await runsPost(authReq('http://localhost/api/accounts/payroll/runs', approverId, approverUser, {
        method: 'POST',
        body: JSON.stringify({ payroll_period_id: '00000000-0000-4000-8000-000000000001' }),
      }));
      assert(postRes.status === 403, `approver POST run → ${postRes.status}`);
    });

    await it('39f) H5: admin يستطيع reopen و cancel', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id, { start_date: '2025-11-01', end_date: '2025-11-30' });
      const closed = await withTransaction((c) => closePayrollPeriod(c, { id: p.id, userId, version: p.version, updated_at: p.updated_at }));
      const reopenRes = await periodReopen(
        authReq(`http://localhost/api/accounts/payroll/periods/${closed.id}/reopen`, userId, adminUser, {
          method: 'POST',
          body: JSON.stringify({ version: closed.version, updated_at: closed.updated_at, reason: 'إعادة فتح إداري' }),
        }),
        { params: Promise.resolve({ id: closed.id }) }
      );
      assert(reopenRes.status === 200, `admin reopen → ${reopenRes.status}`);

      const run = await mkRun(p.id, { run_type: 'MANUAL' });
      const cancelRes = await runCancel(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/cancel`, userId, adminUser, {
          method: 'POST',
          body: JSON.stringify({ version: run.version, updated_at: run.updated_at, reason: 'إلغاء إداري' }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(cancelRes.status === 200, `admin cancel → ${cancelRes.status}`);
    });

    await it('39g) H5: membership-only لا تملك كتابة — PATCH period → 403', async () => {
      const cal = await mkCalendar();
      const p = await mkPeriod(cal.id, { start_date: '2025-12-01', end_date: '2025-12-31' });
      const patchRes = await periodPatch(
        authReq(`http://localhost/api/accounts/payroll/periods/${p.id}`, bareId, bareUser, {
          method: 'PATCH',
          body: JSON.stringify({ version: p.version, updated_at: p.updated_at, name_ar: 'محاولة' }),
        }),
        { params: Promise.resolve({ id: p.id }) }
      );
      assert(patchRes.status === 403, `bare PATCH → ${patchRes.status}`);
    });

    await it('39h) H3+H5: GET period بـ UUID مشوّه → 400 لا 500', async () => {
      const res = await periodGet(
        authReq('http://localhost/api/accounts/payroll/periods/not-uuid', viewerId, viewerUser),
        { params: Promise.resolve({ id: 'not-uuid' }) }
      );
      assert(res.status === 400, `invalid UUID GET → ${res.status}`);
      const body = await res.json() as { message?: string; success?: boolean };
      assert(body.success === false, 'success=false');
      assert(typeof body.message === 'string' && !/constraint|uuid|22P02|payroll_periods/i.test(body.message), 'بلا تسريب SQL');
    });

    // ═══ التدقيق ═══════════════════════════════════════════════════════
    await it('40) التدقيق يسجّل إنشاء الفترة مع القيم', async () => {
      const cal = await mkCalendar();
      const auditId = await withTransaction(async (c) => {
        const p = await createPayrollPeriod(c, {
          payroll_calendar_id: cal.id, name_ar: 'فترة تدقيق', start_date: '2025-09-01', end_date: '2025-09-30',
          fiscal_year_id: fiscalYearId, created_by: userId,
        });
        owned.periodIds.push(p.id);
        await writeFinancialAudit(c, {
          userId, action: 'payroll_period.created', entityType: 'payroll_period', entityId: p.id,
          newValues: serializePayrollPeriod(p), description: `إنشاء فترة رواتب ${p.period_code}`,
        });
        return p.id;
      });
      const log = await query(
        `SELECT description FROM accounts.financial_audit_log
         WHERE entity_id=$1::uuid AND action='payroll_period.created' ORDER BY created_at DESC LIMIT 1`,
        [auditId]
      );
      assert(log.rows[0] && String(log.rows[0].description).includes('إنشاء فترة رواتب'), 'سجل التدقيق موجود');
    });

    // ═══ H6: ترقية strict للتحذيرات ═══════════════════════════════════
    await it('40b) H6: multiple_open_periods — normal يحذّر و strict يفشل', async () => {
      const cal = await mkCalendar();
      await mkPeriod(cal.id, { start_date: '2026-01-01', end_date: '2026-01-31', name_ar: 'OPEN-A' });
      await mkPeriod(cal.id, { start_date: '2026-02-01', end_date: '2026-02-28', name_ar: 'OPEN-B' });
      const normal = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: false }));
      assert(normal.ok === true, 'normal ok=true');
      assert(normal.warnings.some((w) => w.kind === 'multiple_open_periods'), 'normal يحتوي التحذير');
      const strict = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: true }));
      assert(strict.ok === false, 'strict ok=false');
      assert(strict.warnings.some((w) => w.kind === 'multiple_open_periods'), 'نفس التحذير في strict');
      assert(strict.mismatches.length === 0, 'لا mismatches — الترقية عبر warnings فقط');
    });

    // ═══ البذرة + التحقق + الانحدار ════════════════════════════════════
    await it('41) بذرة الفترات DEMO idempotent (تشغيل مرتين)', async () => {
      await seedPayrollPeriodsDemo();
      const c1 = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_periods WHERE name_ar LIKE '%DEMO%'`);
      await seedPayrollPeriodsDemo();
      const c2 = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_periods WHERE name_ar LIKE '%DEMO%'`);
      assert(Number(c1.rows[0].n) === Number(c2.rows[0].n), `عدد فترات DEMO ثابت (${c1.rows[0].n} ↔ ${c2.rows[0].n})`);
    });

    await it('42) التحقق العادي بعد cleanup: لا فروق سلامة', async () => {
      // سيُعاد بعد cleanup النهائي — هنا نتحقق فقط أن mismatches لا تشمل فساداً حقيقياً من غير owned
      const r = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: false }));
      assert(r.mismatches.length === 0, `توقّعنا 0 فروق، وجدنا ${r.mismatches.length}`);
    });

    await it('43) التحقق الصارم يُرجِع العلم (قبل cleanup قد يحذّر من تعدد OPEN للاختبار)', async () => {
      const r = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: true }));
      assert(r.strict === true, 'العلم strict مفعّل');
      assert(r.mismatches.length === 0, 'لا فروق سلامة حتى في الصارم');
    });

    await it('44) انحدار 9.A.1: تحقق الأساس ما زال سليماً', async () => {
      const r = await withTransaction((c) => verifyPayrollFoundation(c, { strict: false }));
      assert(r.mismatches.length === 0, `انحدار الأساس: ${r.mismatches.length} فروق`);
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwnedRemaining();
      if (left === 0) ok('45) H4: لا سجلات اختبار متبقية بعد cleanup');
      else failed('45) H4: سجلات متبقية', `${left}`);
    } catch (e) {
      failed('45) H4: فشل cleanup', e);
    }
  }

  // بعد cleanup: verify يجب أن يمر صارماً بلا تحذيرات من بيانات الاختبار
  await it('46) بعد cleanup: verify normal = PASS', async () => {
    const r = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: false }));
    assert(r.ok === true && r.mismatches.length === 0, `normal: ok=${r.ok} mismatches=${r.mismatches.length}`);
  });

  await it('47) بعد cleanup: verify strict = PASS بلا تحذيرات اختبار', async () => {
    const r = await withTransaction((c) => verifyPayrollPeriodsRuns(c, { strict: true }));
    if (!r.ok) {
      console.log('  warnings:', r.warnings.map((w) => `${w.kind}:${w.detail}`));
      console.log('  unexplained:', r.unexplained.map((w) => `${w.kind}:${w.detail}`));
    }
    assert(r.ok === true, `strict ok=true (warnings=${r.warnings.length})`);
  });

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closePool(); });
