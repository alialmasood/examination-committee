/**
 * نواة إعادة احتساب تشغيل الرواتب 9.A.2.4.1
 *
 * CALCULATED → CALCULATING → مسح آثار → إعادة بناء → CALCULATED داخل Tx واحدة.
 * بلا Public API · بلا UI · بلا Migration 097.
 *
 * ملاحظة Idempotency: يُفحص replay/conflict بعد القفل وقبل assertPayrollConcurrency
 * لأن بصمة الحمولة تتضمن expected_version/updated_at الأصليين لإعادة المحاولة بنفس الجسم.
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import { payrollPeriodLock, payrollRunLock } from './accounting-locks';
import { isSupportedPayrollCurrency } from './payroll-calculation-formulas';
import {
  rebuildPayrollRunArtifactsWhileCalculating,
  type CalculatePayrollRunResult,
} from './payroll-calculation-engine';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPeriod } from './payroll-periods';
import {
  clearRunCalculationArtifacts,
  loadRunCalculationArtifacts,
} from './payroll-run-snapshots';
import {
  loadPayrollRun,
  serializePayrollRun,
  type PayrollRunRow,
} from './payroll-runs';
import { countPayrollRunScopeMembers } from './payroll-scope-resolver';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { hitPayrollRecalcFailpoint } from './payroll-recalculate-failpoints';
import {
  buildRecalculateRequestKeyHash,
  buildRecalculateRequestPayloadHash,
  maskRecalculateRequestKey,
  normalizeRecalculateIdempotencyKey,
  normalizeRecalculateReason,
  requestKeyHashToRequestUuid,
} from './payroll-recalculate-idempotency';
import {
  assertPayrollConcurrency,
  dateStr,
  iso,
  requirePayrollUuid,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type RecalculatePreviousSummary = {
  snapshot_hash: string;
  people_count: number;
  error_count: number;
  warning_count: number;
  gross_total: string;
  deduction_total: string;
  employer_contribution_total: string;
  net_total: string;
  calculated_at: string | null;
  last_calculation_request_id: string | null;
};

export type RecalculatePayrollRunResult = CalculatePayrollRunResult & {
  previous_summary: RecalculatePreviousSummary;
  fingerprints: {
    request_key_hash: string;
    request_payload_hash: string;
    request_key_masked: string;
    calculation_request_id: string;
  };
  source_action: 'RECALCULATE';
};

type AuditRecalcRow = {
  id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: Date | string;
};

function moneyStr(v: unknown): string {
  return String(v ?? '0');
}

function capturePreviousSummary(run: PayrollRunRow): RecalculatePreviousSummary {
  const hash = run.snapshot_hash == null ? '' : String(run.snapshot_hash).trim();
  if (!isPayrollSnapshotHash(hash)) {
    throw new AccountsHttpError(
      'لقطة التشغيل الحالية بلا بصمة صالحة — لا يمكن إعادة الاحتساب بأمان',
      409
    );
  }
  return {
    snapshot_hash: hash,
    people_count: Number(run.people_count),
    error_count: Number(run.error_count),
    warning_count: Number(run.warning_count),
    gross_total: moneyStr(run.gross_total),
    deduction_total: moneyStr(run.deduction_total),
    employer_contribution_total: moneyStr(run.employer_contribution_total),
    net_total: moneyStr(run.net_total),
    calculated_at: iso(run.calculated_at),
    last_calculation_request_id: run.last_calculation_request_id
      ? String(run.last_calculation_request_id)
      : null,
  };
}

async function buildRecalcResult(
  client: TxClient,
  run: PayrollRunRow,
  previous: RecalculatePreviousSummary,
  fingerprints: RecalculatePayrollRunResult['fingerprints'],
  idempotentReplay: boolean
): Promise<RecalculatePayrollRunResult> {
  const artifacts = await loadRunCalculationArtifacts(client, run.id);
  let calculated = 0;
  let errorPeople = 0;
  let excluded = 0;
  for (const p of artifacts.people as Array<{ calculation_status: string }>) {
    if (p.calculation_status === 'CALCULATED') calculated += 1;
    else if (p.calculation_status === 'ERROR') errorPeople += 1;
    else if (p.calculation_status === 'EXCLUDED') excluded += 1;
  }
  let blocking = 0;
  let warnings = 0;
  for (const i of artifacts.issues as Array<{ severity: string }>) {
    if (i.severity === 'ERROR') blocking += 1;
    else warnings += 1;
  }
  return {
    run: serializePayrollRun(run),
    summary: {
      people_count: Number(run.people_count),
      calculated_people: calculated,
      error_people: errorPeople,
      excluded_people: excluded,
      warning_count: Number(run.warning_count),
      error_count: Number(run.error_count),
      gross_total: String(run.gross_total),
      deduction_total: String(run.deduction_total),
      employer_contribution_total: String(run.employer_contribution_total),
      net_total: String(run.net_total),
    },
    issues: { blocking, warnings },
    idempotent_replay: idempotentReplay,
    previous_summary: previous,
    fingerprints,
    source_action: 'RECALCULATE',
  };
}

function auditNewSnapshotHash(nv: Record<string, unknown> | null): string | null {
  if (!nv) return null;
  const v = nv.new_snapshot_hash ?? nv.snapshot_hash;
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function previousFromAudit(
  oldValues: Record<string, unknown> | null,
  run: PayrollRunRow
): RecalculatePreviousSummary {
  if (!oldValues) return capturePreviousSummary(run);
  return {
    snapshot_hash: String(
      oldValues.previous_snapshot_hash ?? oldValues.snapshot_hash ?? ''
    ),
    people_count: Number(
      oldValues.previous_people_count ?? oldValues.people_count ?? 0
    ),
    error_count: Number(
      oldValues.previous_error_count ?? oldValues.error_count ?? 0
    ),
    warning_count: Number(
      oldValues.previous_warning_count ?? oldValues.warning_count ?? 0
    ),
    gross_total: moneyStr(
      oldValues.previous_gross_total ?? oldValues.gross_total
    ),
    deduction_total: moneyStr(
      oldValues.previous_deduction_total ?? oldValues.deduction_total
    ),
    employer_contribution_total: moneyStr(
      oldValues.previous_employer_contribution_total ??
        oldValues.employer_contribution_total
    ),
    net_total: moneyStr(oldValues.previous_net_total ?? oldValues.net_total),
    calculated_at:
      oldValues.previous_calculated_at != null
        ? String(oldValues.previous_calculated_at)
        : oldValues.calculated_at != null
          ? String(oldValues.calculated_at)
          : null,
    last_calculation_request_id:
      oldValues.previous_last_calculation_request_id != null
        ? String(oldValues.previous_last_calculation_request_id)
        : null,
  };
}

export async function recalculatePayrollRunCore(
  client: TxClient,
  input: {
    run_id: string;
    version: unknown;
    updated_at: unknown;
    idempotency_key: unknown;
    reason: unknown;
    userId: string;
  }
): Promise<RecalculatePayrollRunResult> {
  const runId = requirePayrollUuid(input.run_id, 'معرّف التشغيل');
  const normalizedKey = normalizeRecalculateIdempotencyKey(input.idempotency_key);
  const normalizedReason = normalizeRecalculateReason(input.reason);
  const requestKeyHash = buildRecalculateRequestKeyHash(normalizedKey);
  const requestUuid = requestKeyHashToRequestUuid(requestKeyHash);
  const requestKeyMasked = maskRecalculateRequestKey(normalizedKey);

  if (input.version == null) {
    throw new AccountsHttpError('رقم الإصدار (version) مطلوب', 400);
  }
  const expectedVersionForHash = Number(input.version);
  if (!Number.isInteger(expectedVersionForHash) || expectedVersionForHash < 1) {
    throw new AccountsHttpError('رقم الإصدار غير صالح', 400);
  }
  if (input.updated_at == null || input.updated_at === '') {
    throw new AccountsHttpError('حقل updated_at مطلوب للتحقق من التزامن', 400);
  }
  const expectedUpdatedAtIso = iso(input.updated_at as Date | string);
  if (!expectedUpdatedAtIso) {
    throw new AccountsHttpError('قيمة updated_at غير صالحة', 400);
  }

  const requestPayloadHash = buildRecalculateRequestPayloadHash({
    run_id: runId,
    reason: normalizedReason,
    expected_version: expectedVersionForHash,
    expected_updated_at: expectedUpdatedAtIso,
  });

  const fingerprints: RecalculatePayrollRunResult['fingerprints'] = {
    request_key_hash: requestKeyHash,
    request_payload_hash: requestPayloadHash,
    request_key_masked: requestKeyMasked,
    calculation_request_id: requestUuid,
  };

  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(existing.payroll_period_id),
    payrollRunLock(runId),
  ]);
  const run = await loadPayrollRun(client, runId, true);
  const period = await loadPayrollPeriod(client, run.payroll_period_id, true);

  // Idempotency قبل concurrency حتى ينجح replay بنفس جسم الطلب الأصلي
  const prior = await txQuery<AuditRecalcRow>(
    client,
    `SELECT id, old_values, new_values, created_at
     FROM accounts.financial_audit_log
     WHERE entity_type = 'payroll_run'
       AND entity_id = $1::uuid
       AND action = 'payroll_run.recalculated'
       AND new_values->>'request_key_hash' = $2
       AND new_values->>'source_action' = 'RECALCULATE'
     ORDER BY created_at DESC
     LIMIT 5`,
    [runId, requestKeyHash]
  );

  if (prior.rows.length > 0) {
    // تكرار نجاح لنفس المفتاح = فساد سلامة — لا اختيار اعتباطي
    if (prior.rows.length > 1) {
      throw new AccountsHttpError(
        'تكرار سجلات نجاح لنفس مفتاح إعادة الاحتساب — رُفضت الإعادة الآمنة (DUPLICATE_RECALC_AUDIT)',
        409
      );
    }

    const row = prior.rows[0];
    const nv = row.new_values;
    const ov = row.old_values;
    const storedPayload = nv ? String(nv.request_payload_hash ?? '').trim() : '';
    const newHash = auditNewSnapshotHash(nv);
    const auditEntityOk = true; // الاستعلام مقيّد بـ entity_id=runId

    if (
      !nv ||
      !storedPayload ||
      !/^[0-9a-f]{64}$/.test(storedPayload) ||
      !newHash ||
      !isPayrollSnapshotHash(newHash) ||
      !auditEntityOk
    ) {
      throw new AccountsHttpError(
        'سجل تدقيق إعادة الاحتساب السابق ناقص أو تالف — رُفضت الإعادة الآمنة',
        409
      );
    }

    if (storedPayload !== requestPayloadHash) {
      throw new AccountsHttpError(
        'تعارض مفتاح التكرار: نفس المفتاح مع حمولة مختلفة (IDEMPOTENCY_CONFLICT)',
        409
      );
    }

    if (run.status !== 'CALCULATED' || String(run.snapshot_hash) !== newHash) {
      throw new AccountsHttpError(
        'تعارض سلامة إعادة الاحتساب: اللقطة الحالية لا تطابق سجل تدقيق إعادة الاحتساب',
        409
      );
    }
    return buildRecalcResult(
      client,
      run,
      previousFromAudit(ov, run),
      fingerprints,
      true
    );
  }

  assertPayrollConcurrency(run, input.version, input.updated_at, 'تشغيل الرواتب');

  if (run.status === 'DRAFT') {
    throw new AccountsHttpError(
      'التشغيل في مسودة — استخدم احتساب التشغيل أولاً وليس إعادة الاحتساب',
      409
    );
  }
  if (run.status === 'CALCULATING') {
    throw new AccountsHttpError('التشغيل قيد الاحتساب حالياً', 409);
  }
  if (run.status === 'CANCELLED') {
    throw new AccountsHttpError('لا يمكن إعادة احتساب تشغيل ملغى', 409);
  }
  if (run.status !== 'CALCULATED') {
    throw new AccountsHttpError(
      `لا يمكن إعادة احتساب تشغيل في حالة ${run.status}`,
      409
    );
  }

  if (period.status !== 'OPEN' && period.status !== 'PROCESSING') {
    throw new AccountsHttpError(
      `لا يمكن إعادة الاحتساب وفترة الرواتب في حالة ${period.status}`,
      409
    );
  }
  const calcDate = dateStr(run.calculation_date);
  if (!calcDate) throw new AccountsHttpError('تاريخ الاحتساب غير صالح', 400);
  const periodStart = dateStr(period.start_date)!;
  const periodEnd = dateStr(period.end_date)!;
  if (calcDate < periodStart || calcDate > periodEnd) {
    throw new AccountsHttpError('تاريخ الاحتساب خارج نطاق الفترة', 400);
  }
  if (run.currency_code !== period.currency_code) {
    throw new AccountsHttpError('عملة التشغيل تخالف عملة الفترة', 400);
  }
  if (!isSupportedPayrollCurrency(run.currency_code)) {
    throw new AccountsHttpError(
      'عملة تشغيل الرواتب غير مدعومة حاليًا. يدعم النظام الدينار العراقي IQD فقط (UNSUPPORTED_PAYROLL_CURRENCY)',
      422
    );
  }
  if (!isSupportedPayrollCurrency(period.currency_code)) {
    throw new AccountsHttpError(
      'عملة تشغيل الرواتب غير مدعومة حاليًا. يدعم النظام الدينار العراقي IQD فقط (UNSUPPORTED_PAYROLL_CURRENCY)',
      422
    );
  }
  if (run.scope_type === 'PERSON_LIST') {
    // قفل صفوف الأعضاء يمنع بناء لقطة من قائمة نصف قديمة/نصف جديدة
    await txQuery(
      client,
      `SELECT id FROM accounts.payroll_run_scope_members
       WHERE payroll_run_id = $1::uuid
       ORDER BY payroll_person_id
       FOR UPDATE`,
      [run.id]
    );
    const n = await countPayrollRunScopeMembers(client, run.id);
    if (n === 0) {
      throw new AccountsHttpError(
        'قائمة أشخاص التشغيل فارغة — لا يمكن إعادة الاحتساب (EMPTY_PERSON_LIST)',
        422
      );
    }
  }

  const artifacts = await loadRunCalculationArtifacts(client, run.id);
  if (artifacts.people.length === 0 && Number(run.people_count) > 0) {
    throw new AccountsHttpError(
      'آثار الاحتساب غير متسقة مع ملخص التشغيل — رُفضت إعادة الاحتساب',
      409
    );
  }

  const previous = capturePreviousSummary(run);
  hitPayrollRecalcFailpoint('after_previous_summary');

  const started = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET
       status = 'CALCULATING',
       calculation_request_id = $2::uuid,
       calculation_attempt_number = calculation_attempt_number + 1,
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [run.id, requestUuid, input.userId]
  );
  const calculatingRun = started.rows[0];

  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.recalculation_started',
    entityType: 'payroll_run',
    entityId: run.id,
    newValues: {
      attempt: calculatingRun.calculation_attempt_number,
      calculation_request_id: requestUuid,
      request_key_hash: requestKeyHash,
      source_action: 'RECALCULATE',
      previous_snapshot_hash: previous.snapshot_hash,
    },
    description: `بدء إعادة احتساب تشغيل الرواتب ${run.run_number}`,
  });

  await clearRunCalculationArtifacts(client, run.id);
  hitPayrollRecalcFailpoint('after_delete');

  const rebuilt = await rebuildPayrollRunArtifactsWhileCalculating(client, {
    run: calculatingRun,
    calcDate,
    userId: input.userId,
    requestIdUuid: requestUuid,
    failpointHooks: {
      afterFirstPerson: () => hitPayrollRecalcFailpoint('after_first_person'),
      afterFirstLine: () => hitPayrollRecalcFailpoint('after_first_line'),
      beforeRunHash: () => hitPayrollRecalcFailpoint('before_run_hash'),
      beforeTotalsUpdate: () => hitPayrollRecalcFailpoint('before_totals_update'),
    },
  });

  hitPayrollRecalcFailpoint('during_audit');
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.recalculated',
    entityType: 'payroll_run',
    entityId: run.id,
    oldValues: {
      previous_snapshot_hash: previous.snapshot_hash,
      previous_people_count: previous.people_count,
      previous_error_count: previous.error_count,
      previous_warning_count: previous.warning_count,
      previous_gross_total: previous.gross_total,
      previous_deduction_total: previous.deduction_total,
      previous_employer_contribution_total: previous.employer_contribution_total,
      previous_net_total: previous.net_total,
      previous_calculated_at: previous.calculated_at,
      previous_last_calculation_request_id: previous.last_calculation_request_id,
    },
    newValues: {
      new_snapshot_hash: rebuilt.snapshotHash,
      new_people_count: rebuilt.peopleCount,
      new_error_count: rebuilt.errorCount,
      new_warning_count: rebuilt.warningCount,
      new_gross_total: rebuilt.grossTotal,
      new_deduction_total: rebuilt.deductionTotal,
      new_employer_contribution_total: rebuilt.employerTotal,
      new_net_total: rebuilt.netTotal,
      new_calculated_at: iso(rebuilt.run.calculated_at),
      payroll_period_id: run.payroll_period_id,
      reason: normalizedReason,
      request_key_hash: requestKeyHash,
      request_payload_hash: requestPayloadHash,
      request_key_masked: requestKeyMasked,
      source_action: 'RECALCULATE',
      calculation_request_id: requestUuid,
      attempt: calculatingRun.calculation_attempt_number,
    },
    description: normalizedReason.slice(0, 500),
  });

  return buildRecalcResult(client, rebuilt.run, previous, fingerprints, false);
}
