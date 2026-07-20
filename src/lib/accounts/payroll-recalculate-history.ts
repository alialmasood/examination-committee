/**
 * قراءة ملخصات تاريخ إعادة الاحتساب من Audit (9.A.2.4.2)
 * بلا raw JSON · بلا request hashes · بلا مفتاح خام.
 */
import { AccountsHttpError } from './auth';
import { requirePayrollUuid } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function money(v: unknown): string {
  return v == null || v === '' ? '0' : String(v);
}

function shortHash(h: string): string {
  const s = str(h);
  if (s.length <= 12) return s;
  return s.slice(0, 12);
}

export type RecalculationHistoryItem = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  reason: string;
  previous_snapshot_hash_short: string;
  new_snapshot_hash_short: string;
  previous_people_count: number;
  new_people_count: number;
  previous_error_count: number;
  new_error_count: number;
  previous_warning_count: number;
  new_warning_count: number;
  previous_gross_total: string;
  new_gross_total: string;
  previous_deduction_total: string;
  new_deduction_total: string;
  previous_employer_contribution_total: string;
  new_employer_contribution_total: string;
  previous_net_total: string;
  new_net_total: string;
  previous_calculated_at: string | null;
  new_calculated_at: string | null;
  no_change: boolean;
};

export type RecalculationHistoryPage = {
  items: RecalculationHistoryItem[];
  page: number;
  page_size: number;
  total: number;
};

function mapAuditRow(row: {
  id: string;
  user_id: string | null;
  actor_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  description: string | null;
  created_at: Date | string;
}): RecalculationHistoryItem {
  const ov = row.old_values ?? {};
  const nv = row.new_values ?? {};
  const prevHash = str(ov.previous_snapshot_hash ?? ov.snapshot_hash);
  const newHash = str(nv.new_snapshot_hash ?? nv.snapshot_hash);
  const reason = str(nv.reason) || str(row.description);
  return {
    id: row.id,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    actor_user_id: row.user_id ? String(row.user_id) : null,
    actor_display_name: row.actor_name ? String(row.actor_name) : null,
    reason,
    previous_snapshot_hash_short: shortHash(prevHash),
    new_snapshot_hash_short: shortHash(newHash),
    previous_people_count: Number(ov.previous_people_count ?? ov.people_count ?? 0),
    new_people_count: Number(nv.new_people_count ?? nv.people_count ?? 0),
    previous_error_count: Number(ov.previous_error_count ?? ov.error_count ?? 0),
    new_error_count: Number(nv.new_error_count ?? nv.error_count ?? 0),
    previous_warning_count: Number(ov.previous_warning_count ?? ov.warning_count ?? 0),
    new_warning_count: Number(nv.new_warning_count ?? nv.warning_count ?? 0),
    previous_gross_total: money(ov.previous_gross_total ?? ov.gross_total),
    new_gross_total: money(nv.new_gross_total ?? nv.gross_total),
    previous_deduction_total: money(ov.previous_deduction_total ?? ov.deduction_total),
    new_deduction_total: money(nv.new_deduction_total ?? nv.deduction_total),
    previous_employer_contribution_total: money(
      ov.previous_employer_contribution_total ?? ov.employer_contribution_total
    ),
    new_employer_contribution_total: money(
      nv.new_employer_contribution_total ?? nv.employer_contribution_total
    ),
    previous_net_total: money(ov.previous_net_total ?? ov.net_total),
    new_net_total: money(nv.new_net_total ?? nv.net_total),
    previous_calculated_at:
      ov.previous_calculated_at != null
        ? String(ov.previous_calculated_at)
        : ov.calculated_at != null
          ? String(ov.calculated_at)
          : null,
    new_calculated_at:
      nv.new_calculated_at != null
        ? String(nv.new_calculated_at)
        : nv.calculated_at != null
          ? String(nv.calculated_at)
          : null,
    no_change: prevHash !== '' && prevHash === newHash,
  };
}

export async function listPayrollRunRecalculations(
  client: TxClient,
  runIdRaw: string,
  opts: { page?: number; page_size?: number } = {}
): Promise<RecalculationHistoryPage> {
  const runId = requirePayrollUuid(runIdRaw, 'معرّف التشغيل');
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(opts.page_size) || 20));
  const offset = (page - 1) * pageSize;

  const count = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n
     FROM accounts.financial_audit_log
     WHERE entity_type = 'payroll_run'
       AND entity_id = $1::uuid
       AND action = 'payroll_run.recalculated'`,
    [runId]
  );
  const total = Number(count.rows[0]?.n ?? 0);

  const rows = await txQuery<{
    id: string;
    user_id: string | null;
    actor_name: string | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    description: string | null;
    created_at: Date | string;
  }>(
    client,
    `SELECT a.id::text, a.user_id::text, u.full_name AS actor_name,
            a.old_values, a.new_values, a.description, a.created_at
     FROM accounts.financial_audit_log a
     LEFT JOIN student_affairs.users u ON u.id = a.user_id
     WHERE a.entity_type = 'payroll_run'
       AND a.entity_id = $1::uuid
       AND a.action = 'payroll_run.recalculated'
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [runId, pageSize, offset]
  );

  return {
    items: rows.rows.map(mapAuditRow),
    page,
    page_size: pageSize,
    total,
  };
}

export async function loadLatestRecalculationSummary(
  client: TxClient,
  runId: string
): Promise<RecalculationHistoryItem | null> {
  const page = await listPayrollRunRecalculations(client, runId, {
    page: 1,
    page_size: 1,
  });
  return page.items[0] ?? null;
}

export function assertRunExistsForVisibility(
  exists: boolean
): asserts exists is true {
  if (!exists) {
    throw new AccountsHttpError(
      'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه',
      404
    );
  }
}
