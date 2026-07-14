/**
 * التحويلات النقدية بين الصناديق (المرحلة 3.E).
 * قرار محاسبي: Cash in Transit بقيدين (DISPATCH + RECEIVE).
 */
import { AccountsHttpError } from './auth';
import { loadCashBox } from './cash-boxes';
import {
  getLiveSessionForBox,
  loadCashSession,
  type CashBoxSessionRow,
} from './cash-box-sessions';
import { assertCanOperateCashSession } from './cash-session-access';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { getCashInTransitAccountId } from './cash-settings';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  createReversalEntry,
  loadJournalEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import {
  moneyIsPositive,
  moneyToMillis,
  moneyToMillisSigned,
  normalizeMoneyInput,
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
import { calculateSessionExpectedBalance } from './cash-vouchers';

export type CashTransferStatus =
  | 'DRAFT'
  | 'DISPATCHED'
  | 'RECEIVED'
  | 'CANCELLED';

export type CashTransferRow = {
  id: string;
  transfer_number: string;
  status: CashTransferStatus;
  source_cash_box_id: string;
  source_session_id: string;
  destination_cash_box_id: string;
  destination_session_id: string | null;
  fiscal_year_id: string;
  dispatch_period_id: string | null;
  receipt_period_id: string | null;
  transfer_date: string | Date;
  amount: string;
  currency_code: string;
  description: string;
  external_reference: string | null;
  dispatch_journal_entry_id: string | null;
  receipt_journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  dispatched_at: Date | string | null;
  dispatched_by: string | null;
  received_at: Date | string | null;
  received_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const SOURCE_DISPATCH = 'CASH_TRANSFER_DISPATCH';
const SOURCE_RECEIVE = 'CASH_TRANSFER_RECEIVE';

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeCashTransfer(row: CashTransferRow) {
  return {
    ...row,
    transfer_date: pgDateOnly(row.transfer_date as string | Date),
    amount: normalizeMoneyInput(row.amount),
    dispatched_at: iso(row.dispatched_at),
    received_at: iso(row.received_at),
    cancelled_at: iso(row.cancelled_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function assertOptimistic(
  row: CashTransferRow,
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

export async function loadCashTransfer(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<CashTransferRow> {
  const r = await txQuery<CashTransferRow>(
    client,
    `SELECT * FROM accounts.cash_transfers
     WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('التحويل غير موجود', 404);
  return r.rows[0];
}

async function assertOpenSessionForTransfer(
  session: CashBoxSessionRow,
  label: string
): Promise<void> {
  if (session.status === 'CLOSING' || session.closing_started_at) {
    throw new AccountsHttpError(
      `لا يمكن إجراء تحويل على ${label} بعد بدء إغلاق الجلسة`,
      409
    );
  }
  if (session.status !== 'OPEN') {
    throw new AccountsHttpError(
      `${label} تتطلب جلسة صندوق مفتوحة (OPEN)`,
      409
    );
  }
}

async function resolveCitAccount(
  client: TxClient
): Promise<{ id: string; code: string; requires_cost_center: boolean }> {
  const citId = await getCashInTransitAccountId();
  if (!citId) {
    throw new AccountsHttpError(
      'حساب النقد بالطريق غير مهيأ — عيّن cash_in_transit_account_id في إعدادات الصناديق',
      409
    );
  }
  return assertPostingAccount(client, citId, 'حساب النقد بالطريق');
}

async function allocateTransferNumber(
  client: TxClient,
  fiscalYearId: string
): Promise<string> {
  const year = await txQuery<{ start_date: string | Date }>(
    client,
    `SELECT start_date FROM accounts.fiscal_years WHERE id = $1::uuid`,
    [fiscalYearId]
  );
  if (!year.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  const seq = await nextDocumentNumber(client, {
    documentType: 'FINANCIAL_TRANSFER',
    fiscalYearId,
    yearLabel: yearLabelFromDate(year.rows[0].start_date),
  });
  return seq.formatted;
}

function requireDescription(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('البيان مطلوب', 400);
  return s.slice(0, 2000);
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

export async function listTransfersForSession(
  client: TxClient,
  sessionId: string
): Promise<{
  outbound: CashTransferRow[];
  inbound: CashTransferRow[];
  in_transit_inbound: CashTransferRow[];
}> {
  const out = await txQuery<CashTransferRow>(
    client,
    `SELECT * FROM accounts.cash_transfers
     WHERE source_session_id = $1::uuid
     ORDER BY created_at DESC`,
    [sessionId]
  );
  const inbound = await txQuery<CashTransferRow>(
    client,
    `SELECT * FROM accounts.cash_transfers
     WHERE destination_session_id = $1::uuid
        OR (
          status = 'DISPATCHED'
          AND destination_cash_box_id = (
            SELECT cash_box_id FROM accounts.cash_box_sessions WHERE id = $1::uuid
          )
        )
     ORDER BY created_at DESC`,
    [sessionId]
  );
  const received = inbound.rows.filter((t) => t.status === 'RECEIVED');
  const inTransit = inbound.rows.filter((t) => t.status === 'DISPATCHED');
  return {
    outbound: out.rows,
    inbound: received,
    in_transit_inbound: inTransit,
  };
}

export type CreateCashTransferInput = {
  source_cash_box_id: unknown;
  source_session_id: unknown;
  destination_cash_box_id: unknown;
  transfer_date: unknown;
  amount: unknown;
  description: unknown;
  external_reference?: unknown;
  created_by: string;
};

export async function createCashTransfer(
  client: TxClient,
  input: CreateCashTransferInput
): Promise<CashTransferRow> {
  const sourceBoxId = String(input.source_cash_box_id ?? '').trim();
  const destBoxId = String(input.destination_cash_box_id ?? '').trim();
  const sourceSessionId = String(input.source_session_id ?? '').trim();
  if (!sourceBoxId || !destBoxId || !sourceSessionId) {
    throw new AccountsHttpError('الصندوقان وجلسة المرسل مطلوبة', 400);
  }
  if (sourceBoxId === destBoxId) {
    throw new AccountsHttpError('لا يمكن التحويل من صندوق إلى نفسه', 400);
  }

  let amount: string;
  try {
    amount = normalizeMoneyInput(input.amount);
  } catch {
    throw new AccountsHttpError('المبلغ غير صالح', 400);
  }
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('المبلغ يجب أن يكون أكبر من صفر', 400);
  }

  const description = requireDescription(input.description);
  const transferDate = pgDateOnly(String(input.transfer_date ?? '').trim());
  if (!transferDate) throw new AccountsHttpError('تاريخ التحويل مطلوب', 400);

  const sourceSession = await loadCashSession(client, sourceSessionId, true);
  await assertOpenSessionForTransfer(sourceSession, 'جلسة المرسل');
  if (sourceSession.cash_box_id !== sourceBoxId) {
    throw new AccountsHttpError('جلسة المرسل لا تطابق الصندوق المرسل', 409);
  }

  await assertCanOperateCashSession(client, {
    cashBoxId: sourceBoxId,
    userId: input.created_by,
    actionLabel: 'إنشاء تحويل نقدي',
  });

  const sourceBox = await loadCashBox(client, sourceBoxId, true);
  const destBox = await loadCashBox(client, destBoxId, true);
  if (sourceBox.status !== 'ACTIVE' || destBox.status !== 'ACTIVE') {
    throw new AccountsHttpError('يجب أن يكون الصندوقان ACTIVE', 409);
  }
  if (!sourceBox.account_id || !destBox.account_id) {
    throw new AccountsHttpError('أحد الصندوقين بلا حساب محاسبي', 409);
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: sourceSession.fiscal_year_id,
    fiscalPeriodId: sourceSession.fiscal_period_id,
    entryDate: transferDate,
  });

  const number = await allocateTransferNumber(client, sourceSession.fiscal_year_id);

  const ins = await txQuery<CashTransferRow>(
    client,
    `INSERT INTO accounts.cash_transfers (
       transfer_number, status,
       source_cash_box_id, source_session_id,
       destination_cash_box_id,
       fiscal_year_id, transfer_date, amount, currency_code,
       description, external_reference,
       created_by, updated_by
     ) VALUES (
       $1, 'DRAFT',
       $2::uuid, $3::uuid,
       $4::uuid,
       $5::uuid, $6::date, $7::numeric, $8,
       $9, $10,
       $11::uuid, $11::uuid
     )
     RETURNING *`,
    [
      number,
      sourceBoxId,
      sourceSessionId,
      destBoxId,
      sourceSession.fiscal_year_id,
      transferDate,
      amount,
      sourceBox.currency_code || 'IQD',
      description,
      normalizeOptionalText(input.external_reference, 100),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateCashTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    source_cash_box_id?: unknown;
    source_session_id?: unknown;
    destination_cash_box_id?: unknown;
    transfer_date?: unknown;
    amount?: unknown;
    description?: unknown;
    external_reference?: unknown;
  }
): Promise<CashTransferRow> {
  const transfer = await loadCashTransfer(client, params.id, true);
  assertOptimistic(transfer, params.version, params.updated_at);
  if (transfer.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  const sourceBoxId = String(
    params.source_cash_box_id ?? transfer.source_cash_box_id
  ).trim();
  const destBoxId = String(
    params.destination_cash_box_id ?? transfer.destination_cash_box_id
  ).trim();
  const sourceSessionId = String(
    params.source_session_id ?? transfer.source_session_id
  ).trim();
  if (sourceBoxId === destBoxId) {
    throw new AccountsHttpError('لا يمكن التحويل من صندوق إلى نفسه', 400);
  }

  let amount = normalizeMoneyInput(transfer.amount);
  if (params.amount !== undefined) {
    try {
      amount = normalizeMoneyInput(params.amount);
    } catch {
      throw new AccountsHttpError('المبلغ غير صالح', 400);
    }
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError('المبلغ يجب أن يكون أكبر من صفر', 400);
    }
  }

  const description =
    params.description !== undefined
      ? requireDescription(params.description)
      : transfer.description;
  const transferDate =
    params.transfer_date !== undefined
      ? pgDateOnly(String(params.transfer_date).trim())
      : pgDateOnly(transfer.transfer_date as string | Date);

  const sourceSession = await loadCashSession(client, sourceSessionId, true);
  await assertOpenSessionForTransfer(sourceSession, 'جلسة المرسل');
  if (sourceSession.cash_box_id !== sourceBoxId) {
    throw new AccountsHttpError('جلسة المرسل لا تطابق الصندوق المرسل', 409);
  }

  await assertCanOperateCashSession(client, {
    cashBoxId: sourceBoxId,
    userId: params.userId,
    actionLabel: 'تعديل تحويل نقدي',
  });

  const sourceBox = await loadCashBox(client, sourceBoxId, true);
  const destBox = await loadCashBox(client, destBoxId, true);
  if (sourceBox.status !== 'ACTIVE' || destBox.status !== 'ACTIVE') {
    throw new AccountsHttpError('يجب أن يكون الصندوقان ACTIVE', 409);
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: sourceSession.fiscal_year_id,
    fiscalPeriodId: sourceSession.fiscal_period_id,
    entryDate: transferDate,
  });

  const ext =
    params.external_reference !== undefined
      ? normalizeOptionalText(params.external_reference, 100)
      : transfer.external_reference;

  const upd = await txQuery<CashTransferRow>(
    client,
    `UPDATE accounts.cash_transfers SET
       source_cash_box_id = $2::uuid,
       source_session_id = $3::uuid,
       destination_cash_box_id = $4::uuid,
       fiscal_year_id = $5::uuid,
       transfer_date = $6::date,
       amount = $7::numeric,
       description = $8,
       external_reference = $9,
       updated_by = $10::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      transfer.id,
      sourceBoxId,
      sourceSessionId,
      destBoxId,
      sourceSession.fiscal_year_id,
      transferDate,
      amount,
      description,
      ext,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function dispatchCashTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ transfer: CashTransferRow; created: boolean }> {
  const transfer = await loadCashTransfer(client, params.id, true);

  if (transfer.status === 'DISPATCHED' || transfer.status === 'RECEIVED') {
    return { transfer, created: false };
  }
  if (transfer.status === 'CANCELLED') {
    throw new AccountsHttpError('لا يمكن إرسال تحويل ملغى', 409);
  }
  if (transfer.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن إرسال المسودات فقط', 409);
  }

  assertOptimistic(transfer, params.version, params.updated_at);

  const sourcePeek = await loadCashBox(client, transfer.source_cash_box_id, false);
  const destPeek = await loadCashBox(client, transfer.destination_cash_box_id, false);
  await acquireAccountingResourceLocks(client, [
    cashboxLock(transfer.source_cash_box_id),
    cashboxLock(transfer.destination_cash_box_id),
    cashSessionLock(transfer.source_session_id),
    ...(sourcePeek.account_id ? [chartAccountLock(sourcePeek.account_id)] : []),
    ...(destPeek.account_id ? [chartAccountLock(destPeek.account_id)] : []),
  ]);

  const sourceSession = await loadCashSession(client, transfer.source_session_id, true);
  await assertOpenSessionForTransfer(sourceSession, 'جلسة المرسل');
  await assertCanOperateCashSession(client, {
    cashBoxId: transfer.source_cash_box_id,
    userId: params.userId,
    actionLabel: 'إرسال تحويل نقدي',
  });

  const sourceBox = await loadCashBox(client, transfer.source_cash_box_id, true);
  const destBox = await loadCashBox(client, transfer.destination_cash_box_id, true);
  if (!sourceBox.account_id || !destBox.account_id) {
    throw new AccountsHttpError('أحد الصندوقين بلا حساب محاسبي', 409);
  }

  const transferDate = pgDateOnly(transfer.transfer_date as string | Date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: transfer.fiscal_year_id,
    fiscalPeriodId: sourceSession.fiscal_period_id,
    entryDate: transferDate,
  });

  const sourceAcc = await assertPostingAccount(
    client,
    sourceBox.account_id,
    'حساب الصندوق المرسل'
  );
  const citAcc = await resolveCitAccount(client);

  // قفل حركات الجلسة قبل فحص الرصيد
  await txQuery(
    client,
    `SELECT id FROM accounts.cash_vouchers
     WHERE cash_box_session_id = $1::uuid FOR UPDATE`,
    [sourceSession.id]
  );
  await txQuery(
    client,
    `SELECT id FROM accounts.cash_transfers
     WHERE source_session_id = $1::uuid OR destination_session_id = $1::uuid
     FOR UPDATE`,
    [sourceSession.id]
  );

  const expected = await calculateSessionExpectedBalance(client, {
    sessionId: sourceSession.id,
    accountId: sourceBox.account_id,
  });
  const amount = normalizeMoneyInput(transfer.amount);
  if (moneyToMillis(amount) > moneyToMillisSigned(expected.expected_balance)) {
    throw new AccountsHttpError(
      'لا يمكن إرسال التحويل لأن رصيد الصندوق المرسل غير كافٍ.',
      409
    );
  }

  const costCenterId = sourceBox.cost_center_id;
  if (
    (sourceAcc.requires_cost_center || citAcc.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError(
      'أحد الحسابات يتطلب مركز كلفة — عيّن مركز كلفة للصندوق المرسل',
      409
    );
  }

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    [
      {
        account_id: citAcc.id,
        cost_center_id: costCenterId,
        debit_amount: amount,
        credit_amount: '0',
        description: `نقد بالطريق — تحويل ${transfer.transfer_number}`,
      },
      {
        account_id: sourceAcc.id,
        cost_center_id: costCenterId,
        debit_amount: '0',
        credit_amount: amount,
        description: `إرسال تحويل ${transfer.transfer_number}`,
      },
    ],
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    transfer.fiscal_year_id
  );
  const jeDesc = [
    'إرسال تحويل نقدي',
    transfer.transfer_number,
    sourceBox.code,
    '→',
    destBox.code,
    transfer.description,
  ].join(' — ');

  const jeIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'TRANSFER',
       $5, $6::uuid, $7, $8,
       $9::numeric, $10::numeric, 'POSTED',
       1, $11::uuid, $11::uuid, $11::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      transfer.fiscal_year_id,
      sourceSession.fiscal_period_id,
      transferDate,
      SOURCE_DISPATCH,
      transfer.id,
      transfer.external_reference || transfer.transfer_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );

  await replaceJournalLines(client, jeIns.rows[0].id, lines);

  const upd = await txQuery<CashTransferRow>(
    client,
    `UPDATE accounts.cash_transfers SET
       status = 'DISPATCHED',
       dispatch_period_id = $2::uuid,
       dispatch_journal_entry_id = $3::uuid,
       dispatched_by = $4::uuid,
       dispatched_at = NOW(),
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      transfer.id,
      sourceSession.fiscal_period_id,
      jeIns.rows[0].id,
      params.userId,
    ]
  );

  return { transfer: upd.rows[0], created: true };
}

export async function receiveCashTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    destination_session_id?: unknown;
  }
): Promise<{ transfer: CashTransferRow; created: boolean }> {
  const transfer = await loadCashTransfer(client, params.id, true);

  if (transfer.status === 'RECEIVED') {
    return { transfer, created: false };
  }
  if (transfer.status !== 'DISPATCHED') {
    throw new AccountsHttpError('يمكن استلام التحويلات المُرسلة فقط', 409);
  }

  assertOptimistic(transfer, params.version, params.updated_at);

  let destSessionId = String(params.destination_session_id ?? '').trim();
  if (!destSessionId) {
    const live = await getLiveSessionForBox(client, transfer.destination_cash_box_id);
    if (!live || live.status !== 'OPEN') {
      throw new AccountsHttpError(
        'لا توجد جلسة مفتوحة للصندوق المستلم — افتح جلسة قبل تأكيد الاستلام',
        409
      );
    }
    destSessionId = live.id;
  }

  const destPeek = await loadCashBox(client, transfer.destination_cash_box_id, false);
  const sourcePeek = await loadCashBox(client, transfer.source_cash_box_id, false);
  await acquireAccountingResourceLocks(client, [
    cashboxLock(transfer.source_cash_box_id),
    cashboxLock(transfer.destination_cash_box_id),
    cashSessionLock(destSessionId),
    ...(transfer.source_session_id
      ? [cashSessionLock(transfer.source_session_id)]
      : []),
    ...(sourcePeek.account_id ? [chartAccountLock(sourcePeek.account_id)] : []),
    ...(destPeek.account_id ? [chartAccountLock(destPeek.account_id)] : []),
  ]);

  const destSession = await loadCashSession(client, destSessionId, true);
  await assertOpenSessionForTransfer(destSession, 'جلسة المستلم');
  if (destSession.cash_box_id !== transfer.destination_cash_box_id) {
    throw new AccountsHttpError('جلسة المستلم لا تطابق الصندوق المستلم', 409);
  }

  await assertCanOperateCashSession(client, {
    cashBoxId: transfer.destination_cash_box_id,
    userId: params.userId,
    actionLabel: 'استلام تحويل نقدي',
  });

  const destBox = await loadCashBox(client, transfer.destination_cash_box_id, true);
  if (!destBox.account_id) {
    throw new AccountsHttpError('الصندوق المستلم بلا حساب محاسبي', 409);
  }

  const transferDate = pgDateOnly(transfer.transfer_date as string | Date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: destSession.fiscal_year_id,
    fiscalPeriodId: destSession.fiscal_period_id,
    entryDate: transferDate,
  });

  const destAcc = await assertPostingAccount(
    client,
    destBox.account_id,
    'حساب الصندوق المستلم'
  );
  const citAcc = await resolveCitAccount(client);
  const amount = normalizeMoneyInput(transfer.amount);

  const costCenterId = destBox.cost_center_id;
  if (
    (destAcc.requires_cost_center || citAcc.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError(
      'أحد الحسابات يتطلب مركز كلفة — عيّن مركز كلفة للصندوق المستلم',
      409
    );
  }

  // منع تكرار قيد الاستلام
  if (transfer.receipt_journal_entry_id) {
    return { transfer, created: false };
  }

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    [
      {
        account_id: destAcc.id,
        cost_center_id: costCenterId,
        debit_amount: amount,
        credit_amount: '0',
        description: `استلام تحويل ${transfer.transfer_number}`,
      },
      {
        account_id: citAcc.id,
        cost_center_id: costCenterId,
        debit_amount: '0',
        credit_amount: amount,
        description: `إقفال نقد بالطريق — ${transfer.transfer_number}`,
      },
    ],
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    destSession.fiscal_year_id
  );
  const sourceBox = await loadCashBox(client, transfer.source_cash_box_id);
  const jeDesc = [
    'استلام تحويل نقدي',
    transfer.transfer_number,
    sourceBox.code,
    '→',
    destBox.code,
    transfer.description,
  ].join(' — ');

  const jeIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'TRANSFER',
       $5, $6::uuid, $7, $8,
       $9::numeric, $10::numeric, 'POSTED',
       1, $11::uuid, $11::uuid, $11::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      destSession.fiscal_year_id,
      destSession.fiscal_period_id,
      transferDate,
      SOURCE_RECEIVE,
      transfer.id,
      transfer.external_reference || transfer.transfer_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  await replaceJournalLines(client, jeIns.rows[0].id, lines);

  const upd = await txQuery<CashTransferRow>(
    client,
    `UPDATE accounts.cash_transfers SET
       status = 'RECEIVED',
       destination_session_id = $2::uuid,
       receipt_period_id = $3::uuid,
       receipt_journal_entry_id = $4::uuid,
       received_by = $5::uuid,
       received_at = NOW(),
       updated_by = $5::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      transfer.id,
      destSession.id,
      destSession.fiscal_period_id,
      jeIns.rows[0].id,
      params.userId,
    ]
  );

  return { transfer: upd.rows[0], created: true };
}

export async function cancelCashTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason: unknown;
  }
): Promise<CashTransferRow> {
  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new AccountsHttpError('سبب الإلغاء مطلوب', 400);

  const transfer = await loadCashTransfer(client, params.id, true);
  assertOptimistic(transfer, params.version, params.updated_at);

  if (transfer.status === 'CANCELLED') {
    return transfer;
  }

  if (transfer.status === 'RECEIVED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء تحويل مُستلم مباشرة — أنشئ تحويلاً عكسياً جديداً من الصندوق المستلم إلى المرسل',
      409
    );
  }

  const sourcePeek = await loadCashBox(client, transfer.source_cash_box_id, false);
  const destPeek = await loadCashBox(client, transfer.destination_cash_box_id, false);
  await acquireAccountingResourceLocks(client, [
    cashboxLock(transfer.source_cash_box_id),
    cashboxLock(transfer.destination_cash_box_id),
    ...(transfer.source_session_id
      ? [cashSessionLock(transfer.source_session_id)]
      : []),
    ...(sourcePeek.account_id ? [chartAccountLock(sourcePeek.account_id)] : []),
    ...(destPeek.account_id ? [chartAccountLock(destPeek.account_id)] : []),
  ]);

  if (transfer.status === 'DRAFT') {
    await assertCanOperateCashSession(client, {
      cashBoxId: transfer.source_cash_box_id,
      userId: params.userId,
      actionLabel: 'إلغاء تحويل نقدي',
    });
    const upd = await txQuery<CashTransferRow>(
      client,
      `UPDATE accounts.cash_transfers SET
         status = 'CANCELLED',
         cancellation_reason = $2,
         cancelled_by = $3::uuid,
         cancelled_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [transfer.id, reason.slice(0, 2000), params.userId]
    );
    return upd.rows[0];
  }

  // DISPATCHED — عكس قيد الإرسال
  if (transfer.status !== 'DISPATCHED' || !transfer.dispatch_journal_entry_id) {
    throw new AccountsHttpError('حالة التحويل لا تسمح بالإلغاء', 409);
  }

  const sourceSession = await loadCashSession(client, transfer.source_session_id, true);
  if (sourceSession.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء تحويل مرتبط بجلسة مرسل مغلقة',
      409
    );
  }
  await assertOpenSessionForTransfer(sourceSession, 'جلسة المرسل');
  await assertCanOperateCashSession(client, {
    cashBoxId: transfer.source_cash_box_id,
    userId: params.userId,
    actionLabel: 'إلغاء تحويل مُرسل',
  });

  const original = await loadJournalEntry(client, transfer.dispatch_journal_entry_id);
  const reversalDate = pgDateOnly(transfer.transfer_date as string | Date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء تحويل ${transfer.transfer_number}: ${reason}`,
    userId: params.userId,
  });

  // إعادة الأصل إلى POSTED مع الإبقاء على ربط العكس (نفس نمط السندات)
  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET status = 'POSTED',
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [transfer.dispatch_journal_entry_id]
  );

  const upd = await txQuery<CashTransferRow>(
    client,
    `UPDATE accounts.cash_transfers SET
       status = 'CANCELLED',
       reversal_journal_entry_id = $2::uuid,
       cancellation_reason = $3,
       cancelled_by = $4::uuid,
       cancelled_at = NOW(),
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [transfer.id, reversal.id, reason.slice(0, 2000), params.userId]
  );
  return upd.rows[0];
}
