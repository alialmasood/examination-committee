/**
 * أقفال استشارية على مستوى المورد المحاسبي (بدل الأقفال العالمية للبنوك/الصناديق).
 *
 * - مفتاح ثابت: domain + resourceId عبر PostgreSQL hashtext (مستقر داخل نفس القاعدة).
 * - جميع الأقفال داخل معاملة (pg_advisory_xact_lock).
 * - موارد متعددة: normalize → dedupe → sort → acquire بالترتيب.
 * - بعدها يُفضَّل FOR UPDATE على الصفوف الفعلية.
 *
 * لا تستخدم hash عشوائي من JavaScript.
 */
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

/** فضاء أسماء int4 للأقفال — منفصل عن 58001xxx العالمية القديمة */
export const ADVISORY_LOCK_NAMESPACE_ACCOUNTING_RESOURCE = 58002001;

export type AccountingLockDomain =
  | 'BANK_ACCOUNT'
  | 'BANK_GL'
  | 'BANK_STATEMENT'
  | 'CASHBOX'
  | 'CASH_SESSION'
  | 'DOCUMENT_SEQUENCE'
  | 'JOURNAL_SOURCE'
  | 'CHART_ACCOUNT'
  | 'STUDENT_ACCOUNT'
  | 'STUDENT_CHARGE'
  | 'STUDENT_LEDGER'
  | 'STUDENT_BILLING_PLAN'
  | 'STUDENT_INSTALLMENT'
  | 'STUDENT_COLLECTION'
  | 'STUDENT_RELIEF'
  | 'STUDENT_CREDIT_NOTE'
  | 'STUDENT_REFUND'
  | 'SUPPLIER'
  | 'SUPPLIER_ACCOUNT'
  | 'SUPPLIER_INVOICE'
  | 'SUPPLIER_LEDGER'
  | 'SUPPLIER_PAYMENT'
  | 'DIRECT_EXPENSE'
  | 'PURCHASE_REQUISITION'
  | 'PURCHASE_REQUISITION_LINE'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_ORDER_LINE'
  | 'PURCHASE_RECEIPT'
  | 'PURCHASE_RECEIPT_LINE'
  | 'SUPPLIER_INVOICE_MATCH'
  | 'GL_ACCOUNT';

export type AccountingLockResource = {
  domain: AccountingLockDomain;
  /** معرّف المورد (UUID أو مفتاح مركّب مثل SEQUENCE:TYPE:YEAR) */
  resourceId: string;
};

export function accountingLockKey(
  domain: AccountingLockDomain,
  resourceId: string
): string {
  const id = String(resourceId ?? '').trim();
  if (!id) {
    throw new Error(`accountingLockKey: resourceId فارغ لـ ${domain}`);
  }
  return `${domain}:${id}`;
}

function normalizeResources(
  resources: AccountingLockResource[]
): AccountingLockResource[] {
  const map = new Map<string, AccountingLockResource>();
  for (const r of resources) {
    if (!r?.domain || !r.resourceId) continue;
    const id = String(r.resourceId).trim();
    if (!id) continue;
    const key = accountingLockKey(r.domain, id);
    if (!map.has(key)) {
      map.set(key, { domain: r.domain, resourceId: id });
    }
  }
  return [...map.values()].sort((a, b) =>
    accountingLockKey(a.domain, a.resourceId).localeCompare(
      accountingLockKey(b.domain, b.resourceId),
      'en'
    )
  );
}

/**
 * يحصل على أقفال استشارية مرتّبة لمجوعة موارد.
 * يعيد قائمة المفاتيح التي أُقفلت (مفيدة للاختبارات).
 */
export async function acquireAccountingResourceLocks(
  client: TxClient,
  resources: AccountingLockResource[]
): Promise<string[]> {
  const ordered = normalizeResources(resources);
  const keys: string[] = [];
  for (const r of ordered) {
    const key = accountingLockKey(r.domain, r.resourceId);
    await txQuery(
      client,
      `SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))`,
      [ADVISORY_LOCK_NAMESPACE_ACCOUNTING_RESOURCE, key]
    );
    keys.push(key);
  }
  return keys;
}

