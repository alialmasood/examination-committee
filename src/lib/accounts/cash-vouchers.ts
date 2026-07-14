/**
 * سندات القبض والصرف النقدي (المرحلة 3.D).
 */
import {
  getAccountBookBalanceTx,
} from './account-book-balance';
import { AccountsHttpError } from './auth';
import { loadCashBox } from './cash-boxes';
import {
  loadCashSession,
  type CashBoxSessionRow,
} from './cash-box-sessions';
import { assertCanOperateCashSession } from './cash-session-access';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import {
  assertFiscalContextForEntry,
  createReversalEntry,
  loadJournalEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
  allocateJournalEntryNumber,
} from './journal-entries';
import {
  moneyIsPositive,
  moneyToMillis,
  moneyToMillisSigned,
  millisToMoney,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import {
  acquireAccountingResourceLocks,
  cashboxLock,
  cashSessionLock,
  chartAccountLock,
} from './accounting-locks';
import { assertPostingAccount } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CashVoucherType = 'CASH_RECEIPT' | 'CASH_PAYMENT';
export type CashVoucherStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type CashVoucherRow = {
  id: string;
  voucher_number: string;
  voucher_type: CashVoucherType;
  status: CashVoucherStatus;
  fiscal_year_id: string;
  fiscal_period_id: string;
  cash_box_id: string;
  cash_box_session_id: string;
  counter_account_id: string;
  cost_center_id: string | null;
  voucher_date: string | Date;
  amount: string;
  currency_code: string;
  party_name: string | null;
  party_reference: string | null;
  external_reference: string | null;
  description: string;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  posted_at: Date | string | null;
  posted_by: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeCashVoucher(row: CashVoucherRow) {
  return {
    ...row,
    amount: normalizeMoneyInput(row.amount),
    voucher_date: pgDateOnly(row.voucher_date),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function sourceTypeFor(voucherType: CashVoucherType): string {
  return voucherType === 'CASH_RECEIPT' ? 'CASH_RECEIPT' : 'CASH_PAYMENT';
}

function entryTypeFor(voucherType: CashVoucherType): 'RECEIPT' | 'PAYMENT' {
  return voucherType === 'CASH_RECEIPT' ? 'RECEIPT' : 'PAYMENT';
}

function documentTypeFor(
  voucherType: CashVoucherType
): 'RECEIPT_VOUCHER' | 'PAYMENT_VOUCHER' {
  return voucherType === 'CASH_RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER';
}

export async function allocateCashVoucherNumber(
  client: TxClient,
  params: { fiscalYearId: string; voucherType: CashVoucherType }
): Promise<string> {
  const year = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id = $1`,
    [params.fiscalYearId]
  );
  if (!year.rows[0]) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: documentTypeFor(params.voucherType),
      fiscalYearId: params.fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم السند';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadCashVoucher(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<CashVoucherRow> {
  const r = await txQuery<CashVoucherRow>(
    client,
    `SELECT * FROM accounts.cash_vouchers WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('السند غير موجود', 404);
  return r.rows[0];
}

function assertOptimistic(
  row: CashVoucherRow,
  version: unknown,
  updatedAt: unknown
): void {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

async function assertOpenSessionForVoucher(
  client: TxClient,
  session: CashBoxSessionRow
): Promise<void> {
  // بدء الإغلاق ينقل الجلسة إلى CLOSING — تُرفض الحركات حتى قبل CLOSED
  if (session.status === 'CLOSING' || session.closing_started_at) {
    throw new AccountsHttpError(
      'لا يمكن إنشاء أو تعديل أو ترحيل سندات بعد بدء إغلاق الجلسة',
      409
    );
  }
  if (session.status !== 'OPEN') {
    throw new AccountsHttpError(
      'سندات القبض والصرف تتطلب جلسة صندوق مفتوحة (OPEN)',
      409
    );
  }
}

export type SessionExpectedBalance = {
  session_id: string;
  opening_book_balance: string;
  posted_receipts_total: string;
  posted_payments_total: string;
  transfers_out_total: string;
  transfers_in_total: string;
  expected_balance: string;
  current_book_balance: string;
};

/**
 * الرصيد المتوقع =
 * افتتاحي + مقبوضات − مصروفات − تحويلات صادرة (DISPATCHED|RECEIVED) + تحويلات واردة (RECEIVED)
 */
export async function calculateSessionExpectedBalance(
  client: TxClient,
  params: { sessionId: string; accountId?: string | null }
): Promise<SessionExpectedBalance> {
  const session = await loadCashSession(client, params.sessionId);
  const sums = await txQuery<{
    receipts: string;
    payments: string;
  }>(
    client,
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_RECEIPT' AND status = 'POSTED'), 0)::text AS receipts,
       COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_PAYMENT' AND status = 'POSTED'), 0)::text AS payments
     FROM accounts.cash_vouchers
     WHERE cash_box_session_id = $1::uuid`,
    [params.sessionId]
  );
  const transfers = await txQuery<{ out_amt: string; in_amt: string }>(
    client,
    `SELECT
       COALESCE(SUM(amount) FILTER (
         WHERE source_session_id = $1::uuid
           AND status IN ('DISPATCHED', 'RECEIVED')
       ), 0)::text AS out_amt,
       COALESCE(SUM(amount) FILTER (
         WHERE destination_session_id = $1::uuid
           AND status = 'RECEIVED'
       ), 0)::text AS in_amt
     FROM accounts.cash_transfers
     WHERE source_session_id = $1::uuid OR destination_session_id = $1::uuid`,
    [params.sessionId]
  );
  const receipts = normalizeMoneyInput(sums.rows[0]?.receipts ?? '0');
  const payments = normalizeMoneyInput(sums.rows[0]?.payments ?? '0');
  const transfersOut = normalizeMoneyInput(transfers.rows[0]?.out_amt ?? '0');
  const transfersIn = normalizeMoneyInput(transfers.rows[0]?.in_amt ?? '0');
  const opening = normalizeSignedMoneyInput(session.opening_book_balance);
  const expected = millisToMoney(
    moneyToMillisSigned(opening) +
      moneyToMillis(receipts) -
      moneyToMillis(payments) -
      moneyToMillis(transfersOut) +
      moneyToMillis(transfersIn)
  );

  let currentBook = expected;
  const accountId = params.accountId;
  if (accountId) {
    const bal = await getAccountBookBalanceTx(client, accountId);
    currentBook = bal.balance;
  }

  return {
    session_id: session.id,
    opening_book_balance: opening,
    posted_receipts_total: receipts,
    posted_payments_total: payments,
    transfers_out_total: transfersOut,
    transfers_in_total: transfersIn,
    expected_balance: expected,
    current_book_balance: currentBook,
  };
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function requireDescription(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('بيان السند مطلوب', 400);
  return s.slice(0, 4000);
}

export async function createCashVoucher(
  client: TxClient,
  input: {
    voucher_type: unknown;
    cash_box_id: unknown;
    cash_box_session_id: unknown;
    counter_account_id: unknown;
    cost_center_id?: unknown;
    voucher_date: unknown;
    amount: unknown;
    party_name?: unknown;
    party_reference?: unknown;
    external_reference?: unknown;
    description: unknown;
    created_by: string;
  }
): Promise<CashVoucherRow> {
  const voucherType = String(input.voucher_type || '').toUpperCase();
  if (voucherType !== 'CASH_RECEIPT' && voucherType !== 'CASH_PAYMENT') {
    throw new AccountsHttpError('نوع السند غير صالح', 400);
  }
  const boxId = String(input.cash_box_id || '');
  const sessionId = String(input.cash_box_session_id || '');
  if (!boxId || !sessionId) {
    throw new AccountsHttpError('الصندوق والجلسة مطلوبان', 400);
  }

  const box = await loadCashBox(client, boxId, true);
  if (box.status !== 'ACTIVE') {
    throw new AccountsHttpError('الصندوق يجب أن يكون فعّالاً', 409);
  }
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي', 409);
  }

  const session = await loadCashSession(client, sessionId, true);
  if (session.cash_box_id !== box.id) {
    throw new AccountsHttpError('الجلسة لا تنتمي لهذا الصندوق', 409);
  }
  await assertOpenSessionForVoucher(client, session);
  await assertCanOperateCashSession(client, {
    cashBoxId: box.id,
    userId: input.created_by,
    actionLabel: 'إنشاء سند نقدي',
  });

  const voucherDate = pgDateOnly(String(input.voucher_date || ''));
  if (!voucherDate) throw new AccountsHttpError('تاريخ السند مطلوب', 400);

  await assertFiscalContextForEntry(client, {
    fiscalYearId: session.fiscal_year_id,
    fiscalPeriodId: session.fiscal_period_id,
    entryDate: voucherDate,
  });

  const amount = normalizeMoneyInput(input.amount);
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('مبلغ السند يجب أن يكون أكبر من صفر', 400);
  }

  const counterId = String(input.counter_account_id || '');
  if (!counterId) throw new AccountsHttpError('الحساب المقابل مطلوب', 400);
  if (counterId === box.account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب الصندوق نفسه',
      400
    );
  }
  await assertPostingAccount(client, counterId, 'الحساب المقابل');
  await assertPostingAccount(client, box.account_id, 'حساب الصندوق');

  const costCenterId =
    input.cost_center_id != null && input.cost_center_id !== ''
      ? String(input.cost_center_id)
      : box.cost_center_id;

  const currency = (box.currency_code || 'IQD').trim() || 'IQD';
  const voucherNumber = await allocateCashVoucherNumber(client, {
    fiscalYearId: session.fiscal_year_id,
    voucherType: voucherType as CashVoucherType,
  });

  const ins = await txQuery<CashVoucherRow>(
    client,
    `INSERT INTO accounts.cash_vouchers (
       voucher_number, voucher_type, status,
       fiscal_year_id, fiscal_period_id,
       cash_box_id, cash_box_session_id,
       counter_account_id, cost_center_id,
       voucher_date, amount, currency_code,
       party_name, party_reference, external_reference, description,
       version, created_by, updated_by
     ) VALUES (
       $1, $2, 'DRAFT',
       $3::uuid, $4::uuid,
       $5::uuid, $6::uuid,
       $7::uuid, $8::uuid,
       $9::date, $10::numeric, $11,
       $12, $13, $14, $15,
       1, $16::uuid, $16::uuid
     )
     RETURNING *`,
    [
      voucherNumber,
      voucherType,
      session.fiscal_year_id,
      session.fiscal_period_id,
      box.id,
      session.id,
      counterId,
      costCenterId,
      voucherDate,
      amount,
      currency,
      normalizeOptionalText(input.party_name, 200),
      normalizeOptionalText(input.party_reference, 100),
      normalizeOptionalText(input.external_reference, 100),
      requireDescription(input.description),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateCashVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    counter_account_id?: unknown;
    cost_center_id?: unknown;
    voucher_date?: unknown;
    amount?: unknown;
    party_name?: unknown;
    party_reference?: unknown;
    external_reference?: unknown;
    description?: unknown;
  }
): Promise<CashVoucherRow> {
  const voucher = await loadCashVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);

  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  const session = await loadCashSession(client, voucher.cash_box_session_id, true);
  await assertOpenSessionForVoucher(client, session);
  await assertCanOperateCashSession(client, {
    cashBoxId: voucher.cash_box_id,
    userId: params.userId,
    actionLabel: 'تعديل سند نقدي',
  });

  const box = await loadCashBox(client, voucher.cash_box_id, true);
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي', 409);
  }

  let counterId = voucher.counter_account_id;
  if (params.counter_account_id !== undefined) {
    counterId = String(params.counter_account_id || '');
    if (!counterId) throw new AccountsHttpError('الحساب المقابل مطلوب', 400);
  }
  if (counterId === box.account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب الصندوق نفسه',
      400
    );
  }
  await assertPostingAccount(client, counterId, 'الحساب المقابل');

  let costCenterId = voucher.cost_center_id;
  if (params.cost_center_id !== undefined) {
    costCenterId =
      params.cost_center_id == null || params.cost_center_id === ''
        ? null
        : String(params.cost_center_id);
  }

  let voucherDate = pgDateOnly(voucher.voucher_date);
  if (params.voucher_date !== undefined) {
    voucherDate = pgDateOnly(String(params.voucher_date || ''));
    if (!voucherDate) throw new AccountsHttpError('تاريخ السند غير صالح', 400);
  }
  await assertFiscalContextForEntry(client, {
    fiscalYearId: voucher.fiscal_year_id,
    fiscalPeriodId: voucher.fiscal_period_id,
    entryDate: voucherDate,
  });

  let amount = normalizeMoneyInput(voucher.amount);
  if (params.amount !== undefined) {
    amount = normalizeMoneyInput(params.amount);
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError('مبلغ السند يجب أن يكون أكبر من صفر', 400);
    }
  }

  const description =
    params.description !== undefined
      ? requireDescription(params.description)
      : voucher.description;

  const partyName =
    params.party_name !== undefined
      ? normalizeOptionalText(params.party_name, 200)
      : voucher.party_name;
  const partyRef =
    params.party_reference !== undefined
      ? normalizeOptionalText(params.party_reference, 100)
      : voucher.party_reference;
  const extRef =
    params.external_reference !== undefined
      ? normalizeOptionalText(params.external_reference, 100)
      : voucher.external_reference;

  const upd = await txQuery<CashVoucherRow>(
    client,
    `UPDATE accounts.cash_vouchers SET
       counter_account_id = $2::uuid,
       cost_center_id = $3::uuid,
       voucher_date = $4::date,
       amount = $5::numeric,
       party_name = $6,
       party_reference = $7,
       external_reference = $8,
       description = $9,
       updated_by = $10::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      voucher.id,
      counterId,
      costCenterId,
      voucherDate,
      amount,
      partyName,
      partyRef,
      extRef,
      description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function postCashVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ voucher: CashVoucherRow; created: boolean }> {
  const voucher = await loadCashVoucher(client, params.id, true);

  // Idempotent
  if (voucher.status === 'POSTED' && voucher.journal_entry_id) {
    return { voucher, created: false };
  }
  if (voucher.status === 'VOID') {
    throw new AccountsHttpError('لا يمكن ترحيل سند ملغى', 409);
  }
  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل المسودات فقط', 409);
  }

  assertOptimistic(voucher, params.version, params.updated_at);

  const session = await loadCashSession(client, voucher.cash_box_session_id, true);
  await assertOpenSessionForVoucher(client, session);
  await assertCanOperateCashSession(client, {
    cashBoxId: voucher.cash_box_id,
    userId: params.userId,
    actionLabel: 'ترحيل سند نقدي',
  });

  const box = await loadCashBox(client, voucher.cash_box_id, true);
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي', 409);
  }
  if (voucher.counter_account_id === box.account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب الصندوق نفسه',
      400
    );
  }

  const voucherDate = pgDateOnly(voucher.voucher_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: voucher.fiscal_year_id,
    fiscalPeriodId: voucher.fiscal_period_id,
    entryDate: voucherDate,
  });

  const cashAcc = await assertPostingAccount(client, box.account_id, 'حساب الصندوق');
  const counterAcc = await assertPostingAccount(
    client,
    voucher.counter_account_id,
    'الحساب المقابل'
  );

  const costCenterId = voucher.cost_center_id || box.cost_center_id;
  if (
    (cashAcc.requires_cost_center || counterAcc.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError(
      'أحد الحسابات يتطلب مركز كلفة — عيّن مركز كلفة للسند أو الصندوق',
      409
    );
  }

  const amount = normalizeMoneyInput(voucher.amount);

  if (voucher.voucher_type === 'CASH_PAYMENT') {
    await acquireAccountingResourceLocks(client, [
      cashboxLock(box.id),
      cashSessionLock(session.id),
      chartAccountLock(box.account_id),
    ]);
    // قفل صف الجلسة أولاً ثم سندات الجلسة — يمنع تجاوز الرصيد تحت READ COMMITTED
    await loadCashSession(client, session.id, true);
    await txQuery(
      client,
      `SELECT id FROM accounts.cash_vouchers
       WHERE cash_box_session_id = $1::uuid
       FOR UPDATE`,
      [session.id]
    );
    const expected = await calculateSessionExpectedBalance(client, {
      sessionId: session.id,
      accountId: box.account_id,
    });
    if (moneyToMillis(amount) > moneyToMillisSigned(expected.expected_balance)) {
      throw new AccountsHttpError(
        'لا يمكن ترحيل سند الصرف لأن رصيد الصندوق المتاح غير كافٍ.',
        409
      );
    }
  }

  const linesInput =
    voucher.voucher_type === 'CASH_RECEIPT'
      ? [
          {
            account_id: box.account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: `قبض نقدي ${voucher.voucher_number}`,
          },
          {
            account_id: voucher.counter_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amount,
            description: voucher.description,
          },
        ]
      : [
          {
            account_id: voucher.counter_account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: voucher.description,
          },
          {
            account_id: box.account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amount,
            description: `صرف نقدي ${voucher.voucher_number}`,
          },
        ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    voucher.fiscal_year_id
  );

  const typeLabel =
    voucher.voucher_type === 'CASH_RECEIPT' ? 'سند قبض' : 'سند صرف';
  const jeDesc = [
    typeLabel,
    voucher.voucher_number,
    box.code,
    voucher.party_name ? `طرف: ${voucher.party_name}` : null,
    voucher.description,
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
      ($1, $2::uuid, $3::uuid, $4::date, $5,
       $6, $7::uuid, $8, $9,
       $10::numeric, $11::numeric, 'POSTED',
       1, $12::uuid, $12::uuid, $12::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      voucher.fiscal_year_id,
      voucher.fiscal_period_id,
      voucherDate,
      entryTypeFor(voucher.voucher_type),
      sourceTypeFor(voucher.voucher_type),
      voucher.id,
      voucher.external_reference || voucher.voucher_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  const posted = await txQuery<CashVoucherRow>(
    client,
    `UPDATE accounts.cash_vouchers SET
       status = 'POSTED',
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [voucher.id, journalId, params.userId]
  );

  return { voucher: posted.rows[0], created: true };
}

export async function voidCashVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason: unknown;
  }
): Promise<CashVoucherRow> {
  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new AccountsHttpError('سبب الإلغاء مطلوب', 400);

  const voucher = await loadCashVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);

  if (voucher.status === 'VOID') {
    return voucher;
  }

  const session = await loadCashSession(client, voucher.cash_box_session_id, true);
  if (session.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء سند مرتبط بجلسة صندوق مغلقة',
      409
    );
  }
  if (session.status === 'CLOSING' || session.closing_started_at) {
    throw new AccountsHttpError(
      'لا يمكن إلغاء سند بعد بدء إغلاق الجلسة',
      409
    );
  }
  if (session.status !== 'OPEN') {
    throw new AccountsHttpError(
      'إلغاء السند يتطلب أن تكون جلسة الصندوق مفتوحة',
      409
    );
  }
  await assertCanOperateCashSession(client, {
    cashBoxId: voucher.cash_box_id,
    userId: params.userId,
    actionLabel: 'إلغاء سند نقدي',
  });

  if (voucher.status === 'DRAFT') {
    const voided = await txQuery<CashVoucherRow>(
      client,
      `UPDATE accounts.cash_vouchers SET
         status = 'VOID',
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [voucher.id, reason.slice(0, 2000), params.userId]
    );
    return voided.rows[0];
  }

  if (voucher.status !== 'POSTED' || !voucher.journal_entry_id) {
    throw new AccountsHttpError('حالة السند لا تسمح بالإلغاء', 409);
  }

  const original = await loadJournalEntry(client, voucher.journal_entry_id);
  const reversalDate = pgDateOnly(voucher.voucher_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء ${voucher.voucher_number}: ${reason}`,
    userId: params.userId,
  });

  // المحرك يضع الأصل REVERSED؛ لإبقاء الرصيد الدفتري صحيحاً (POSTED فقط)
  // نعيد الأصل إلى POSTED مع الإبقاء على ربط قيد العكس — الأثر الصافي = صفر.
  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET status = 'POSTED',
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [voucher.journal_entry_id]
  );

  const voided = await txQuery<CashVoucherRow>(
    client,
    `UPDATE accounts.cash_vouchers SET
       status = 'VOID',
       reversal_journal_entry_id = $2::uuid,
       void_reason = $3,
       voided_by = $4::uuid,
       voided_at = NOW(),
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [voucher.id, reversal.id, reason.slice(0, 2000), params.userId]
  );
  return voided.rows[0];
}

export async function deleteDraftCashVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<void> {
  const voucher = await loadCashVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);
  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن حذف المسودات فقط', 409);
  }
  const session = await loadCashSession(client, voucher.cash_box_session_id, true);
  await assertOpenSessionForVoucher(client, session);
  await assertCanOperateCashSession(client, {
    cashBoxId: voucher.cash_box_id,
    userId: params.userId,
    actionLabel: 'حذف مسودة سند',
  });
  await txQuery(client, `DELETE FROM accounts.cash_vouchers WHERE id = $1::uuid`, [
    voucher.id,
  ]);
}

export async function listVouchersForSession(
  client: TxClient,
  sessionId: string
): Promise<CashVoucherRow[]> {
  const r = await txQuery<CashVoucherRow>(
    client,
    `SELECT * FROM accounts.cash_vouchers
     WHERE cash_box_session_id = $1::uuid
     ORDER BY voucher_date DESC, created_at DESC`,
    [sessionId]
  );
  return r.rows;
}
