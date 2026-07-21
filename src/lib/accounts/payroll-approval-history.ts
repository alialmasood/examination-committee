/**
 * سجل قرارات مراجعة واعتماد الرواتب 9.B.4
 * مصدر: accounts.payroll_run_approval_actions فقط (بلا blocked/failed Audit).
 * DTO معقّم: بلا request hashes · بلا metadata · بلا snapshot كامل.
 */
import { AccountsHttpError } from './auth';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { requirePayrollUuid } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export const APPROVAL_ACTION_LABELS_AR: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: 'تم إرسال التشغيل للمراجعة',
  APPROVED: 'تم اعتماد التشغيل',
  REJECTED: 'تم رفض التشغيل وإعادته للتصحيح',
};

export function shortApprovalSnapshotHash(h: string | null | undefined): string | null {
  if (!h || !isPayrollSnapshotHash(h)) return null;
  const s = String(h);
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export type ApprovalHistoryActor = {
  id: string | null;
  display_name: string;
};

export type ApprovalHistoryItem = {
  id: string;
  approval_cycle: number;
  action: 'SUBMITTED_FOR_REVIEW' | 'APPROVED' | 'REJECTED';
  action_label_ar: string;
  from_status: string;
  to_status: string;
  actor: ApprovalHistoryActor;
  comment: string | null;
  reason: string | null;
  snapshot_hash_short: string | null;
  version_before: number;
  version_after: number;
  created_at: string;
};

export type ApprovalHistoryPage = {
  items: ApprovalHistoryItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

type ActionRow = {
  id: string;
  approval_cycle: number;
  action: string;
  from_status: string;
  to_status: string;
  actor_id: string | null;
  actor_display_name_snapshot: string | null;
  live_actor_name: string | null;
  comment: string | null;
  reason: string | null;
  snapshot_hash: string;
  version_before: number;
  version_after: number;
  created_at: Date | string;
};

function mapRow(row: ActionRow): ApprovalHistoryItem {
  const action = row.action as ApprovalHistoryItem['action'];
  const display =
    (row.live_actor_name && String(row.live_actor_name).trim()) ||
    (row.actor_display_name_snapshot && String(row.actor_display_name_snapshot).trim()) ||
    'مستخدم سابق';
  return {
    id: String(row.id),
    approval_cycle: Number(row.approval_cycle),
    action,
    action_label_ar: APPROVAL_ACTION_LABELS_AR[action] ?? action,
    from_status: String(row.from_status),
    to_status: String(row.to_status),
    actor: {
      id: row.actor_id ? String(row.actor_id) : null,
      display_name: display,
    },
    comment: row.comment != null && String(row.comment).trim() !== '' ? String(row.comment) : null,
    reason: row.reason != null && String(row.reason).trim() !== '' ? String(row.reason) : null,
    snapshot_hash_short: shortApprovalSnapshotHash(row.snapshot_hash),
    version_before: Number(row.version_before),
    version_after: Number(row.version_after),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function listPayrollRunApprovalHistory(
  client: TxClient,
  runIdRaw: string,
  opts: { page?: unknown; page_size?: unknown } = {}
): Promise<ApprovalHistoryPage> {
  const runId = requirePayrollUuid(runIdRaw, 'معرّف التشغيل');

  const pageRaw = Number(opts.page);
  const sizeRaw = Number(opts.page_size);
  if (opts.page != null && opts.page !== '' && (!Number.isFinite(pageRaw) || pageRaw < 1)) {
    throw new AccountsHttpError('رقم الصفحة غير صالح', 400);
  }
  if (
    opts.page_size != null &&
    opts.page_size !== '' &&
    (!Number.isFinite(sizeRaw) || sizeRaw < 1)
  ) {
    throw new AccountsHttpError('حجم الصفحة غير صالح', 400);
  }

  const page = Math.max(1, Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1);
  const page_size = Math.min(
    100,
    Math.max(1, Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.floor(sizeRaw) : 20)
  );
  const offset = (page - 1) * page_size;

  const countR = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE payroll_run_id=$1::uuid`,
    [runId]
  );
  const total = Number(countR.rows[0]?.n ?? 0);

  const rows = await txQuery<ActionRow>(
    client,
    `SELECT a.id::text, a.approval_cycle, a.action, a.from_status, a.to_status,
            a.actor_id::text, a.actor_display_name_snapshot,
            COALESCE(u.full_name, u.username) AS live_actor_name,
            a.comment, a.reason, a.snapshot_hash,
            a.version_before, a.version_after, a.created_at
     FROM accounts.payroll_run_approval_actions a
     LEFT JOIN student_affairs.users u ON u.id = a.actor_id
     WHERE a.payroll_run_id = $1::uuid
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2 OFFSET $3`,
    [runId, page_size, offset]
  );

  const items = rows.rows.map(mapRow);
  return {
    items,
    page,
    page_size,
    total,
    has_more: offset + items.length < total,
  };
}