/** مساعدات بناء موارد شائعة */
export function bankAccountLock(id: string): AccountingLockResource {
  return { domain: 'BANK_ACCOUNT', resourceId: id };
}
export function bankGlLock(glAccountId: string): AccountingLockResource {
  return { domain: 'BANK_GL', resourceId: glAccountId };
}
export function bankStatementLock(id: string): AccountingLockResource {
  return { domain: 'BANK_STATEMENT', resourceId: id };
}
export function cashboxLock(id: string): AccountingLockResource {
  return { domain: 'CASHBOX', resourceId: id };
}
export function cashSessionLock(id: string): AccountingLockResource {
  return { domain: 'CASH_SESSION', resourceId: id };
}
export function chartAccountLock(id: string): AccountingLockResource {
  return { domain: 'CHART_ACCOUNT', resourceId: id };
}
export function documentSequenceLock(
  documentType: string,
  fiscalYearId: string
): AccountingLockResource {
  return {
    domain: 'DOCUMENT_SEQUENCE',
    resourceId: `${documentType}:${fiscalYearId}`,
  };
}
export function journalSourceLock(
  sourceType: string,
  sourceId: string
): AccountingLockResource {
  return {
    domain: 'JOURNAL_SOURCE',
    resourceId: `${sourceType}:${sourceId}`,
  };
}
export function studentAccountLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_ACCOUNT', resourceId: id };
}
export function studentChargeLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_CHARGE', resourceId: id };
}
export function studentLedgerLock(studentAccountId: string): AccountingLockResource {
  return { domain: 'STUDENT_LEDGER', resourceId: studentAccountId };
}
export function studentBillingPlanLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_BILLING_PLAN', resourceId: id };
}
export function studentInstallmentLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_INSTALLMENT', resourceId: id };
}
export function studentCollectionLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_COLLECTION', resourceId: id };
}
export function studentReliefLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_RELIEF', resourceId: id };
}
export function studentCreditNoteLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_CREDIT_NOTE', resourceId: id };
}
export function studentRefundLock(id: string): AccountingLockResource {
  return { domain: 'STUDENT_REFUND', resourceId: id };
}
export function supplierLock(id: string): AccountingLockResource {
  return { domain: 'SUPPLIER', resourceId: id };
}
export function supplierAccountLock(id: string): AccountingLockResource {
  return { domain: 'SUPPLIER_ACCOUNT', resourceId: id };
}
export function supplierInvoiceLock(id: string): AccountingLockResource {
  return { domain: 'SUPPLIER_INVOICE', resourceId: id };
}
export function supplierLedgerLock(supplierAccountId: string): AccountingLockResource {
  return { domain: 'SUPPLIER_LEDGER', resourceId: supplierAccountId };
}
export function supplierPaymentLock(id: string): AccountingLockResource {
  return { domain: 'SUPPLIER_PAYMENT', resourceId: id };
}
export function directExpenseLock(id: string): AccountingLockResource {
  return { domain: 'DIRECT_EXPENSE', resourceId: id };
}
export function purchaseRequisitionLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_REQUISITION', resourceId: id };
}
export function purchaseRequisitionLineLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_REQUISITION_LINE', resourceId: id };
}
export function purchaseOrderLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_ORDER', resourceId: id };
}
export function purchaseOrderLineLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_ORDER_LINE', resourceId: id };
}
export function purchaseReceiptLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_RECEIPT', resourceId: id };
}
export function purchaseReceiptLineLock(id: string): AccountingLockResource {
  return { domain: 'PURCHASE_RECEIPT_LINE', resourceId: id };
}
export function supplierInvoiceMatchLock(id: string): AccountingLockResource {
  return { domain: 'SUPPLIER_INVOICE_MATCH', resourceId: id };
}
/** قفل GL للحسابات المستخدمة في ذمم الموردين (6.A) — موازٍ لـ CHART_ACCOUNT */
export function glAccountLock(glAccountId: string): AccountingLockResource {
  return { domain: 'GL_ACCOUNT', resourceId: glAccountId };
}
