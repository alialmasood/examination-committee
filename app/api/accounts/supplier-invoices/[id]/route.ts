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
  loadSupplierInvoice,
  serializeSupplierInvoice,
  updateSupplierInvoice,
} from '@/src/lib/accounts/supplier-invoices';
import {
  SUPPLIER_PAYABLES_CAPABILITIES,
  assertSupplierPayablesCapability,
} from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertSupplierPayablesCapability(
      null,
      auth.user.id,
      SUPPLIER_PAYABLES_CAPABILITIES.VIEW
    );
    const { id } = await context.params;
    const r = await query(
      `SELECT si.*,
              s.name_ar AS supplier_name_ar,
              s.supplier_number,
              sa.account_number,
              eg.code AS expense_gl_code,
              eg.name_ar AS expense_gl_name_ar,
              pg.code AS payable_gl_code,
              cc.code AS cost_center_code,
              cc.name_ar AS cost_center_name_ar,
              sit.code AS invoice_type_code,
              sit.name_ar AS invoice_type_name_ar,
              je.entry_number AS journal_entry_number,
              rje.entry_number AS reversal_journal_entry_number
       FROM accounts.supplier_invoices si
       JOIN accounts.suppliers s ON s.id = si.supplier_id
       JOIN accounts.supplier_accounts sa ON sa.id = si.supplier_account_id
       LEFT JOIN accounts.chart_of_accounts eg ON eg.id = si.expense_gl_account_id
       LEFT JOIN accounts.chart_of_accounts pg ON pg.id = sa.payable_gl_account_id
       LEFT JOIN accounts.cost_centers cc ON cc.id = si.cost_center_id
       LEFT JOIN accounts.supplier_invoice_types sit ON sit.id = si.invoice_type_id
       LEFT JOIN accounts.journal_entries je ON je.id = si.journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = si.reversal_journal_entry_id
       WHERE si.id = $1::uuid`,
      [id]
    );
    if (!r.rows[0]) return jsonError('فاتورة المورد غير موجودة', 404);
    const row = r.rows[0] as Record<string, unknown>;
    return jsonSuccess({
      data: {
        ...serializeSupplierInvoice(row as never),
        supplier_name_ar: row.supplier_name_ar ?? null,
        supplier_number: row.supplier_number ?? null,
        account_number: row.account_number ?? null,
        expense_gl_code: row.expense_gl_code ?? null,
        expense_gl_name_ar: row.expense_gl_name_ar ?? null,
        payable_gl_code: row.payable_gl_code ?? null,
        cost_center_code: row.cost_center_code ?? null,
        cost_center_name_ar: row.cost_center_name_ar ?? null,
        invoice_type_code: row.invoice_type_code ?? null,
        invoice_type_name_ar: row.invoice_type_name_ar ?? null,
        journal_entry_number: row.journal_entry_number ?? null,
        reversal_journal_entry_number: row.reversal_journal_entry_number ?? null,
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError
      ? jsonError(error.message, error.status)
      : mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    // لا تقبل نقل المورد أو تغيير الحالة/outstanding يدوياً
    const {
      supplier_id: _sid,
      supplier_account_id: _said,
      status: _st,
      outstanding_amount: _oa,
      total_amount: _ta,
      journal_entry_id: _je,
      ...safe
    } = body;
    void _sid;
    void _said;
    void _st;
    void _oa;
    void _ta;
    void _je;

    const row = await withTransaction(async (client) => {
      await assertSupplierPayablesCapability(
        client,
        auth.user.id,
        SUPPLIER_PAYABLES_CAPABILITIES.INVOICES_PREPARE
      );
      const before = await loadSupplierInvoice(client, id);
      const r = await updateSupplierInvoice(client, {
        id,
        userId: auth.user.id,
        ...safe,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'SUPPLIER_INVOICE_UPDATED',
        entityType: 'supplier_invoice',
        entityId: id,
        oldValues: serializeSupplierInvoice(before),
        newValues: serializeSupplierInvoice(r),
        description: `تعديل فاتورة مورد ${r.invoice_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return r;
    });
    return jsonSuccess({ data: serializeSupplierInvoice(row) });
  } catch (error) {
    return error instanceof AccountsHttpError
      ? jsonError(error.message, error.status)
      : mapPgError(error);
  }
}
