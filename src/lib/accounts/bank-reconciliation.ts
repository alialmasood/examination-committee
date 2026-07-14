/**
 * مطابقة كشف الحساب المصرفي — المرحلة 4.D (محرك المطابقة + الحساب + الإقفال).
 *
 * اصطلاح الإشارة (يجب مراعاته في كل هذا الملف):
 * - سطر الكشف Debit (خروج بحسب المصرف)  ⇄ يقابله دائن (Credit) على حساب البنك GL في الدفاتر
 * - سطر الكشف Credit (دخول بحسب المصرف) ⇄ يقابله مدين (Debit) على حساب البنك GL في الدفاتر
 * - مبلغ المطابقة (matched_amount) دائماً موجب — يمثل جزءاً من "الجانب" المطابق للسطر
 *   (debit_amount أو credit_amount) وللحركة الدفترية المقابلة على حساب البنك GL.
 *
 * تبسيط متعمّد: تُحسب حركات الدفتر على مستوى القيد (aggregate) بافتراض أن كل قيد يلمس
 * حساب البنك GL بسطر واحد فقط (وهو واقع كل مسارات الترحيل الحالية: سندات القبض/الصرف،
 * والتحويلات المصرفية). حالة قيد يحوي أكثر من سطر على نفس حساب البنك GL مع جانبين
 * مختلفين (مدين ودائن معاً) نادرة جداً ولم تُعالَج بدقة كاملة هنا (moved to TODO أدناه).
 */
import { AccountsHttpError } from './auth';
import { requireAccountsAdmin } from './accounts-access';
import {
  assertCanPostBankAccount,
  assertCanReconcileBankAccount,
} from './bank-account-access';
import { loadBankAccount } from './bank-accounts';
import {
  assertStatementEditable,
  assertStatementMatchable,
  loadBankStatement,
  loadBankStatementLine,
  listBankStatementLines,
  serializeBankStatement,
  serializeBankStatementLine,
  type BankStatementLineRow,
  type BankStatementRow,
} from './bank-statements';
import {
  acquireAccountingResourceLocks,
  bankAccountLock,
  bankGlLock,
  bankStatementLock,
  journalSourceLock,
} from './accounting-locks';
import { addDaysUTC, formatDateUTC, parseDateUTC } from './fiscal';
import { pgDateOnly } from './document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import {
  millisToMoney,
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import { assertPostingAccount } from './posting-account';
import { writeFinancialAudit } from './audit';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type MatchType =
  | 'MANUAL'
  | 'REFERENCE'
  | 'AMOUNT_DATE'
  | 'SYSTEM_SUGGESTED'
  | 'ADJUSTMENT';

export type BankReconciliationMatchRow = {
  id: string;
  bank_statement_id: string;
  bank_statement_line_id: string;
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  matched_amount: string;
  match_type: MatchType;
  confidence: string | null;
  notes: string | null;
  created_by: string;
  created_at: Date | string;
};

export type BookItem = {
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  gl_line_count: number;
  entry_number: string;
  entry_date: string;
  source_type: string | null;
  source_id: string | null;
  description: string;
  bank_reference: string | null;
  side: 'DEBIT' | 'CREDIT';
  debit_on_bank_gl: string;
  credit_on_bank_gl: string;
  side_amount: string;
  matched_amount: string;
  remaining_amount: string;
};

export type MatchSuggestion = {
  bank_statement_line_id: string;
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  entry_number: string;
  entry_date: string;
  amount: string;
  confidence: number;
  reason: string;
};

export type BankReconciliationSummary = {
  opening_balance: string;
  closing_balance: string;
  total_credits: string;
  total_debits: string;
  statement_movement: string;
  expected_closing: string;
  statement_balance_ok: boolean;
  book_balance_at_date_to: string;
  unmatched_bank_credits: string;
  unmatched_bank_debits: string;
  outstanding_book_debits: string;
  outstanding_book_credits: string;
  adjustments_count: number;
  adjustments_net: string;
  bank_adjusted: string;
  reconciled_book_balance: string;
  difference: string;
  within_tolerance: boolean;
};

/** لقطة نهائية تُحفظ عند CLOSED ولا يُعاد حسابها من الدفتر لاحقاً */
export type ClosedStatementSnapshot = {
  version: 1;
  generated_at: string;
  summary: BankReconciliationSummary;
  outstanding_book_items: BookItem[];
  lines: ReturnType<typeof serializeBankStatementLine>[];
};

export type BankReconciliationView = {
  summary: BankReconciliationSummary;
  from_snapshot: boolean;
  outstanding_book_items?: BookItem[];
  lines?: ReturnType<typeof serializeBankStatementLine>[];
  generated_at?: string | null;
};

function isSummaryShape(value: unknown): value is BankReconciliationSummary {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.difference === 'string' && typeof o.bank_adjusted === 'string';
}

/** يستخرج ملخص التسوية من snapshot_json (صيغة v1 أو اللقطة الموروثة = الملخص مباشرة) */
export function parseClosedStatementSnapshot(
  snapshot: unknown
): BankReconciliationView | null {
  if (!snapshot) return null;
  if (isSummaryShape(snapshot)) {
    return { summary: snapshot, from_snapshot: true };
  }
  if (typeof snapshot === 'object' && snapshot !== null) {
    const o = snapshot as Record<string, unknown>;
    if (isSummaryShape(o.summary)) {
      return {
        summary: o.summary,
        from_snapshot: true,
        outstanding_book_items: Array.isArray(o.outstanding_book_items)
          ? (o.outstanding_book_items as BookItem[])
          : undefined,
        lines: Array.isArray(o.lines)
          ? (o.lines as ReturnType<typeof serializeBankStatementLine>[])
          : undefined,
        generated_at: typeof o.generated_at === 'string' ? o.generated_at : null,
      };
    }
  }
  return null;
}

/**
 * ملخص التسوية للعرض/الطباعة:
 * - CLOSED + snapshot_json → اللقطة المجمدة (لا يُعاد الحساب من الدفتر)
 * - خلاف ذلك → حساب حيّ
 */
export async function getBankStatementReconciliationView(
  client: TxClient,
  statementId: string
): Promise<BankReconciliationView> {
  const statement = await loadBankStatement(client, statementId);
  if (statement.status === 'CLOSED' && statement.snapshot_json != null) {
    const parsed = parseClosedStatementSnapshot(statement.snapshot_json);
    if (parsed) return parsed;
  }
  const summary = await calculateBankReconciliation(client, statementId);
  return { summary, from_snapshot: false };
}

