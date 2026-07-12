/**
 * جلسات الصندوق اليومية (المرحلة 3.B).
 */
import {
  captureAccountBookSnapshotTx,
  detectBookDriftSinceCount,
  subtractBookBalances,
} from './account-book-balance';
import { AccountsHttpError } from './auth';
import { loadCashBox } from './cash-boxes';
import { assertCanOperateCashSession } from './cash-session-access';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { pgDateOnly } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyEquals,
  moneyToMillis,
  moneyToMillisSigned,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CashSessionStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

export type CashBoxSessionRow = {
  id: string;
  cash_box_id: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  session_date: string | Date;
  status: CashSessionStatus;
  primary_custodian_user_id: string;
  opened_by: string;
  opened_at: Date | string;
  opening_book_balance: string;
  opening_last_posted_entry_id: string | null;
  opening_last_posted_at: Date | string | null;
  closed_by: string | null;
  closed_at: Date | string | null;
  final_book_balance: string | null;
  final_counted_amount: string | null;
  final_variance_amount: string | null;
  current_count_id: string | null;
  closing_started_at: Date | string | null;
  closing_started_by: string | null;
  cancel_closing_reason: string | null;
  notes: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CashCountRow = {
  id: string;
  session_id: string;
  cash_box_id: string;
  sequence_no: number;
  is_current: boolean;
  counted_amount: string;
  book_balance_at_count: string;
  variance_amount: string;
  counted_at: Date | string;
  counted_by: string;
  last_posted_entry_id_at_count: string | null;
  last_posted_entry_at_count: Date | string | null;
  notes: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const POST_COUNT_DRIFT_MESSAGE =
  'توجد حركة مالية مرحلة بعد الجرد، يجب إعادة الجرد قبل إغلاق الجلسة';

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function moneyField(value: string | null | undefined): string | null {
  if (value == null) return null;
  return normalizeSignedMoneyInput(value);
}

export function serializeCashSession(row: CashBoxSessionRow) {
  return {
    ...row,
    session_date: pgDateOnly(row.session_date as string | Date),
    opening_book_balance: normalizeSignedMoneyInput(row.opening_book_balance),
    opening_last_posted_at: iso(row.opening_last_posted_at),
    opened_at: iso(row.opened_at)!,
    closed_at: iso(row.closed_at),
    closing_started_at: iso(row.closing_started_at),
    final_book_balance: moneyField(row.final_book_balance),
    final_counted_amount: moneyField(row.final_counted_amount),
    final_variance_amount: moneyField(row.final_variance_amount),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeCashCount(row: CashCountRow) {
  return {
    ...row,
    counted_amount: normalizeMoneyInput(row.counted_amount),
    book_balance_at_count: normalizeSignedMoneyInput(row.book_balance_at_count),
    variance_amount: normalizeSignedMoneyInput(row.variance_amount),
    counted_at: iso(row.counted_at)!,
    last_posted_entry_at_count: iso(row.last_posted_entry_at_count),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadCashSession(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<CashBoxSessionRow> {
  const r = await txQuery<CashBoxSessionRow>(
    client,
    `SELECT * FROM accounts.cash_box_sessions
     WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الجلسة غير موجودة', 404);
  return r.rows[0];
}

export async function getLiveSessionForBox(
  client: TxClient,
  cashBoxId: string
): Promise<CashBoxSessionRow | null> {
  const r = await txQuery<CashBoxSessionRow>(
    client,
    `SELECT * FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1::uuid
       AND status IN ('OPEN', 'CLOSING')
     LIMIT 1`,
    [cashBoxId]
  );
  return r.rows[0] ?? null;
}

export type OpenCashSessionInput = {
  cash_box_id: unknown;
  fiscal_year_id: unknown;
  fiscal_period_id: unknown;
  session_date: unknown;
  notes?: unknown;
  opened_by: string;
};

export async function openCashSession(
  client: TxClient,
  input: OpenCashSessionInput
): Promise<CashBoxSessionRow> {
  const cashBoxId = String(input.cash_box_id ?? '').trim();
  if (!cashBoxId) throw new AccountsHttpError('معرّف الصندوق مطلوب', 400);

  const fiscalYearId = String(input.fiscal_year_id ?? '').trim();
  const fiscalPeriodId = String(input.fiscal_period_id ?? '').trim();
  if (!fiscalYearId || !fiscalPeriodId) {
    throw new AccountsHttpError('السنة المالية والفترة المحاسبية مطلوبتان', 400);
  }

  const sessionDateRaw = String(input.session_date ?? '').trim();
  if (!sessionDateRaw) throw new AccountsHttpError('تاريخ الجلسة مطلوب', 400);
  const sessionDate = pgDateOnly(sessionDateRaw);

  // قفل صف الصندوق
  const box = await loadCashBox(client, cashBoxId, true);
  if (box.status !== 'ACTIVE') {
    throw new AccountsHttpError('يمكن فتح جلسة لصندوق ACTIVE فقط', 409);
  }
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي مرتبط', 409);
  }

  const { primaryUserId } = await assertCanOperateCashSession(client, {
    cashBoxId,
    userId: input.opened_by,
    actionLabel: 'فتح الجلسة',
  });

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: sessionDate,
  });

  const live = await getLiveSessionForBox(client, cashBoxId);
  if (live) {
    if (live.status === 'CLOSING') {
      throw new AccountsHttpError(
        'لا يمكن فتح جلسة جديدة بينما توجد جلسة قيد الإغلاق (CLOSING)',
        409
      );
    }
    throw new AccountsHttpError('يوجد يوم مفتوح لهذا الصندوق مسبقاً', 409);
  }

  const sameDate = await txQuery(
    client,
    `SELECT id FROM accounts.cash_box_sessions
     WHERE cash_box_id = $1::uuid AND session_date = $2::date
     LIMIT 1`,
    [cashBoxId, sessionDate]
  );
  if (sameDate.rows[0]) {
    throw new AccountsHttpError('توجد جلسة لهذا الصندوق في نفس التاريخ مسبقاً', 409);
  }

  const snap = await captureAccountBookSnapshotTx(client, box.account_id);
  const notes =
    input.notes == null || input.notes === ''
      ? null
      : String(input.notes).trim().slice(0, 2000);

  const ins = await txQuery<CashBoxSessionRow>(
    client,
    `INSERT INTO accounts.cash_box_sessions (
       cash_box_id, fiscal_year_id, fiscal_period_id, session_date, status,
       primary_custodian_user_id, opened_by, opened_at,
       opening_book_balance, opening_last_posted_entry_id, opening_last_posted_at,
       notes, version
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::date, 'OPEN',
       $5::uuid, $6::uuid, NOW(),
       $7::numeric, $8::uuid, $9::timestamptz,
       $10, 1
     )
     RETURNING *`,
    [
      cashBoxId,
      fiscalYearId,
      fiscalPeriodId,
      sessionDate,
      primaryUserId,
      input.opened_by,
      snap.balance,
      snap.last_posted_entry_id,
      snap.last_posted_at,
      notes,
    ]
  );

  return ins.rows[0];
}

export async function startClosingCashSession(
  client: TxClient,
  params: {
    sessionId: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<CashBoxSessionRow> {
  const session = await loadCashSession(client, params.sessionId, true);
  await loadCashBox(client, session.cash_box_id, true);

  if (session.status === 'CLOSED') {
    throw new AccountsHttpError('الجلسة مغلقة ولا يمكن بدء إغلاقها', 409);
  }

  // Idempotent: already CLOSING
  if (session.status === 'CLOSING') {
    return session;
  }

  assertCashSessionOptimisticConcurrency({
    currentVersion: session.version,
    currentUpdatedAt: session.updated_at,
    expectedVersion: params.version,
    expectedUpdatedAt: params.updated_at,
  });

  await assertCanOperateCashSession(client, {
    cashBoxId: session.cash_box_id,
    userId: params.userId,
    actionLabel: 'بدء الإغلاق',
  });

  const upd = await txQuery<CashBoxSessionRow>(
    client,
    `UPDATE accounts.cash_box_sessions
     SET status = 'CLOSING',
         closing_started_at = NOW(),
         closing_started_by = $2::uuid,
         cancel_closing_reason = NULL,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [session.id, params.userId]
  );
  return upd.rows[0];
}

export async function recordCashCount(
  client: TxClient,
  params: {
    sessionId: string;
    userId: string;
    counted_amount: unknown;
    notes?: unknown;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ session: CashBoxSessionRow; count: CashCountRow }> {
  const session = await loadCashSession(client, params.sessionId, true);
  const box = await loadCashBox(client, session.cash_box_id, true);

  if (session.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تسجيل جرد على جلسة مغلقة', 409);
  }
  if (session.status !== 'CLOSING') {
    throw new AccountsHttpError('يجب بدء الإغلاق قبل تسجيل الجرد', 409);
  }
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي مرتبط', 409);
  }

  assertCashSessionOptimisticConcurrency({
    currentVersion: session.version,
    currentUpdatedAt: session.updated_at,
    expectedVersion: params.version,
    expectedUpdatedAt: params.updated_at,
  });

  await assertCanOperateCashSession(client, {
    cashBoxId: session.cash_box_id,
    userId: params.userId,
    actionLabel: 'تسجيل الجرد',
  });

  let countedAmount: string;
  try {
    countedAmount = normalizeMoneyInput(params.counted_amount);
  } catch {
    throw new AccountsHttpError('المبلغ المعدود غير صالح', 400);
  }
  if (moneyToMillis(countedAmount) < BigInt(0)) {
    throw new AccountsHttpError('المبلغ المعدود لا يمكن أن يكون سالباً', 400);
  }

  const snap = await captureAccountBookSnapshotTx(client, box.account_id);
  const variance = subtractBookBalances(countedAmount, snap.balance);

  await txQuery(
    client,
    `UPDATE accounts.cash_counts
     SET is_current = FALSE, updated_at = NOW()
     WHERE session_id = $1::uuid AND is_current = TRUE`,
    [session.id]
  );

  const seqRes = await txQuery<{ next: number }>(
    client,
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next
     FROM accounts.cash_counts WHERE session_id = $1::uuid`,
    [session.id]
  );
  const sequenceNo = Number(seqRes.rows[0]?.next ?? 1);

  const notes =
    params.notes == null || params.notes === ''
      ? null
      : String(params.notes).trim().slice(0, 2000);

  const countIns = await txQuery<CashCountRow>(
    client,
    `INSERT INTO accounts.cash_counts (
       session_id, cash_box_id, sequence_no, is_current,
       counted_amount, book_balance_at_count, variance_amount,
       counted_at, counted_by,
       last_posted_entry_id_at_count, last_posted_entry_at_count,
       notes, version
     ) VALUES (
       $1::uuid, $2::uuid, $3, TRUE,
       $4::numeric, $5::numeric, $6::numeric,
       NOW(), $7::uuid,
       $8::uuid, $9::timestamptz,
       $10, 1
     )
     RETURNING *`,
    [
      session.id,
      session.cash_box_id,
      sequenceNo,
      countedAmount,
      snap.balance,
      variance,
      params.userId,
      snap.last_posted_entry_id,
      snap.last_posted_at,
      notes,
    ]
  );

  const count = countIns.rows[0];

  const upd = await txQuery<CashBoxSessionRow>(
    client,
    `UPDATE accounts.cash_box_sessions
     SET current_count_id = $2::uuid,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [session.id, count.id]
  );

  return { session: upd.rows[0], count };
}

export async function closeCashSession(
  client: TxClient,
  params: {
    sessionId: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<CashBoxSessionRow> {
  const session = await loadCashSession(client, params.sessionId, true);
  const box = await loadCashBox(client, session.cash_box_id, true);

  // Idempotent
  if (session.status === 'CLOSED') {
    return session;
  }

  if (session.status !== 'CLOSING') {
    throw new AccountsHttpError('الإغلاق النهائي يتطلب حالة CLOSING', 409);
  }

  assertCashSessionOptimisticConcurrency({
    currentVersion: session.version,
    currentUpdatedAt: session.updated_at,
    expectedVersion: params.version,
    expectedUpdatedAt: params.updated_at,
  });

  await assertCanOperateCashSession(client, {
    cashBoxId: session.cash_box_id,
    userId: params.userId,
    actionLabel: 'إغلاق الجلسة',
  });

  if (!session.current_count_id) {
    throw new AccountsHttpError('يجب تسجيل الجرد قبل إغلاق الجلسة', 409);
  }
  if (!box.account_id) {
    throw new AccountsHttpError('الصندوق بلا حساب محاسبي مرتبط', 409);
  }

  const countRes = await txQuery<CashCountRow>(
    client,
    `SELECT * FROM accounts.cash_counts
     WHERE id = $1::uuid AND session_id = $2::uuid AND is_current = TRUE
     FOR UPDATE`,
    [session.current_count_id, session.id]
  );
  const count = countRes.rows[0];
  if (!count) {
    throw new AccountsHttpError('سجل الجرد الحالي غير موجود', 409);
  }

  if (moneyToMillisSigned(normalizeSignedMoneyInput(count.variance_amount)) !== BigInt(0)) {
    // مسار 3.C: تسوية POSTED للجرد الحالي بدل رفض الفرق مباشرة
    const adjRes = await txQuery<{
      id: string;
      cash_count_id: string;
      journal_entry_id: string | null;
      status: string;
      posted_at: Date | string | null;
    }>(
      client,
      `SELECT id, cash_count_id, journal_entry_id, status, posted_at
       FROM accounts.cash_count_adjustments
       WHERE cash_count_id = $1::uuid AND status = 'POSTED'
       LIMIT 1
       FOR UPDATE`,
      [count.id]
    );
    const adj = adjRes.rows[0];
    if (!adj || !adj.journal_entry_id) {
      throw new AccountsHttpError(
        'لا يمكن إغلاق الجلسة بوجود فرق جرد — نفّذ تسوية فرق الجرد أولاً',
        409
      );
    }

    const currentSnap = await captureAccountBookSnapshotTx(client, box.account_id);
    const counted = normalizeMoneyInput(count.counted_amount);

    // أولاً: أي POSTED أحدث مؤثر على حساب الصندوق بعد قيد التسوية
    const last = currentSnap.last_posted_entry_id
      ? {
          entry_id: currentSnap.last_posted_entry_id,
          posted_at: currentSnap.last_posted_at!,
        }
      : null;
    if (!last || last.entry_id !== adj.journal_entry_id) {
      throw new AccountsHttpError(
        'توجد حركة مالية مرحلة بعد قيد التسوية، يجب إعادة الجرد قبل إغلاق الجلسة',
        409
      );
    }

    if (!moneyEquals(currentSnap.balance, counted)) {
      throw new AccountsHttpError(
        'الرصيد الدفتري لا يطابق المبلغ المعدود بعد التسوية — أعد الجرد',
        409
      );
    }

    const upd = await txQuery<CashBoxSessionRow>(
      client,
      `UPDATE accounts.cash_box_sessions
       SET status = 'CLOSED',
           closed_by = $2::uuid,
           closed_at = NOW(),
           final_book_balance = $3::numeric,
           final_counted_amount = $4::numeric,
           final_variance_amount = 0,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [session.id, params.userId, counted, counted]
    );
    return upd.rows[0];
  }

  const currentSnap = await captureAccountBookSnapshotTx(client, box.account_id);
  const drift = detectBookDriftSinceCount({
    currentBalance: currentSnap.balance,
    currentLast: currentSnap.last_posted_entry_id
      ? {
          entry_id: currentSnap.last_posted_entry_id,
          posted_at: currentSnap.last_posted_at!,
        }
      : null,
    snapshotBalance: normalizeSignedMoneyInput(count.book_balance_at_count),
    snapshotEntryId: count.last_posted_entry_id_at_count,
    snapshotPostedAt: count.last_posted_entry_at_count,
  });

  if (drift.drifted) {
    throw new AccountsHttpError(POST_COUNT_DRIFT_MESSAGE, 409);
  }

  // تأكيد اتساق المبلغ المعدود مع اللقطة
  if (!moneyEquals(currentSnap.balance, normalizeSignedMoneyInput(count.book_balance_at_count))) {
    throw new AccountsHttpError(POST_COUNT_DRIFT_MESSAGE, 409);
  }

  const upd = await txQuery<CashBoxSessionRow>(
    client,
    `UPDATE accounts.cash_box_sessions
     SET status = 'CLOSED',
         closed_by = $2::uuid,
         closed_at = NOW(),
         final_book_balance = $3::numeric,
         final_counted_amount = $4::numeric,
         final_variance_amount = $5::numeric,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [
      session.id,
      params.userId,
      normalizeSignedMoneyInput(count.book_balance_at_count),
      normalizeMoneyInput(count.counted_amount),
      normalizeSignedMoneyInput(count.variance_amount),
    ]
  );
  return upd.rows[0];
}

export async function cancelClosingCashSession(
  client: TxClient,
  params: {
    sessionId: string;
    userId: string;
    reason: unknown;
    version: unknown;
    updated_at: unknown;
  }
): Promise<CashBoxSessionRow> {
  const session = await loadCashSession(client, params.sessionId, true);
  await loadCashBox(client, session.cash_box_id, true);

  if (session.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إلغاء إغلاق جلسة مغلقة نهائياً', 409);
  }
  if (session.status !== 'CLOSING') {
    throw new AccountsHttpError('الجلسة ليست قيد الإغلاق', 409);
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب إلغاء الإغلاق مطلوب', 400);
  }
  if (reason.length > 2000) {
    throw new AccountsHttpError('سبب إلغاء الإغلاق طويل جداً', 400);
  }

  assertCashSessionOptimisticConcurrency({
    currentVersion: session.version,
    currentUpdatedAt: session.updated_at,
    expectedVersion: params.version,
    expectedUpdatedAt: params.updated_at,
  });

  await assertCanOperateCashSession(client, {
    cashBoxId: session.cash_box_id,
    userId: params.userId,
    actionLabel: 'إلغاء الإغلاق',
  });

  // إبقاء سجلات الجرد للتدقيق؛ إلغاء is_current و current_count_id لإعادة الجرد لاحقاً
  await txQuery(
    client,
    `UPDATE accounts.cash_counts
     SET is_current = FALSE, updated_at = NOW()
     WHERE session_id = $1::uuid AND is_current = TRUE`,
    [session.id]
  );

  const upd = await txQuery<CashBoxSessionRow>(
    client,
    `UPDATE accounts.cash_box_sessions
     SET status = 'OPEN',
         cancel_closing_reason = $2,
         current_count_id = NULL,
         closing_started_at = NULL,
         closing_started_by = NULL,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [session.id, reason]
  );
  return upd.rows[0];
}

export async function listCashCountsForSession(
  client: TxClient,
  sessionId: string
): Promise<CashCountRow[]> {
  const r = await txQuery<CashCountRow>(
    client,
    `SELECT * FROM accounts.cash_counts
     WHERE session_id = $1::uuid
     ORDER BY sequence_no DESC`,
    [sessionId]
  );
  return r.rows;
}

export { POST_COUNT_DRIFT_MESSAGE };
