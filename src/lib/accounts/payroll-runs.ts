/**
 * تشغيلات الرواتب — 9.A.2.1 (Payroll Runs).
 *
 * دورة الحياة في هذه المرحلة: DRAFT → CANCELLED (والإلغاء متاح أيضاً من CALCULATED).
 * لا احتساب/لقطات/أسطر/issues — الحقول الحسابية تبقى صفرية.
 * منع تكرار التشغيل الحيّ المكافئ عبر حارس خدمي تحت قفل الفترة + فهرس REGULAR الجزئي.
 */
import { AccountsHttpError } from './auth';
import { payrollPeriodLock, payrollRunLock } from './accounting-locks';
import { loadPayrollPeriod } from './payroll-periods';
import { acquirePayrollLocks } from './payroll-locks';
import {
  PAYROLL_ENUMS,
  assertPayrollConcurrency,
  dateStr,
  iso,
  nextPayrollNumber,
  oneOf,
  optionalPayrollUuid,
  requirePayrollUuid,
  requiredReason,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollRunRow = {
  id: string;
  run_number: string;
  payroll_period_id: string;
  payroll_calendar_id: string;
  run_type: string;
  scope_type: string;
  scope_ref_id: string | null;
  status: string;
  currency_code: string;
  calculation_date: string | Date;
  revision_number: number;
  root_run_id: string | null;
  supersedes_run_id: string | null;
  superseded_by_run_id: string | null;
  revision_reason: string | null;
  people_count: number;
  gross_total: string;
  deduction_total: string;
  employer_contribution_total: string;
  net_total: string;
  warning_count: number;
  error_count: number;
  snapshot_hash: string | null;
  calculation_request_id: string | null;
  last_calculation_request_id: string | null;
  calculation_attempt_number: number;
  calculated_at: Date | string | null;
  calculated_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  /** 9.B.1 — دورة المراجعة (يزيد عند كل Submit) */
  approval_cycle: number;
  review_snapshot_hash: string | null;
  submitted_for_review_at: Date | string | null;
  submitted_for_review_by: string | null;
  approved_snapshot_hash: string | null;
  approved_at: Date | string | null;
  approved_by: string | null;
  /** 9.C.1 — ترحيل */
  posted_at: Date | string | null;
  posted_by: string | null;
  posting_journal_entry_id: string | null;
  posted_snapshot_hash: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollRun(row: PayrollRunRow) {
  return {
    ...row,
    calculation_date: dateStr(row.calculation_date)!,
    calculated_at: iso(row.calculated_at),
    cancelled_at: iso(row.cancelled_at),
    submitted_for_review_at: iso(row.submitted_for_review_at),
    approved_at: iso(row.approved_at),
    posted_at: iso(row.posted_at),
    approval_cycle: Number(row.approval_cycle ?? 0),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollRun(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollRunRow> {
  const runId = requirePayrollUuid(id, 'معرّف التشغيل');
  const r = await txQuery<PayrollRunRow>(
    client,
    `SELECT * FROM accounts.payroll_runs WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [runId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('تشغيل الرواتب غير موجود', 404);
  return r.rows[0];
}

/** يتحقق من شكل النطاق ومن وجود المرجع (بلا الاعتماد على person_type كنطاق). */
async function resolveScope(
  client: TxClient,
  scopeType: string,
  scopeRefRaw: unknown
): Promise<{ scope_type: string; scope_ref_id: string | null }> {
  const scope = oneOf(scopeType, PAYROLL_ENUMS.SCOPE_TYPE, 'نوع النطاق');
  const ref = optionalPayrollUuid(scopeRefRaw, 'مرجع النطاق');
  if (scope === 'ALL' || scope === 'PERSON_LIST') {
    if (ref) throw new AccountsHttpError('هذا النطاق لا يقبل مرجعاً مباشراً', 400);
    return { scope_type: scope, scope_ref_id: null };
  }
  if (!ref) throw new AccountsHttpError('النطاق يتطلب مرجعاً (قسم/كلية/مركز كلفة)', 400);
  if (scope === 'COST_CENTER') {
    const cc = await txQuery<{ id: string; is_active: boolean }>(
      client,
      `SELECT id, is_active FROM accounts.cost_centers WHERE id=$1::uuid`,
      [ref]
    );
    if (!cc.rows[0]) throw new AccountsHttpError('مركز الكلفة المرجعي غير موجود', 404);
  } else if (scope === 'COLLEGE') {
    // نطاق COLLEGE = كلية حقيقية (ليس قسماً)
    const col = await txQuery<{ id: string }>(
      client,
      `SELECT id FROM student_affairs.colleges WHERE id=$1::uuid`,
      [ref]
    );
    if (!col.rows[0]) throw new AccountsHttpError('الكلية المرجعية غير موجودة', 404);
  } else {
    // DEPARTMENT
    const dep = await txQuery<{ id: string }>(
      client,
      `SELECT id FROM student_affairs.departments WHERE id=$1::uuid`,
      [ref]
    );
    if (!dep.rows[0]) throw new AccountsHttpError('القسم المرجعي غير موجود', 404);
  }
  return { scope_type: scope, scope_ref_id: ref };
}

const ACTIVE_RUN_STATUSES = [
  'DRAFT',
  'CALCULATING',
  'CALCULATED',
  'UNDER_REVIEW',
  'APPROVED',
];
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * يمنع تكرار تشغيل حيّ مكافئ لنفس (الفترة/النوع/النطاق/رقم الإصدار).
 * يُستدعى تحت قفل الفترة → لا سباق. فهرس REGULAR الجزئي حارس إضافي ضد السباق.
 */
async function assertNoDuplicateActiveRun(
  client: TxClient,
  p: {
    periodId: string;
    runType: string;
    scopeType: string;
    scopeRefId: string | null;
    revisionNumber: number;
    exceptId: string | null;
  }
): Promise<void> {
  const r = await txQuery<{ id: string; run_number: string }>(
    client,
    `SELECT id, run_number FROM accounts.payroll_runs
     WHERE payroll_period_id=$1::uuid
       AND run_type=$2
       AND scope_type=$3
       AND COALESCE(scope_ref_id, $4::uuid) = COALESCE($5::uuid, $4::uuid)
       AND revision_number=$6
       AND status = ANY($7::text[])
       AND ($8::uuid IS NULL OR id<>$8::uuid)
     LIMIT 1`,
    [p.periodId, p.runType, p.scopeType, ZERO_UUID, p.scopeRefId, p.revisionNumber, ACTIVE_RUN_STATUSES, p.exceptId]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError(
      `يوجد تشغيل حيّ مكافئ لنفس الفترة والنوع والنطاق (${r.rows[0].run_number})`,
      409
    );
  }
}

export async function createPayrollRun(
  client: TxClient,
  input: {
    payroll_period_id: unknown;
    run_type?: unknown;
    scope_type?: unknown;
    scope_ref_id?: unknown;
    created_by: string;
  }
): Promise<PayrollRunRow> {
  const periodId = optionalPayrollUuid(input.payroll_period_id, 'فترة الرواتب');
  if (!periodId) throw new AccountsHttpError('فترة الرواتب مطلوبة', 400);

  // قفل الفترة لتسلسل فحص التكرار + الإدراج
  await acquirePayrollLocks(client, [payrollPeriodLock(periodId)]);
  const period = await loadPayrollPeriod(client, periodId);
  if (period.status !== 'OPEN') {
    throw new AccountsHttpError('لا يمكن إنشاء تشغيل إلا ضمن فترة مفتوحة (OPEN)', 409);
  }

  const runType = input.run_type == null || String(input.run_type).trim() === ''
    ? 'REGULAR'
    : oneOf(input.run_type, PAYROLL_ENUMS.RUN_TYPE, 'نوع التشغيل');
  const scope = await resolveScope(
    client,
    input.scope_type == null || String(input.scope_type).trim() === '' ? 'ALL' : String(input.scope_type),
    input.scope_ref_id
  );

  await assertNoDuplicateActiveRun(client, {
    periodId,
    runType,
    scopeType: scope.scope_type,
    scopeRefId: scope.scope_ref_id,
    revisionNumber: 1,
    exceptId: null,
  });

  const number = await nextPayrollNumber(client, 'PAYROLL_RUN', 'PYR');

  try {
    const r = await txQuery<PayrollRunRow>(
      client,
      `INSERT INTO accounts.payroll_runs
         (run_number, payroll_period_id, payroll_calendar_id, run_type, scope_type, scope_ref_id,
          status, currency_code, calculation_date, revision_number, created_by, updated_by)
       VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6::uuid,'DRAFT',$7,$8::date,1,$9::uuid,$9::uuid)
       RETURNING *`,
      [
        number,
        periodId,
        period.payroll_calendar_id,
        runType,
        scope.scope_type,
        scope.scope_ref_id,
        period.currency_code,
        dateStr(period.calculation_date)!,
        input.created_by,
      ]
    );
    return r.rows[0];
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err?.code === '23505' && String(err.constraint ?? '').includes('uq_payroll_runs_one_live')) {
      throw new AccountsHttpError(
        'يوجد تشغيل حيّ مكافئ لنفس الفترة والنوع والنطاق',
        409
      );
    }
    throw e;
  }
}

async function countScopeMembers(client: TxClient, runId: string): Promise<number> {
  const r = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`,
    [runId]
  );
  return r.rows[0]?.n ?? 0;
}

export async function updatePayrollRun(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    run_type?: unknown;
    scope_type?: unknown;
    scope_ref_id?: unknown;
  }
): Promise<PayrollRunRow> {
  const existing = await loadPayrollRun(client, p.id);
  await acquirePayrollLocks(client, [payrollPeriodLock(existing.payroll_period_id), payrollRunLock(p.id)]);
  const row = await loadPayrollRun(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'تشغيل الرواتب');
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('لا يمكن تعديل تشغيل إلا وهو مسودة (DRAFT)', 409);
  }

  const runType = p.run_type === undefined ? row.run_type : oneOf(p.run_type, PAYROLL_ENUMS.RUN_TYPE, 'نوع التشغيل');
  const scope = p.scope_type === undefined && p.scope_ref_id === undefined
    ? { scope_type: row.scope_type, scope_ref_id: row.scope_ref_id }
    : await resolveScope(
        client,
        p.scope_type === undefined ? row.scope_type : String(p.scope_type),
        p.scope_ref_id === undefined ? row.scope_ref_id : p.scope_ref_id
      );

  // تغيير النطاق بعيداً عن PERSON_LIST مع وجود أعضاء → يُرفض حتى لا تبقى أعضاء يتيمة دلالياً
  if (row.scope_type === 'PERSON_LIST' && scope.scope_type !== 'PERSON_LIST') {
    const members = await countScopeMembers(client, p.id);
    if (members > 0) {
      throw new AccountsHttpError('أزل أعضاء النطاق قبل تغيير نوع النطاق من قائمة الأشخاص', 409);
    }
  }

  await assertNoDuplicateActiveRun(client, {
    periodId: row.payroll_period_id,
    runType,
    scopeType: scope.scope_type,
    scopeRefId: scope.scope_ref_id,
    revisionNumber: row.revision_number,
    exceptId: row.id,
  });

  const r = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET
       run_type=$2, scope_type=$3, scope_ref_id=$4::uuid,
       updated_by=$5::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, runType, scope.scope_type, scope.scope_ref_id, p.userId]
  );
  return r.rows[0];
}