/** نافذة تاريخية إضافية (قبل date_from) لالتقاط حركات الدفتر المعلّقة (outstanding) عند العرض */
const BOOK_ITEMS_LOOKBACK_DAYS = 30;

function shiftDateOnly(date: string, days: number): string {
  return formatDateUTC(addDaysUTC(parseDateUTC(date), days));
}

function serializeMatch(row: BankReconciliationMatchRow) {
  return {
    ...row,
    matched_amount: normalizeMoneyInput(row.matched_amount),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(String(row.created_at)).toISOString(),
  };
}

/** الجانب الفعّال لسطر كشف (المبلغ الموجب الوحيد بين مدين/دائن) */
function lineSide(
  line: BankStatementLineRow
): { side: 'DEBIT' | 'CREDIT'; amount: string } {
  const debit = normalizeMoneyInput(line.debit_amount);
  if (moneyIsPositive(debit)) return { side: 'DEBIT', amount: debit };
  return { side: 'CREDIT', amount: normalizeMoneyInput(line.credit_amount) };
}

/** الجانب الذي يجب أن تُطابَق عليه الحركة الدفترية بحسب جانب سطر الكشف */
function expectedBookSideFor(lineSideValue: 'DEBIT' | 'CREDIT'): 'DEBIT' | 'CREDIT' {
  // سطر الكشف Debit (خروج) ⇄ دائن على البنك GL — والعكس صحيح
  return lineSideValue === 'DEBIT' ? 'CREDIT' : 'DEBIT';
}

/**
 * يعيد حساب match_status لسطر بناءً على مجموع مطابقاته الحالية.
 * لا يُغيّر الحالة إن كان السطر مستبعداً (EXCLUDED) — بحسب المتطلبات.
 */
export async function refreshLineMatchStatus(
  client: TxClient,
  lineId: string
): Promise<BankStatementLineRow> {
  const line = await loadBankStatementLine(client, lineId, true);
  if (line.match_status === 'EXCLUDED') return line;

  const { amount } = lineSide(line);
  const sumRes = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(matched_amount), 0)::text AS total
     FROM accounts.bank_reconciliation_matches
     WHERE bank_statement_line_id = $1::uuid`,
    [lineId]
  );
  const matched = normalizeMoneyInput(sumRes.rows[0]?.total ?? '0');

  let nextStatus: BankStatementLineRow['match_status'];
  if (moneyIsZero(matched)) {
    nextStatus = 'UNMATCHED';
  } else if (moneyToMillis(matched) >= moneyToMillis(amount)) {
    nextStatus = 'MATCHED';
  } else {
    nextStatus = 'PARTIALLY_MATCHED';
  }

  if (nextStatus === line.match_status) return line;

  const upd = await txQuery<BankStatementLineRow>(
    client,
    `UPDATE accounts.bank_statement_lines
     SET match_status = $2, updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [lineId, nextStatus]
  );
  return upd.rows[0];
}

/**
 * حركات الدفتر (قيود POSTED) على حساب البنك GL المرتبطة بكشف — بتجميع على مستوى القيد.
 * unmatchedOnly=true يستثني الحركات المطابقة بالكامل عبر أي كشف (المطابقة نهائية عبر الزمن).
 */
export async function listBookItems(
  client: TxClient,
  params: {
    statementId: string;
    q?: string | null;
    page?: number;
    pageSize?: number;
    unmatchedOnly?: boolean;
  }
): Promise<{ items: BookItem[]; total: number; page: number; pageSize: number }> {
  const statement = await loadBankStatement(client, params.statementId);
  const bankAcc = await loadBankAccount(client, statement.bank_account_id);

  const page = Math.max(1, Math.trunc(Number(params.page ?? 1)) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Math.trunc(Number(params.pageSize ?? 50)) || 50)
  );
  const dateTo = pgDateOnly(statement.date_to);
  const bufferFrom = shiftDateOnly(pgDateOnly(statement.date_from), -BOOK_ITEMS_LOOKBACK_DAYS);
  const q = params.q ? String(params.q).trim().slice(0, 100) : null;
  const unmatchedOnly = Boolean(params.unmatchedOnly);

  const r = await txQuery<{
    journal_entry_id: string;
    journal_entry_line_id: string | null;
    gl_line_count: number;
    entry_number: string;
    entry_date: string;
    source_type: string | null;
    source_id: string | null;
    entry_description: string;
    bank_reference: string | null;
    debit_sum: string;
    credit_sum: string;
    matched_sum: string;
    side: 'DEBIT' | 'CREDIT';
    side_amount: string;
    remaining_amount: string;
    total_count: string;
  }>(
    client,
    `WITH book_lines AS (
       SELECT je.id AS journal_entry_id,
              (ARRAY_AGG(jel.id ORDER BY jel.id))[1] AS journal_entry_line_id,
              COUNT(jel.id) AS gl_line_count,
              je.entry_number, je.entry_date::text AS entry_date, je.source_type, je.source_id,
              je.description AS entry_description, je.reference_number AS bank_reference,
              COALESCE(SUM(jel.debit_amount), 0) AS debit_sum,
              COALESCE(SUM(jel.credit_amount), 0) AS credit_sum
       FROM accounts.journal_entries je
       JOIN accounts.journal_entry_lines jel
         ON jel.journal_entry_id = je.id AND jel.account_id = $1::uuid
       WHERE je.status = 'POSTED'
         AND je.entry_date <= $2::date
         AND je.entry_date >= $3::date
       GROUP BY je.id, je.entry_number, je.entry_date, je.source_type, je.source_id,
                je.description, je.reference_number
     ),
     matched AS (
       SELECT journal_entry_id, COALESCE(SUM(matched_amount), 0) AS matched_sum
       FROM accounts.bank_reconciliation_matches
       GROUP BY journal_entry_id
     ),
     scored AS (
       SELECT bl.*,
              COALESCE(m.matched_sum, 0) AS matched_sum,
              CASE WHEN bl.debit_sum >= bl.credit_sum THEN 'DEBIT' ELSE 'CREDIT' END AS side,
              GREATEST(bl.debit_sum, bl.credit_sum) AS side_amount,
              GREATEST(GREATEST(bl.debit_sum, bl.credit_sum) - COALESCE(m.matched_sum, 0), 0) AS remaining_amount
       FROM book_lines bl
       LEFT JOIN matched m ON m.journal_entry_id = bl.journal_entry_id
     )
     SELECT *, COUNT(*) OVER()::text AS total_count
     FROM scored
     WHERE ($4::boolean IS NOT TRUE OR remaining_amount > 0)
       AND (
         $5::text IS NULL
         OR entry_number ILIKE '%' || $5 || '%'
         OR COALESCE(bank_reference,'') ILIKE '%' || $5 || '%'
         OR entry_description ILIKE '%' || $5 || '%'
       )
     ORDER BY entry_date DESC, entry_number DESC
     LIMIT $6 OFFSET $7`,
    [
      bankAcc.gl_account_id,
      dateTo,
      bufferFrom,
      unmatchedOnly,
      q,
      pageSize,
      (page - 1) * pageSize,
    ]
  );

  const items: BookItem[] = r.rows.map((row) => ({
    journal_entry_id: row.journal_entry_id,
    journal_entry_line_id: row.journal_entry_line_id,
    gl_line_count: Number(row.gl_line_count),
    entry_number: row.entry_number,
    entry_date: pgDateOnly(row.entry_date),
    source_type: row.source_type,
    source_id: row.source_id,
    description: row.entry_description,
    bank_reference: row.bank_reference,
    side: row.side,
    debit_on_bank_gl: normalizeMoneyInput(row.debit_sum),
    credit_on_bank_gl: normalizeMoneyInput(row.credit_sum),
    side_amount: normalizeMoneyInput(row.side_amount),
    matched_amount: normalizeMoneyInput(row.matched_sum),
    remaining_amount: normalizeMoneyInput(row.remaining_amount),
  }));

  return {
    items,
    total: Number(r.rows[0]?.total_count ?? 0),
    page,
    pageSize,
  };
}

