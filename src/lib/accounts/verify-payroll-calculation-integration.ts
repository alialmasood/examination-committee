/**
 * تحقق تكامل احتساب الرواتب 9.A.2.3.2 — API + تدقيق + حارس الترحيل.
 * يُكمّل verify-payroll-calculation-core (9.A.2.3.1).
 */
import { isPayrollRunReadyForPosting } from './payroll-posting-guard';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { verifyPayrollCalculationCore, type PayrollCalculationVerifyResult } from './verify-payroll-calculation-core';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type IntegrationVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollCalculationIntegrationVerifyResult = PayrollCalculationVerifyResult & {
  integration_mismatches: IntegrationVerifyIssue[];
  integration_warnings: IntegrationVerifyIssue[];
};

export async function verifyPayrollCalculationIntegration(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollCalculationIntegrationVerifyResult> {
  const strict = options.strict === true;
  const integration_mismatches: IntegrationVerifyIssue[] = [];
  const integration_warnings: IntegrationVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    integration_mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) =>
    integration_warnings.push({ kind, detail, entity_id });

  const core = await verifyPayrollCalculationCore(client, { strict });

  const calculatedRuns = await txQuery<{
    id: string;
    status: string;
    error_count: number;
    snapshot_hash: string | null;
    calculated_at: Date | string | null;
    last_calculation_request_id: string | null;
    calculation_request_id: string | null;
    run_number: string;
  }>(
    client,
    `SELECT id, status, error_count, snapshot_hash, calculated_at,
            last_calculation_request_id, calculation_request_id, run_number
     FROM accounts.payroll_runs
     WHERE status = 'CALCULATED'`
  );

  for (const run of calculatedRuns.rows) {
    if (run.calculated_at == null) {
      fail('integration_calculated_at', 'CALCULATED بلا calculated_at', run.id);
    }
    if (run.last_calculation_request_id == null) {
      fail('integration_last_request', 'CALCULATED بلا last_calculation_request_id', run.id);
    } else if (
      run.calculation_request_id != null &&
      String(run.last_calculation_request_id).toLowerCase() !==
        String(run.calculation_request_id).toLowerCase()
    ) {
      fail(
        'integration_request_consistency',
        'last_calculation_request_id ≠ calculation_request_id',
        run.id
      );
    }

    const errorPeople = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_people
       WHERE payroll_run_id=$1::uuid AND calculation_status='ERROR'`,
      [run.id]
    );
    const errorPeopleN = errorPeople.rows[0]?.n ?? 0;
    if (errorPeopleN !== Number(run.error_count)) {
      fail(
        'integration_error_count',
        `error_count=${run.error_count} vs ERROR people=${errorPeopleN}`,
        run.id
      );
    }

    const audits = await txQuery<{ action: string; n: number }>(
      client,
      `SELECT action, COUNT(*)::int n
       FROM accounts.financial_audit_log
       WHERE entity_type = 'payroll_run' AND entity_id = $1::uuid
         AND action IN (
           'payroll_run.calculation_started',
           'payroll_run.calculated',
           'payroll_run.calculation_blocked',
           'payroll_run.calculation_failed'
         )
       GROUP BY action`,
      [run.id]
    );
    const auditMap = new Map(audits.rows.map((a) => [a.action, a.n]));
    if ((auditMap.get('payroll_run.calculation_started') ?? 0) < 1) {
      fail('integration_audit_started', 'CALCULATED بلا audit calculation_started', run.id);
    }
    if ((auditMap.get('payroll_run.calculated') ?? 0) < 1) {
      fail('integration_audit_calculated', 'CALCULATED بلا audit calculated', run.id);
    }

    const blockingIssues = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
       WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
      [run.id]
    );
    const blockingN = blockingIssues.rows[0]?.n ?? 0;

    const readyForPosting = isPayrollRunReadyForPosting(
      {
        status: run.status,
        error_count: run.error_count,
        snapshot_hash: run.snapshot_hash,
        approved_snapshot_hash: (run as { approved_snapshot_hash?: string | null })
          .approved_snapshot_hash,
      },
      { blocking_issues_count: blockingN }
    );
    // 9.B.1: CALCULATED نظيف ليس جاهزاً للترحيل — يشترط APPROVED
    if (run.status === 'CALCULATED' && readyForPosting) {
      fail(
        'integration_posting_guard_calculated',
        'حارس الترحيل يقبل CALCULATED دون اعتماد',
        run.id
      );
    }
    if (
      run.status === 'APPROVED' &&
      Number(run.error_count) === 0 &&
      isPayrollSnapshotHash(run.snapshot_hash) &&
      blockingN === 0 &&
      !readyForPosting
    ) {
      fail('integration_posting_guard', 'حارس الترحيل يرفض تشغيلاً معتمداً يبدو جاهزاً', run.id);
    }
    if (Number(run.error_count) > 0 && readyForPosting) {
      fail('integration_posting_guard_errors', 'حارس الترحيل يقبل تشغيلاً فيه أخطاء', run.id);
    }
  }

  const blockedWithoutAudit = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n
     FROM accounts.payroll_runs r
     WHERE r.status = 'DRAFT'
       AND r.calculation_attempt_number = 0
       AND EXISTS (
         SELECT 1 FROM accounts.financial_audit_log a
         WHERE a.entity_type = 'payroll_run' AND a.entity_id = r.id
           AND a.action = 'payroll_run.calculation_started'
       )`
  );
  if ((blockedWithoutAudit.rows[0]?.n ?? 0) > 0) {
    warn(
      'draft_with_started_audit',
      `تشغيلات DRAFT بها audit started (${blockedWithoutAudit.rows[0]?.n})`
    );
  }

  const integrationOk =
    integration_mismatches.length === 0 && (!strict || integration_warnings.length === 0);
  const ok = core.ok && integrationOk;

  return {
    ...core,
    ok,
    integration_mismatches,
    integration_warnings,
  };
}
