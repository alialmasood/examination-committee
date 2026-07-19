/**
 * تحقق فترات/تشغيلات الرواتب 9.A.2.1 — سلامة الطبقة التنظيمية (بلا احتساب).
 * منطق التحقق فقط — يشغّله src/scripts/verify-payroll-periods-runs.ts.
 *
 * mismatch = فشل دائماً. strict يرقّي warnings/unexplained إلى فشل أيضاً.
 *
 * الفحوصات — Periods:
 *  - تداخل فترات لنفس التقويم ضمن الحالات المانعة (OPEN/PROCESSING/CLOSED).
 *  - تواريخ غير صالحة (end<start، calc<start، due<end).
 *  - version < 1.
 *  - عملة الفترة تخالف عملة التقويم.
 *  - سنة مالية مفقودة/غير موجودة، فترة مالية لا تعود لنفس السنة.
 *  - تكرار period_code.
 *  - مراجع تقويم/سنة مالية يتيمة.
 *  - CLOSED مع تشغيل DRAFT أو CALCULATING.
 *  - CANCELLED مع تشغيل CALCULATING.
 *
 * الفحوصات — Runs:
 *  - عدم تطابق التقويم/العملة/تاريخ الاحتساب مع الفترة.
 *  - حالة غير صالحة، version/revision/attempt غير صالح.
 *  - تكرار run_number.
 *  - روابط إصدار ذاتية (supersedes/superseded = نفسه).
 *  - سلسلة إصدار غير متطابقة (supersedes لفترة/نوع/نطاق مختلف).
 *  - تشغيلات حيّة مكافئة مكرّرة (نفس الفترة/النوع/النطاق/الإصدار وحالة فعّالة).
 *  - CANCELLED بلا سبب إلغاء.
 *  - PERSON_LIST بلا أعضاء (تحذير)، وغير PERSON_LIST لديه أعضاء (فشل).
 *  - scope_ref_id غير متوافق مع scope_type.
 *  - أعضاء نطاق يتيمون (تشغيل/شخص مفقود).
 *  - تسلسلات PAYROLL_PERIOD/PAYROLL_RUN غير موجودة (تحذير).
 *
 * strict:
 *  - أكثر من OPEN غير متداخل لنفس التقويم (يترقّى إلى فشل).
 *  - حقول احتساب غير صفرية في DRAFT قبل تفعيل المحرك (unexplained).
 *  - أي calculation_request_id/attempt>0 قبل تفعيل المحرك (unexplained).
 */
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollPeriodsRunsVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: PayrollVerifyIssue[];
  warnings: PayrollVerifyIssue[];
  unexplained: PayrollVerifyIssue[];
  summary: {
    periods: number;
    periods_open: number;
    runs: number;
    runs_active: number;
    scope_members: number;
  };
};

export type VerifyOptions = { strict?: boolean };

const ACTIVE_RUN_STATUSES = ['DRAFT', 'CALCULATING', 'CALCULATED'];
const OVERLAP_PERIOD_STATUSES = ['OPEN', 'PROCESSING', 'CLOSED'];
const PERIOD_STATUSES = ['OPEN', 'PROCESSING', 'CLOSED', 'CANCELLED'];
const RUN_STATUSES = ['DRAFT', 'CALCULATING', 'CALCULATED', 'CANCELLED'];
const RUN_TYPES = ['REGULAR', 'CORRECTION', 'SUPPLEMENTAL', 'TERMINATION', 'MANUAL'];
const SCOPE_TYPES = ['ALL', 'COLLEGE', 'DEPARTMENT', 'COST_CENTER', 'PERSON_LIST'];