async function lockMatchParticipants(
  client: TxClient,
  params: { statementId: string; bankAccountId: string; glAccountId: string; journalEntryId: string }
): Promise<void> {
  await acquireAccountingResourceLocks(client, [
    bankStatementLock(params.statementId),
    bankAccountLock(params.bankAccountId),
    bankGlLock(params.glAccountId),
    journalSourceLock('JOURNAL_ENTRY', params.journalEntryId),
  ]);
}

async function sumMatchedForLine(client: TxClient, lineId: string): Promise<bigint> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(matched_amount), 0)::text AS total
     FROM accounts.bank_reconciliation_matches
     WHERE bank_statement_line_id = $1::uuid`,
    [lineId]
  );
  return moneyToMillis(normalizeMoneyInput(r.rows[0]?.total ?? '0'));
}

/**
 * سقف المطابقة على مستوى القيد كاملاً (مجموع كل المطابقات على journal_entry_id)
 * بما يتوافق مع listBookItems / calculateBankReconciliation — حتى لو رُبط سطر قيد محدد.
 */
async function sumMatchedForBookSide(
  client: TxClient,
  params: { journalEntryId: string }
): Promise<bigint> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(matched_amount), 0)::text AS total
     FROM accounts.bank_reconciliation_matches
     WHERE journal_entry_id = $1::uuid`,
    [params.journalEntryId]
  );
  return moneyToMillis(normalizeMoneyInput(r.rows[0]?.total ?? '0'));
}

