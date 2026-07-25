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

      const tableExists = async (table: string) => {
        const r = await txQuery<{ ok: boolean }>(
          client,
          `SELECT to_regclass($1) IS NOT NULL AS ok`,
          [`accounts.${table}`]
        );
        return Boolean(r.rows[0]?.ok);
      };

      const countOf = async (sql: string) => {
        const r = await txQuery<{ c: number }>(client, sql, [id]);
        return Number(r.rows[0]?.c || 0);
      };

      const blockers: string[] = [];

      if (await tableExists('journal_entries')) {
        const n = await countOf(
          `SELECT COUNT(*)::int AS c FROM accounts.journal_entries WHERE fiscal_year_id = $1`
        );
        if (n > 0) blockers.push(`${n} قيد يومية`);
      }

      if (await tableExists('cash_box_sessions')) {
        const n = await countOf(
          `SELECT COUNT(*)::int AS c FROM accounts.cash_box_sessions WHERE fiscal_year_id = $1`
        );
        if (n > 0) blockers.push(`${n} جلسة صندوق`);
      }

      if (await tableExists('cash_vouchers')) {
        const n = await countOf(
          `SELECT COUNT(*)::int AS c FROM accounts.cash_vouchers WHERE fiscal_year_id = $1`
        );
        if (n > 0) blockers.push(`${n} سند نقدي`);
      }

      if (await tableExists('bank_vouchers')) {
        const n = await countOf(
          `SELECT COUNT(*)::int AS c FROM accounts.bank_vouchers WHERE fiscal_year_id = $1`
        );
        if (n > 0) blockers.push(`${n} سند بنكي`);
      }

      if (await tableExists('payroll_runs') && (await tableExists('payroll_periods'))) {
        const n = await countOf(
          `SELECT COUNT(*)::int AS c
           FROM accounts.payroll_runs r
           JOIN accounts.payroll_periods p ON p.id = r.payroll_period_id
           WHERE p.fiscal_year_id = $1`
        );
        if (n > 0) blockers.push(`${n} تشغيل رواتب`);
      }

      if (blockers.length > 0) {
        throw new AccountsHttpError(
          `لا يمكن حذف السنة ${year.code} لوجود بيانات مرتبطة: ${blockers.join('، ')}. احذفها أولاً ثم أعد المحاولة.`,
          409
        );
      }

      // فك ارتباط فترات الرواتب ثم حذفها إن لم تكن لها تشغيلات
      if (await tableExists('payroll_periods')) {
        await txQuery(
          client,
          `UPDATE accounts.payroll_periods
           SET fiscal_period_id = NULL
           WHERE fiscal_period_id IN (
             SELECT id FROM accounts.fiscal_periods WHERE fiscal_year_id = $1
           )`,
          [id]
        );
        await txQuery(client, `DELETE FROM accounts.payroll_periods WHERE fiscal_year_id = $1`, [
          id,
        ]);
      }

      if (await tableExists('gl_account_balances')) {
        await txQuery(client, `DELETE FROM accounts.gl_account_balances WHERE fiscal_year_id = $1`, [
          id,
        ]);
      }

      await txQuery(client, `DELETE FROM accounts.document_sequences WHERE fiscal_year_id = $1`, [id]);
      await txQuery(client, `DELETE FROM accounts.fiscal_periods WHERE fiscal_year_id = $1`, [id]);
      await txQuery(client, `DELETE FROM accounts.fiscal_years WHERE id = $1`, [id]);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.delete',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        description: `حذف السنة المالية ${year.code} (الحالة: ${year.status})`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess({ message: 'تم حذف السنة المالية وفتراتها' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
