import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability, hasPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { buildRunCalculationSummary } from '@/src/lib/accounts/payroll-calculation-results';
import { isSupportedPayrollCurrency } from '@/src/lib/accounts/payroll-calculation-formulas';
import { loadLatestRecalculationSummary } from '@/src/lib/accounts/payroll-recalculate-history';
import { loadPayrollRun, serializePayrollRun, updatePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { listScopeMembers, serializeScopeMember } from '@/src/lib/accounts/payroll-run-scope';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

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
      const can_recalculate =
        canRecalcCap &&
        row.status === 'CALCULATED' &&
        isSupportedPayrollCurrency(row.currency_code);

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