export async function verifyPayrollPeriodsRuns(
  client: TxClient,
  options: VerifyOptions = {}
): Promise<PayrollPeriodsRunsVerifyResult> {
  const strict = options.strict === true;
  const mismatches: PayrollVerifyIssue[] = [];
  const warnings: PayrollVerifyIssue[] = [];
  const unexplained: PayrollVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) => mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) => warnings.push({ kind, detail, entity_id });
  const unexp = (kind: string, detail: string, entity_id?: string) => unexplained.push({ kind, detail, entity_id });

  // ── مراجع التقويمات والعملات ──────────────────────────────────────
  const calendars = await txQuery<{ id: string; currency_code: string }>(
    client,
    `SELECT id, currency_code FROM accounts.payroll_calendars`
  );
  const calById = new Map(calendars.rows.map((c) => [c.id, c] as const));

  const fiscalYears = await txQuery<{ id: string }>(client, `SELECT id FROM accounts.fiscal_years`);
  const fyIds = new Set(fiscalYears.rows.map((f) => f.id));
  const fiscalPeriods = await txQuery<{ id: string; fiscal_year_id: string }>(
    client,
    `SELECT id, fiscal_year_id FROM accounts.fiscal_periods`
  );
  const fpYear = new Map(fiscalPeriods.rows.map((p) => [p.id, p.fiscal_year_id] as const));

  // ── الفترات ───────────────────────────────────────────────────────
  const periods = await txQuery<{
    id: string; period_code: string; payroll_calendar_id: string; status: string;
    start_date: string; end_date: string; calculation_date: string; payment_due_date: string | null;
    currency_code: string; fiscal_year_id: string; fiscal_period_id: string | null; version: number;
  }>(
    client,
    `SELECT id, period_code, payroll_calendar_id, status,
            start_date::text AS start_date, end_date::text AS end_date,
            calculation_date::text AS calculation_date, payment_due_date::text AS payment_due_date,
            currency_code, fiscal_year_id, fiscal_period_id, version
     FROM accounts.payroll_periods`
  );
  let periodsOpen = 0;
  for (const p of periods.rows) {
    if (p.status === 'OPEN') periodsOpen += 1;
    if (!PERIOD_STATUSES.includes(p.status)) fail('period_status_invalid', `حالة فترة غير صالحة (${p.status})`, p.id);
    if (p.end_date < p.start_date) fail('period_dates', 'نهاية الفترة قبل بدايتها', p.id);
    if (p.calculation_date < p.start_date) fail('period_calc_date', 'تاريخ الاحتساب قبل بداية الفترة', p.id);
    if (p.payment_due_date != null && p.payment_due_date < p.end_date) fail('period_due_date', 'تاريخ الاستحقاق قبل نهاية الفترة', p.id);
    if (p.version < 1) fail('period_version', `version غير صالح (${p.version})`, p.id);
    const cal = calById.get(p.payroll_calendar_id);
    if (!cal) fail('period_calendar_orphan', 'فترة مرتبطة بتقويم غير موجود', p.id);
    else if (cal.currency_code !== p.currency_code) fail('period_currency_mismatch', `عملة الفترة (${p.currency_code}) تخالف عملة التقويم (${cal.currency_code})`, p.id);
    if (!p.fiscal_year_id || !fyIds.has(p.fiscal_year_id)) fail('period_fiscal_year_orphan', 'سنة مالية مفقودة/غير موجودة', p.id);
    if (p.fiscal_period_id) {
      if (!fpYear.has(p.fiscal_period_id)) fail('period_fiscal_period_orphan', 'فترة مالية غير موجودة', p.id);
      else if (fpYear.get(p.fiscal_period_id) !== p.fiscal_year_id) fail('period_fiscal_period_mismatch', 'الفترة المالية لا تعود لنفس السنة', p.id);
    }
  }

  // تكرار period_code
  const dupPeriodCode = await txQuery<{ v: string; n: number }>(
    client,
    `SELECT period_code AS v, COUNT(*)::int n FROM accounts.payroll_periods GROUP BY period_code HAVING COUNT(*)>1`
  );
  for (const row of dupPeriodCode.rows) fail('period_code_dup', `period_code مكرر (${row.v}) بعدد ${row.n}`);

  // تداخل الفترات لنفس التقويم ضمن الحالات المانعة
  const overlap = await txQuery<{ a: string; b: string; code_a: string; code_b: string }>(
    client,
    `SELECT p1.id AS a, p2.id AS b, p1.period_code AS code_a, p2.period_code AS code_b
     FROM accounts.payroll_periods p1
     JOIN accounts.payroll_periods p2
       ON p1.id < p2.id
      AND p1.payroll_calendar_id = p2.payroll_calendar_id
      AND p1.status = ANY($1::text[]) AND p2.status = ANY($1::text[])
      AND daterange(p1.start_date, p1.end_date, '[]') && daterange(p2.start_date, p2.end_date, '[]')`,
    [OVERLAP_PERIOD_STATUSES]
  );
  for (const row of overlap.rows) fail('period_overlap', `تداخل فترتين لنفس التقويم (${row.code_a} ↔ ${row.code_b})`);

  // ── الفترات مقابل حالات التشغيلات ─────────────────────────────────
  const runsByPeriodStatus = await txQuery<{ payroll_period_id: string; period_status: string; run_status: string; n: number }>(
    client,
    `SELECT r.payroll_period_id, p.status AS period_status, r.status AS run_status, COUNT(*)::int n
     FROM accounts.payroll_runs r JOIN accounts.payroll_periods p ON p.id = r.payroll_period_id
     GROUP BY r.payroll_period_id, p.status, r.status`
  );
  for (const row of runsByPeriodStatus.rows) {
    if (row.period_status === 'CLOSED' && (row.run_status === 'DRAFT' || row.run_status === 'CALCULATING')) {
      fail('closed_period_active_run', `فترة مغلقة بها تشغيل ${row.run_status}`, row.payroll_period_id);
    }
    if (row.period_status === 'CANCELLED' && row.run_status === 'CALCULATING') {
      fail('cancelled_period_calculating_run', 'فترة ملغاة بها تشغيل قيد الاحتساب', row.payroll_period_id);
    }
  }

  // strict: أكثر من OPEN غير متداخل لنفس التقويم
  if (strict) {
    const multiOpen = await txQuery<{ payroll_calendar_id: string; n: number }>(
      client,
      `SELECT payroll_calendar_id, COUNT(*)::int n FROM accounts.payroll_periods
       WHERE status='OPEN' GROUP BY payroll_calendar_id HAVING COUNT(*)>1`
    );
    for (const row of multiOpen.rows) warn('multiple_open_periods', `أكثر من فترة OPEN لنفس التقويم (${row.n})`, row.payroll_calendar_id);
  }

  // ── التشغيلات ─────────────────────────────────────────────────────
  const periodById = new Map(periods.rows.map((p) => [p.id, p] as const));
  const runs = await txQuery<{
    id: string; run_number: string; payroll_period_id: string; payroll_calendar_id: string;
    run_type: string; scope_type: string; scope_ref_id: string | null; status: string;
    currency_code: string; calculation_date: string; revision_number: number;
    root_run_id: string | null; supersedes_run_id: string | null; superseded_by_run_id: string | null;
    people_count: number; gross_total: string; deduction_total: string; employer_contribution_total: string;
    net_total: string; warning_count: number; error_count: number; snapshot_hash: string | null;
    calculation_request_id: string | null; last_calculation_request_id: string | null; calculation_attempt_number: number;
    cancellation_reason: string | null; version: number;
  }>(
    client,
    `SELECT id, run_number, payroll_period_id, payroll_calendar_id, run_type, scope_type, scope_ref_id, status,
            currency_code, calculation_date::text AS calculation_date, revision_number,
            root_run_id, supersedes_run_id, superseded_by_run_id,
            people_count, gross_total, deduction_total, employer_contribution_total, net_total,
            warning_count, error_count, snapshot_hash, calculation_request_id, last_calculation_request_id,
            calculation_attempt_number, cancellation_reason, version
     FROM accounts.payroll_runs`
  );
  const runById = new Map(runs.rows.map((r) => [r.id, r] as const));
  let runsActive = 0;
  for (const r of runs.rows) {
    if (ACTIVE_RUN_STATUSES.includes(r.status)) runsActive += 1;
    if (!RUN_STATUSES.includes(r.status)) fail('run_status_invalid', `حالة تشغيل غير صالحة (${r.status})`, r.id);
    if (!RUN_TYPES.includes(r.run_type)) fail('run_type_invalid', `نوع تشغيل غير صالح (${r.run_type})`, r.id);
    if (!SCOPE_TYPES.includes(r.scope_type)) fail('run_scope_invalid', `نطاق تشغيل غير صالح (${r.scope_type})`, r.id);
    if (r.version < 1) fail('run_version', `version غير صالح (${r.version})`, r.id);
    if (r.revision_number < 1) fail('run_revision', `revision_number غير صالح (${r.revision_number})`, r.id);
    if (r.calculation_attempt_number < 0) fail('run_attempt', `calculation_attempt_number غير صالح (${r.calculation_attempt_number})`, r.id);

    const period = periodById.get(r.payroll_period_id);
    if (!period) fail('run_period_orphan', 'تشغيل مرتبط بفترة غير موجودة', r.id);
    else {
      if (r.payroll_calendar_id !== period.payroll_calendar_id) fail('run_calendar_mismatch', 'تقويم التشغيل يخالف تقويم الفترة', r.id);
      if (r.currency_code !== period.currency_code) fail('run_currency_mismatch', 'عملة التشغيل تخالف عملة الفترة', r.id);
      if (r.calculation_date !== period.calculation_date) fail('run_calc_date_mismatch', 'تاريخ احتساب التشغيل يخالف تاريخ الفترة', r.id);
    }

    // شكل النطاق
    if ((r.scope_type === 'ALL' || r.scope_type === 'PERSON_LIST') && r.scope_ref_id) {
      fail('run_scope_ref_shape', `النطاق ${r.scope_type} يجب ألا يملك مرجعاً`, r.id);
    }
    if (['COLLEGE', 'DEPARTMENT', 'COST_CENTER'].includes(r.scope_type) && !r.scope_ref_id) {
      fail('run_scope_ref_shape', `النطاق ${r.scope_type} يتطلب مرجعاً`, r.id);
    }

    // روابط الإصدار الذاتية
    if (r.supersedes_run_id === r.id) fail('run_supersedes_self', 'supersedes_run_id يشير إلى نفسه', r.id);
    if (r.superseded_by_run_id === r.id) fail('run_superseded_self', 'superseded_by_run_id يشير إلى نفسه', r.id);
    // سلسلة الإصدار (عند الاستخدام المستقبلي)
    if (r.supersedes_run_id) {
      const prev = runById.get(r.supersedes_run_id);
      if (!prev) fail('run_supersedes_orphan', 'supersedes_run_id يشير إلى تشغيل غير موجود', r.id);
      else if (period && (prev.payroll_period_id !== r.payroll_period_id || prev.run_type !== r.run_type || prev.scope_type !== r.scope_type)) {
        fail('run_revision_chain_mismatch', 'سلسلة الإصدار لا تعود لنفس الفترة/النوع/النطاق', r.id);
      }
    }

    // CANCELLED بلا سبب
    if (r.status === 'CANCELLED' && !(r.cancellation_reason ?? '').trim()) {
      fail('run_cancel_no_reason', 'تشغيل ملغى بلا سبب إلغاء', r.id);
    }

    // strict: حقول احتساب غير صفرية قبل تفعيل المحرك
    if (strict && r.status === 'DRAFT') {
      const nonZero =
        Number(r.people_count) !== 0 || Number(r.gross_total) !== 0 || Number(r.deduction_total) !== 0 ||
        Number(r.employer_contribution_total) !== 0 || Number(r.net_total) !== 0 ||
        Number(r.warning_count) !== 0 || Number(r.error_count) !== 0 || r.snapshot_hash != null;
      if (nonZero) unexp('run_nonzero_calc_fields', 'حقول احتساب غير صفرية في DRAFT قبل تفعيل المحرك', r.id);
      if (r.calculation_request_id != null || r.last_calculation_request_id != null || Number(r.calculation_attempt_number) > 0) {
        unexp('run_calc_request_before_engine', 'وجود معرّف طلب احتساب/محاولات قبل تفعيل المحرك', r.id);
      }
    }
  }

  // تكرار run_number
  const dupRunNumber = await txQuery<{ v: string; n: number }>(
    client,
    `SELECT run_number AS v, COUNT(*)::int n FROM accounts.payroll_runs GROUP BY run_number HAVING COUNT(*)>1`
  );
  for (const row of dupRunNumber.rows) fail('run_number_dup', `run_number مكرر (${row.v}) بعدد ${row.n}`);

  // تشغيلات حيّة مكافئة مكرّرة (نفس الفترة/النوع/النطاق/الإصدار وحالة فعّالة)
  const dupActive = await txQuery<{ payroll_period_id: string; run_type: string; scope_type: string; scope_ref_id: string | null; revision_number: number; n: number }>(
    client,
    `SELECT payroll_period_id, run_type, scope_type, scope_ref_id, revision_number, COUNT(*)::int n
     FROM accounts.payroll_runs
     WHERE status = ANY($1::text[])
     GROUP BY payroll_period_id, run_type, scope_type, scope_ref_id, revision_number
     HAVING COUNT(*) > 1`,
    [ACTIVE_RUN_STATUSES]
  );
  for (const row of dupActive.rows) {
    // للـPERSON_LIST قد تختلف قوائم الأعضاء؛ نبلّغ كتحذير بدل فشل قاطع
    if (row.scope_type === 'PERSON_LIST') warn('run_duplicate_active_person_list', `أكثر من تشغيل حيّ PERSON_LIST بنفس التوقيع (${row.n}) — راجع الأعضاء`, row.payroll_period_id);
    else fail('run_duplicate_active', `تشغيلات حيّة مكافئة مكرّرة (${row.run_type}/${row.scope_type}) بعدد ${row.n}`, row.payroll_period_id);
  }

  // ── أعضاء النطاق ──────────────────────────────────────────────────
  const members = await txQuery<{ id: string; payroll_run_id: string; payroll_person_id: string }>(
    client,
    `SELECT id, payroll_run_id, payroll_person_id FROM accounts.payroll_run_scope_members`
  );
  const people = await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_people`);
  const personIds = new Set(people.rows.map((p) => p.id));
  const memberCountByRun = new Map<string, number>();
  for (const m of members.rows) {
    memberCountByRun.set(m.payroll_run_id, (memberCountByRun.get(m.payroll_run_id) ?? 0) + 1);
    const run = runById.get(m.payroll_run_id);
    if (!run) fail('scope_member_run_orphan', 'عضو نطاق مرتبط بتشغيل غير موجود', m.id);
    else if (run.scope_type !== 'PERSON_LIST') fail('scope_member_non_person_list', 'عضو نطاق في تشغيل ليس نطاقه PERSON_LIST', m.id);
    if (!personIds.has(m.payroll_person_id)) fail('scope_member_person_orphan', 'عضو نطاق مرتبط بشخص غير موجود', m.id);
  }
  // PERSON_LIST بلا أعضاء (تحذير)
  for (const r of runs.rows) {
    if (r.scope_type === 'PERSON_LIST' && ACTIVE_RUN_STATUSES.includes(r.status) && !(memberCountByRun.get(r.id) ?? 0)) {
      warn('person_list_no_members', `تشغيل PERSON_LIST بلا أعضاء (${r.run_number})`, r.id);
    }
  }

  // ── تسلسلات المستندات ─────────────────────────────────────────────
  const seqTypes = await txQuery<{ document_type: string }>(
    client,
    `SELECT DISTINCT document_type FROM accounts.document_sequences
     WHERE document_type IN ('PAYROLL_PERIOD','PAYROLL_RUN')`
  );
  const presentSeq = new Set(seqTypes.rows.map((s) => s.document_type));
  for (const t of ['PAYROLL_PERIOD', 'PAYROLL_RUN']) {
    if (!presentSeq.has(t)) warn('sequence_missing', `تسلسل ${t} غير مُنشأ بعد (يُنشأ عند أول ترقيم)`);
  }

  const summary = {
    periods: periods.rows.length,
    periods_open: periodsOpen,
    runs: runs.rows.length,
    runs_active: runsActive,
    scope_members: members.rows.length,
  };

  const ok = mismatches.length === 0 && (!strict || (warnings.length === 0 && unexplained.length === 0));
  return { ok, strict, mismatches, warnings, unexplained, summary };
}
