/**
 * تحقق نهائي مجمّع لسلسلة الرواتب (9.C.2 Final Acceptance).
 * يجمع وحدات التحقق الأساسية دون إنشاء Migration 099.
 */
import { verifyPayrollFoundation } from './verify-payroll-foundation';
import { verifyPayrollPeriodsRuns } from './verify-payroll-periods-runs';
import { verifyPayrollSnapshotSchema } from './verify-payroll-snapshot-schema';
import { verifyPayrollCalculationCore } from './verify-payroll-calculation-core';
import { verifyPayrollRecalculateCore } from './verify-payroll-recalculate-core';
import { verifyPayrollApprovalWorkflow } from './verify-payroll-approval-workflow';
import { verifyPayrollPosting } from './verify-payroll-posting';
import type { TxClient } from './with-transaction';

export type PayrollFinalModuleResult = {
  ok: boolean;
  mismatch_count: number;
  warning_count?: number;
};

export type PayrollFinalVerifyResult = {
  ok: boolean;
  strict: boolean;
  modules: {
    foundation: PayrollFinalModuleResult;
    periods_runs: PayrollFinalModuleResult;
    snapshot: PayrollFinalModuleResult;
    calculation: PayrollFinalModuleResult;
    recalculate: PayrollFinalModuleResult;
    approval: PayrollFinalModuleResult;
    posting: PayrollFinalModuleResult;
  };
  mismatch_count: number;
};

function mod(
  ok: boolean,
  mismatch_count: number,
  warning_count?: number
): PayrollFinalModuleResult {
  const out: PayrollFinalModuleResult = { ok, mismatch_count };
  if (warning_count != null) out.warning_count = warning_count;
  return out;
}

function countMismatches(r: {
  mismatch_count?: number;
  mismatches?: unknown[];
}): number {
  if (typeof r.mismatch_count === 'number') return r.mismatch_count;
  return Array.isArray(r.mismatches) ? r.mismatches.length : 0;
}

export async function verifyPayrollFinal(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollFinalVerifyResult> {
  const strict = options.strict === true;

  const foundation = await verifyPayrollFoundation(client, { strict });
  const periods = await verifyPayrollPeriodsRuns(client, { strict });
  const snapshot = await verifyPayrollSnapshotSchema(client, { strict });
  const calculation = await verifyPayrollCalculationCore(client, { strict });
  const recalculate = await verifyPayrollRecalculateCore(client, { strict });
  const approval = await verifyPayrollApprovalWorkflow(client, { strict });
  const posting = await verifyPayrollPosting(client, { strict });

  const modules = {
    foundation: mod(
      foundation.ok,
      countMismatches(foundation),
      foundation.warnings?.length
    ),
    periods_runs: mod(
      periods.ok,
      countMismatches(periods),
      periods.warnings?.length
    ),
    snapshot: mod(
      snapshot.ok,
      countMismatches(snapshot),
      snapshot.warnings?.length
    ),
    calculation: mod(
      calculation.ok,
      countMismatches(calculation),
      calculation.warnings?.length
    ),
    recalculate: mod(
      recalculate.ok,
      countMismatches(recalculate),
      recalculate.warnings?.length
    ),
    approval: mod(
      approval.ok,
      countMismatches(approval),
      approval.warnings?.length
    ),
    posting: mod(
      posting.ok,
      countMismatches(posting),
      posting.warnings?.length
    ),
  };

  const mismatch_count =
    modules.foundation.mismatch_count +
    modules.periods_runs.mismatch_count +
    modules.snapshot.mismatch_count +
    modules.calculation.mismatch_count +
    modules.recalculate.mismatch_count +
    modules.approval.mismatch_count +
    modules.posting.mismatch_count;

  const ok =
    modules.foundation.ok &&
    modules.periods_runs.ok &&
    modules.snapshot.ok &&
    modules.calculation.ok &&
    modules.recalculate.ok &&
    modules.approval.ok &&
    modules.posting.ok &&
    mismatch_count === 0;

  return { ok, strict, modules, mismatch_count };
}