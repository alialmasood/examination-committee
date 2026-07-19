/**
 * خدمات داخلية للقطة الاحتساب 9.A.2.2 — Persist/Validate فقط.
 * لا Calculate · لا Scope Resolution · لا تغيير حالة Run · لا Public APIs.
 */
import { AccountsHttpError } from './auth';
import { payrollRunLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollRun } from './payroll-runs';
import {
  isPayrollSnapshotHash,
  hashPayrollSnapshot,
} from './payroll-snapshot-hash';
import {
  PAYROLL_SNAPSHOT_ENUMS,
  type PayrollPersonSnapshotJson,
} from './payroll-snapshot-types';
import {
  oneOf,
  optionalPayrollUuid,
  requirePayrollUuid,
  requiredText,
} from './payroll-validation';
import { normalizeMoneyInput, normalizeSignedMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function moneyNonNeg(v: unknown, label: string, fallback = '0'): string {
  if (v == null || v === '') return normalizeMoneyInput(fallback);
  try {
    return normalizeMoneyInput(v);
  } catch {
    throw new AccountsHttpError(`${label} يجب أن يكون رقمًا غير سالب`, 400);
  }
}

function moneySigned(v: unknown, label: string, fallback = '0'): string {
  if (v == null || v === '') return normalizeSignedMoneyInput(fallback);
  try {
    return normalizeSignedMoneyInput(v);
  } catch {
    throw new AccountsHttpError(`${label} غير صالح`, 400);
  }
}

async function assertRunWritable(client: TxClient, runId: string) {
  await acquirePayrollLocks(client, [payrollRunLock(runId)]);
  const run = await loadPayrollRun(client, runId, true);
  if (run.status === 'CANCELLED') {
    throw new AccountsHttpError('لا يمكن كتابة لقطة احتساب لتشغيل ملغى', 409);
  }
  return run;
}

export type InsertRunPersonInput = {
  payroll_run_id: string;
  payroll_person_id: unknown;
  payroll_contract_id?: unknown;
  person_code_snapshot: unknown;
  full_name_snapshot: unknown;
  person_type_snapshot: unknown;
  college_id_snapshot?: unknown;
  department_id_snapshot?: unknown;
  cost_center_id_snapshot?: unknown;
  currency_code?: unknown;
  basic_amount?: unknown;
  gross_amount?: unknown;
  deductions_amount?: unknown;
  employer_contributions_amount?: unknown;
  net_amount?: unknown;
  calculation_status?: unknown;
  warning_count?: unknown;
  error_count?: unknown;
  snapshot_json: PayrollPersonSnapshotJson | Record<string, unknown>;
  snapshot_hash?: unknown;
  superseded?: boolean;
  created_by: string;
};

export async function insertRunPersonSnapshot(
  client: TxClient,
  input: InsertRunPersonInput
): Promise<{ id: string }> {
  const run = await assertRunWritable(client, input.payroll_run_id);
  const personId = requirePayrollUuid(input.payroll_person_id, 'معرّف الشخص');
  const contractId = optionalPayrollUuid(input.payroll_contract_id, 'معرّف العقد');

  const person = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM accounts.payroll_people WHERE id=$1::uuid`,
    [personId]
  );
  if (!person.rows[0]) throw new AccountsHttpError('الشخص غير موجود', 404);

  if (contractId) {
    const c = await txQuery<{ id: string; payroll_person_id: string }>(
      client,
      `SELECT id, payroll_person_id FROM accounts.payroll_contracts WHERE id=$1::uuid`,
      [contractId]
    );
    if (!c.rows[0]) throw new AccountsHttpError('العقد غير موجود', 404);
    if (c.rows[0].payroll_person_id !== personId) {
      throw new AccountsHttpError('العقد لا يعود لنفس الشخص', 400);
    }
  }

  const status = input.calculation_status == null || String(input.calculation_status).trim() === ''
    ? 'PENDING'
    : oneOf(input.calculation_status, PAYROLL_SNAPSHOT_ENUMS.CALCULATION_STATUS, 'حالة احتساب الشخص');

  const currency = String(input.currency_code ?? run.currency_code).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AccountsHttpError('عملة اللقطة غير صالحة', 400);
  if (currency !== run.currency_code) {
    throw new AccountsHttpError('عملة لقطة الشخص يجب أن تطابق عملة التشغيل', 400);
  }

  const snap = input.snapshot_json;
  if (snap == null || typeof snap !== 'object' || Array.isArray(snap)) {
    throw new AccountsHttpError('snapshot_json مطلوب ويجب أن يكون كائنًا', 400);
  }
  const hash =
    input.snapshot_hash == null || String(input.snapshot_hash).trim() === ''
      ? hashPayrollSnapshot(snap)
      : String(input.snapshot_hash).trim();
  if (!isPayrollSnapshotHash(hash)) {
    throw new AccountsHttpError('بصمة اللقطة غير صالحة (SHA-256 hex بطول 64)', 400);
  }

  const warn = Number(input.warning_count ?? 0);
  const err = Number(input.error_count ?? 0);
  if (!Number.isInteger(warn) || warn < 0) throw new AccountsHttpError('عدد التحذيرات غير صالح', 400);
  if (!Number.isInteger(err) || err < 0) throw new AccountsHttpError('عدد الأخطاء غير صالح', 400);

  const r = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.payroll_run_people
       (payroll_run_id, payroll_person_id, payroll_contract_id, payroll_period_id,
        person_code_snapshot, full_name_snapshot, person_type_snapshot,
        college_id_snapshot, department_id_snapshot, cost_center_id_snapshot,
        currency_code, basic_amount, gross_amount, deductions_amount,
        employer_contributions_amount, net_amount, calculation_status,
        warning_count, error_count, snapshot_json, snapshot_hash, superseded,
        created_by, updated_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9::uuid,$10::uuid,
             $11,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17,
             $18,$19,$20::jsonb,$21,$22,$23::uuid,$23::uuid)
     RETURNING id`,
    [
      run.id,
      personId,
      contractId,
      run.payroll_period_id,
      requiredText(input.person_code_snapshot, 40, 'رمز الشخص في اللقطة'),
      requiredText(input.full_name_snapshot, 200, 'اسم الشخص في اللقطة'),
      requiredText(input.person_type_snapshot, 20, 'نوع الشخص في اللقطة'),
      optionalPayrollUuid(input.college_id_snapshot, 'الكلية'),
      optionalPayrollUuid(input.department_id_snapshot, 'القسم'),
      optionalPayrollUuid(input.cost_center_id_snapshot, 'مركز الكلفة'),
      currency,
      moneyNonNeg(input.basic_amount, 'الأساسي'),
      moneyNonNeg(input.gross_amount, 'الإجمالي'),
      moneyNonNeg(input.deductions_amount, 'الاستقطاعات'),
      moneyNonNeg(input.employer_contributions_amount, 'مساهمات جهة العمل'),
      moneySigned(input.net_amount, 'الصافي'),
      status,
      warn,
      err,
      JSON.stringify(snap),
      hash,
      input.superseded === true,
      input.created_by,
    ]
  );
  return r.rows[0];
}

