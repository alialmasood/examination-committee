/* eslint-disable @typescript-eslint/no-explicit-any */

export const API = {
  options: '/api/accounts/purchasing/options',
  requisitions: '/api/accounts/purchase-requisitions',
  orders: '/api/accounts/purchase-orders',
  ordersFromReq: '/api/accounts/purchase-orders/from-requisition',
  receipts: '/api/accounts/purchase-receipts',
  invoiceFromPo: '/api/accounts/supplier-invoices/from-purchase-order',
} as const;

export async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: 'include', ...init });
  return r.json();
}

export const REQ_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  SUBMITTED: 'مقدّم',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغى',
  PARTIALLY_ORDERED: 'مطلوب جزئياً',
  ORDERED: 'مطلوب بالكامل',
};

export const PO_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  SUBMITTED: 'مقدّم',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغى',
  PARTIALLY_RECEIVED: 'استلام جزئي',
  RECEIVED: 'مستلم',
  PARTIALLY_INVOICED: 'مفوتر جزئياً',
  CLOSED: 'مغلق',
};

export const RECEIPT_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  VOID: 'ملغى',
};

export const KIND_LABEL: Record<string, string> = {
  SERVICE: 'خدمة',
  NON_STOCK_ITEM: 'مادة غير مخزنة',
  FIXED_ASSET_CANDIDATE: 'مرشّح أصل ثابت',
  OTHER: 'أخرى',
};

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'منخفضة',
  NORMAL: 'عادية',
  HIGH: 'عالية',
  URGENT: 'عاجلة',
};

export function statusLabel(map: Record<string, string>, s: string) {
  return map[s] ?? s;
}

export function errMsg(r: any) {
  return r?.error || r?.message || 'تعذر تنفيذ العملية';
}

export const emptyLine = () => ({
  purchase_kind: 'SERVICE',
  description: '',
  requested_quantity: '1',
  estimated_unit_price: '0',
  expense_gl_account_id: '',
});

export const emptyPoLine = () => ({
  purchase_kind: 'SERVICE',
  description: '',
  ordered_quantity: '1',
  unit_price: '0',
  expense_gl_account_id: '',
});