export async function createReconciliationMatch(
  client: TxClient,
  params: {
    statementId: string;
    lineId: string;
    journalEntryId: string;
    journalEntryLineId?: string | null;
    matchedAmount: unknown;
    matchType?: MatchType;
    confidence?: number | null;
    notes?: unknown;
    userId: string;
  }
): Promise<BankReconciliationMatchRow> {
  const statementPeek = await loadBankStatement(client, params.statementId);
  const bankAccPeek = await loadBankAccount(client, statementPeek.bank_account_id);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: bankAccPeek.id,
    userId: params.userId,
  });

  await lockMatchParticipants(client, {
    statementId: statementPeek.id,
    bankAccountId: bankAccPeek.id,
    glAccountId: bankAccPeek.gl_account_id,
    journalEntryId: params.journalEntryId,
  });

  const statement = await loadBankStatement(client, statementPeek.id, true);
  assertStatementMatchable(statement);

  const line = await loadBankStatementLine(client, params.lineId, true);
  if (line.bank_statement_id !== statement.id) {
    throw new AccountsHttpError('السطر لا يتبع هذا الكشف', 409);
  }
  if (line.match_status === 'EXCLUDED') {
    throw new AccountsHttpError('لا يمكن مطابقة سطر مستبعد', 409);
  }

  const je = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM accounts.journal_entries WHERE id = $1::uuid`,
    [params.journalEntryId]
  );
  if (!je.rows[0]) throw new AccountsHttpError('القيد المحاسبي غير موجود', 404);
  if (je.rows[0].status !== 'POSTED') {
    throw new AccountsHttpError('لا يمكن المطابقة إلا على قيود مرحّلة (POSTED)', 409);
  }

  const journalEntryLineId = params.journalEntryLineId
    ? String(params.journalEntryLineId).trim()
    : null;

  // إن وُجد سطر قيد محدد: التحقق من تبعيته وحساب البنك GL، ثم السعة تُحسب على مستوى القيد كاملاً
  if (journalEntryLineId) {
    const jelRes = await txQuery<{
      id: string;
      journal_entry_id: string;
      account_id: string;
      debit_amount: string;
      credit_amount: string;
    }>(
      client,
      `SELECT id, journal_entry_id, account_id, debit_amount, credit_amount
       FROM accounts.journal_entry_lines WHERE id = $1::uuid`,
      [journalEntryLineId]
    );
    if (!jelRes.rows[0]) throw new AccountsHttpError('سطر القيد غير موجود', 404);
    const jel = jelRes.rows[0];
    if (jel.journal_entry_id !== params.journalEntryId) {
      throw new AccountsHttpError('سطر القيد لا يتبع القيد المحدد', 409);
    }
    if (jel.account_id !== bankAccPeek.gl_account_id) {
      throw new AccountsHttpError('سطر القيد المحدد لا يقع على حساب البنك GL', 409);
    }
  }

  // سعة المطابقة = إجمالي أثر Account Bank GL على القيد (متوافق مع listBookItems)
  const agg = await txQuery<{ debit_sum: string; credit_sum: string }>(
    client,
    `SELECT COALESCE(SUM(debit_amount), 0)::text AS debit_sum,
            COALESCE(SUM(credit_amount), 0)::text AS credit_sum
     FROM accounts.journal_entry_lines
     WHERE journal_entry_id = $1::uuid AND account_id = $2::uuid`,
    [params.journalEntryId, bankAccPeek.gl_account_id]
  );
  if (!agg.rows[0]) throw new AccountsHttpError('القيد لا يلمس حساب البنك GL', 409);
  const debitSum = normalizeMoneyInput(agg.rows[0].debit_sum);
  const creditSum = normalizeMoneyInput(agg.rows[0].credit_sum);
  if (moneyIsZero(debitSum) && moneyIsZero(creditSum)) {
    throw new AccountsHttpError('القيد لا يلمس حساب البنك GL', 409);
  }
  const bookSide: 'DEBIT' | 'CREDIT' =
    moneyToMillis(debitSum) >= moneyToMillis(creditSum) ? 'DEBIT' : 'CREDIT';
  const bookAmount = bookSide === 'DEBIT' ? debitSum : creditSum;

  const { side: statementSide, amount: lineAmount } = lineSide(line);
  const expectedSide = expectedBookSideFor(statementSide);
  if (bookSide !== expectedSide) {
    throw new AccountsHttpError(
      'اتجاه المطابقة غير صحيح: مدين الكشف يقابل دائن الدفتر والعكس صحيح',
      409
    );
  }

  const matchedAmount = normalizeMoneyInput(params.matchedAmount);
  if (!moneyIsPositive(matchedAmount)) {
    throw new AccountsHttpError('مبلغ المطابقة يجب أن يكون أكبر من صفر', 400);
  }
  const matchedMillis = moneyToMillis(matchedAmount);

  const lineMatchedSoFar = await sumMatchedForLine(client, line.id);
  const lineRemaining = moneyToMillis(lineAmount) - lineMatchedSoFar;
  if (matchedMillis > lineRemaining) {
    throw new AccountsHttpError(
      `مبلغ المطابقة يتجاوز المتبقي على سطر الكشف (المتبقي: ${millisToMoney(lineRemaining)})`,
      409
    );
  }

  const bookMatchedSoFar = await sumMatchedForBookSide(client, {
    journalEntryId: params.journalEntryId,
  });
  const bookRemaining = moneyToMillis(bookAmount) - bookMatchedSoFar;
  if (matchedMillis > bookRemaining) {
    throw new AccountsHttpError(
      `مبلغ المطابقة يتجاوز المتبقي على حركة الدفتر (المتبقي: ${millisToMoney(bookRemaining)})`,
      409
    );
  }

  const matchType: MatchType = params.matchType ?? 'MANUAL';
  const notes =
    params.notes != null && params.notes !== ''
      ? String(params.notes).trim().slice(0, 4000)
      : null;

  // دمج المطابقة الجزئية المتكررة على نفس (سطر كشف + قيد) دون خرق القيد الفريد
  const existing = await txQuery<BankReconciliationMatchRow>(
    client,
    `SELECT * FROM accounts.bank_reconciliation_matches
     WHERE bank_statement_line_id = $1::uuid
       AND journal_entry_id = $2::uuid
       AND (
         ($3::uuid IS NULL AND journal_entry_line_id IS NULL)
         OR journal_entry_line_id IS NOT DISTINCT FROM $3::uuid
       )
     LIMIT 1
     FOR UPDATE`,
    [line.id, params.journalEntryId, journalEntryLineId]
  );

  let match: BankReconciliationMatchRow;
  if (existing.rows[0]) {
    const nextAmount = millisToMoney(
      moneyToMillis(normalizeMoneyInput(existing.rows[0].matched_amount)) + matchedMillis
    );
    const upd = await txQuery<BankReconciliationMatchRow>(
      client,
      `UPDATE accounts.bank_reconciliation_matches SET
         matched_amount = $2::numeric,
         match_type = COALESCE($3, match_type),
         notes = COALESCE($4, notes),
         confidence = COALESCE($5, confidence)
       WHERE id = $1::uuid
       RETURNING *`,
      [
        existing.rows[0].id,
        nextAmount,
        matchType,
        notes,
        params.confidence ?? null,
      ]
    );
    match = upd.rows[0];
  } else {
    const ins = await txQuery<BankReconciliationMatchRow>(
      client,
      `INSERT INTO accounts.bank_reconciliation_matches (
         bank_statement_id, bank_statement_line_id, journal_entry_id, journal_entry_line_id,
         matched_amount, match_type, confidence, notes, created_by
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6, $7, $8, $9::uuid)
       RETURNING *`,
      [
        statement.id,
        line.id,
        params.journalEntryId,
        journalEntryLineId,
        matchedAmount,
        matchType,
        params.confidence ?? null,
        notes,
        params.userId,
      ]
    );
    match = ins.rows[0];
  }

  await refreshLineMatchStatus(client, line.id);

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_reconciliation.matched',
    entityType: 'bank_statement_line',
    entityId: line.id,
    newValues: {
      journal_entry_id: params.journalEntryId,
      journal_entry_line_id: journalEntryLineId,
      matched_amount: matchedAmount,
      match_type: matchType,
    },
    description: `مطابقة سطر كشف ${statement.statement_number}#${line.line_number} بقيد`,
  });

  return match;
}

export async function removeReconciliationMatch(
  client: TxClient,
  params: { matchId: string; userId: string; statementId?: string }
): Promise<{ removed: boolean; lineId: string }> {
  const matchRes = await txQuery<BankReconciliationMatchRow>(
    client,
    `SELECT * FROM accounts.bank_reconciliation_matches WHERE id = $1::uuid FOR UPDATE`,
    [params.matchId]
  );
  const match = matchRes.rows[0];
  if (!match) throw new AccountsHttpError('المطابقة غير موجودة', 404);
  if (params.statementId && match.bank_statement_id !== params.statementId) {
    throw new AccountsHttpError('المطابقة غير موجودة ضمن هذا الكشف', 404);
  }
  if (match.match_type === 'ADJUSTMENT') {
    throw new AccountsHttpError(
      'لا يمكن حذف مطابقة تسوية آلية مباشرة — يجب عكس قيد التسوية أولاً',
      409
    );
  }

  const statementPeek = await loadBankStatement(client, match.bank_statement_id);
  const bankAccPeek = await loadBankAccount(client, statementPeek.bank_account_id);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: bankAccPeek.id,
    userId: params.userId,
  });

  await lockMatchParticipants(client, {
    statementId: statementPeek.id,
    bankAccountId: bankAccPeek.id,
    glAccountId: bankAccPeek.gl_account_id,
    journalEntryId: match.journal_entry_id,
  });

  const statement = await loadBankStatement(client, statementPeek.id, true);
  assertStatementMatchable(statement);

  await txQuery(
    client,
    `DELETE FROM accounts.bank_reconciliation_matches WHERE id = $1::uuid`,
    [match.id]
  );
  await refreshLineMatchStatus(client, match.bank_statement_line_id);

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_reconciliation.match_removed',
    entityType: 'bank_statement_line',
    entityId: match.bank_statement_line_id,
    oldValues: { journal_entry_id: match.journal_entry_id, matched_amount: match.matched_amount },
    description: `إزالة مطابقة عن كشف ${statement.statement_number}`,
  });

  return { removed: true, lineId: match.bank_statement_line_id };
}

