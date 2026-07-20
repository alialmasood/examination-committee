/**
 * تحقق تكامل إعادة احتساب الرواتب 9.A.2.4.2 — API + تدقيق blocked/failed.
 * يُكمّل verify-payroll-recalculate-core (9.A.2.4.1).
 */
import { verifyPayrollRecalculateCore } from './verify-payroll-recalculate-core';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type RecalcIntegrationIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollRecalculateIntegrationVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: RecalcIntegrationIssue[];
  warnings: RecalcIntegrationIssue[];
  core_ok: boolean;
  summary: {
    recalculated_audits: number;
    blocked_audits: number;
    failed_audits: number;
  };
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export async function verifyPayrollRecalculateIntegration(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollRecalculateIntegrationVerifyResult> {
  const strict = options.strict === true;
  const mismatches: RecalcIntegrationIssue[] = [];
  const warnings: RecalcIntegrationIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  const core = await verifyPayrollRecalculateCore(client, { strict });
  for (const m of core.mismatches) {
    fail(`core:${m.kind}`, m.detail, m.entity_id);
  }

  const blocked = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
    description: string | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values, description
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.recalculation_blocked'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of blocked.rows) {
    const nv = a.new_values ?? {};
    if (str(nv.source_action) !== 'RECALCULATE') {
      fail('blocked_bad_source', 'blocked بلا source_action=RECALCULATE', a.entity_id);
    }
    if (str(nv.request_key_hash) || str(nv.request_payload_hash)) {
      fail('blocked_has_hashes', 'blocked يحتوي بصمات طلب عامة', a.entity_id);
    }
    const bag = JSON.stringify(nv);
    if (/idempotency_key[^_]/i.test(bag) && !bag.includes('idempotency_key_masked')) {
      fail('blocked_raw_key', 'blocked قد يحتوي مفتاحاً خاماً', a.entity_id);
    }
    if (str(a.description).includes('SELECT ') || str(a.description).includes('stack')) {
      fail('blocked_leaky_desc', 'وصف blocked مسرّب', a.entity_id);
    }
  }

  const failedAudits = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
    description: string | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values, description
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.recalculation_failed'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of failedAudits.rows) {
    const nv = a.new_values ?? {};
    if (str(nv.source_action) !== 'RECALCULATE') {
      fail('failed_bad_source', 'failed بلا source_action=RECALCULATE', a.entity_id);
    }
    if (str(nv.error_code) !== 'RECALC_TECHNICAL_FAILURE') {
      fail('failed_bad_code', 'failed بلا RECALC_TECHNICAL_FAILURE', a.entity_id);
    }
    if (str(nv.request_key_hash)) {
      fail('failed_has_key_hash', 'failed يحتوي request_key_hash', a.entity_id);
    }
  }

  // نجاحات: لا مفتاح خام في description
  const successes = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
    description: string | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values, description
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.recalculated'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of successes.rows) {
    const nv = a.new_values ?? {};
    if (Object.prototype.hasOwnProperty.call(nv, 'idempotency_key')) {
      fail('success_raw_key_field', 'نجاح يحتوي حقل idempotency_key', a.entity_id);
    }
    if (str(nv.snapshot_json) || str(nv.lines)) {
      fail('success_has_snapshot', 'نجاح يحتوي لقطة/أسطر', a.entity_id);
    }
  }

  return {
    ok: mismatches.length === 0 && core.ok,
    strict,
    mismatches,
    warnings,
    core_ok: core.ok,
    summary: {
      recalculated_audits: successes.rows.length,
      blocked_audits: blocked.rows.length,
      failed_audits: failedAudits.rows.length,
    },
  };
}
