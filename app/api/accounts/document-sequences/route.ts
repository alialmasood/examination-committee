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
import { previewDocumentNumber, yearLabelFromDate } from '@/src/lib/accounts/document-sequences';
import {
  acquireFiscalYearsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const fiscalYearId = request.nextUrl.searchParams.get('fiscal_year_id');

    const result = await query(
      `SELECT ds.*, fy.code AS fiscal_year_code, fy.start_date
       FROM accounts.document_sequences ds
       JOIN accounts.fiscal_years fy ON fy.id = ds.fiscal_year_id
       WHERE ($1::uuid IS NULL OR ds.fiscal_year_id = $1::uuid)
       ORDER BY fy.start_date DESC, ds.document_type ASC`,
      [fiscalYearId || null]
    );

    const data = result.rows.map((row) => ({
      ...row,
      preview_next_number: previewDocumentNumber({
        prefix: row.prefix,
        yearLabel: yearLabelFromDate(row.start_date),
        currentNumber: row.current_number,
        paddingLength: row.padding_length,
      }),
    }));

    return jsonSuccess({ data });
  } catch (error) {
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const id = String(body.id || '');
    if (!id) return jsonError('معرف التسلسل مطلوب', 400);

    const prefix = body.prefix != null ? String(body.prefix).trim() : undefined;
    const paddingLength = body.padding_length != null ? Number(body.padding_length) : undefined;
    const currentNumber = body.current_number != null ? Number(body.current_number) : undefined;
    const isActive = body.is_active != null ? Boolean(body.is_active) : undefined;

    if (prefix !== undefined && !prefix) {
      return jsonError('البادئة مطلوبة', 400);
    }
    if (paddingLength !== undefined && (!Number.isInteger(paddingLength) || paddingLength < 1 || paddingLength > 12)) {
      return jsonError('عدد خانات الرقم يجب أن يكون بين 1 و 12', 400);
    }
    if (currentNumber !== undefined && (!Number.isInteger(currentNumber) || currentNumber < 0)) {
      return jsonError('الرقم الحالي غير صالح', 400);
    }

    const updated = await withTransaction(async (client) => {
      await acquireFiscalYearsLock(client);
      const existing = await txQuery(
        client,
        `SELECT * FROM accounts.document_sequences WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (existing.rows.length === 0) {
        throw new AccountsHttpError('تسلسل المستند غير موجود', 404);
      }
      const current = existing.rows[0];

      const nextPrefix = prefix ?? current.prefix;
      const nextPadding = paddingLength ?? current.padding_length;
      const nextCurrent = currentNumber ?? current.current_number;
      const nextActive = isActive ?? current.is_active;

      if (nextCurrent < current.current_number) {
        throw new AccountsHttpError(
          'لا يمكن تقليل الرقم الحالي لتفادي تكرار أرقام المستندات المستقبلية',
          409
        );
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.document_sequences
         SET prefix = $2, padding_length = $3, current_number = $4, is_active = $5, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, nextPrefix, nextPadding, nextCurrent, nextActive]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'document_sequence.update',
        entityType: 'document_sequence',
        entityId: id,
        oldValues: current,
        newValues: result.rows[0],
        description: `تعديل تسلسل المستند ${current.document_type}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تحديث تسلسل المستند' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