function normalizeReference(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function dateDiffDays(a: string, b: string): number {
  const ms = parseDateUTC(a).getTime() - parseDateUTC(b).getTime();
  return Math.abs(Math.round(ms / 86400000));
}

/**
 * يقترح مطابقات محتملة دون إنشائها أبداً — القرار النهائي للمستخدم.
 * درجات الثقة: مرجع مطابق تماماً (95) > نفس المبلغ والتاريخ (85) > نفس المبلغ وتاريخ ضمن 3 أيام (70).
 */
export async function suggestMatches(
  client: TxClient,
  params: { statementId: string; lineId?: string | null; limit?: number }
): Promise<MatchSuggestion[]> {
  const statement = await loadBankStatement(client, params.statementId);

  const lines: BankStatementLineRow[] = params.lineId
    ? [await loadBankStatementLine(client, params.lineId)]
    : (await listBankStatementLines(client, statement.id)).filter(
        (l) => l.match_status === 'UNMATCHED' || l.match_status === 'PARTIALLY_MATCHED'
      );

  const candidatesRes = await listBookItems(client, {
    statementId: statement.id,
    unmatchedOnly: true,
    page: 1,
    pageSize: 200,
  });
  const candidates = candidatesRes.items;

  const limitTotal = Math.min(200, Math.max(1, Number(params.limit ?? 50) || 50));
  const perLineLimit = 5;
  const suggestions: MatchSuggestion[] = [];

  for (const line of lines) {
    if (line.match_status === 'EXCLUDED') continue;
    const { side, amount } = lineSide(line);
    const expectedSide = expectedBookSideFor(side);
    const remainingOnLineMillis =
      moneyToMillis(amount) - (await sumMatchedForLine(client, line.id));
    if (remainingOnLineMillis <= BigInt(0)) continue;
    const remainingOnLine = millisToMoney(remainingOnLineMillis);
    const lineDate = pgDateOnly(line.transaction_date);
    const lineRef = normalizeReference(line.bank_reference);

    const scored: MatchSuggestion[] = [];
    for (const item of candidates) {
      if (item.side !== expectedSide) continue;
      if (moneyToMillis(item.remaining_amount) <= BigInt(0)) continue;

      const itemRef = normalizeReference(item.bank_reference);
      const amountEqual = moneyEquals(item.remaining_amount, remainingOnLine);

      if (lineRef && itemRef && lineRef === itemRef) {
        scored.push({
          bank_statement_line_id: line.id,
          journal_entry_id: item.journal_entry_id,
          journal_entry_line_id: item.journal_entry_line_id,
          entry_number: item.entry_number,
          entry_date: item.entry_date,
          amount: item.remaining_amount,
          confidence: 95,
          reason: 'مرجع مطابق تماماً',
        });
        continue;
      }
      if (amountEqual && item.entry_date === lineDate) {
        scored.push({
          bank_statement_line_id: line.id,
          journal_entry_id: item.journal_entry_id,
          journal_entry_line_id: item.journal_entry_line_id,
          entry_number: item.entry_number,
          entry_date: item.entry_date,
          amount: item.remaining_amount,
          confidence: 85,
          reason: 'نفس المبلغ ونفس التاريخ',
        });
        continue;
      }
      if (amountEqual && dateDiffDays(item.entry_date, lineDate) <= 3) {
        scored.push({
          bank_statement_line_id: line.id,
          journal_entry_id: item.journal_entry_id,
          journal_entry_line_id: item.journal_entry_line_id,
          entry_number: item.entry_number,
          entry_date: item.entry_date,
          amount: item.remaining_amount,
          confidence: 70,
          reason: 'نفس المبلغ وتاريخ قريب (٣ أيام أو أقل)',
        });
      }
    }

    scored.sort((a, b) => b.confidence - a.confidence);
    suggestions.push(...scored.slice(0, perLineLimit));
    if (suggestions.length >= limitTotal) break;
  }

  return suggestions.slice(0, limitTotal);
}

/**
 * إنشاء قيد تسوية (Adjustment) من سطر كشف لم يُسجَّل بعد في الدفاتر (مثل رسوم/فوائد بنكية).
 * سطر Debit (خروج): مدين الحساب المقابل / دائن البنك GL.
 * سطر Credit (دخول): مدين البنك GL / دائن الحساب المقابل.
 */
export async function createBankAdjustmentFromStatementLine(
  client: TxClient,
  params: {
    lineId: string;
    counterAccountId: unknown;
    costCenterId?: unknown;
    description?: unknown;
    userId: string;
  }
): Promise<{
  line: BankStatementLineRow;
  journalEntryId: string;
  matchId: string;
  amount: string;
}> {
  const linePeek = await loadBankStatementLine(client, params.lineId);
  const statementPeek = await loadBankStatement(client, linePeek.bank_statement_id);
  const bankAccPeek = await loadBankAccount(client, statementPeek.bank_account_id);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: bankAccPeek.id,
    userId: params.userId,
  });
  await assertCanPostBankAccount(client, {
    bankAccountId: bankAccPeek.id,
    userId: params.userId,
  });

  await acquireAccountingResourceLocks(client, [
    bankAccountLock(bankAccPeek.id),
    bankGlLock(bankAccPeek.gl_account_id),
    bankStatementLock(statementPeek.id),
    journalSourceLock('BANK_RECONCILIATION_ADJUSTMENT', params.lineId),
  ]);

  const statement = await loadBankStatement(client, statementPeek.id, true);
  assertStatementMatchable(statement);

  const line = await loadBankStatementLine(client, params.lineId, true);
  if (line.bank_statement_id !== statement.id) {
    throw new AccountsHttpError('السطر لا يتبع هذا الكشف', 409);
  }
  if (line.adjustment_journal_entry_id) {
    throw new AccountsHttpError('يوجد قيد تسوية مرحّل لهذا السطر مسبقاً', 409);
  }
  if (line.match_status === 'EXCLUDED') {
    throw new AccountsHttpError('لا يمكن إنشاء تسوية لسطر مستبعد — أعد إدراجه أولاً', 409);
  }

  const { side, amount } = lineSide(line);
  const remainingMillis = moneyToMillis(amount) - (await sumMatchedForLine(client, line.id));
  if (remainingMillis <= BigInt(0)) {
    throw new AccountsHttpError('السطر مطابق بالكامل مسبقاً — لا حاجة لتسوية', 409);
  }
  const amountToPost = millisToMoney(remainingMillis);

  const bankAcc = await loadBankAccount(client, statement.bank_account_id, true);

  const counterAccountId = String(params.counterAccountId ?? '').trim();
  if (!counterAccountId) throw new AccountsHttpError('الحساب المقابل مطلوب', 400);
  if (counterAccountId === bankAcc.gl_account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب GL للبنك نفسه',
      400
    );
  }
  const counterAcc = await assertPostingAccount(
    client,
    counterAccountId,
    'الحساب المقابل',
    { invalidStatusCode: 400 }
  );
  const bankGl = await assertPostingAccount(
    client,
    bankAcc.gl_account_id,
    'حساب البنك GL',
    { invalidStatusCode: 400 }
  );

  const costCenterId =
    params.costCenterId == null || params.costCenterId === ''
      ? null
      : String(params.costCenterId).trim();
  if ((bankGl.requires_cost_center || counterAcc.requires_cost_center) && !costCenterId) {
    throw new AccountsHttpError('أحد الحسابات يتطلب مركز كلفة', 409);
  }
  if (costCenterId) {
    const cc = await txQuery(
      client,
      `SELECT id FROM accounts.cost_centers WHERE id = $1::uuid AND is_active`,
      [costCenterId]
    );
    if (!cc.rows[0]) throw new AccountsHttpError('مركز الكلفة غير صالح', 400);
  }

  const transactionDate = pgDateOnly(line.transaction_date);
  const fiscal = await resolveOpenFiscalForAdjustmentDate(client, transactionDate);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: fiscal.fiscalYearId,
    fiscalPeriodId: fiscal.fiscalPeriodId,
    entryDate: transactionDate,
  });

  const lineDesc =
    params.description != null && params.description !== ''
      ? String(params.description).trim().slice(0, 4000)
      : line.description;

  const linesInput =
    side === 'DEBIT'
      ? [
          {
            account_id: counterAccountId,
            cost_center_id: costCenterId,
            debit_amount: amountToPost,
            credit_amount: '0',
            description: lineDesc,
          },
          {
            account_id: bankAcc.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amountToPost,
            description: `تسوية مطابقة مصرفية — ${statement.statement_number}`,
          },
        ]
      : [
          {
            account_id: bankAcc.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: amountToPost,
            credit_amount: '0',
            description: `تسوية مطابقة مصرفية — ${statement.statement_number}`,
          },
          {
            account_id: counterAccountId,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amountToPost,
            description: lineDesc,
          },
        ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(client, fiscal.fiscalYearId);
  const jeDesc = [
    'تسوية مطابقة مصرفية',
    statement.statement_number,
    `سطر #${line.line_number}`,
    lineDesc,
  ]
    .filter(Boolean)
    .join(' — ');

  const jeIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'ADJUSTMENT',
       'BANK_RECONCILIATION_ADJUSTMENT', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      fiscal.fiscalYearId,
      fiscal.fiscalPeriodId,
      transactionDate,
      line.id,
      line.bank_reference || statement.statement_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalEntryId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalEntryId, lines);

  const bankGlLine = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.journal_entry_lines
     WHERE journal_entry_id = $1::uuid AND account_id = $2::uuid
     LIMIT 1`,
    [journalEntryId, bankAcc.gl_account_id]
  );

  const matchIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.bank_reconciliation_matches (
       bank_statement_id, bank_statement_line_id, journal_entry_id, journal_entry_line_id,
       matched_amount, match_type, confidence, notes, created_by
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric, 'ADJUSTMENT', 100, $6, $7::uuid)
     RETURNING id`,
    [
      statement.id,
      line.id,
      journalEntryId,
      bankGlLine.rows[0]?.id ?? null,
      amountToPost,
      `قيد تسوية آلي لسطر #${line.line_number}`,
      params.userId,
    ]
  );

  await txQuery(
    client,
    `UPDATE accounts.bank_statement_lines
     SET adjustment_journal_entry_id = $2::uuid, updated_at = NOW()
     WHERE id = $1::uuid`,
    [line.id, journalEntryId]
  );

  const finalLine = await refreshLineMatchStatus(client, line.id);

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_reconciliation.adjustment_posted',
    entityType: 'bank_statement_line',
    entityId: line.id,
    newValues: { journal_entry_id: journalEntryId, amount: amountToPost, entry_number: entryNumber },
    description: `ترحيل قيد تسوية مطابقة مصرفية ${entryNumber} لكشف ${statement.statement_number}`,
  });

  return {
    line: finalLine,
    journalEntryId,
    matchId: matchIns.rows[0].id as string,
    amount: amountToPost,
  };
}

