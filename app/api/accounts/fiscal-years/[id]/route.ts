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
  assertNoYearOverlap,
  normalizeCode,
  toDateOnly,
} from '@/src/lib/accounts/fiscal';
import {
  acquireFiscalYearsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const result = await withTransaction(async (client) => {
      const year = await txQuery(client, `SELECT * FROM accounts.fiscal_years WHERE id = $1`, [id]);
      if (year.rows.length === 0) {
        throw new AccountsHttpError('السنة المالية غير موجودة', 404);
      }
      const periods = await txQuery(
        client,
        `SELECT * FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 ORDER BY period_number`,
        [id]
      );
      const sequences = await txQuery(
        client,
        `SELECT * FROM accounts.document_sequences WHERE fiscal_year_id = $1 ORDER BY document_type`,
        [id]
      );
      return { year: year.rows[0], periods: periods.rows, sequences: sequences.rows };
    });
    return jsonSuccess({ data: result });
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
      await acquireFiscalYearsLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_years WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        throw new AccountsHttpError('السنة المالية غير موجودة', 404);
      }
      const year = existing.rows[0];

      if (year.status === 'CLOSED') {
        throw new AccountsHttpError('لا يمكن تعديل سنة مالية مغلقة', 409);
      }

      let code = year.code;
      let startDate = toDateOnly(year.start_date);
      let endDate = toDateOnly(year.end_date);
      const nameAr = body.name_ar != null ? String(body.name_ar).trim() : year.name_ar;
      const nameEn = body.name_en != null ? (body.name_en ? String(body.name_en).trim() : null) : year.name_en;
      const notes = body.notes != null ? (body.notes ? String(body.notes).trim() : null) : year.notes;

      if (!nameAr) {
        throw new AccountsHttpError('اسم السنة مطلوب', 400);
      }

      if (year.status === 'DRAFT') {
        if (body.code != null) code = normalizeCode(String(body.code));
        if (body.start_date != null) startDate = toDateOnly(String(body.start_date));
        if (body.end_date != null) endDate = toDateOnly(String(body.end_date));
        if (!code) throw new AccountsHttpError('رمز السنة مطلوب', 400);
        if (startDate >= endDate) {
          throw new AccountsHttpError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 400);
        }
        await assertNoYearOverlap(client, startDate, endDate, id);
      } else if (year.status === 'ACTIVE') {
        if (
          (body.code != null && normalizeCode(String(body.code)) !== year.code) ||
          (body.start_date != null && toDateOnly(String(body.start_date)) !== startDate) ||
          (body.end_date != null && toDateOnly(String(body.end_date)) !== endDate)
        ) {
          throw new AccountsHttpError(
            'لا يمكن تغيير رمز أو تواريخ سنة مالية نشطة من الواجهة العادية',
            409
          );
        }
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_years
         SET code = $2, name_ar = $3, name_en = $4, start_date = $5::date, end_date = $6::date,
             notes = $7, updated_by = $8, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, code, nameAr, nameEn, startDate, endDate, notes, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.update',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        newValues: result.rows[0],
        description: `تعديل السنة المالية ${code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تحديث السنة المالية' });
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
      await acquireFiscalYearsLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_years WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        throw new AccountsHttpError('السنة المالية غير موجودة', 404);
      }
      const year = existing.rows[0];
      if (year.status !== 'DRAFT') {
        throw new AccountsHttpError('يمكن حذف السنة المالية فقط وهي في حالة مسودة', 409);
      }

      const periods = await txQuery(
        client,
        `SELECT COUNT(*)::int AS c FROM accounts.fiscal_periods WHERE fiscal_year_id = $1`,
        [id]
      );
      if (periods.rows[0].c > 0) {
        throw new AccountsHttpError('لا يمكن حذف سنة مالية تحتوي على فترات محاسبية', 409);
      }

      await txQuery(client, `DELETE FROM accounts.document_sequences WHERE fiscal_year_id = $1`, [id]);
      await txQuery(client, `DELETE FROM accounts.fiscal_years WHERE id = $1`, [id]);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.delete',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        description: `حذف السنة المالية المسودة ${year.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess({ message: 'تم حذف السنة المالية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
