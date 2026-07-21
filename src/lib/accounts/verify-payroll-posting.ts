/**
 * تحقق سلامة ترحيل الرواتب 9.C.1
 */
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollPostingVerifyIssue = {
  kind: string;
  detail: string;
  entity_id?: string;
};

export type PayrollPostingVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: PayrollPostingVerifyIssue[];
  warnings: PayrollPostingVerifyIssue[];
  mismatch_count: number;
  summary: {
    posted_runs: number;
    posting_records: number;
    empty_info?: string;
  };
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export async function verifyPayrollPosting(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollPostingVerifyResult> {
  const strict = options.strict === true;
  const mismatches: PayrollPostingVerifyIssue[] = [];
  const warnings: PayrollPostingVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  const table = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM information_schema.tables
     WHERE table_schema='accounts' AND table_name='payroll_run_postings'`
  );
  if (Number(table.rows[0]?.n ?? 0) === 0) {
    return {
      ok: true,
      strict,
      mismatches: [],
      warnings: [{ kind: 'missing_table', detail: 'جدول الترحيل غير موجود — مطلوب 098' }],
      mismatch_count: 0,
      summary: { posted_runs: 0, posting_records: 0, empty_info: '098 غير مطبّق' },
    };
  }

  const posted = await txQuery<{
    id: string;
    approval_cycle: number;
    posted_at: string | null;
    posted_by: string | null;
    posting_journal_entry_id: string | null;
    posted_snapshot_hash: string | null;
    approved_snapshot_hash: string | null;
    snapshot_hash: string | null;
    review_snapshot_hash: string | null;
  }>(
    client,
    `SELECT id::text, approval_cycle, posted_at::text, posted_by::text,
            posting_journal_entry_id::text, posted_snapshot_hash,
            approved_snapshot_hash, snapshot_hash, review_snapshot_hash
     FROM accounts.payroll_runs WHERE status='POSTED' LIMIT 500`
  );

  for (const run of posted.rows) {
    if (!run.posted_at || !run.posted_by || !run.posting_journal_entry_id || !run.posted_snapshot_hash) {
      fail('posted_partial_fields', 'POSTED بحقول ترحيل جزئية', run.id);
    }
    if (
      !isPayrollSnapshotHash(run.posted_snapshot_hash) ||
      str(run.posted_snapshot_hash) !== str(run.approved_snapshot_hash)
    ) {
      fail('posted_hash_mismatch', 'posted_snapshot_hash ≠ approved', run.id);
    }
    if (str(run.approved_snapshot_hash) !== str(run.snapshot_hash)) {
      fail('posted_current_hash_drift', 'لقطة حالية انحرفت بعد الترحيل', run.id);
    }
    if (Number(run.approval_cycle) < 1) {
      fail('posted_bad_cycle', 'POSTED بدورة اعتماد غير صالحة', run.id);
    }
    const pr = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`,
      [run.id]
    );
    if (Number(pr.rows[0]?.n ?? 0) !== 1) {
      fail('posted_missing_or_dup_record', 'POSTED بلا/بأكثر من سجل ترحيل', run.id);
    }
    if (run.posting_journal_entry_id) {
      const je = await txQuery<{
        status: string;
        entry_type: string;
        source_type: string | null;
        source_id: string | null;
        total_debit: string;
        total_credit: string;
      }>(
        client,
        `SELECT status, entry_type, source_type, source_id::text,
                total_debit::text, total_credit::text
         FROM accounts.journal_entries WHERE id=$1::uuid`,
        [run.posting_journal_entry_id]
      );
      const j = je.rows[0];
      if (!j) fail('posted_missing_journal', 'POSTED بلا قيد', run.id);
      else {
        if (j.status !== 'POSTED') fail('journal_not_posted', 'القيد ليس POSTED', run.id);
        if (j.entry_type !== 'SALARY') fail('wrong_entry_type', 'entry_type ليس SALARY', run.id);
        if (j.source_type !== 'PAYROLL_RUN' || str(j.source_id) !== run.id) {
          fail('wrong_journal_source', 'source_type/id غير صحيح', run.id);
        }
        if (str(j.total_debit) !== str(j.total_credit)) {
          fail('journal_unbalanced', 'مدين ≠ دائن', run.id);
        }
      }
    }
  }

  // APPROVED بحقول ترحيل جزئية
  const approvedLeak = await txQuery<{ id: string }>(
    client,
    `SELECT id::text FROM accounts.payroll_runs
     WHERE status='APPROVED' AND (
       posted_at IS NOT NULL OR posted_by IS NOT NULL
       OR posting_journal_entry_id IS NOT NULL OR posted_snapshot_hash IS NOT NULL
     ) LIMIT 100`
  );
  for (const r of approvedLeak.rows) {
    fail('approved_with_posted_fields', 'APPROVED بحقول ترحيل', r.id);
  }

  const postings = await txQuery<{
    id: string;
    payroll_run_id: string;
    journal_entry_id: string;
    snapshot_hash: string;
    approved_snapshot_hash: string;
    version_before: number;
    version_after: number;
    request_key_hash: string;
    gross_total: string;
    net_total: string;
    total_debit?: string;
  }>(
    client,
    `SELECT p.id::text, p.payroll_run_id::text, p.journal_entry_id::text,
            p.snapshot_hash, p.approved_snapshot_hash,
            p.version_before, p.version_after, p.request_key_hash,
            p.gross_total::text, p.net_total::text
     FROM accounts.payroll_run_postings p
     LIMIT 1000`
  );

  for (const p of postings.rows) {
    if (str(p.snapshot_hash) !== str(p.approved_snapshot_hash)) {
      fail('posting_hash_mismatch', 'hashes داخل سجل الترحيل', p.id);
    }
    if (Number(p.version_after) !== Number(p.version_before) + 1) {
      fail('posting_version_chain', 'version_after ≠ before+1', p.id);
    }
    if (!/^[0-9a-f]{64}$/i.test(p.request_key_hash)) {
      fail('malformed_request_key_hash', 'request_key_hash تالف', p.id);
    }
    const run = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_runs WHERE id=$1::uuid`,
      [p.payroll_run_id]
    );
    if (Number(run.rows[0]?.n ?? 0) < 1) fail('posting_orphan_run', 'ترحيل بلا تشغيل', p.id);
    const je = await txQuery<{ n: number; td: string; tc: string }>(
      client,
      `SELECT COUNT(*)::int n, COALESCE(MAX(total_debit),0)::text td, COALESCE(MAX(total_credit),0)::text tc
       FROM accounts.journal_entries WHERE id=$1::uuid`,
      [p.journal_entry_id]
    );
    if (Number(je.rows[0]?.n ?? 0) < 1) fail('posting_orphan_journal', 'ترحيل بلا قيد', p.id);
    const lines = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.journal_entry_lines WHERE journal_entry_id=$1::uuid`,
      [p.journal_entry_id]
    );
    if (Number(lines.rows[0]?.n ?? 0) < 1) fail('orphan_journal_no_lines', 'قيد بلا سطور', p.journal_entry_id);
  }

  // duplicate journal source
  const dupSrc = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM (
       SELECT source_id FROM accounts.journal_entries
       WHERE source_type='PAYROLL_RUN' AND source_id IS NOT NULL
       GROUP BY source_id HAVING COUNT(*) > 1
     ) t`
  );
  if (Number(dupSrc.rows[0]?.n ?? 0) > 0) {
    fail('duplicate_journal_source', 'أكثر من قيد لنفس PAYROLL_RUN');
  }

  // Audit raw key
  const leaky = await txQuery<{ id: string }>(
    client,
    `SELECT id::text FROM accounts.financial_audit_log
     WHERE action LIKE 'payroll_run.post%'
       AND (new_values ? 'idempotency_key' OR old_values ? 'idempotency_key')
     LIMIT 50`
  );
  for (const a of leaky.rows) {
    fail('audit_raw_key', 'مفتاح خام في Audit', a.id);
  }

  const mismatch_count = mismatches.length;
  return {
    ok: mismatch_count === 0,
    strict,
    mismatches,
    warnings,
    mismatch_count,
    summary: {
      posted_runs: posted.rows.length,
      posting_records: postings.rows.length,
      empty_info:
        posted.rows.length === 0 && postings.rows.length === 0
          ? 'بيئة فارغة من الترحيل — لا انحرافات'
          : undefined,
    },
  };
}