export type InsertRunLineInput = {
  payroll_run_id: string;
  payroll_run_person_id: unknown;
  payroll_component_id: unknown;
  payroll_assignment_id?: unknown;
  payroll_component_assignment_id?: unknown;
  component_code_snapshot: unknown;
  component_name_snapshot: unknown;
  component_type: unknown;
  calculation_method: unknown;
  calculation_base_type?: unknown;
  quantity?: unknown;
  rate?: unknown;
  percentage?: unknown;
  base_amount?: unknown;
  calculated_amount?: unknown;
  manual_override_amount?: unknown;
  quantity_source?: unknown;
  source_effective_from: unknown;
  source_effective_to?: unknown;
  calculation_details_json?: unknown;
  line_source?: unknown;
  sequence?: unknown;
  created_by: string;
};

export async function insertRunLine(
  client: TxClient,
  input: InsertRunLineInput
): Promise<{ id: string }> {
  const run = await assertRunWritable(client, input.payroll_run_id);
  const runPersonId = requirePayrollUuid(input.payroll_run_person_id, 'معرّف شخص التشغيل');
  const componentId = requirePayrollUuid(input.payroll_component_id, 'معرّف المكوّن');

  const rp = await txQuery<{ id: string; payroll_run_id: string }>(
    client,
    `SELECT id, payroll_run_id FROM accounts.payroll_run_people WHERE id=$1::uuid`,
    [runPersonId]
  );
  if (!rp.rows[0]) throw new AccountsHttpError('شخص التشغيل غير موجود في اللقطة', 404);
  if (rp.rows[0].payroll_run_id !== run.id) {
    throw new AccountsHttpError('شخص التشغيل لا يعود لنفس التشغيل', 400);
  }

  const method = requiredText(input.calculation_method, 25, 'طريقة الاحتساب');
  if (method === 'CUSTOM_FORMULA') {
    throw new AccountsHttpError('CUSTOM_FORMULA ممنوع في أسطر اللقطة', 400);
  }

  let qtySource: string | null = null;
  if (input.quantity_source != null && String(input.quantity_source).trim() !== '') {
    qtySource = oneOf(input.quantity_source, PAYROLL_SNAPSHOT_ENUMS.QUANTITY_SOURCE, 'مصدر الكمية');
  }

  const lineSource = input.line_source == null || String(input.line_source).trim() === ''
    ? 'GENERATED'
    : oneOf(input.line_source, PAYROLL_SNAPSHOT_ENUMS.LINE_SOURCE, 'مصدر السطر');

  const from = String(input.source_effective_from ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw new AccountsHttpError('تاريخ بداية المصدر غير صالح', 400);
  }
  let to: string | null = null;
  if (input.source_effective_to != null && String(input.source_effective_to).trim() !== '') {
    to = String(input.source_effective_to).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AccountsHttpError('تاريخ نهاية المصدر غير صالح', 400);
    if (to < from) throw new AccountsHttpError('نهاية المصدر لا تسبق بدايته', 400);
  }

  const seq = input.sequence == null || input.sequence === '' ? 1 : Number(input.sequence);
  if (!Number.isInteger(seq) || seq < 1) throw new AccountsHttpError('تسلسل السطر غير صالح', 400);

  const optMoney = (v: unknown, label: string): string | null => {
    if (v == null || v === '') return null;
    return moneyNonNeg(v, label);
  };

  const r = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.payroll_run_lines
       (payroll_run_id, payroll_run_person_id, payroll_component_id, payroll_assignment_id,
        payroll_component_assignment_id, component_code_snapshot, component_name_snapshot,
        component_type, calculation_method, calculation_base_type, quantity, rate, percentage,
        base_amount, calculated_amount, manual_override_amount, quantity_source,
        source_effective_from, source_effective_to, calculation_details_json, line_source,
        sequence, created_by, updated_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,
             $11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17,
             $18::date,$19::date,$20::jsonb,$21,$22,$23::uuid,$23::uuid)
     RETURNING id`,
    [
      run.id,
      runPersonId,
      componentId,
      optionalPayrollUuid(input.payroll_assignment_id, 'التكليف'),
      optionalPayrollUuid(input.payroll_component_assignment_id, 'إسناد المكوّن'),
      requiredText(input.component_code_snapshot, 40, 'رمز المكوّن في اللقطة'),
      requiredText(input.component_name_snapshot, 200, 'اسم المكوّن في اللقطة'),
      requiredText(input.component_type, 25, 'نوع المكوّن'),
      method,
      input.calculation_base_type == null || String(input.calculation_base_type).trim() === ''
        ? null
        : requiredText(input.calculation_base_type, 25, 'أساس الاحتساب'),
      optMoney(input.quantity, 'الكمية'),
      optMoney(input.rate, 'المعدّل'),
      optMoney(input.percentage, 'النسبة'),
      optMoney(input.base_amount, 'مبلغ الأساس'),
      moneyNonNeg(input.calculated_amount, 'المبلغ المحسوب'),
      optMoney(input.manual_override_amount, 'التجاوز اليدوي'),
      qtySource,
      from,
      to,
      input.calculation_details_json == null
        ? null
        : JSON.stringify(input.calculation_details_json),
      lineSource,
      seq,
      input.created_by,
    ]
  );
  return r.rows[0];
}

export type InsertRunIssueInput = {
  payroll_run_id: string;
  payroll_run_person_id?: unknown;
  severity: unknown;
  issue_code: unknown;
  message_ar: unknown;
  message_en?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  details_json?: unknown;
  created_by?: string | null;
};

export async function insertRunIssue(
  client: TxClient,
  input: InsertRunIssueInput
): Promise<{ id: string }> {
  const run = await assertRunWritable(client, input.payroll_run_id);
  const severity = oneOf(input.severity, PAYROLL_SNAPSHOT_ENUMS.ISSUE_SEVERITY, 'شدة المشكلة');
  const isBlocking = severity === 'ERROR';
  const code = requiredText(input.issue_code, 60, 'رمز المشكلة').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(code)) {
    throw new AccountsHttpError('رمز المشكلة غير صالح', 400);
  }

  const personId = optionalPayrollUuid(input.payroll_run_person_id, 'معرّف شخص التشغيل');
  if (personId) {
    const rp = await txQuery<{ payroll_run_id: string }>(
      client,
      `SELECT payroll_run_id FROM accounts.payroll_run_people WHERE id=$1::uuid`,
      [personId]
    );
    if (!rp.rows[0]) throw new AccountsHttpError('شخص التشغيل غير موجود في اللقطة', 404);
    if (rp.rows[0].payroll_run_id !== run.id) {
      throw new AccountsHttpError('شخص التشغيل لا يعود لنفس التشغيل', 400);
    }
  }

  const r = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.payroll_run_issues
       (payroll_run_id, payroll_run_person_id, severity, issue_code, message_ar, message_en,
        entity_type, entity_id, details_json, is_blocking, created_by)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,$9::jsonb,$10,$11::uuid)
     RETURNING id`,
    [
      run.id,
      personId,
      severity,
      code,
      requiredText(input.message_ar, 2000, 'رسالة المشكلة'),
      input.message_en == null || String(input.message_en).trim() === ''
        ? null
        : String(input.message_en).trim().slice(0, 2000),
      input.entity_type == null || String(input.entity_type).trim() === ''
        ? null
        : String(input.entity_type).trim().slice(0, 40),
      optionalPayrollUuid(input.entity_id, 'كيان المشكلة'),
      input.details_json == null ? null : JSON.stringify(input.details_json),
      isBlocking,
      input.created_by ?? null,
    ]
  );
  return r.rows[0];
}