async function resolveOpenFiscalForAdjustmentDate(
  client: TxClient,
  date: string
): Promise<{ fiscalYearId: string; fiscalPeriodId: string }> {
  const r = await txQuery<{ year_id: string; period_id: string }>(
    client,
    `SELECT y.id AS year_id, p.id AS period_id
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE'
       AND p.status = 'OPEN'
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`,
    [date]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ حركة السطر', 409);
  }
  return { fiscalYearId: r.rows[0].year_id, fiscalPeriodId: r.rows[0].period_id };
}

/**
 * حساب التسوية الكامل لكشف — صيغة تسوية بنكية تقليدية:
 *   bank_adjusted = closing_balance + outstanding_book_debits - outstanding_book_credits
 *   difference    = bank_adjusted - book_balance_at_date_to
 * حيث outstanding_book_debits/credits = حركات دفترية POSTED (تاريخها ≤ date_to) لم تُطابَق
 * بالكامل بعد (عبر أي كشف — المطابقة نهائية بمجرد إثباتها)، أي: "معلّقة" لم تظهر في البنك بعد.
 * عند اكتمال مطابقة كل سطور الكشف والحركات الدفترية المرتبطة بالفترة، يجب أن يكون difference=0.
 */
export async function calculateBankReconciliation(
  client: TxClient,
  statementId: string
): Promise<BankReconciliationSummary> {
  const statement = await loadBankStatement(client, statementId);
  const bankAcc = await loadBankAccount(client, statement.bank_account_id);
  const dateTo = pgDateOnly(statement.date_to);

  const lines = await listBankStatementLines(client, statement.id);

  let totalDebitsMillis = BigInt(0);
  let totalCreditsMillis = BigInt(0);
  let unmatchedBankDebitsMillis = BigInt(0);
  let unmatchedBankCreditsMillis = BigInt(0);
  let adjustmentsCount = 0;

  for (const line of lines) {
    const debit = normalizeMoneyInput(line.debit_amount);
    const credit = normalizeMoneyInput(line.credit_amount);
    totalDebitsMillis += moneyToMillis(debit);
    totalCreditsMillis += moneyToMillis(credit);
    if (line.adjustment_journal_entry_id) adjustmentsCount += 1;

    if (line.match_status === 'EXCLUDED') continue;
    const { side, amount } = lineSide(line);
    const matchedMillis = await sumMatchedForLine(client, line.id);
    const remaining = moneyToMillis(amount) - matchedMillis;
    if (remaining <= BigInt(0)) continue;
    if (side === 'DEBIT') unmatchedBankDebitsMillis += remaining;
    else unmatchedBankCreditsMillis += remaining;
  }

  const totalDebits = millisToMoney(totalDebitsMillis);
  const totalCredits = millisToMoney(totalCreditsMillis);
  const openingBalanceMillis = moneyToMillisSignedLocal(statement.opening_balance);
  const closingBalanceMillis = moneyToMillisSignedLocal(statement.closing_balance);
  const statementMovementMillis = totalCreditsMillis - totalDebitsMillis;
  const expectedClosingMillis = openingBalanceMillis + statementMovementMillis;
  const statementBalanceOk = expectedClosingMillis === closingBalanceMillis;

  const bookRes = await txQuery<{
    journal_entry_id: string;
    debit_sum: string;
    credit_sum: string;
  }>(
    client,
    `SELECT je.id AS journal_entry_id,
            COALESCE(SUM(jel.debit_amount), 0)::text AS debit_sum,
            COALESCE(SUM(jel.credit_amount), 0)::text AS credit_sum
     FROM accounts.journal_entries je
     JOIN accounts.journal_entry_lines jel
       ON jel.journal_entry_id = je.id AND jel.account_id = $1::uuid
     WHERE je.status = 'POSTED' AND je.entry_date <= $2::date
     GROUP BY je.id`,
    [bankAcc.gl_account_id, dateTo]
  );

  let bookBalanceMillis = BigInt(0);
  let outstandingDebitsMillis = BigInt(0);
  let outstandingCreditsMillis = BigInt(0);

  if (bookRes.rows.length > 0) {
    const jeIds = bookRes.rows.map((r) => r.journal_entry_id);
    const matchedRes = await txQuery<{ journal_entry_id: string; total: string }>(
      client,
      `SELECT journal_entry_id, COALESCE(SUM(matched_amount), 0)::text AS total
       FROM accounts.bank_reconciliation_matches
       WHERE journal_entry_id = ANY($1::uuid[])
       GROUP BY journal_entry_id`,
      [jeIds]
    );
    const matchedByJe = new Map<string, bigint>();
    for (const row of matchedRes.rows) {
      matchedByJe.set(row.journal_entry_id, moneyToMillis(normalizeMoneyInput(row.total)));
    }

    for (const row of bookRes.rows) {
      const debitMillis = moneyToMillis(normalizeMoneyInput(row.debit_sum));
      const creditMillis = moneyToMillis(normalizeMoneyInput(row.credit_sum));
      bookBalanceMillis += debitMillis - creditMillis;

      const net = debitMillis - creditMillis;
      const matched = matchedByJe.get(row.journal_entry_id) ?? BigInt(0);
      if (net > BigInt(0)) {
        const remaining = net - matched;
        if (remaining > BigInt(0)) outstandingDebitsMillis += remaining;
      } else if (net < BigInt(0)) {
        const remaining = -net - matched;
        if (remaining > BigInt(0)) outstandingCreditsMillis += remaining;
      }
    }
  }

  const bankAdjustedMillis =
    closingBalanceMillis + outstandingDebitsMillis - outstandingCreditsMillis;
  const differenceMillis = bankAdjustedMillis - bookBalanceMillis;

  const adjustmentsNetRes = await txQuery<{ net: string }>(
    client,
    `SELECT COALESCE(SUM(
       CASE WHEN bsl.debit_amount > 0 THEN -brm.matched_amount ELSE brm.matched_amount END
     ), 0)::text AS net
     FROM accounts.bank_reconciliation_matches brm
     JOIN accounts.bank_statement_lines bsl ON bsl.id = brm.bank_statement_line_id
     WHERE brm.bank_statement_id = $1::uuid AND brm.match_type = 'ADJUSTMENT'`,
    [statement.id]
  );

  return {
    opening_balance: millisToMoney(openingBalanceMillis),
    closing_balance: millisToMoney(closingBalanceMillis),
    total_credits: totalCredits,
    total_debits: totalDebits,
    statement_movement: millisToMoney(statementMovementMillis),
    expected_closing: millisToMoney(expectedClosingMillis),
    statement_balance_ok: statementBalanceOk,
    book_balance_at_date_to: millisToMoney(bookBalanceMillis),
    unmatched_bank_credits: millisToMoney(unmatchedBankCreditsMillis),
    unmatched_bank_debits: millisToMoney(unmatchedBankDebitsMillis),
    outstanding_book_debits: millisToMoney(outstandingDebitsMillis),
    outstanding_book_credits: millisToMoney(outstandingCreditsMillis),
    adjustments_count: adjustmentsCount,
    adjustments_net: normalizeSignedMoneyInput(adjustmentsNetRes.rows[0]?.net ?? '0'),
    bank_adjusted: millisToMoney(bankAdjustedMillis),
    reconciled_book_balance: millisToMoney(bankAdjustedMillis),
    difference: millisToMoney(differenceMillis),
    within_tolerance: differenceMillis === BigInt(0),
  };
}

