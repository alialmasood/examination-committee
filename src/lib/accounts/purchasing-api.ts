import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from './auth';
import { writeFinancialAudit } from './audit';
import { withTransaction } from './with-transaction';
import {
  PURCHASING_CAPABILITIES as C,
  assertPurchasingCapability,
  type PurchasingCapability,
} from './purchasing-access';
import {
  approvePurchaseRequisition,
  cancelPurchaseRequisition,
  createPurchaseRequisition,
  listPurchaseRequisitionLines,
  listPurchaseRequisitions,
  loadPurchaseRequisition,
  rejectPurchaseRequisition,
  serializePurchaseRequisition,
  serializePurchaseRequisitionLine,
  submitPurchaseRequisition,
  updatePurchaseRequisition,
} from './purchase-requisitions';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrderFromRequisition,
  listPurchaseOrderLines,
  listPurchaseOrders,
  loadPurchaseOrder,
  rejectPurchaseOrder,
  serializePurchaseOrder,
  serializePurchaseOrderLine,
  submitPurchaseOrder,
  updatePurchaseOrder,
} from './purchase-orders';
import {
  createPurchaseReceipt,
  listPurchaseReceiptLines,
  listPurchaseReceipts,
  loadPurchaseReceipt,
  postPurchaseReceipt,
  serializePurchaseReceipt,
  serializePurchaseReceiptLine,
  updatePurchaseReceipt,
  voidPurchaseReceipt,
} from './purchase-receipts';
import {
  createSupplierInvoiceFromPurchaseOrder,
  getPriceTolerancePercent,
  listMatchablePoLines,
  serializeSupplierInvoiceLine,
} from './purchase-invoice-matching';
import { serializeSupplierInvoice } from './supplier-invoices';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown) =>
  e instanceof AccountsHttpError ? jsonError(e.message, e.status) : mapPgError(e);
const page = (x: string | null, d: number) => Math.max(1, Number(x || d));

async function access(request: NextRequest, cap: PurchasingCapability) {
  const a = await requireAccountsAccess(request);
  if (isAuthFailure(a)) return a;
  await assertPurchasingCapability(null, a.user.id, cap);
  return a;
}

