/**
 * استيراد/تصدير كشوف الحساب المصرفي بصيغة CSV — المرحلة 4.D.
 *
 * previewBankStatementCsv: تحليل فقط (لا يكتب لقاعدة البيانات) — للمعاينة قبل الاستيراد.
 * commitBankStatementCsv: يطبّق الصفوف الصالحة على كشف موجود (يتجاوز التكرارات ببصمة السطر).
 *
 * الأمان: sanitizeExportCell تحمي من CSV Injection عند التصدير لبرامج جدولية (Excel/Sheets).
 */
import { AccountsHttpError } from './auth';
import {
  assertStatementEditable,
  computeLineFingerprint,
  loadBankStatement,
} from './bank-statements';
import { assertCanReconcileBankAccount } from './bank-account-access';
import { writeFinancialAudit } from './audit';
import { pgDateOnly } from './document-sequences';
import { moneyIsPositive, normalizeMoneyInput, normalizeSignedMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankStatementCsvMappingKey =
  | 'transaction_date'
  | 'value_date'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'balance'
  | 'external_id';

/** مفتاح ← اسم العمود في ملف الـ CSV (مطابقة غير حسّاسة لحالة الأحرف/الفراغات) */
export type BankStatementCsvMapping = Partial<
  Record<BankStatementCsvMappingKey, string>
>;

export type ParsedCsvLine = {
  row_number: number;
  transaction_date: string | null;
  value_date: string | null;
  description: string;
  bank_reference: string | null;
  debit_amount: string;
  credit_amount: string;
  running_balance: string | null;
  external_line_id: string | null;
  fingerprint: string | null;
  valid: boolean;
  errors: string[];
};

export type PreviewCsvResult = {
  delimiter: ',' | ';';
  header: string[];
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  truncated: boolean;
  warnings: string[];
  rows: ParsedCsvLine[];
};

export type CommitCsvResult = {
  imported: number;
  skipped_duplicate: number;
  invalid: number;
  total_input: number;
};

const MAX_PREVIEW_ROWS = 5000;

/**
 * حماية من CSV Injection عند التصدير: إن بدأت الخلية بأحد المحارف = + - @
 * (قد يُفسَّر كصيغة في Excel/Sheets)، يُضاف علامة اقتباس ' في البداية لتعطيل التفسير.
 */
export function sanitizeExportCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

/** يفصل نص CSV إلى صفوف من خلايا نصية — يدعم اقتباس مزدوج "..." وفواصل مضمّنة داخله */
function parseCsvContent(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function detectDelimiter(headerLine: string): ',' | ';' {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function findColumnIndex(header: string[], columnName: string | undefined): number {
  if (!columnName) return -1;
  const needle = columnName.trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === needle);
}

/** يقبل YYYY-MM-DD أو DD/MM/YYYY فقط — أي صيغة أخرى تُعتبر غير صالحة */
function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return pgDateOnly(`${y}-${m}-${d}`);
  }
  const dmyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return pgDateOnly(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  return null;
}

/**
 * يحلّل محتوى CSV (نص UTF-8) دون الكتابة لقاعدة البيانات — للمعاينة قبل التأكيد.
 * الحد الأقصى: 5000 صف بيانات (لا يشمل صف العناوين) — يُقتطع الباقي مع تحذير.
 * فحص حجم الملف (~2MB) على المستدعي (طبقة الـ route) قبل تمرير المحتوى هنا.
 */
export function previewBankStatementCsv(
  content: string,
  mapping: BankStatementCsvMapping
): PreviewCsvResult {
  const trimmed = content.replace(/^\uFEFF/, '');
  if (!trimmed.trim()) {
    throw new AccountsHttpError('ملف CSV فارغ', 400);
  }

  const firstLine = trimmed.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const table = parseCsvContent(trimmed, delimiter);
  if (table.length === 0) {
    throw new AccountsHttpError('لم يتم العثور على بيانات في ملف CSV', 400);
  }

  const header = table[0].map((h) => h.trim());
  const dataRows = table.slice(1);
  const warnings: string[] = [];

  const truncated = dataRows.length > MAX_PREVIEW_ROWS;
  if (truncated) {
    warnings.push(
      `تجاوز عدد الصفوف الحد الأقصى (${MAX_PREVIEW_ROWS}) — تم الاقتصار على أول ${MAX_PREVIEW_ROWS} صفاً`
    );
  }
  const usedRows = truncated ? dataRows.slice(0, MAX_PREVIEW_ROWS) : dataRows;

  const colIdx = {
    transaction_date: findColumnIndex(header, mapping.transaction_date),
    value_date: findColumnIndex(header, mapping.value_date),
    description: findColumnIndex(header, mapping.description),
    reference: findColumnIndex(header, mapping.reference),
    debit: findColumnIndex(header, mapping.debit),
    credit: findColumnIndex(header, mapping.credit),
    balance: findColumnIndex(header, mapping.balance),
    external_id: findColumnIndex(header, mapping.external_id),
  };

  if (colIdx.transaction_date === -1) {
    warnings.push('لم يتم تحديد أو العثور على عمود تاريخ الحركة (transaction_date)');
  }
  if (colIdx.debit === -1 && colIdx.credit === -1) {
    warnings.push('لم يتم تحديد أعمدة المدين/الدائن (debit/credit)');
  }

  const cell = (r: string[], idx: number): string => (idx >= 0 ? (r[idx] ?? '').trim() : '');

  const rows: ParsedCsvLine[] = usedRows.map((r, i) => {
    const rowNumber = i + 1;
    const errors: string[] = [];

    const rawDate = cell(r, colIdx.transaction_date);
    const transactionDate = colIdx.transaction_date >= 0 ? parseCsvDate(rawDate) : null;
    if (colIdx.transaction_date >= 0 && !transactionDate) {
      errors.push('تاريخ الحركة غير صالح (استخدم YYYY-MM-DD أو DD/MM/YYYY)');
    }

    const rawValueDate = cell(r, colIdx.value_date);
    const valueDate = rawValueDate ? parseCsvDate(rawValueDate) : null;
    if (rawValueDate && !valueDate) {
      errors.push('تاريخ القيمة غير صالح');
    }

    const description = cell(r, colIdx.description).slice(0, 4000);
    if (!description) {
      errors.push('الوصف مطلوب');
    }

    const bankReference = cell(r, colIdx.reference).slice(0, 100) || null;
    const externalLineId = cell(r, colIdx.external_id).slice(0, 100) || null;

    let debitAmount = '0.000';
    let creditAmount = '0.000';
    try {
      debitAmount = normalizeMoneyInput(cell(r, colIdx.debit) || '0');
    } catch {
      errors.push('قيمة المدين غير صالحة');
    }
    try {
      creditAmount = normalizeMoneyInput(cell(r, colIdx.credit) || '0');
    } catch {
      errors.push('قيمة الدائن غير صالحة');
    }
    const debitPositive = moneyIsPositive(debitAmount);
    const creditPositive = moneyIsPositive(creditAmount);
    if (debitPositive && creditPositive) {
      errors.push('لا يمكن أن يكون السطر مديناً ودائناً معاً');
    } else if (!debitPositive && !creditPositive) {
      errors.push('يجب أن يحتوي السطر على مبلغ مدين أو دائن أكبر من صفر');
    }

    let runningBalance: string | null = null;
    const rawBalance = cell(r, colIdx.balance);
    if (rawBalance) {
      try {
        runningBalance = normalizeSignedMoneyInput(rawBalance);
      } catch {
        errors.push('قيمة الرصيد الجاري غير صالحة');
      }
    }

    const valid = errors.length === 0;
    const fingerprint =
      valid && transactionDate
        ? computeLineFingerprint({
            transaction_date: transactionDate,
            description,
            bank_reference: bankReference,
            debit_amount: debitAmount,
            credit_amount: creditAmount,
            external_line_id: externalLineId,
          })
        : null;

    return {
      row_number: rowNumber,
      transaction_date: transactionDate,
      value_date: valueDate,
      description,
      bank_reference: bankReference,
      debit_amount: debitAmount,
      credit_amount: creditAmount,
      running_balance: runningBalance,
      external_line_id: externalLineId,
      fingerprint,
      valid,
      errors,
    };
  });

  const validCount = rows.filter((r) => r.valid).length;

  return {
    delimiter,
    header,
    total_rows: dataRows.length,
    valid_count: validCount,
    invalid_count: rows.length - validCount,
    truncated,
    warnings,
    rows,
  };
}

/**
 * يطبّق صفوف تم تحليلها مسبقاً (عبر previewBankStatementCsv) على كشف موجود.
 * يتجاهل الصفوف غير الصالحة ويتخطى المكرر (بصمة موجودة مسبقاً ضمن الكشف أو داخل الدفعة نفسها).
 */
export async function commitBankStatementCsv(
  client: TxClient,
  params: {
    statementId: string;
    rows: ParsedCsvLine[];
    userId: string;
    fileName?: string | null;
  }
): Promise<CommitCsvResult> {
  const statement = await loadBankStatement(client, params.statementId, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  const totalInput = params.rows.length;
  const validRows = params.rows.filter((r) => r.valid && r.fingerprint && r.transaction_date);
  const invalidCount = totalInput - validRows.length;

  const existingRes = await txQuery<{ fingerprint: string }>(
    client,
    `SELECT fingerprint FROM accounts.bank_statement_lines WHERE bank_statement_id = $1::uuid`,
    [statement.id]
  );
  const existingFingerprints = new Set(existingRes.rows.map((r) => r.fingerprint));

  const nextLineRes = await txQuery<{ next: string }>(
    client,
    `SELECT COALESCE(MAX(line_number), 0) + 1 AS next
     FROM accounts.bank_statement_lines WHERE bank_statement_id = $1::uuid`,
    [statement.id]
  );
  let lineNumber = Number(nextLineRes.rows[0]?.next ?? 1);

  let imported = 0;
  let skippedDuplicate = 0;
  const seenInBatch = new Set<string>();

  for (const row of validRows) {
    const fp = row.fingerprint as string;
    if (existingFingerprints.has(fp) || seenInBatch.has(fp)) {
      skippedDuplicate += 1;
      continue;
    }
    seenInBatch.add(fp);

    try {
      await txQuery(
        client,
        `INSERT INTO accounts.bank_statement_lines (
           bank_statement_id, line_number, transaction_date, value_date, description,
           bank_reference, debit_amount, credit_amount, running_balance, currency_code,
           external_line_id, fingerprint
         ) VALUES (
           $1::uuid, $2, $3::date, $4::date, $5,
           $6, $7::numeric, $8::numeric, $9::numeric, $10,
           $11, $12
         )`,
        [
          statement.id,
          lineNumber,
          row.transaction_date,
          row.value_date,
          row.description,
          row.bank_reference,
          row.debit_amount,
          row.credit_amount,
          row.running_balance,
          statement.currency_code,
          row.external_line_id,
          fp,
        ]
      );
      lineNumber += 1;
      imported += 1;
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') {
        skippedDuplicate += 1;
        continue;
      }
      throw e;
    }
  }

  await txQuery(
    client,
    `UPDATE accounts.bank_statements SET
       imported_file_name = COALESCE($2, imported_file_name),
       imported_at = NOW(),
       imported_by = $3::uuid,
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid`,
    [statement.id, params.fileName ?? null, params.userId]
  );

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.csv_imported',
    entityType: 'bank_statement',
    entityId: statement.id,
    newValues: { imported, skipped_duplicate: skippedDuplicate, invalid: invalidCount, total_input: totalInput },
    description: `استيراد سطور CSV لكشف الحساب المصرفي ${statement.statement_number}`,
  });

  return { imported, skipped_duplicate: skippedDuplicate, invalid: invalidCount, total_input: totalInput };
}
