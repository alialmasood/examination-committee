/**
 * بيانات عرض فترات/تشغيلات الرواتب 9.A.2.1 — DEMO فقط، idempotent (تشغيل مرتين بلا تكرار).
 *
 * الاستخدام:
 *  - npm run seed:accounts-payroll-periods-demo
 *  - npx tsx src/scripts/seed-accounts-payroll-periods-demo.ts
 *
 * الثبات (idempotency):
 *  - كل فترة محروسة بـ(التقويم + الاسم الفريد DEMO)، وكل تشغيل بـ(الفترة + النوع + النطاق).
 *  - لا ينشئ run_people/lines/issues ولا مخرجات احتساب.
 *  - لا يحذف/يعدّل بيانات غير DEMO، ولا يربط بسنة مالية أو تقويم حقيقي (يستعمل DEMO فقط).
 *  - يعتمد على seed:accounts-payroll-demo (التقويمات والأشخاص DEMO). شغّله أولاً إن لزم.
 */
import { closePool, query } from '../lib/db';
import { withTransaction } from '../lib/accounts/with-transaction';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollRun } from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';

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

/** سنة مالية DEMO فعّالة (لا تلمس السنوات الحقيقية). */
async function ensureFiscalYear(userId: string): Promise<string> {
  const code = 'DEMO-FY-2025';
  const existing = await query(`SELECT id FROM accounts.fiscal_years WHERE LOWER(code)=LOWER($1)`, [code]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await query(
    `INSERT INTO accounts.fiscal_years (code, name_ar, name_en, start_date, end_date, status, is_default, notes, created_by)
     VALUES ($1,'سنة مالية DEMO 2025','DEMO FY 2025','2025-01-01','2025-12-31','ACTIVE',FALSE,'DEMO 9.A.2.1 Payroll',$2)
     RETURNING id`,
    [code, userId]
  );
  return ins.rows[0].id as string;
}

async function findCalendar(code: string): Promise<string | null> {
  const r = await query(`SELECT id FROM accounts.payroll_calendars WHERE code=$1`, [code]);
  return (r.rows[0]?.id as string | undefined) ?? null;
}

async function findPersonIds(): Promise<string[]> {
  const r = await query(
    `SELECT id FROM accounts.payroll_people WHERE person_code LIKE 'DEMO-%' AND status='ACTIVE' ORDER BY person_code`
  );
  return r.rows.map((x) => x.id as string);
}

/** ينشئ فترة DEMO مرة واحدة (حارس: التقويم + الاسم). يعيد المعرّف. */
async function ensurePeriod(
  userId: string,
  calendarId: string,
  fiscalYearId: string,
  nameAr: string,
  startDate: string,
  endDate: string
): Promise<string | null> {
  const found = await query(
    `SELECT id FROM accounts.payroll_periods WHERE payroll_calendar_id=$1::uuid AND name_ar=$2 LIMIT 1`,
    [calendarId, nameAr]
  );
  if (found.rows[0]) return found.rows[0].id as string;
  const row = await withTransaction((c) => createPayrollPeriod(c, {
    payroll_calendar_id: calendarId,
    name_ar: nameAr,
    start_date: startDate,
    end_date: endDate,
    fiscal_year_id: fiscalYearId,
    created_by: userId,
  }));
  console.log(`✓ فترة: ${nameAr} (${row.period_code})`);
  return row.id;
}

/** ينشئ تشغيل DEMO مرة واحدة (حارس: الفترة + النوع + النطاق). يعيد المعرّف. */
async function ensureRun(
  userId: string,
  periodId: string,
  scopeType: string
): Promise<string> {
  const found = await query(
    `SELECT id FROM accounts.payroll_runs
     WHERE payroll_period_id=$1::uuid AND run_type='REGULAR' AND scope_type=$2 LIMIT 1`,
    [periodId, scopeType]
  );
  if (found.rows[0]) return found.rows[0].id as string;
  const row = await withTransaction((c) => createPayrollRun(c, {
    payroll_period_id: periodId,
    run_type: 'REGULAR',
    scope_type: scopeType,
    created_by: userId,
  }));
  console.log(`✓ تشغيل DRAFT (${scopeType}): ${row.run_number}`);
  return row.id;
}

export async function seedPayrollPeriodsDemo(): Promise<void> {
  const userId = await resolveUserId();
  const fiscalYearId = await ensureFiscalYear(userId);

  const monthlyCal = await findCalendar('DEMO-MONTHLY');
  const lecturerCal = await findCalendar('DEMO-LECTURER');
  if (!monthlyCal || !lecturerCal) {
    throw new Error('تقويمات DEMO غير موجودة — شغّل seed:accounts-payroll-demo أولاً');
  }

  const monthlyPeriodId = await ensurePeriod(
    userId, monthlyCal, fiscalYearId,
    'فترة رواتب DEMO شهرية — يناير 2025', '2025-01-01', '2025-01-31'
  );
  await ensurePeriod(
    userId, lecturerCal, fiscalYearId,
    'فترة محاضرين DEMO — يناير 2025', '2025-01-01', '2025-01-31'
  );

  if (monthlyPeriodId) {
    // تشغيل DRAFT بنطاق ALL
    await ensureRun(userId, monthlyPeriodId, 'ALL');
    // تشغيل DRAFT بنطاق PERSON_LIST + أعضاء DEMO
    const personListRunId = await ensureRun(userId, monthlyPeriodId, 'PERSON_LIST');
    const people = await findPersonIds();
    for (const personId of people.slice(0, 3)) {
      const already = await query(
        `SELECT 1 FROM accounts.payroll_run_scope_members
         WHERE payroll_run_id=$1::uuid AND payroll_person_id=$2::uuid LIMIT 1`,
        [personListRunId, personId]
      );
      if (already.rows[0]) continue;
      // نقرأ نسخة التشغيل الحالية لتمرير التزامن المتفائل
      const run = await query(
        `SELECT version, updated_at FROM accounts.payroll_runs WHERE id=$1::uuid`,
        [personListRunId]
      );
      await withTransaction((c) => addScopeMember(c, {
        runId: personListRunId,
        personId,
        userId,
        version: run.rows[0].version,
        updated_at: run.rows[0].updated_at,
      }));
      console.log(`✓ عضو نطاق: ${personId}`);
    }
  }

  console.log('✓ بيانات فترات/تشغيلات الرواتب DEMO 9.A.2.1 جاهزة — /accounts/payroll/periods');
}

// ── تشغيل مباشر عبر tsx (بدون التأثير عند الاستيراد من الاختبارات) ──
const invokedDirectly = /seed-accounts-payroll-periods-demo\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  seedPayrollPeriodsDemo()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
