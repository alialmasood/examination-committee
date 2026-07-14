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
  addBankStatementLine,
  assertCanAccessBankStatement,
  listBankStatementLines,
  serializeBankStatementLine,
} from '@/src/lib/accounts/bank-statements';
import { serializeBankReconciliationMatch } from '@/src/lib/accounts/bank-reconciliation';
import { txQuery, withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim().toLowerCase() || '';
    const matchStatus = sp.get('match_status');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(500, Math.max(1, Number(sp.get('page_size') || 200)));

    const { lines, matchesByLine } = await withTransaction(async (client) => {
      try {
        await assertCanAccessBankStatement(client, {
          statementId: id,
          userId: auth.user.id,
        });
      } catch (e) {
        if (e instanceof AccountsHttpError && e.status === 403) {
          throw new AccountsHttpError('كشف الحساب المصرفي غير موجود', 404);
        }
        throw e;
      }
      const l = await listBankStatementLines(client, id);
      const matchesRes = await txQuery(
        client,
        `SELECT m.*, je.entry_number, je.entry_date::text AS entry_date
         FROM accounts.bank_reconciliation_matches m
         JOIN accounts.journal_entries je ON je.id = m.journal_entry_id
         WHERE m.bank_statement_id = $1::uuid
         ORDER BY m.created_at ASC`,
        [id]
      );
      const grouped = new Map<string, unknown[]>();
      for (const row of matchesRes.rows as Array<{
        bank_statement_line_id: string;
        entry_number: string;
        entry_date: string;
      }>) {
        const arr = grouped.get(row.bank_statement_line_id) || [];
        arr.push({
          ...serializeBankReconciliationMatch(row as never),
          entry_number: row.entry_number,
          entry_date: row.entry_date,
        });
        grouped.set(row.bank_statement_line_id, arr);
      }
      return { lines: l, matchesByLine: grouped };
    });

    let filtered = lines;
    if (matchStatus) {
      filtered = filtered.filter((l) => l.match_status === matchStatus);
    }
    if (q) {
      filtered = filtered.filter(
        (l) =>
          l.description.toLowerCase().includes(q) ||
          (l.bank_reference || '').toLowerCase().includes(q) ||
          (l.external_line_id || '').toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    return jsonSuccess({
      data: paged.map((l) => ({
        ...serializeBankStatementLine(l),
        matches: matchesByLine.get(l.id) || [],
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const line = await withTransaction(async (client) => {
      const created = await addBankStatementLine(client, {
        ...body,
        statementId: id,
        userId: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.line_added',
        entityType: 'bank_statement_line',
        entityId: created.id,
        newValues: serializeBankStatementLine(created),
        description: `إضافة سطر #${created.line_number} لكشف حساب مصرفي`,
      });
      return created;
    });

    return jsonSuccess({ data: serializeBankStatementLine(line) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
