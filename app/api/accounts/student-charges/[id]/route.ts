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
  loadStudentCharge,
  serializeStudentCharge,
  updateStudentCharge,
} from '@/src/lib/accounts/student-charges';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const detail = await query(
      `SELECT sc.*,
              ft.code AS fee_type_code,
              ft.name_ar AS fee_type_name_ar,
              sa.account_number,
              COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
              s.university_id AS student_university_id,
              je.entry_number AS journal_entry_number,
              rje.entry_number AS reversal_journal_entry_number
       FROM accounts.student_charges sc
       JOIN accounts.student_fee_types ft ON ft.id = sc.fee_type_id
       JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
       JOIN student_affairs.students s ON s.id = sc.student_id
       LEFT JOIN accounts.journal_entries je ON je.id = sc.journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = sc.reversal_journal_entry_id
       WHERE sc.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('المطالبة المالية غير موجودة', 404);
    }
    const row = detail.rows[0];
    return jsonSuccess({
      data: {
        ...serializeStudentCharge(
          row as Parameters<typeof serializeStudentCharge>[0]
        ),
        fee_type_code: row.fee_type_code ?? null,
        fee_type_name_ar: row.fee_type_name_ar ?? null,
        account_number: row.account_number ?? null,
        student_full_name_ar: row.student_full_name_ar ?? null,
        student_university_id: row.student_university_id ?? null,
        journal_entry_number: row.journal_entry_number ?? null,
        reversal_journal_entry_number: row.reversal_journal_entry_number ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'المطالبة المالية غير موجودة' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      const before = await loadStudentCharge(client, id);
      const row = await updateStudentCharge(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        fee_type_id: body.fee_type_id,
        charge_date: body.charge_date,
        due_date: body.due_date,
        original_amount: body.original_amount,
        fiscal_year_id: body.fiscal_year_id,
        fiscal_period_id: body.fiscal_period_id,
        academic_year: body.academic_year,
        cost_center_id: body.cost_center_id,
        description: body.description,
        external_reference: body.external_reference,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_charge.updated',
        entityType: 'student_charge',
        entityId: row.id,
        oldValues: serializeStudentCharge(before),
        newValues: serializeStudentCharge(row),
        description: `تعديل مطالبة مالية ${row.charge_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentCharge(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
