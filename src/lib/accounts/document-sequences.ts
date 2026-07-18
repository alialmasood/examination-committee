import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { toDateOnly } from './fiscal';

/**
 * يجب أن تبقى هذه القائمة متزامنة مع بذر accounts.document_sequence_types
 * في db/migrations/073_document_sequence_types.sql (نفس document_type/prefix).
 * الجدول المرجعي في القاعدة هو الآن مصدر قيد التحقق (FK) على document_sequences.document_type،
 * وهذه القائمة تبقى مصدر التوليد الفعلي من الكود (createDefaultSequencesForYear).
 */
export const DOCUMENT_SEQUENCE_DEFAULTS = [
  { document_type: 'JOURNAL_ENTRY', prefix: 'JV' },
  { document_type: 'RECEIPT_VOUCHER', prefix: 'RV' },
  { document_type: 'PAYMENT_VOUCHER', prefix: 'PV' },
  { document_type: 'FINANCIAL_TRANSFER', prefix: 'TR' },
  { document_type: 'OPENING_BALANCE', prefix: 'OB' },
  { document_type: 'BANK_RECEIPT_VOUCHER', prefix: 'BRV' },
  { document_type: 'BANK_PAYMENT_VOUCHER', prefix: 'BPV' },
  { document_type: 'BANK_TRANSFER_VOUCHER', prefix: 'BTR' },
  { document_type: 'BANK_STATEMENT', prefix: 'BST' },
  { document_type: 'STUDENT_ACCOUNT', prefix: 'STA' },
  { document_type: 'STUDENT_CHARGE', prefix: 'SCH' },
  { document_type: 'SUPPLIER', prefix: 'SUP' },
  { document_type: 'SUPPLIER_ACCOUNT', prefix: 'SPA' },
  { document_type: 'SUPPLIER_INVOICE', prefix: 'SIN' },
  { document_type: 'SUPPLIER_PAYMENT', prefix: 'SPY' },
  { document_type: 'DIRECT_EXPENSE', prefix: 'DEX' },
  { document_type: 'PURCHASE_REQUISITION', prefix: 'PRQ' },
  { document_type: 'PURCHASE_ORDER', prefix: 'POR' },
  { document_type: 'PURCHASE_RECEIPT', prefix: 'PRC' },
  { document_type: 'FIXED_ASSET', prefix: 'AST' },
  { document_type: 'ASSET_MOVEMENT', prefix: 'AMV' },
  { document_type: 'DEPRECIATION_RUN', prefix: 'DPR' },
  { document_type: 'ASSET_DISPOSAL', prefix: 'ADS' },
] as const;

export type DocumentType = (typeof DOCUMENT_SEQUENCE_DEFAULTS)[number]['document_type'];

export async function createDefaultSequencesForYear(
  client: TxClient,
  fiscalYearId: string
): Promise<void> {
  for (const seq of DOCUMENT_SEQUENCE_DEFAULTS) {
    await txQuery(
      client,
      `INSERT INTO accounts.document_sequences
        (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
       VALUES ($1, $2, $3, 0, 6, TRUE, TRUE)`,
      [seq.document_type, fiscalYearId, seq.prefix]
    );
  }
}

function padNumber(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatDocumentNumber(params: {
  prefix: string;
  yearLabel: string;
  number: number;
  paddingLength: number;
}): string {
  return `${params.prefix}-${params.yearLabel}-${padNumber(params.number, params.paddingLength)}`;
}

export function yearLabelFromDate(startDate: string | Date): string {
  if (typeof startDate === 'string') {
    const raw = startDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 4);
  }
  if (startDate instanceof Date && !Number.isNaN(startDate.getTime())) {
    // أعمدة DATE من pg تُعاد كمنتصف ليل محلي — استخدم المكونات المحلية
    return String(startDate.getFullYear());
  }
  return toDateOnly(startDate).slice(0, 4);
}

/** تحويل آمن لتاريخ DATE قادم من PostgreSQL بدون إزاحة UTC */
export function pgDateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return toDateOnly(value);
}

/**
 * استخراج الرقم التالي داخل معاملة مع قفل الصف.
 * للاستخدام في الخطوات القادمة — لا يُستدعى من واجهة الخطوة 0.
 */
export async function nextDocumentNumber(
  client: TxClient,
  params: {
    documentType: DocumentType | string;
    fiscalYearId: string;
    yearLabel: string;
  }
): Promise<{ number: number; formatted: string; sequenceId: string }> {
  const locked = await txQuery<{
    id: string;
    prefix: string;
    current_number: number;
    padding_length: number;
    is_active: boolean;
  }>(
    client,
    `SELECT id, prefix, current_number, padding_length, is_active
     FROM accounts.document_sequences
     WHERE document_type = $1 AND fiscal_year_id = $2
     FOR UPDATE`,
    [params.documentType, params.fiscalYearId]
  );

  if (locked.rows.length === 0) {
    throw new Error('تسلسل المستند غير موجود لهذه السنة المالية');
  }

  const row = locked.rows[0];
  if (!row.is_active) {
    throw new Error('تسلسل المستند غير نشط');
  }

  const next = row.current_number + 1;
  await txQuery(
    client,
    `UPDATE accounts.document_sequences
     SET current_number = $1, updated_at = NOW()
     WHERE id = $2`,
    [next, row.id]
  );

  return {
    number: next,
    sequenceId: row.id,
    formatted: formatDocumentNumber({
      prefix: row.prefix,
      yearLabel: params.yearLabel,
      number: next,
      paddingLength: row.padding_length,
    }),
  };
}

export function previewDocumentNumber(params: {
  prefix: string;
  yearLabel: string;
  currentNumber: number;
  paddingLength: number;
}): string {
  return formatDocumentNumber({
    prefix: params.prefix,
    yearLabel: params.yearLabel,
    number: params.currentNumber + 1,
    paddingLength: params.paddingLength,
  });
}
