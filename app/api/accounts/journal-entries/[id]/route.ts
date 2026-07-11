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
import { toDateOnly } from '@/src/lib/accounts/fiscal';
import {
  assertFiscalContextForEntry,
  assertOptimisticVersion,
  loadJournalEntry,
  loadJournalLines,
  normalizeAndValidateLines,
  parseEntryType,
  replaceJournalLines,
} from '@/src/lib/accounts/journal-entries';
import { canDeleteJournal } from '@/src/lib/accounts/journal-transitions';
import { normalizeMoneyInput } from '@/src/lib/accounts/money';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

async function loadDetail(client: Parameters<typeof loadJournalEntry>[0], id: string) {
  const entry = await loadJournalEntry(client, id);
  const lines = await loadJournalLines(client, id);

  const userIds = [
    entry.created_by,
    entry.updated_by,
    entry.reviewed_by,
    entry.approved_by,
    entry.posted_by,
    entry.reversed_by,
  ].filter(Boolean) as string[];

  const users = await txQuery<{ id: string; username: string }>(
    client,
    `SELECT id, username FROM student_affairs.users WHERE id = ANY($1::uuid[])`,
    [userIds]
  );
  const userMap = new Map(users.rows.map((u) => [u.id, u.username]));

  return {
    ...entry,
    lines,
    created_by_username: userMap.get(entry.created_by) || null,
    updated_by_username: entry.updated_by ? userMap.get(entry.updated_by) : null,
    reviewed_by_username: entry.reviewed_by ? userMap.get(entry.reviewed_by) : null,
    approved_by_username: entry.approved_by ? userMap.get(entry.approved_by) : null,
    posted_by_username: entry.posted_by ? userMap.get(entry.posted_by) : null,
    reversed_by_username: entry.reversed_by ? userMap.get(entry.reversed_by) : null,
  };
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const data = await withTransaction(async (client) => loadDetail(client, id));
    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const current = await loadJournalEntry(client, id, true);
      if (current.status !== 'DRAFT') {
        throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
      }
      assertOptimisticVersion(current.version, body.version);

      const fiscalYearId = String(body.fiscal_year_id || current.fiscal_year_id);
      const fiscalPeriodId = String(body.fiscal_period_id || current.fiscal_period_id);
      const entryDate = body.entry_date
        ? toDateOnly(String(body.entry_date))
        : current.entry_date;
      const description =
        body.description != null ? String(body.description).trim() : current.description;
      const referenceNumber =
        body.reference_number !== undefined
          ? body.reference_number
            ? String(body.reference_number).trim()
            : null
          : current.reference_number;
      const entryType =
        body.entry_type != null ? parseEntryType(body.entry_type) : current.entry_type;

      if (!description) {
        throw new AccountsHttpError('وصف القيد مطلوب', 400);
      }

      await assertFiscalContextForEntry(client, {
        fiscalYearId,
        fiscalPeriodId,
        entryDate,
      });

      const existingLines = await loadJournalLines(client, id);
      const linesPayload: unknown = Array.isArray(body.lines)
        ? body.lines
        : existingLines.map((line) => ({
            account_id: line.account_id,
            cost_center_id: line.cost_center_id,
            description: line.description,
            debit_amount: line.debit_amount,
            credit_amount: line.credit_amount,
          }));

      const { lines, totalDebit, totalCredit, warnings } = await normalizeAndValidateLines(
        client,
        linesPayload,
        'draft'
      );

      const result = await txQuery(
        client,
        `UPDATE accounts.journal_entries
         SET fiscal_year_id = $2,
             fiscal_period_id = $3,
             entry_date = $4::date,
             entry_type = $5,
             reference_number = $6,
             description = $7,
             total_debit = $8::numeric,
             total_credit = $9::numeric,
             updated_by = $10,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
         RETURNING *`,
        [
          id,
          fiscalYearId,
          fiscalPeriodId,
          entryDate,
          entryType,
          referenceNumber,
          description,
          totalDebit,
          totalCredit,
          auth.user.id,
        ]
      );

      await replaceJournalLines(client, id, lines);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'journal_entry.updated',
        entityType: 'journal_entry',
        entityId: id,
        oldValues: {
          version: current.version,
          total_debit: current.total_debit,
          total_credit: current.total_credit,
        },
        newValues: {
          version: result.rows[0].version,
          lines_count: lines.length,
          total_debit: totalDebit,
          total_credit: totalCredit,
        },
        description: `تعديل مسودة القيد ${current.entry_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return { entry: result.rows[0], warnings };
    });

    return jsonSuccess({
      data: {
        ...updated.entry,
        entry_date: toDateOnly(updated.entry.entry_date),
        total_debit: normalizeMoneyInput(updated.entry.total_debit),
        total_credit: normalizeMoneyInput(updated.entry.total_credit),
      },
      warnings: updated.warnings,
      message: 'تم تحديث المسودة',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const current = await loadJournalEntry(client, id, true);
      if (!canDeleteJournal(current.status, current.source_id)) {
        throw new AccountsHttpError(
          'لا يمكن حذف هذا القيد. يمكن حذف المسودات غير المرتبطة بمصدر فقط',
          409
        );
      }

      const lines = await loadJournalLines(client, id);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'journal_entry.deleted',
        entityType: 'journal_entry',
        entityId: id,
        oldValues: {
          entry_number: current.entry_number,
          status: current.status,
          total_debit: current.total_debit,
          total_credit: current.total_credit,
          lines,
        },
        description: `حذف مسودة القيد ${current.entry_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      await txQuery(client, `DELETE FROM accounts.journal_entries WHERE id = $1`, [id]);
    });

    return jsonSuccess({ message: 'تم حذف القيد' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