export async function cancelPayrollRun(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason: unknown }
): Promise<PayrollRunRow> {
  const reason = requiredReason(p.reason, 'سبب إلغاء التشغيل');
  const existing = await loadPayrollRun(client, p.id);
  await acquirePayrollLocks(client, [payrollPeriodLock(existing.payroll_period_id), payrollRunLock(p.id)]);
  const row = await loadPayrollRun(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'تشغيل الرواتب');
  if (row.status === 'CANCELLED') {
    throw new AccountsHttpError('التشغيل ملغى مسبقاً', 409);
  }
  if (row.status === 'CALCULATING') {
    throw new AccountsHttpError('لا يمكن الإلغاء أثناء الاحتساب', 409);
  }
  if (row.status === 'UNDER_REVIEW') {
    throw new AccountsHttpError('لا يمكن إلغاء تشغيل قيد المراجعة', 409);
  }
  if (row.status === 'APPROVED') {
    throw new AccountsHttpError('لا يمكن إلغاء تشغيل معتمد', 409);
  }
  if (row.status === 'POSTED') {
    throw new AccountsHttpError('لا يمكن إلغاء تشغيل مرحّل محاسبياً', 409);
  }
  if (row.status !== 'DRAFT' && row.status !== 'CALCULATED') {
    throw new AccountsHttpError('لا يمكن إلغاء التشغيل في حالته الحالية', 409);
  }
  // H4: تحرير حارس الشخص الحيّ قبل إلغاء التشغيل — لا حذف للقطات
  await txQuery(
    client,
    `UPDATE accounts.payroll_run_people
     SET superseded = TRUE, updated_by = $2::uuid, updated_at = NOW(), version = version + 1
     WHERE payroll_run_id = $1::uuid AND superseded = FALSE`,
    [row.id, p.userId]
  );
  const r = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2::uuid,
       cancellation_reason=$3, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId, reason]
  );
  return r.rows[0];
}

export async function listPayrollRuns(
  client: TxClient,
  p: {
    payroll_period_id?: string;
    status?: string;
    run_type?: string;
    scope_type?: string;
    q?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollRunRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const period = (p.payroll_period_id ?? '').trim();
  const status = (p.status ?? '').trim().toUpperCase();
  const runType = (p.run_type ?? '').trim().toUpperCase();
  const scopeType = (p.scope_type ?? '').trim().toUpperCase();
  const q = (p.q ?? '').trim();
  const values: unknown[] = [period, status, runType, scopeType, q];
  const where = `WHERE ($1='' OR payroll_period_id=$1::uuid)
     AND ($2='' OR status=$2)
     AND ($3='' OR run_type=$3)
     AND ($4='' OR scope_type=$4)
     AND ($5='' OR run_number ILIKE '%'||$5||'%')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_runs ${where}`,
    values
  );
  const r = await txQuery<PayrollRunRow>(
    client,
    `SELECT * FROM accounts.payroll_runs ${where} ORDER BY created_at DESC, run_number DESC LIMIT $6 OFFSET $7`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