/** يحذف كل آثار اللقطة لتشغيل داخل Transaction (للاختبارات / Recalculate لاحقًا). لا يغيّر حالة Run. */
export async function clearRunCalculationArtifacts(
  client: TxClient,
  runId: string
): Promise<void> {
  const run = await assertRunWritable(client, runId);
  await txQuery(client, `DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=$1::uuid`, [run.id]);
  await txQuery(client, `DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id=$1::uuid`, [run.id]);
  await txQuery(client, `DELETE FROM accounts.payroll_run_people WHERE payroll_run_id=$1::uuid`, [run.id]);
}

export async function loadRunCalculationArtifacts(client: TxClient, runId: string) {
  const id = requirePayrollUuid(runId, 'معرّف التشغيل');
  const people = await txQuery(client, `SELECT * FROM accounts.payroll_run_people WHERE payroll_run_id=$1::uuid ORDER BY person_code_snapshot`, [id]);
  const lines = await txQuery(client, `SELECT * FROM accounts.payroll_run_lines WHERE payroll_run_id=$1::uuid ORDER BY sequence, id`, [id]);
  const issues = await txQuery(client, `SELECT * FROM accounts.payroll_run_issues WHERE payroll_run_id=$1::uuid ORDER BY created_at, id`, [id]);
  return { people: people.rows, lines: lines.rows, issues: issues.rows };
}

export { ZERO_UUID };