/** يقبل مبالغ موجبة/سالبة (أرصدة الكشف قد تكون سالبة لحسابات سحب على المكشوف) */
function moneyToMillisSignedLocal(value: string): bigint {
  const raw = String(value ?? '0').trim();
  const neg = raw.startsWith('-');
  const abs = normalizeMoneyInput(neg ? raw.slice(1) : raw);
  const millis = moneyToMillis(abs);
  return neg ? -millis : millis;
}

/**
 * إنهاء التسوية: كل السطور MATCHED أو EXCLUDED، ورصيد الكشف متّسق حسابياً (فرق = صفر تماماً).
 */
export async function markBankStatementReconciled(
  client: TxClient,
  params: { statementId: string; userId: string }
): Promise<BankStatementRow> {
  const statementPeek = await loadBankStatement(client, params.statementId);
  const bankAccPeek = await loadBankAccount(client, statementPeek.bank_account_id);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: bankAccPeek.id,
    userId: params.userId,
  });

  await acquireAccountingResourceLocks(client, [
    bankStatementLock(statementPeek.id),
    bankAccountLock(bankAccPeek.id),
  ]);

  const statement = await loadBankStatement(client, statementPeek.id, true);
  assertStatementMatchable(statement);

  const lines = await listBankStatementLines(client, statement.id);
  const unresolved = lines.filter(
    (l) => l.match_status === 'UNMATCHED' || l.match_status === 'PARTIALLY_MATCHED'
  );
  if (unresolved.length > 0) {
    throw new AccountsHttpError(
      `توجد ${unresolved.length} سطر/سطور غير مطابقة بالكامل — طابقها أو استبعدها أولاً`,
      409
    );
  }

  const calc = await calculateBankReconciliation(client, statement.id);
  if (!calc.statement_balance_ok) {
    throw new AccountsHttpError(
      'الرصيد الافتتاحي + صافي الحركات لا يساوي الرصيد الختامي المُدخل للكشف',
      409
    );
  }
  if (!calc.within_tolerance) {
    throw new AccountsHttpError(
      `يوجد فرق تسوية غير صفري بين البنك والدفاتر (الفرق: ${calc.difference})`,
      409
    );
  }

  const upd = await txQuery<BankStatementRow>(
    client,
    `UPDATE accounts.bank_statements SET
       status = 'RECONCILED',
       reconciled_by = $2::uuid,
       reconciled_at = NOW(),
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [statement.id, params.userId]
  );
  const row = upd.rows[0];

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.reconciled',
    entityType: 'bank_statement',
    entityId: row.id,
    newValues: {
      difference: calc.difference,
      summary: calc,
      within_tolerance: calc.within_tolerance,
      statement_balance_ok: calc.statement_balance_ok,
    },
    description: `إنهاء تسوية كشف الحساب المصرفي ${row.statement_number}`,
  });

  return row;
}

/** إغلاق كشف مُسوّى — Accounts Admin فقط؛ يحفظ لقطة snapshot_json نهائية */
export async function closeBankStatement(
  client: TxClient,
  params: { statementId: string; userId: string }
): Promise<BankStatementRow> {
  await requireAccountsAdmin(
    client,
    params.userId,
    'إغلاق كشف الحساب المصرفي يتطلب صلاحية مدير الحسابات (Accounts Admin)'
  );

  const statementPeek = await loadBankStatement(client, params.statementId);
  await acquireAccountingResourceLocks(client, [bankStatementLock(statementPeek.id)]);

  const statement = await loadBankStatement(client, statementPeek.id, true);
  if (statement.status !== 'RECONCILED') {
    throw new AccountsHttpError('يمكن إغلاق الكشوف المسوّاة (RECONCILED) فقط', 409);
  }

  const calc = await calculateBankReconciliation(client, statement.id);
  const outstanding = await listBookItems(client, {
    statementId: statement.id,
    unmatchedOnly: true,
    pageSize: 200,
  });
  const lines = await listBankStatementLines(client, statement.id);
  const snapshot: ClosedStatementSnapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    summary: calc,
    outstanding_book_items: outstanding.items,
    lines: lines.map(serializeBankStatementLine),
  };

  const upd = await txQuery<BankStatementRow>(
    client,
    `UPDATE accounts.bank_statements SET
       status = 'CLOSED',
       snapshot_json = $2::jsonb,
       closed_by = $3::uuid,
       closed_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [statement.id, JSON.stringify(snapshot), params.userId]
  );
  const row = upd.rows[0];

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.closed',
    entityType: 'bank_statement',
    entityId: row.id,
    newValues: {
      snapshot_version: 1,
      difference: calc.difference,
      within_tolerance: calc.within_tolerance,
      outstanding_count: outstanding.items.length,
      lines_count: lines.length,
    },
    description: `إغلاق كشف الحساب المصرفي ${row.statement_number}`,
  });

  return row;
}

