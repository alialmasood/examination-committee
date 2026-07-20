/**
 * تحقق سلامة سجلات إعادة احتساب الرواتب 9.A.2.4.1
 * UI-agnostic · يعتمد على Audit JSONB (بلا أرشفة لقطة كاملة).
 */
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type RecalcVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollRecalculateVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: RecalcVerifyIssue[];
  warnings: RecalcVerifyIssue[];
  summary: {
    recalculated_audits: number;
    checked_runs: number;
  };
};

async function probeTransactionRollback(client: TxClient): Promise<void> {
  await txQuery(client, `SAVEPOINT __payroll_recalc_core_verify_probe`);
  try {
    await txQuery(client, `CREATE TEMP TABLE IF NOT EXISTS __payroll_recalc_core_probe (n int)`);
    await txQuery(client, `INSERT INTO __payroll_recalc_core_probe(n) VALUES (1)`);
  } finally {
    await txQuery(client, `ROLLBACK TO SAVEPOINT __payroll_recalc_core_verify_probe`);
    await txQuery(client, `RELEASE SAVEPOINT __payroll_recalc_core_verify_probe`);
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export async function verifyPayrollRecalculateCore(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollRecalculateVerifyResult> {
  const strict = options.strict === true;
  const mismatches: RecalcVerifyIssue[] = [];
  const warnings: RecalcVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) =>
    warnings.push({ kind, detail, entity_id });

  try {
    await probeTransactionRollback(client);
  } catch (e) {
    fail(
      'tx_rollback_probe',
      `فشل مسبار Transaction/ROLLBACK: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`
    );
  }

  const audits = await txQuery<{
    id: string;
    entity_id: string;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    description: string | null;
    created_at: Date | string;
  }>(
    client,
    `SELECT id, entity_id::text, old_values, new_values, description, created_at
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.recalculated'
       AND entity_type = 'payroll_run'
     ORDER BY created_at DESC
     LIMIT 500`
  );

  const keySuccessCounts = new Map<string, number>();
  const keyPayloads = new Map<string, Set<string>>();

  for (const a of audits.rows) {
    const ov = a.old_values ?? {};
    const nv = a.new_values ?? {};
    const runId = a.entity_id;

    const reason = str(nv.reason) || str(a.description);
    if (!reason || reason.length < 10) {
      fail('recalc_audit_missing_reason', 'سجل recalculated بلا سبب كافٍ', runId);
    }

    const prevHash = str(ov.previous_snapshot_hash ?? ov.snapshot_hash);
    const newHash = str(nv.new_snapshot_hash ?? nv.snapshot_hash);
    if (!isPayrollSnapshotHash(prevHash)) {
      fail('recalc_audit_missing_previous_hash', 'نقص previous_snapshot_hash', runId);
    }
    if (!isPayrollSnapshotHash(newHash)) {
      fail('recalc_audit_missing_new_hash', 'نقص new_snapshot_hash', runId);
    }

    const keyHash = str(nv.request_key_hash);
    const payloadHash = str(nv.request_payload_hash);
    if (!/^[0-9a-f]{64}$/.test(keyHash)) {
      fail('recalc_audit_missing_key_hash', 'نقص request_key_hash', runId);
    }
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      fail('recalc_audit_missing_payload_hash', 'نقص request_payload_hash', runId);
    }
    if (str(nv.source_action) !== 'RECALCULATE') {
      fail('recalc_audit_bad_source_action', 'source_action ≠ RECALCULATE', runId);
    }

    for (const field of [
      'previous_gross_total',
      'previous_deduction_total',
      'previous_net_total',
      'new_gross_total',
      'new_deduction_total',
      'new_net_total',
    ] as const) {
      const bag = field.startsWith('previous_') ? ov : nv;
      const alt = field.replace(/^(previous_|new_)/, '');
      const val = bag[field] ?? bag[alt];
      if (val == null || String(val).trim() === '') {
        fail('recalc_audit_missing_totals', `نقص ${field}`, runId);
      }
    }

    if (keyHash) {
      const mapKey = `${runId}|${keyHash}`;
      keySuccessCounts.set(mapKey, (keySuccessCounts.get(mapKey) ?? 0) + 1);
      if (!keyPayloads.has(mapKey)) keyPayloads.set(mapKey, new Set());
      if (payloadHash) keyPayloads.get(mapKey)!.add(payloadHash);
    }
  }

  for (const [mapKey, count] of keySuccessCounts) {
    if (count > 1) {
      const [runId, keyHash] = mapKey.split('|');
      fail(
        'recalc_duplicate_success_same_key',
        `تكرار نجاح لنفس request_key_hash (${count}) key=${keyHash?.slice(0, 12)}…`,
        runId
      );
    }
  }
  for (const [mapKey, payloads] of keyPayloads) {
    if (payloads.size > 1) {
      const [runId] = mapKey.split('|');
      fail(
        'recalc_conflicting_payloads_same_key',
        `حمولات متعارضة لنفس المفتاح (${payloads.size})`,
        runId
      );
    }
  }

  // آخر recalculated لكل تشغيل مقابل snapshot_hash الحالي
  const latestByRun = new Map<string, (typeof audits.rows)[0]>();
  for (const a of audits.rows) {
    if (!latestByRun.has(a.entity_id)) latestByRun.set(a.entity_id, a);
  }

  let checkedRuns = 0;
  for (const [runId, a] of latestByRun) {
    checkedRuns += 1;
    const run = await txQuery<{
      id: string;
      status: string;
      snapshot_hash: string | null;
    }>(
      client,
      `SELECT id::text, status, snapshot_hash FROM accounts.payroll_runs WHERE id=$1::uuid`,
      [runId]
    );
    const row = run.rows[0];
    if (!row) {
      fail('recalc_audit_orphan_run', 'تدقيق recalculated لتشغيل غير موجود', runId);
      continue;
    }
    const newHash = str(
      a.new_values?.new_snapshot_hash ?? a.new_values?.snapshot_hash
    );
    if (row.status === 'CALCULATED' && newHash && String(row.snapshot_hash) !== newHash) {
      fail(
        'recalc_last_hash_mismatch_run',
        `آخر new_snapshot_hash لا يطابق run.snapshot_hash`,
        runId
      );
    }
    if (row.status === 'CALCULATED' && !isPayrollSnapshotHash(row.snapshot_hash)) {
      fail('calculated_without_snapshot_hash', 'CALCULATED بلا snapshot_hash', runId);
    }
  }

  if (strict && audits.rows.length === 0) {
    warn('no_recalc_audits', 'لا توجد سجلات recalculated للفحص (طبيعي قبل الاستخدام)');
  }

  return {
    ok: mismatches.length === 0,
    strict,
    mismatches,
    warnings,
    summary: {
      recalculated_audits: audits.rows.length,
      checked_runs: checkedRuns,
    },
  };
}
