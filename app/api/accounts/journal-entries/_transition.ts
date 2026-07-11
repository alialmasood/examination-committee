import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import {
  assertFiscalContextForEntry,
  loadJournalEntry,
  loadJournalLines,
  normalizeAndValidateLines,
} from '@/src/lib/accounts/journal-entries';
import {
  assertJournalTransition,
  type JournalTransitionAction,
  type JournalStatus,
} from '@/src/lib/accounts/journal-transitions';
import { normalizeMoneyInput } from '@/src/lib/accounts/money';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
  type TxClient,
} from '@/src/lib/accounts/with-transaction';

type AuthOk = Exclude<
  Awaited<ReturnType<typeof requireAccountsAccess>>,
  { response: Response }
>;

const ACTION_AUDIT: Record<
  Exclude<JournalTransitionAction, 'reverse' | 'post'>,
  { action: string; message: string }
> = {
  submit: { action: 'journal_entry.submitted', message: 'إرسال القيد للمراجعة' },
  review: { action: 'journal_entry.reviewed', message: 'مراجعة القيد' },
  approve: { action: 'journal_entry.approved', message: 'اعتماد القيد' },
  reject: { action: 'journal_entry.rejected', message: 'رفض القيد' },
  return_to_draft: {
    action: 'journal_entry.returned_to_draft',
    message: 'إرجاع القيد إلى مسودة',
  },
  cancel: { action: 'journal_entry.cancelled', message: 'إلغاء القيد' },
};

export async function runJournalTransition(
  request: NextRequest,
  entryId: string,
  transition: JournalTransitionAction,
  options?: { requireStrictBalance?: boolean }
) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const reason = body.reason != null ? String(body.reason) : null;

    const result = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const current = await loadJournalEntry(client, entryId, true);
      const { to } = assertJournalTransition(
        transition,
        current.status as JournalStatus,
        reason
      );

      if (options?.requireStrictBalance || transition === 'submit' || transition === 'post') {
        const lines = await loadJournalLines(client, entryId);
        const validated = await normalizeAndValidateLines(
          client,
          lines.map((l) => ({
            account_id: l.account_id,
            cost_center_id: l.cost_center_id,
            description: l.description,
            debit_amount: l.debit_amount,
            credit_amount: l.credit_amount,
          })),
          'strict'
        );
        await assertFiscalContextForEntry(client, {
          fiscalYearId: current.fiscal_year_id,
          fiscalPeriodId: current.fiscal_period_id,
          entryDate: current.entry_date,
        });

        // حدّث الإجماليات من إعادة الحساب
        await txQuery(
          client,
          `UPDATE accounts.journal_entries
           SET total_debit = $2::numeric, total_credit = $3::numeric, updated_at = NOW()
           WHERE id = $1`,
          [entryId, validated.totalDebit, validated.totalCredit]
        );
      }

      return applyStatusUpdate(client, auth, current, to, transition, reason);
    });

    return jsonSuccess({
      data: {
        ...result,
        entry_date: result.entry_date,
        total_debit: normalizeMoneyInput(result.total_debit),
        total_credit: normalizeMoneyInput(result.total_credit),
      },
      message: ACTION_AUDIT[transition as keyof typeof ACTION_AUDIT]?.message || 'تمت العملية',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

async function applyStatusUpdate(
  client: TxClient,
  auth: AuthOk,
  current: Awaited<ReturnType<typeof loadJournalEntry>>,
  to: JournalStatus,
  transition: JournalTransitionAction,
  reason: string | null
) {
  let sql = `UPDATE accounts.journal_entries SET status = $2, updated_by = $3, updated_at = NOW(), version = version + 1`;
  const params: unknown[] = [current.id, to, auth.user.id];

  if (transition === 'review') {
    sql += `, reviewed_by = $3, reviewed_at = NOW()`;
  } else if (transition === 'approve') {
    sql += `, approved_by = $3, approved_at = NOW()`;
  } else if (transition === 'reject') {
    sql += `, rejection_reason = $4`;
    params.push(reason);
  } else if (transition === 'cancel') {
    sql += `, cancellation_reason = $4`;
    params.push(reason);
  } else if (transition === 'return_to_draft') {
    sql += `, rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, approved_by = NULL, approved_at = NULL`;
  }

  sql += ` WHERE id = $1 RETURNING *`;
  const result = await txQuery(client, sql, params);

  const meta = ACTION_AUDIT[transition as keyof typeof ACTION_AUDIT];
  if (meta) {
    await writeFinancialAudit(client, {
      userId: auth.user.id,
      action: meta.action,
      entityType: 'journal_entry',
      entityId: current.id,
      oldValues: { status: current.status },
      newValues: { status: to, reason: reason || undefined },
      description: `${meta.message}: ${current.entry_number}`,
      ipAddress: auth.ipAddress,
      userAgent: auth.userAgent,
    });
  }

  return result.rows[0];
}

export async function runPostTransition(request: NextRequest, entryId: string) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const result = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const current = await loadJournalEntry(client, entryId, true);
      assertJournalTransition('post', current.status as JournalStatus);

      const lines = await loadJournalLines(client, entryId);
      const validated = await normalizeAndValidateLines(
        client,
        lines.map((l) => ({
          account_id: l.account_id,
          cost_center_id: l.cost_center_id,
          description: l.description,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
        })),
        'strict'
      );

      await assertFiscalContextForEntry(client, {
        fiscalYearId: current.fiscal_year_id,
        fiscalPeriodId: current.fiscal_period_id,
        entryDate: current.entry_date,
      });

      const updated = await txQuery(
        client,
        `UPDATE accounts.journal_entries
         SET status = 'POSTED',
             total_debit = $2::numeric,
             total_credit = $3::numeric,
             posted_by = $4,
             posted_at = NOW(),
             updated_by = $4,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
         RETURNING *`,
        [entryId, validated.totalDebit, validated.totalCredit, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'journal_entry.posted',
        entityType: 'journal_entry',
        entityId: entryId,
        oldValues: { status: current.status },
        newValues: {
          status: 'POSTED',
          total_debit: validated.totalDebit,
          total_credit: validated.totalCredit,
        },
        description: `ترحيل القيد ${current.entry_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return updated.rows[0];
    });

    return jsonSuccess({
      data: {
        ...result,
        total_debit: normalizeMoneyInput(result.total_debit),
        total_credit: normalizeMoneyInput(result.total_credit),
      },
      message: 'تم ترحيل القيد',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