/** إعادة فتح كشف مُسوّى (وليس مغلقاً) — Accounts Admin فقط */
export async function reopenBankStatement(
  client: TxClient,
  params: { statementId: string; userId: string; reason?: unknown }
): Promise<BankStatementRow> {
  await requireAccountsAdmin(
    client,
    params.userId,
    'إعادة فتح كشف الحساب المصرفي يتطلب صلاحية مدير الحسابات (Accounts Admin)'
  );

  const reasonRaw = params.reason != null ? String(params.reason).trim() : '';
  if (!reasonRaw) {
    throw new AccountsHttpError('سبب إعادة الفتح مطلوب', 400);
  }
  const reason = reasonRaw.slice(0, 2000);

  const statementPeek = await loadBankStatement(client, params.statementId);
  await acquireAccountingResourceLocks(client, [bankStatementLock(statementPeek.id)]);

  const statement = await loadBankStatement(client, statementPeek.id, true);
  if (statement.status === 'CLOSED') {
    throw new AccountsHttpError('الكشف مغلق نهائياً — لا يمكن إعادة فتحه', 409);
  }
  if (statement.status !== 'RECONCILED') {
    throw new AccountsHttpError('يمكن إعادة الفتح من حالة مُسوّى (RECONCILED) فقط', 409);
  }

  const upd = await txQuery<BankStatementRow>(
    client,
    `UPDATE accounts.bank_statements SET
       status = 'IN_PROGRESS',
       reconciled_by = NULL,
       reconciled_at = NULL,
       snapshot_json = NULL,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [statement.id, params.userId]
  );
  const row = upd.rows[0];

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.reopened',
    entityType: 'bank_statement',
    entityId: row.id,
    newValues: { reason, previous_status: 'RECONCILED' },
    description: `إعادة فتح كشف الحساب المصرفي ${row.statement_number} للتسوية`,
  });

  return row;
}

export {
  assertStatementEditable,
  assertStatementMatchable,
  loadBankStatement,
  loadBankStatementLine,
  serializeBankStatement,
  serializeBankStatementLine,
  serializeMatch as serializeBankReconciliationMatch,
};
