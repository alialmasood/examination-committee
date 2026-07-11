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
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  parseEntryType,
  replaceJournalLines,
} from '@/src/lib/accounts/journal-entries';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';
import { normalizeMoneyInput } from '@/src/lib/accounts/money';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const fiscalYearId = sp.get('fiscal_year_id');
    const fiscalPeriodId = sp.get('fiscal_period_id');
    const status = sp.get('status');
    const entryType = sp.get('entry_type');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR e.entry_number ILIKE '%'||$1||'%'
             OR COALESCE(e.reference_number,'') ILIKE '%'||$1||'%'
             OR e.description ILIKE '%'||$1||'%')
        AND ($2::uuid IS NULL OR e.fiscal_year_id = $2::uuid)
        AND ($3::uuid IS NULL OR e.fiscal_period_id = $3::uuid)
        AND ($4::text IS NULL OR e.status = $4)
        AND ($5::text IS NULL OR e.entry_type = $5)
        AND ($6::date IS NULL OR e.entry_date >= $6::date)
        AND ($7::date IS NULL OR e.entry_date <= $7::date)
    `;
    const params = [
      q,
      fiscalYearId || null,
      fiscalPeriodId || null,
      status || null,
      entryType || null,
      dateFrom ? toDateOnly(dateFrom) : null,
      dateTo ? toDateOnly(dateTo) : null,
    ];

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM accounts.journal_entries e ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS drafts,
         COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW')::int AS pending_review,
         COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
         COUNT(*) FILTER (WHERE status = 'REVERSED')::int AS reversed
       FROM accounts.journal_entries e
       ${where}`,
      params
    );

    const listRes = await query(
      `SELECT e.id, e.entry_number, e.entry_date, e.entry_type, e.description,
              e.reference_number, e.total_debit, e.total_credit, e.status,
              e.version, e.created_at, e.is_reversal,
              u.username AS created_by_username,
              fy.code AS fiscal_year_code,
              fp.code AS fiscal_period_code
       FROM accounts.journal_entries e
       JOIN student_affairs.users u ON u.id = e.created_by
       JOIN accounts.fiscal_years fy ON fy.id = e.fiscal_year_id
       JOIN accounts.fiscal_periods fp ON fp.id = e.fiscal_period_id
       ${where}
       ORDER BY e.entry_date DESC, e.entry_number DESC
       LIMIT $8 OFFSET $9`,
      [...params, pageSize, offset]
    );

    const data = listRes.rows.map((r) => ({
      ...r,
      entry_date: toDateOnly(r.entry_date),
      total_debit: normalizeMoneyInput(r.total_debit),
      total_credit: normalizeMoneyInput(r.total_credit),
    }));

    return jsonSuccess({
      data,
      pagination: {
        page,
        page_size: pageSize,
        total: countRes.rows[0].total,
        total_pages: Math.ceil(countRes.rows[0].total / pageSize) || 1,
      },
      stats: statsRes.rows[0],
    });
  } catch (error) {
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const fiscalYearId = String(body.fiscal_year_id || '');
    const fiscalPeriodId = String(body.fiscal_period_id || '');
    const entryDate = body.entry_date ? toDateOnly(String(body.entry_date)) : '';
    const description = String(body.description || '').trim();
    const referenceNumber = body.reference_number
      ? String(body.reference_number).trim()
      : null;
    const entryType = parseEntryType(body.entry_type);

    if (!fiscalYearId || !fiscalPeriodId || !entryDate || !description) {
      return jsonError('السنة والفترة والتاريخ والوصف مطلوبة', 400);
    }

    const created = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      await assertFiscalContextForEntry(client, {
        fiscalYearId,
        fiscalPeriodId,
        entryDate,
      });

      const { lines, totalDebit, totalCredit, warnings } = await normalizeAndValidateLines(
        client,
        Array.isArray(body.lines) ? body.lines : [],
        'draft'
      );

      const entryNumber = await allocateJournalEntryNumber(client, fiscalYearId);

      const result = await txQuery(
        client,
        `INSERT INTO accounts.journal_entries
          (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
           source_type, reference_number, description, total_debit, total_credit,
           status, created_by, updated_by)
         VALUES ($1,$2,$3,$4::date,$5,'MANUAL',$6,$7,$8::numeric,$9::numeric,
                 'DRAFT',$10,$10)
         RETURNING *`,
        [
          entryNumber,
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

      const entry = result.rows[0];
      await replaceJournalLines(client, entry.id, lines);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'journal_entry.created',
        entityType: 'journal_entry',
        entityId: entry.id,
        newValues: {
          entry_number: entryNumber,
          status: 'DRAFT',
          lines_count: lines.length,
          total_debit: totalDebit,
          total_credit: totalCredit,
        },
        description: `إنشاء مسودة قيد ${entryNumber}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return { entry, warnings };
    });

    return jsonSuccess(
      {
        data: {
          ...created.entry,
          entry_date: toDateOnly(created.entry.entry_date),
          total_debit: normalizeMoneyInput(created.entry.total_debit),
          total_credit: normalizeMoneyInput(created.entry.total_credit),
        },
        warnings: created.warnings,
        message: 'تم إنشاء مسودة القيد',
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
