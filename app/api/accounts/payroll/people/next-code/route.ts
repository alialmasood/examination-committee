import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { previewDocumentNumber, yearLabelFromDate } from '@/src/lib/accounts/document-sequences';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { query } from '@/src/lib/db';

/**
 * GET /api/accounts/payroll/people/next-code
 * معاينة الرمز التالي لشخص الرواتب (PYP) دون استهلاك التسلسل.
 * الرمز النهائي يُخصَّص داخل معاملة الإنشاء؛ المعاينة للعرض فقط.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);

    const year = await query(
      `SELECT id, start_date::text AS start_date
       FROM accounts.fiscal_years
       WHERE status = 'ACTIVE'
       ORDER BY is_default DESC, start_date DESC
       LIMIT 1`
    );
    if (!year.rows[0]) throw new AccountsHttpError('لا توجد سنة مالية نشطة', 409);

    await query(
      `INSERT INTO accounts.document_sequences
        (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
       SELECT 'PAYROLL_PERSON', $1::uuid, 'PYP', 0, 6, TRUE, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts.document_sequences
         WHERE document_type = 'PAYROLL_PERSON' AND fiscal_year_id = $1::uuid
       )`,
      [year.rows[0].id]
    );

    // مزامنة العدّاد مع أعلى رمز مستخدم فعلياً قبل المعاينة
    await query(
      `UPDATE accounts.document_sequences ds
       SET current_number = GREATEST(
         ds.current_number,
         COALESCE((
           SELECT MAX(
             NULLIF(regexp_replace(pp.person_code, '^' || ds.prefix || '-[0-9]{4}-', ''), '')::int
           )
           FROM accounts.payroll_people pp
           WHERE pp.person_code ~ ('^' || ds.prefix || '-[0-9]{4}-[0-9]+$')
         ), 0)
       ),
       updated_at = NOW()
       WHERE ds.document_type = 'PAYROLL_PERSON' AND ds.fiscal_year_id = $1::uuid`,
      [year.rows[0].id]
    );

    const seq = await query(
      `SELECT prefix, current_number, padding_length
       FROM accounts.document_sequences
       WHERE document_type = 'PAYROLL_PERSON' AND fiscal_year_id = $1::uuid`,
      [year.rows[0].id]
    );
    const row = seq.rows[0] ?? { prefix: 'PYP', current_number: 0, padding_length: 6 };

    const nextCode = previewDocumentNumber({
      prefix: row.prefix,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
      currentNumber: Number(row.current_number),
      paddingLength: Number(row.padding_length),
    });
    return jsonSuccess({ data: { next_code: nextCode } });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