export async function requisitions(request: NextRequest) {
  const a = await access(
    request,
    request.method === 'GET' ? C.REQ_VIEW : C.REQ_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    if (request.method === 'GET') {
      const s = request.nextUrl.searchParams;
      const r = await withTransaction((c) =>
        listPurchaseRequisitions(c, {
          q: s.get('q') || '',
          status: s.get('status'),
          requested_by: s.get('requested_by'),
          page: page(s.get('page'), 1),
          page_size: Math.min(100, page(s.get('page_size'), 20)),
        })
      );
      return jsonSuccess({
        data: r.rows.map(serializePurchaseRequisition),
        pagination: {
          page: r.page,
          page_size: r.page_size,
          total: r.total,
          total_pages: Math.ceil(r.total / r.page_size) || 1,
        },
      });
    }
    const b = await request.json();
    const r = await withTransaction(async (c) => {
      const x = await createPurchaseRequisition(c, { ...b, created_by: a.user.id });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_REQUISITION_CREATED',
        entityType: 'purchase_requisition',
        entityId: x.id,
        newValues: serializePurchaseRequisition(x),
        description: `إنشاء طلب شراء ${x.requisition_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseRequisition(r) }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function requisition(request: NextRequest, ctx: Ctx) {
  const a = await access(
    request,
    request.method === 'GET' ? C.REQ_VIEW : C.REQ_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    if (request.method === 'GET') {
      const r = await withTransaction(async (c) => {
        const header = await loadPurchaseRequisition(c, id);
        const lines = await listPurchaseRequisitionLines(c, id);
        return { header, lines };
      });
      return jsonSuccess({
        data: {
          ...serializePurchaseRequisition(r.header),
          lines: r.lines.map(serializePurchaseRequisitionLine),
        },
      });
    }
    const b = await request.json();
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseRequisition(c, id);
      const x = await updatePurchaseRequisition(c, { id, userId: a.user.id, ...b });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_REQUISITION_UPDATED',
        entityType: 'purchase_requisition',
        entityId: id,
        oldValues: serializePurchaseRequisition(before),
        newValues: serializePurchaseRequisition(x),
        description: `تعديل طلب شراء ${x.requisition_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseRequisition(r) });
  } catch (e) {
    return fail(e);
  }
}

export async function requisitionTransition(
  request: NextRequest,
  ctx: Ctx,
  action: 'submit' | 'approve' | 'reject' | 'cancel'
) {
  const cap =
    action === 'submit'
      ? C.REQ_SUBMIT
      : action === 'approve'
        ? C.REQ_APPROVE
        : action === 'reject'
          ? C.REQ_REJECT
          : C.REQ_CANCEL;
  const a = await access(request, cap);
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    const b = await request.json().catch(() => ({}));
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseRequisition(c, id);
      const x =
        action === 'submit'
          ? await submitPurchaseRequisition(c, { id, userId: a.user.id, ...b })
          : action === 'approve'
            ? await approvePurchaseRequisition(c, { id, userId: a.user.id, ...b })
            : action === 'reject'
              ? await rejectPurchaseRequisition(c, { id, userId: a.user.id, ...b })
              : await cancelPurchaseRequisition(c, { id, userId: a.user.id, ...b });
      const auditAction =
        action === 'submit'
          ? 'PURCHASE_REQUISITION_SUBMITTED'
          : action === 'approve'
            ? 'PURCHASE_REQUISITION_APPROVED'
            : action === 'reject'
              ? 'PURCHASE_REQUISITION_REJECTED'
              : 'PURCHASE_REQUISITION_CANCELLED';
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: auditAction,
        entityType: 'purchase_requisition',
        entityId: id,
        oldValues: serializePurchaseRequisition(before),
        newValues: serializePurchaseRequisition(x),
        description: `${action} طلب شراء ${x.requisition_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseRequisition(r) });
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseOrders(request: NextRequest) {
  const a = await access(
    request,
    request.method === 'GET' ? C.PO_VIEW : C.PO_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    if (request.method === 'GET') {
      const s = request.nextUrl.searchParams;
      const r = await withTransaction((c) =>
        listPurchaseOrders(c, {
          q: s.get('q') || '',
          status: s.get('status'),
          supplier_id: s.get('supplier_id'),
          requisition_id: s.get('requisition_id'),
          page: page(s.get('page'), 1),
          page_size: Math.min(100, page(s.get('page_size'), 20)),
        })
      );
      return jsonSuccess({
        data: r.rows.map(serializePurchaseOrder),
        pagination: {
          page: r.page,
          page_size: r.page_size,
          total: r.total,
          total_pages: Math.ceil(r.total / r.page_size) || 1,
        },
      });
    }
    const b = await request.json();
    await assertPurchasingCapability(null, a.user.id, C.PO_DIRECT);
    const r = await withTransaction(async (c) => {
      const x = await createPurchaseOrder(c, { ...b, created_by: a.user.id });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_ORDER_CREATED',
        entityType: 'purchase_order',
        entityId: x.id,
        newValues: serializePurchaseOrder(x),
        description: `إنشاء أمر شراء ${x.purchase_order_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseOrder(r) }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseOrder(request: NextRequest, ctx: Ctx) {
  const a = await access(
    request,
    request.method === 'GET' ? C.PO_VIEW : C.PO_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    if (request.method === 'GET') {
      const r = await withTransaction(async (c) => {
        const header = await loadPurchaseOrder(c, id);
        const lines = await listPurchaseOrderLines(c, id);
        return { header, lines };
      });
      return jsonSuccess({
        data: {
          ...serializePurchaseOrder(r.header),
          lines: r.lines.map(serializePurchaseOrderLine),
        },
      });
    }
    const b = await request.json();
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseOrder(c, id);
      const x = await updatePurchaseOrder(c, { id, userId: a.user.id, ...b });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_ORDER_UPDATED',
        entityType: 'purchase_order',
        entityId: id,
        oldValues: serializePurchaseOrder(before),
        newValues: serializePurchaseOrder(x),
        description: `تعديل أمر شراء ${x.purchase_order_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseOrder(r) });
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseOrderFromRequisition(request: NextRequest) {
  const a = await access(request, C.PO_PREPARE);
  if (isAuthFailure(a)) return a.response;
  try {
    const b = await request.json();
    const reqId = String(b.requisition_id ?? '').trim();
    if (!reqId) throw new AccountsHttpError('معرّف طلب الشراء مطلوب', 400);
    const r = await withTransaction(async (c) => {
      const x = await createPurchaseOrderFromRequisition(c, {
        requisitionId: reqId,
        supplier_account_id: b.supplier_account_id,
        lines: b.lines,
        order_date: b.order_date,
        expected_delivery_date: b.expected_delivery_date,
        payment_terms_days: b.payment_terms_days,
        delivery_location: b.delivery_location,
        description: b.description,
        userId: a.user.id,
      });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_ORDER_FROM_REQUISITION',
        entityType: 'purchase_order',
        entityId: x.id,
        newValues: serializePurchaseOrder(x),
        description: `إنشاء أمر شراء ${x.purchase_order_number} من طلب ${reqId}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseOrder(r) }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseOrderTransition(
  request: NextRequest,
  ctx: Ctx,
  action: 'submit' | 'approve' | 'reject' | 'cancel' | 'close'
) {
  const cap =
    action === 'submit'
      ? C.PO_SUBMIT
      : action === 'approve'
        ? C.PO_APPROVE
        : action === 'reject'
          ? C.PO_REJECT
          : action === 'cancel'
            ? C.PO_CANCEL
            : C.PO_CANCEL;
  const a = await access(request, cap);
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    const b = await request.json().catch(() => ({}));
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseOrder(c, id);
      const x =
        action === 'submit'
          ? await submitPurchaseOrder(c, { id, userId: a.user.id, ...b })
          : action === 'approve'
            ? await approvePurchaseOrder(c, { id, userId: a.user.id, ...b })
            : action === 'reject'
              ? await rejectPurchaseOrder(c, { id, userId: a.user.id, ...b })
              : action === 'cancel'
                ? await cancelPurchaseOrder(c, { id, userId: a.user.id, ...b })
                : await closePurchaseOrder(c, { id, userId: a.user.id, ...b });
      const auditAction =
        action === 'submit'
          ? 'PURCHASE_ORDER_SUBMITTED'
          : action === 'approve'
            ? 'PURCHASE_ORDER_APPROVED'
            : action === 'reject'
              ? 'PURCHASE_ORDER_REJECTED'
              : action === 'cancel'
                ? 'PURCHASE_ORDER_CANCELLED'
                : 'PURCHASE_ORDER_CLOSED';
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: auditAction,
        entityType: 'purchase_order',
        entityId: id,
        oldValues: serializePurchaseOrder(before),
        newValues: serializePurchaseOrder(x),
        description: `${auditAction} ${x.purchase_order_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseOrder(r) });
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseOrderMatchableLines(request: NextRequest, ctx: Ctx) {
  const a = await access(request, C.MATCH_VIEW);
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    const r = await withTransaction(async (c) => {
      const lines = await listMatchablePoLines(c, id);
      const tolerance = await getPriceTolerancePercent(c);
      return { lines, price_tolerance_percent: tolerance };
    });
    return jsonSuccess({ data: r });
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseReceipts(request: NextRequest) {
  const a = await access(
    request,
    request.method === 'GET' ? C.RECEIPT_VIEW : C.RECEIPT_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    if (request.method === 'GET') {
      const s = request.nextUrl.searchParams;
      const r = await withTransaction((c) =>
        listPurchaseReceipts(c, {
          q: s.get('q') || '',
          status: s.get('status'),
          purchase_order_id: s.get('purchase_order_id'),
          supplier_id: s.get('supplier_id'),
          page: page(s.get('page'), 1),
          page_size: Math.min(100, page(s.get('page_size'), 20)),
        })
      );
      return jsonSuccess({
        data: r.rows.map(serializePurchaseReceipt),
        pagination: {
          page: r.page,
          page_size: r.page_size,
          total: r.total,
          total_pages: Math.ceil(r.total / r.page_size) || 1,
        },
      });
    }
    const b = await request.json();
    const r = await withTransaction(async (c) => {
      const x = await createPurchaseReceipt(c, { ...b, created_by: a.user.id });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_RECEIPT_CREATED',
        entityType: 'purchase_receipt',
        entityId: x.id,
        newValues: serializePurchaseReceipt(x),
        description: `إنشاء محضر استلام ${x.receipt_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseReceipt(r) }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseReceipt(request: NextRequest, ctx: Ctx) {
  const a = await access(
    request,
    request.method === 'GET' ? C.RECEIPT_VIEW : C.RECEIPT_PREPARE
  );
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    if (request.method === 'GET') {
      const r = await withTransaction(async (c) => {
        const header = await loadPurchaseReceipt(c, id);
        const lines = await listPurchaseReceiptLines(c, id);
        return { header, lines };
      });
      return jsonSuccess({
        data: {
          ...serializePurchaseReceipt(r.header),
          lines: r.lines.map(serializePurchaseReceiptLine),
        },
      });
    }
    const b = await request.json();
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseReceipt(c, id);
      const x = await updatePurchaseReceipt(c, { id, userId: a.user.id, ...b });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'PURCHASE_RECEIPT_UPDATED',
        entityType: 'purchase_receipt',
        entityId: id,
        oldValues: serializePurchaseReceipt(before),
        newValues: serializePurchaseReceipt(x),
        description: `تعديل محضر استلام ${x.receipt_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess({ data: serializePurchaseReceipt(r) });
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseReceiptTransition(
  request: NextRequest,
  ctx: Ctx,
  action: 'post' | 'void'
) {
  const a = await access(
    request,
    action === 'post' ? C.RECEIPT_POST : C.RECEIPT_VOID
  );
  if (isAuthFailure(a)) return a.response;
  try {
    const { id } = await ctx.params;
    const b = await request.json().catch(() => ({}));
    const r = await withTransaction(async (c) => {
      const before = await loadPurchaseReceipt(c, id);
      const x =
        action === 'post'
          ? await postPurchaseReceipt(c, { id, userId: a.user.id, ...b })
          : await voidPurchaseReceipt(c, { id, userId: a.user.id, ...b });
      const row = 'receipt' in x ? x.receipt : x;
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action:
          action === 'post' ? 'PURCHASE_RECEIPT_POSTED' : 'PURCHASE_RECEIPT_VOIDED',
        entityType: 'purchase_receipt',
        entityId: id,
        oldValues: serializePurchaseReceipt(before),
        newValues: serializePurchaseReceipt(row),
        description: `${action === 'post' ? 'ترحيل' : 'إلغاء'} محضر استلام ${row.receipt_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    const row = 'receipt' in r ? r.receipt : r;
    return jsonSuccess({
      data: serializePurchaseReceipt(row),
      ...('created' in r ? { created: r.created } : {}),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function supplierInvoiceFromPurchaseOrder(request: NextRequest) {
  const a = await access(request, C.MATCH_PREPARE);
  if (isAuthFailure(a)) return a.response;
  try {
    const b = await request.json();
    if (b.override_tolerance === true) {
      await assertPurchasingCapability(null, a.user.id, C.MATCH_OVERRIDE);
    }
    const r = await withTransaction(async (c) => {
      const x = await createSupplierInvoiceFromPurchaseOrder(c, {
        ...b,
        created_by: a.user.id,
      });
      await writeFinancialAudit(c, {
        userId: a.user.id,
        action: 'SUPPLIER_INVOICE_FROM_PO_CREATED',
        entityType: 'supplier_invoice',
        entityId: x.invoice.id,
        newValues: {
          ...serializeSupplierInvoice(x.invoice),
          lines: x.lines.map(serializeSupplierInvoiceLine),
        },
        description: `إنشاء فاتورة من أمر شراء ${x.invoice.invoice_number}`,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
      });
      return x;
    });
    return jsonSuccess(
      {
        data: {
          ...serializeSupplierInvoice(r.invoice),
          lines: r.lines.map(serializeSupplierInvoiceLine),
        },
      },
      201
    );
  } catch (e) {
    return fail(e);
  }
}

function countsByStatus(rows: { status: string; cnt: number }[]) {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.cnt;
  return out;
}

export async function purchasingOptions(request: NextRequest) {
  const a = await access(request, C.REQ_VIEW);
  if (isAuthFailure(a)) return a.response;
  try {
    const dashboard = request.nextUrl.searchParams.get('dashboard') === '1';
    const [suppliers, glAccounts, costCenters, departments, tolerance] = await Promise.all([
      query(
        `SELECT sa.id AS supplier_account_id, sa.account_number, sa.currency_code,
                s.id AS supplier_id, s.supplier_number, s.name_ar, s.status
         FROM accounts.supplier_accounts sa
         JOIN accounts.suppliers s ON s.id = sa.supplier_id
         WHERE sa.status = 'ACTIVE' AND s.status = 'ACTIVE'
         ORDER BY s.supplier_number`
      ),
      query(
        `SELECT id, code, name_ar FROM accounts.chart_of_accounts
         WHERE account_type = 'EXPENSE' AND is_active = TRUE AND allows_posting = TRUE
         ORDER BY code`
      ),
      query(
        `SELECT id, code, name_ar FROM accounts.cost_centers
         WHERE is_active = TRUE ORDER BY code`
      ),
      query(`SELECT id, name_ar FROM student_affairs.departments ORDER BY name_ar`),
      withTransaction((c) => getPriceTolerancePercent(c)),
    ]);

    const base = {
      supplier_accounts: suppliers.rows,
      expense_gl_accounts: glAccounts.rows,
      cost_centers: costCenters.rows,
      departments: departments.rows,
      price_tolerance_percent: tolerance,
      purchase_kinds: [
        'SERVICE',
        'NON_STOCK_ITEM',
        'FIXED_ASSET_CANDIDATE',
        'OTHER',
      ],
      requisition_priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      requisition_statuses: [
        'DRAFT',
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'PARTIALLY_ORDERED',
        'ORDERED',
      ],
      purchase_order_statuses: [
        'DRAFT',
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'PARTIALLY_INVOICED',
        'CLOSED',
      ],
      receipt_statuses: ['DRAFT', 'POSTED', 'VOID'],
    };

    if (!dashboard) {
      return jsonSuccess({ data: base });
    }

    const [reqCounts, poCounts, receiptCounts, openPos, pendingReceiptPos] =
      await Promise.all([
        query(
          `SELECT status, COUNT(*)::int cnt FROM accounts.purchase_requisitions GROUP BY status`
        ),
        query(
          `SELECT status, COUNT(*)::int cnt FROM accounts.purchase_orders GROUP BY status`
        ),
        query(
          `SELECT status, COUNT(*)::int cnt FROM accounts.purchase_receipts GROUP BY status`
        ),
        query(
          `SELECT po.id, po.purchase_order_number, po.status, po.order_date,
                  s.name_ar AS supplier_name_ar
           FROM accounts.purchase_orders po
           JOIN accounts.suppliers s ON s.id = po.supplier_id
           WHERE po.status IN ('APPROVED','PARTIALLY_RECEIVED','PARTIALLY_INVOICED','RECEIVED')
           ORDER BY po.order_date DESC, po.created_at DESC
           LIMIT 30`
        ),
        query(
          `SELECT COUNT(*)::int cnt FROM accounts.purchase_orders
           WHERE status IN ('APPROVED','PARTIALLY_RECEIVED')`
        ),
      ]);

    return jsonSuccess({
      data: {
        ...base,
        dashboard: {
          requisitions: countsByStatus(
            reqCounts.rows as Array<{ status: string; cnt: number }>
          ),
          purchase_orders: countsByStatus(
            poCounts.rows as Array<{ status: string; cnt: number }>
          ),
          receipts: countsByStatus(
            receiptCounts.rows as Array<{ status: string; cnt: number }>
          ),
          open_purchase_orders: openPos.rows,
          pending_receipt_count: pendingReceiptPos.rows[0]?.cnt ?? 0,
          draft_receipt_count: receiptCounts.rows.find((r) => r.status === 'DRAFT')?.cnt ?? 0,
        },
      },
    });
  } catch (e) {
    return fail(e);
  }
}
