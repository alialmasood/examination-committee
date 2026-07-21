import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability, hasPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { buildRunCalculationSummary } from '@/src/lib/accounts/payroll-calculation-results';
import { isSupportedPayrollCurrency } from '@/src/lib/accounts/payroll-calculation-formulas';
import { buildPayrollPostingSection } from '@/src/lib/accounts/payroll-posting-preview';
import { loadLatestRecalculationSummary } from '@/src/lib/accounts/payroll-recalculate-history';
import { loadPayrollRun, serializePayrollRun, updatePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { listScopeMembers, serializeScopeMember } from '@/src/lib/accounts/payroll-run-scope';
import { isPayrollSnapshotHash } from '@/src/lib/accounts/payroll-snapshot-hash';
import { withTransaction, txQuery } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function shortHash(h: string | null | undefined): string | null {
  if (!h || !isPayrollSnapshotHash(h)) return null;
  return `${String(h).slice(0, 8)}…${String(h).slice(-6)}`;
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id } = await context.params;
    const data = await withTransaction(async (client) => {
      const row = await loadPayrollRun(client, id);
      const members = row.scope_type === 'PERSON_LIST' ? await listScopeMembers(client, id) : [];
      const calculation_summary = await buildRunCalculationSummary(client, id);
      const lastRecalc = await loadLatestRecalculationSummary(client, id);
      const canRecalcCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.RECALCULATE
      );
      const canSubmitCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.SUBMIT_REVIEW
      );
      const canApproveCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.APPROVE
      );
      const canRejectCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.REJECT
      );
      const canViewHistoryCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.VIEW_APPROVAL_HISTORY
      );
      const canPostCap = await hasPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.POST
      );

      const blockingIssues = await txQuery<{ n: number }>(
        client,
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
         WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
        [id]
      );
      const blocking_issues_count = Number(blockingIssues.rows[0]?.n ?? 0);

      const readiness_blockers: string[] = [];
      if (row.status !== 'CALCULATED') readiness_blockers.push('STATUS_NOT_CALCULATED');
      if (!isSupportedPayrollCurrency(row.currency_code)) {
        readiness_blockers.push('UNSUPPORTED_CURRENCY');
      }
      if (Number(row.error_count) > 0) readiness_blockers.push('HAS_ERRORS');
      if (blocking_issues_count > 0) readiness_blockers.push('HAS_BLOCKING_ISSUES');
      if (!isPayrollSnapshotHash(row.snapshot_hash)) {
        readiness_blockers.push('MISSING_SNAPSHOT_HASH');
      }
      const readiness_for_review = readiness_blockers.length === 0;

      const is_current_user_submitter =
        row.status === 'UNDER_REVIEW' &&
        row.submitted_for_review_by != null &&
        String(row.submitted_for_review_by) === String(auth.user.id);
      const segregation_of_duties_blocked = is_current_user_submitter;

      const approval_blockers: string[] = [];
      if (row.status !== 'UNDER_REVIEW') approval_blockers.push('STATUS_NOT_UNDER_REVIEW');
      if (Number(row.error_count) > 0) approval_blockers.push('HAS_ERRORS');
      if (blocking_issues_count > 0) approval_blockers.push('HAS_BLOCKING_ISSUES');
      if (
        isPayrollSnapshotHash(row.review_snapshot_hash) &&
        isPayrollSnapshotHash(row.snapshot_hash) &&
        String(row.review_snapshot_hash) !== String(row.snapshot_hash)
      ) {
        approval_blockers.push('SNAPSHOT_DRIFT');
      }
      if (!isPayrollSnapshotHash(row.review_snapshot_hash)) {
        approval_blockers.push('MISSING_REVIEW_HASH');
      }
      if (segregation_of_duties_blocked) approval_blockers.push('SOD_SUBMITTER');
      const readiness_for_approval =
        row.status === 'UNDER_REVIEW' &&
        approval_blockers.filter((b) => b !== 'SOD_SUBMITTER').length === 0;

      const isPosted = row.status === 'POSTED';
      const can_recalculate =
        !isPosted &&
        canRecalcCap &&
        row.status === 'CALCULATED' &&
        isSupportedPayrollCurrency(row.currency_code);

      const can_submit_for_review =
        !isPosted &&
        canSubmitCap &&
        row.status === 'CALCULATED' &&
        readiness_for_review;

      const can_approve =
        !isPosted &&
        canApproveCap &&
        row.status === 'UNDER_REVIEW' &&
        !is_current_user_submitter &&
        readiness_for_approval;

      const can_reject =
        !isPosted &&
        canRejectCap &&
        row.status === 'UNDER_REVIEW' &&
        !is_current_user_submitter;

      const posting = await buildPayrollPostingSection(client, row, { canPostCap });

      let submitted_by: { id: string; display_name: string } | null = null;
      let submit_comment: string | null = null;
      let approved_by: { id: string; display_name: string } | null = null;
      let last_rejection: {
        reason: string;
        rejected_at: string;
        rejected_by: { id: string; display_name: string } | null;
        approval_cycle: number;
      } | null = null;

      if (row.submitted_for_review_by) {
        const u = await txQuery<{ name: string | null }>(
          client,
          `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
          [row.submitted_for_review_by]
        );
        submitted_by = {
          id: String(row.submitted_for_review_by),
          display_name: u.rows[0]?.name ? String(u.rows[0].name) : '',
        };
      }
      if (row.approved_by) {
        const u = await txQuery<{ name: string | null }>(
          client,
          `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
          [row.approved_by]
        );
        approved_by = {
          id: String(row.approved_by),
          display_name: u.rows[0]?.name ? String(u.rows[0].name) : '',
        };
      }
      if (row.status === 'UNDER_REVIEW' && Number(row.approval_cycle) >= 1) {
        const act = await txQuery<{ comment: string | null }>(
          client,
          `SELECT comment FROM accounts.payroll_run_approval_actions
           WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
             AND action='SUBMITTED_FOR_REVIEW'
           ORDER BY created_at DESC LIMIT 1`,
          [id, row.approval_cycle]
        );
        submit_comment = act.rows[0]?.comment ?? null;
      }

      // آخر رفض تاريخي (حتى بعد العودة لـ CALCULATED)
      const lastRej = await txQuery<{
        reason: string | null;
        created_at: Date | string;
        actor_id: string | null;
        actor_display_name_snapshot: string | null;
        approval_cycle: number;
      }>(
        client,
        `SELECT reason, created_at, actor_id::text, actor_display_name_snapshot, approval_cycle
         FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action='REJECTED'
         ORDER BY created_at DESC LIMIT 1`,
        [id]
      );
      if (lastRej.rows[0]?.reason) {
        const rj = lastRej.rows[0];
        last_rejection = {
          reason: String(rj.reason),
          rejected_at:
            rj.created_at instanceof Date
              ? rj.created_at.toISOString()
              : String(rj.created_at),
          rejected_by: rj.actor_id
            ? {
                id: String(rj.actor_id),
                display_name: rj.actor_display_name_snapshot
                  ? String(rj.actor_display_name_snapshot)
                  : '',
              }
            : null,
          approval_cycle: Number(rj.approval_cycle),
        };
      }

      const review_state =
        row.status === 'UNDER_REVIEW'
          ? 'UNDER_REVIEW'
          : row.status === 'APPROVED'
            ? 'APPROVED'
            : Number(row.approval_cycle ?? 0) > 0
              ? 'PREVIOUS_CYCLE'
              : 'NONE';

      return {
        run: serializePayrollRun(row),
        scope_members: members.map(serializeScopeMember),
        calculation_summary,
        recalculation: {
          can_recalculate,
          has_recalculation_history: lastRecalc != null,
          current_snapshot_hash: row.snapshot_hash,
          last_calculated_at: row.calculated_at
            ? row.calculated_at instanceof Date
              ? row.calculated_at.toISOString()
              : String(row.calculated_at)
            : null,
          calculation_version: row.version,
          last_recalculation: lastRecalc
            ? {
                created_at: lastRecalc.created_at,
                actor_display_name: lastRecalc.actor_display_name,
                reason: lastRecalc.reason,
                previous_snapshot_hash_short: lastRecalc.previous_snapshot_hash_short,
                new_snapshot_hash_short: lastRecalc.new_snapshot_hash_short,
                previous_people_count: lastRecalc.previous_people_count,
                new_people_count: lastRecalc.new_people_count,
                previous_error_count: lastRecalc.previous_error_count,
                new_error_count: lastRecalc.new_error_count,
                previous_gross_total: lastRecalc.previous_gross_total,
                new_gross_total: lastRecalc.new_gross_total,
                previous_net_total: lastRecalc.previous_net_total,
                new_net_total: lastRecalc.new_net_total,
                no_change: lastRecalc.no_change,
              }
            : null,
        },
        approval: {
          can_submit_for_review,
          can_approve,
          can_reject,
          can_view_history: canViewHistoryCap,
          can_recalculate,
          review_state,
          approval_cycle: Number(row.approval_cycle ?? 0),
          submitted_for_review_at: row.submitted_for_review_at
            ? row.submitted_for_review_at instanceof Date
              ? row.submitted_for_review_at.toISOString()
              : String(row.submitted_for_review_at)
            : null,
          submitted_for_review_by: submitted_by,
          approved_at: row.approved_at
            ? row.approved_at instanceof Date
              ? row.approved_at.toISOString()
              : String(row.approved_at)
            : null,
          approved_by,
          review_snapshot_hash_short: shortHash(row.review_snapshot_hash),
          approved_snapshot_hash_short: shortHash(row.approved_snapshot_hash),
          submit_comment,
          last_rejection_reason: last_rejection?.reason ?? null,
          last_rejection,
          error_count: Number(row.error_count),
          blocking_issues_count,
          warning_count: Number(row.warning_count),
          readiness_for_review,
          readiness_blockers,
          readiness_for_approval,
          approval_blockers,
          is_current_user_submitter,
          segregation_of_duties_blocked,
        },
        posting,
      };
    });
    return jsonSuccess({ data });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const before = await loadPayrollRun(client, id);
      const updated = await updatePayrollRun(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.updated', entityType: 'payroll_run', entityId: id, oldValues: serializePayrollRun(before), newValues: serializePayrollRun(updated), description: `تعديل تشغيل رواتب ${updated.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollRun(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
