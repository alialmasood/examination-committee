import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import {
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import {
  JOURNAL_ENTRY_TYPES,
  UI_JOURNAL_ENTRY_TYPES,
  type JournalEntryType,
  type JournalStatus,
} from './journal-transitions';

export type JournalLineInput = {
  account_id: string;
  cost_center_id?: string | null;
  description?: string | null;
  debit_amount: unknown;
  credit_amount: unknown;
  reference_type?: string | null;
  reference_id?: string | null;
};

export type NormalizedJournalLine = {
  line_number: number;
  account_id: string;
  cost_center_id: string | null;
  description: string | null;
  debit_amount: string;
  credit_amount: string;
  reference_type: string | null;
  reference_id: string | null;
};

export type JournalEntryRow = {
  id: string;
  entry_number: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  entry_date: string;
  entry_type: JournalEntryType;
  source_type: string | null;
  source_id: string | null;
  reference_number: string | null;
  description: string;
  total_debit: string;
  total_credit: string;
  status: JournalStatus;
  is_reversal: boolean;
  reverses_entry_id: string | null;
  reversal_entry_id: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  posted_by: string | null;
  reversed_by: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  approved_at: string | null;
  posted_at: string | null;
  reversed_at: string | null;
};

export async function loadJournalEntry(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<JournalEntryRow> {
  const res = await txQuery<JournalEntryRow>(
    client,
    `SELECT *
     FROM accounts.journal_entries
     WHERE id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (res.rows.length === 0) {
    throw new AccountsHttpError('القيد غير موجود', 404);
  }
  const row = res.rows[0];
  return {
    ...row,
    entry_date: pgDateOnly(row.entry_date as unknown as string | Date),
    total_debit: normalizeMoneyInput(row.total_debit),
    total_credit: normalizeMoneyInput(row.total_credit),
  };
}

export async function loadJournalLines(
  client: TxClient,
  entryId: string
): Promise<
  Array<{
    id: string;
    journal_entry_id: string;
    line_number: number;
    account_id: string;
    cost_center_id: string | null;
    description: string | null;
    debit_amount: string;
    credit_amount: string;
    account_code?: string;
    account_name_ar?: string;
    requires_cost_center?: boolean;
    cost_center_code?: string | null;
    cost_center_name_ar?: string | null;
  }>
> {
  const res = await txQuery(
    client,
    `SELECT l.*,
            a.code AS account_code,
            a.name_ar AS account_name_ar,
            a.requires_cost_center,
            cc.code AS cost_center_code,
            cc.name_ar AS cost_center_name_ar
     FROM accounts.journal_entry_lines l
     JOIN accounts.chart_of_accounts a ON a.id = l.account_id
     LEFT JOIN accounts.cost_centers cc ON cc.id = l.cost_center_id
     WHERE l.journal_entry_id = $1
     ORDER BY l.line_number ASC`,
    [entryId]
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    journal_entry_id: r.journal_entry_id as string,
    line_number: Number(r.line_number),
    account_id: r.account_id as string,
    cost_center_id: (r.cost_center_id as string | null) || null,
    description: (r.description as string | null) || null,
    debit_amount: normalizeMoneyInput(r.debit_amount),
    credit_amount: normalizeMoneyInput(r.credit_amount),
    account_code: r.account_code as string | undefined,
    account_name_ar: r.account_name_ar as string | undefined,
    requires_cost_center: Boolean(r.requires_cost_center),
    cost_center_code: (r.cost_center_code as string | null) || null,
    cost_center_name_ar: (r.cost_center_name_ar as string | null) || null,
  }));
}

export async function assertFiscalContextForEntry(
  client: TxClient,
  params: {
    fiscalYearId: string;
    fiscalPeriodId: string;
    entryDate: string;
    requireOpenPeriod?: boolean;
    requireActiveYear?: boolean;
  }
): Promise<{ yearCode: string; yearStart: string; periodCode: string }> {
  const year = await txQuery<{
    id: string;
    code: string;
    status: string;
    start_date: string;
    end_date: string;
  }>(
    client,
    `SELECT id, code, status, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_years WHERE id = $1`,
    [params.fiscalYearId]
  );
  if (year.rows.length === 0) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }
  const y = year.rows[0];
  const yearStart = pgDateOnly(y.start_date);
  const yearEnd = pgDateOnly(y.end_date);
  const entryDate = pgDateOnly(params.entryDate);

  if (params.requireActiveYear !== false && y.status !== 'ACTIVE') {
    throw new AccountsHttpError('يجب أن تكون السنة المالية نشطة (ACTIVE)', 409);
  }
  if (entryDate < yearStart || entryDate > yearEnd) {
    throw new AccountsHttpError('تاريخ القيد خارج حدود السنة المالية', 400);
  }

  const period = await txQuery<{
    id: string;
    code: string;
    status: string;
    fiscal_year_id: string;
    start_date: string;
    end_date: string;
  }>(
    client,
    `SELECT id, code, status, fiscal_year_id,
            start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods WHERE id = $1`,
    [params.fiscalPeriodId]
  );
  if (period.rows.length === 0) {
    throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
  }
  const p = period.rows[0];
  if (p.fiscal_year_id !== params.fiscalYearId) {
    throw new AccountsHttpError('الفترة المحاسبية لا تنتمي للسنة المالية المحددة', 409);
  }
  const pStart = pgDateOnly(p.start_date);
  const pEnd = pgDateOnly(p.end_date);
  if (entryDate < pStart || entryDate > pEnd) {
    throw new AccountsHttpError('تاريخ القيد خارج حدود الفترة المحاسبية', 400);
  }
  if (params.requireOpenPeriod !== false) {
    if (p.status === 'CLOSED' || p.status === 'LOCKED') {
      throw new AccountsHttpError('لا يمكن استخدام فترة مغلقة أو مقفلة', 409);
    }
    if (p.status !== 'OPEN') {
      throw new AccountsHttpError('الفترة المحاسبية يجب أن تكون مفتوحة (OPEN)', 409);
    }
  }

  return { yearCode: y.code, yearStart, periodCode: p.code };
}

function parseLineAmount(raw: unknown, field: string): string {
  try {
    const n = normalizeMoneyInput(raw);
    if (moneyToMillis(n) < BigInt(0)) {
      throw new AccountsHttpError(`قيمة ${field} لا يمكن أن تكون سالبة`, 400);
    }
    return n;
  } catch (e) {
    if (e instanceof AccountsHttpError) throw e;
    throw new AccountsHttpError(`قيمة ${field} غير صالحة`, 400);
  }
}

/**
 * تطبيع وتحقق من سطور القيد.
 * mode=draft: يسمح بسطور فارغة العدد؛ كل سطر موجود يجب أن يكون صحيحاً منفرداً.
 * mode=strict: يتطلب سطرين على الأقل وتوازناً كاملاً.
 */
export async function normalizeAndValidateLines(
  client: TxClient,
  linesInput: unknown,
  mode: 'draft' | 'strict'
): Promise<{
  lines: NormalizedJournalLine[];
  totalDebit: string;
  totalCredit: string;
  warnings: string[];
}> {
  if (!Array.isArray(linesInput)) {
    throw new AccountsHttpError('سطور القيد يجب أن تكون مصفوفة', 400);
  }

  const warnings: string[] = [];
  const lines: NormalizedJournalLine[] = [];
  const accountCounts = new Map<string, number>();

  for (let i = 0; i < linesInput.length; i++) {
    const raw = linesInput[i] as JournalLineInput;
    if (!raw || typeof raw !== 'object') {
      throw new AccountsHttpError(`السطر ${i + 1} غير صالح`, 400);
    }
    const accountId = String(raw.account_id || '').trim();
    if (!accountId) {
      throw new AccountsHttpError(`السطر ${i + 1}: الحساب مطلوب`, 400);
    }

    const debit = parseLineAmount(raw.debit_amount ?? 0, 'المدين');
    const credit = parseLineAmount(raw.credit_amount ?? 0, 'الدائن');

    const debitPos = moneyIsPositive(debit);
    const creditPos = moneyIsPositive(credit);
    if (debitPos && creditPos) {
      throw new AccountsHttpError(`السطر ${i + 1}: لا يمكن أن يكون مديناً ودائناً معاً`, 400);
    }
    if (!debitPos && !creditPos) {
      throw new AccountsHttpError(`السطر ${i + 1}: يجب إدخال مبلغ مدين أو دائن`, 400);
    }

    const account = await txQuery<{
      id: string;
      code: string;
      name_ar: string;
      is_active: boolean;
      is_group: boolean;
      allow_posting: boolean;
      requires_cost_center: boolean;
    }>(
      client,
      `SELECT id, code, name_ar, is_active, is_group, allow_posting, requires_cost_center
       FROM accounts.chart_of_accounts WHERE id = $1`,
      [accountId]
    );
    if (account.rows.length === 0) {
      throw new AccountsHttpError(`السطر ${i + 1}: الحساب غير موجود`, 404);
    }
    const acc = account.rows[0];
    if (!acc.is_active) {
      throw new AccountsHttpError(`السطر ${i + 1}: الحساب ${acc.code} غير فعّال`, 409);
    }
    if (acc.is_group || !acc.allow_posting) {
      throw new AccountsHttpError(
        `السطر ${i + 1}: لا يمكن الترحيل على حساب تجميعي (${acc.code})`,
        409
      );
    }

    let costCenterId: string | null = raw.cost_center_id
      ? String(raw.cost_center_id).trim()
      : null;
    if (!costCenterId) costCenterId = null;

    if (acc.requires_cost_center && !costCenterId) {
      throw new AccountsHttpError(
        `السطر ${i + 1}: الحساب ${acc.code} يتطلب مركز كلفة`,
        400
      );
    }

    if (costCenterId) {
      const cc = await txQuery<{
        id: string;
        code: string;
        is_active: boolean;
        is_group: boolean;
      }>(
        client,
        `SELECT id, code, is_active, is_group FROM accounts.cost_centers WHERE id = $1`,
        [costCenterId]
      );
      if (cc.rows.length === 0) {
        throw new AccountsHttpError(`السطر ${i + 1}: مركز الكلفة غير موجود`, 404);
      }
      if (!cc.rows[0].is_active) {
        throw new AccountsHttpError(
          `السطر ${i + 1}: مركز الكلفة ${cc.rows[0].code} غير فعّال`,
          409
        );
      }
      // لا يوجد allow_posting على مراكز الكلفة — يُسمح بالمركز الفعّال (حتى التجميعي حالياً)
    }

    accountCounts.set(accountId, (accountCounts.get(accountId) || 0) + 1);

    lines.push({
      line_number: i + 1,
      account_id: accountId,
      cost_center_id: costCenterId,
      description: raw.description ? String(raw.description).trim() || null : null,
      debit_amount: debitPos ? debit : '0.000',
      credit_amount: creditPos ? credit : '0.000',
      reference_type: raw.reference_type ? String(raw.reference_type) : null,
      reference_id: raw.reference_id ? String(raw.reference_id) : null,
    });
  }

  for (const [accountId, count] of accountCounts) {
    if (count > 1) {
      const acc = await txQuery<{ code: string }>(
        client,
        `SELECT code FROM accounts.chart_of_accounts WHERE id = $1`,
        [accountId]
      );
      warnings.push(
        `تكرار الحساب ${acc.rows[0]?.code || accountId} في أكثر من سطر (${count} مرات)`
      );
    }
  }

  const totalDebit = sumMoney(lines.map((l) => l.debit_amount));
  const totalCredit = sumMoney(lines.map((l) => l.credit_amount));

  if (mode === 'strict') {
    if (lines.length < 2) {
      throw new AccountsHttpError('القيد يتطلب سطرين على الأقل', 400);
    }
    if (moneyIsZero(totalDebit) || moneyIsZero(totalCredit)) {
      throw new AccountsHttpError('مجموع المدين والدائن يجب أن يكون أكبر من صفر', 400);
    }
    if (!moneyEquals(totalDebit, totalCredit)) {
      const diff = millisToAbsDiff(totalDebit, totalCredit);
      throw new AccountsHttpError(`القيد غير متوازن — الفرق: ${diff}`, 409);
    }
  }

  return { lines, totalDebit, totalCredit, warnings };
}

function millisToAbsDiff(a: string, b: string): string {
  const diff = moneyToMillis(a) - moneyToMillis(b);
  const abs = diff < BigInt(0) ? -diff : diff;
  const intPart = abs / BigInt(1000);
  const frac = (abs % BigInt(1000)).toString().padStart(3, '0');
  return `${intPart}.${frac}`;
}

export function parseEntryType(raw: unknown, allowReversal = false): JournalEntryType {
  const t = String(raw || 'MANUAL').toUpperCase();
  if (!JOURNAL_ENTRY_TYPES.includes(t as JournalEntryType)) {
    throw new AccountsHttpError('نوع القيد غير صالح', 400);
  }
  if (t === 'REVERSAL' && !allowReversal) {
    throw new AccountsHttpError('لا يمكن إنشاء قيد عكسي يدوياً من هذا المسار', 400);
  }
  if (!allowReversal && !(UI_JOURNAL_ENTRY_TYPES as readonly string[]).includes(t)) {
    throw new AccountsHttpError(
      'نوع القيد غير متاح حالياً من الواجهة. استخدم MANUAL أو ADJUSTMENT',
      400
    );
  }
  return t as JournalEntryType;
}

export async function replaceJournalLines(
  client: TxClient,
  entryId: string,
  lines: NormalizedJournalLine[]
): Promise<void> {
  await txQuery(client, `DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
    entryId,
  ]);
  for (const line of lines) {
    await txQuery(
      client,
      `INSERT INTO accounts.journal_entry_lines
        (journal_entry_id, line_number, account_id, cost_center_id, description,
         debit_amount, credit_amount, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9)`,
      [
        entryId,
        line.line_number,
        line.account_id,
        line.cost_center_id,
        line.description,
        line.debit_amount,
        line.credit_amount,
        line.reference_type,
        line.reference_id,
      ]
    );
  }
}

export async function allocateJournalEntryNumber(
  client: TxClient,
  fiscalYearId: string
): Promise<string> {
  const year = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id = $1`,
    [fiscalYearId]
  );
  if (year.rows.length === 0) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'JOURNAL_ENTRY',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم القيد';
    throw new AccountsHttpError(msg, 409);
  }
}

export function assertOptimisticVersion(
  current: number,
  expected: unknown
): void {
  if (expected == null) {
    throw new AccountsHttpError('رقم الإصدار (version) مطلوب للتعديل', 400);
  }
  const v = Number(expected);
  if (!Number.isInteger(v) || v < 1) {
    throw new AccountsHttpError('رقم الإصدار غير صالح', 400);
  }
  if (v !== current) {
    throw new AccountsHttpError(
      'تم تعديل القيد بواسطة مستخدم آخر، يرجى إعادة تحميل الصفحة',
      409
    );
  }
}

export async function createReversalEntry(
  client: TxClient,
  params: {
    original: JournalEntryRow;
    reversalDate: string;
    reason: string;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<JournalEntryRow> {
  if (params.original.status !== 'POSTED') {
    throw new AccountsHttpError('يمكن عكس القيود المرحلة فقط', 409);
  }
  if (params.original.is_reversal) {
    throw new AccountsHttpError('لا يمكن عكس قيد عكسي من الواجهة الاعتيادية', 409);
  }
  if (params.original.reversal_entry_id) {
    throw new AccountsHttpError('تم عكس هذا القيد مسبقاً', 409);
  }

  // ابحث عن فترة OPEN تغطي تاريخ العكس ضمن نفس السنة
  const periodCheck = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1
       AND start_date <= $2::date
       AND end_date >= $2::date
     LIMIT 1`,
    [params.original.fiscal_year_id, pgDateOnly(params.reversalDate)]
  );
  if (periodCheck.rows.length === 0) {
    throw new AccountsHttpError('لا توجد فترة محاسبية تغطي تاريخ العكس', 400);
  }
  const periodId = periodCheck.rows[0].id;
  await assertFiscalContextForEntry(client, {
    fiscalYearId: params.original.fiscal_year_id,
    fiscalPeriodId: periodId,
    entryDate: pgDateOnly(params.reversalDate),
  });

  const originalLines = await loadJournalLines(client, params.original.id);
  const flipped: NormalizedJournalLine[] = originalLines.map((l, idx) => ({
    line_number: idx + 1,
    account_id: l.account_id as string,
    cost_center_id: (l.cost_center_id as string | null) || null,
    description:
      (l.description as string | null) ||
      `عكس قيد ${params.original.entry_number}`,
    debit_amount: normalizeMoneyInput(l.credit_amount),
    credit_amount: normalizeMoneyInput(l.debit_amount),
    reference_type: 'JOURNAL_REVERSAL',
    reference_id: params.original.id,
  }));

  const { totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    flipped.map((l) => ({
      account_id: l.account_id,
      cost_center_id: l.cost_center_id,
      description: l.description,
      debit_amount: l.debit_amount,
      credit_amount: l.credit_amount,
    })),
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    params.original.fiscal_year_id
  );

  const description = `عكس القيد ${params.original.entry_number}: ${params.reason.trim()}`;

  const created = await txQuery<JournalEntryRow>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status, is_reversal, reverses_entry_id,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1,$2,$3,$4::date,'REVERSAL','MANUAL',NULL,$5,$6,
       $7::numeric,$8::numeric,'POSTED',TRUE,$9,
       1,$10,$10,$10,NOW())
     RETURNING *`,
    [
      entryNumber,
      params.original.fiscal_year_id,
      periodId,
      pgDateOnly(params.reversalDate),
      params.original.entry_number,
      description,
      totalDebit,
      totalCredit,
      params.original.id,
      params.userId,
    ]
  );

  const reversal = created.rows[0];
  await replaceJournalLines(client, reversal.id, flipped);

  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET status = 'REVERSED',
         reversal_entry_id = $2,
         reversed_by = $3,
         reversed_at = NOW(),
         updated_by = $3,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1`,
    [params.original.id, reversal.id, params.userId]
  );

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'journal_entry.reversed',
    entityType: 'journal_entry',
    entityId: params.original.id,
    oldValues: { status: 'POSTED', reversal_entry_id: null },
    newValues: {
      status: 'REVERSED',
      reversal_entry_id: reversal.id,
      reason: params.reason.trim(),
    },
    description: `عكس القيد ${params.original.entry_number} → ${entryNumber}`,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'journal_entry.posted',
    entityType: 'journal_entry',
    entityId: reversal.id,
    newValues: {
      entry_number: entryNumber,
      reverses_entry_id: params.original.id,
      status: 'POSTED',
    },
    description: `ترحيل قيد عكسي ${entryNumber}`,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    ...reversal,
    entry_date: pgDateOnly(reversal.entry_date as unknown as string | Date),
    total_debit: normalizeMoneyInput(reversal.total_debit),
    total_credit: normalizeMoneyInput(reversal.total_credit),
  };
}
