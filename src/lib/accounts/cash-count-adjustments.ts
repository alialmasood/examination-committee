/**
 * تسوية فرق الجرد (3.C) — كيان cash_count_adjustments + قيد ADJUSTMENT مرحّل.
 */
import {
  captureAccountBookSnapshotTx,
  detectBookDriftSinceCount,
  getLastPostedEntryForAccountTx,
} from './account-book-balance';
import { AccountsHttpError } from './auth';
import { loadCashBox } from './cash-boxes';
import {
  loadCashSession,
  type CashBoxSessionRow,
  type CashCountRow,
  POST_COUNT_DRIFT_MESSAGE,
} from './cash-box-sessions';
import { assertCanOperateCashSession } from './cash-session-access';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { getCashVarianceSettings } from './cash-settings';
import { pgDateOnly } from './document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import {
  absoluteMoney,
  moneyEquals,
  moneyIsZero,
  moneyToMillisSigned,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import { assertPostingAccount as assertPostingAccountTx } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type AdjustmentDirection = 'GAIN' | 'LOSS';

export type CashCountAdjustmentRow = {
  id: string;
  cash_count_id: string;
  cash_box_session_id: string;
  cash_box_id: string;
  direction: AdjustmentDirection;
  variance_amount: string;
  original_signed_variance: string;
  cash_account_id: string;
  variance_account_id: string;
  gain_account_id: string | null;
  loss_account_id: string | null;
  journal_entry_id: string | null;
  status: 'CREATED' | 'POSTED';
  created_by: string;
  posted_by: string | null;
  created_at: Date | string;
  posted_at: Date | string | null;
  updated_at: Date | string;
  version: number;
  notes: string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeCashCountAdjustment(row: CashCountAdjustmentRow) {
  return {
    ...row,
    variance_amount: normalizeMoneyInput(row.variance_amount),
    original_signed_variance: normalizeSignedMoneyInput(row.original_signed_variance),
    created_at: iso(row.created_at)!,
    posted_at: iso(row.posted_at),
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadCashCountAdjustment(
  client: TxClient,
  id: string
): Promise<CashCountAdjustmentRow> {
  const r = await txQuery<CashCountAdjustmentRow>(
    client,
    `SELECT * FROM accounts.cash_count_adjustments WHERE id = $1::uuid`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('تسوية فرق الجرد غير موجودة', 404);
  return r.rows[0];
}

export async function getPostedAdjustmentForCount(
  client: TxClient,
  cashCountId: string
): Promise<CashCountAdjustmentRow | null> {
  const r = await txQuery<CashCountAdjustmentRow>(
    client,
    `SELECT * FROM accounts.cash_count_adjustments
     WHERE cash_count_id = $1::uuid AND status = 'POSTED'
     LIMIT 1`,
    [cashCountId]
  );
  return r.rows[0] ?? null;
}

export async function listAdjustmentsForSession(
  client: TxClient,
  sessionId: string
): Promise<CashCountAdjustmentRow[]> {
  const r = await txQuery<CashCountAdjustmentRow>(
    client,
    `SELECT * FROM accounts.cash_count_adjustments
     WHERE cash_box_session_id = $1::uuid
     ORDER BY created_at DESC`,
    [sessionId]
  );
  return r.rows;
}

export type CashCountAdjustmentListItem = ReturnType<
  typeof serializeCashCountAdjustment
> & {
  journal_entry_number: string | null;
  cash_account_code: string | null;
  cash_account_name_ar: string | null;
  variance_account_code: string | null;
  variance_account_name_ar: string | null;
  posted_by_name: string | null;
  created_by_name: string | null;
};

/** قائمة تسويات الجلسة مع أرقام القيود وأسماء الحسابات للواجهة */
export async function listAdjustmentsForSessionView(
  client: TxClient,
  sessionId: string
): Promise<CashCountAdjustmentListItem[]> {
  const r = await txQuery<
    CashCountAdjustmentRow & {
      journal_entry_number: string | null;
      cash_account_code: string | null;
      cash_account_name_ar: string | null;
      variance_account_code: string | null;
      variance_account_name_ar: string | null;
      posted_by_name: string | null;
      created_by_name: string | null;
    }
  >(
    client,
    `SELECT a.*,
            je.entry_number AS journal_entry_number,
            ca.code AS cash_account_code,
            ca.name_ar AS cash_account_name_ar,
            va.code AS variance_account_code,
            va.name_ar AS variance_account_name_ar,
            COALESCE(up.full_name, up.username) AS posted_by_name,
            COALESCE(uc.full_name, uc.username) AS created_by_name
     FROM accounts.cash_count_adjustments a
     LEFT JOIN accounts.journal_entries je ON je.id = a.journal_entry_id
     LEFT JOIN accounts.chart_of_accounts ca ON ca.id = a.cash_account_id
     LEFT JOIN accounts.chart_of_accounts va ON va.id = a.variance_account_id
     LEFT JOIN student_affairs.users up ON up.id = a.posted_by
     LEFT JOIN student_affairs.users uc ON uc.id = a.created_by
     WHERE a.cash_box_session_id = $1::uuid
     ORDER BY a.created_at DESC`,
    [sessionId]
  );
  return r.rows.map((row) => ({
    ...serializeCashCountAdjustment(row),
    journal_entry_number: row.journal_entry_number,
    cash_account_code: row.cash_account_code,
    cash_account_name_ar: row.cash_account_name_ar,
    variance_account_code: row.variance_account_code,
    variance_account_name_ar: row.variance_account_name_ar,
    posted_by_name: row.posted_by_name,
    created_by_name: row.created_by_name,
  }));
}

async function loadCurrentCount(
  client: TxClient,
  session: CashBoxSessionRow
): Promise<CashCountRow> {
  if (!session.current_count_id) {
    throw new AccountsHttpError('يجب تسجيل الجرد قبل التسوية', 409);
  }
  const r = await txQuery<CashCountRow>(
    client,
    `SELECT * FROM accounts.cash_counts
     WHERE id = $1::uuid AND session_id = $2::uuid AND is_current = TRUE
     FOR UPDATE`,
    [session.current_count_id, session.id]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('سجل الجرد الحالي غير موجود', 409);
  }
  return r.rows[0];
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
export async function adjustCashCountVariance(
  client: TxClient,
  params: {
    sessionId: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    notes?: unknown;
  }
): Promise<{
  adjustment: CashCountAdjustmentRow;
  session: CashBoxSessionRow;
  count: CashCountRow;
  created: boolean;
}> {
  const session = await loadCashSession(client, params.sessionId, true);
  const box = await loadCashBox(client, session.cash_box_id, true);

  if (session.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تسوية فرق على جلسة مغلقة', 409);
  }
  if (session.status !== 'CLOSING') {
    throw new AccountsHttpError('التسوية تتطلب جلسة قيد الإغلاق (CLOSING)', 409);
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
    actionLabel: 'تسوية فرق الجرد',
  });

  const count = await loadCurrentCount(client, session);
  const signedVariance = normalizeSignedMoneyInput(count.variance_amount);

  const existing = await getPostedAdjustmentForCount(client, count.id);
  if (existing) {
    return { adjustment: existing, session, count, created: false };
  }

  if (moneyIsZero(absoluteMoney(signedVariance)) || moneyToMillisSigned(signedVariance) === BigInt(0)) {
    throw new AccountsHttpError('لا توجد حاجة لتسوية — فرق الجرد صفر', 409);
  }

  const settings = await getCashVarianceSettings();
  if (
    !settings.cash_variance_gain_account_id ||
    !settings.cash_variance_loss_account_id
  ) {
    throw new AccountsHttpError(
      'اضبط حسابات فروقات الجرد أولاً من إعدادات الصناديق',
      409
    );
  }

  const direction: AdjustmentDirection =
    moneyToMillisSigned(signedVariance) > BigInt(0) ? 'GAIN' : 'LOSS';
  const varianceAbs = absoluteMoney(signedVariance);

  const cashAcc = await assertPostingAccountTx(
    client,
    box.account_id,
    'حساب الصندوق'
  );
  const gainAcc = await assertPostingAccountTx(
    client,
    settings.cash_variance_gain_account_id,
    'حساب زيادة الجرد'
  );
  const lossAcc = await assertPostingAccountTx(
    client,
    settings.cash_variance_loss_account_id,
    'حساب عجز الجرد'
  );
  const varianceAccount = direction === 'GAIN' ? gainAcc : lossAcc;

  const currentSnap = await captureAccountBookSnapshotTx(client, box.account_id);
  const drift = detectBookDriftSinceCount({
    currentBalance: currentSnap.balance,
    currentLast: currentSnap.last_posted_entry_id
      ? {
          entry_id: currentSnap.last_posted_entry_id,
          posted_at: currentSnap.last_posted_at!,
        }
      : null,
    snapshotBalance: normalizeMoneyInput(count.book_balance_at_count),
    snapshotEntryId: count.last_posted_entry_id_at_count,
    snapshotPostedAt: count.last_posted_entry_at_count,
  });
  if (drift.drifted) {
    throw new AccountsHttpError(POST_COUNT_DRIFT_MESSAGE, 409);
  }

  const entryDate = pgDateOnly(session.session_date as string | Date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: session.fiscal_year_id,
    fiscalPeriodId: session.fiscal_period_id,
    entryDate,
  });

  const costCenterId = box.cost_center_id;
  const needCc =
    cashAcc.requires_cost_center || varianceAccount.requires_cost_center;
  if (needCc && !costCenterId) {
    throw new AccountsHttpError(
      'أحد حسابات التسوية يتطلب مركز كلفة — عيّن مركز كلفة للصندوق',
      409
    );
  }
  const lineCc = costCenterId || undefined;

  const linesInput =
    direction === 'GAIN'
      ? [
          {
            account_id: box.account_id,
            debit_amount: varianceAbs,
            credit_amount: '0',
            cost_center_id: lineCc,
            description: 'تسوية زيادة جرد نقدي',
          },
          {
            account_id: gainAcc.id,
            debit_amount: '0',
            credit_amount: varianceAbs,
            cost_center_id: lineCc,
            description: 'مقابل زيادة الجرد',
          },
        ]
      : [
          {
            account_id: lossAcc.id,
            debit_amount: varianceAbs,
            credit_amount: '0',
            cost_center_id: lineCc,
            description: 'عجز جرد نقدي',
          },
          {
            account_id: box.account_id,
            debit_amount: '0',
            credit_amount: varianceAbs,
            cost_center_id: lineCc,
            description: 'تسوية عجز جرد نقدي',
          },
        ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const boxMeta = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.cash_boxes WHERE id = $1::uuid`,
    [box.id]
  );
  const boxCode = boxMeta.rows[0]?.code || shortId(box.id);

  const notes =
    params.notes == null || params.notes === ''
      ? count.notes
      : String(params.notes).trim().slice(0, 2000);

  const description = [
    `تسوية فرق جرد نقدي (${direction})`,
    `صندوق ${boxCode}`,
    `جلسة ${shortId(session.id)}`,
    `جرد ${shortId(count.id)}`,
    notes ? `ملاحظات: ${notes}` : null,
  ]
    .filter(Boolean)
    .join(' — ');

  // 1) CREATED (مؤقت داخل المعاملة فقط)
  const adjCreated = await txQuery<CashCountAdjustmentRow>(
    client,
    `INSERT INTO accounts.cash_count_adjustments (
       cash_count_id, cash_box_session_id, cash_box_id,
       direction, variance_amount, original_signed_variance,
       cash_account_id, variance_account_id, gain_account_id, loss_account_id,
       journal_entry_id, status, created_by, notes, version
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid,
       $4, $5::numeric, $6::numeric,
       $7::uuid, $8::uuid, $9::uuid, $10::uuid,
       NULL, 'CREATED', $11::uuid, $12, 1
     )
     RETURNING *`,
    [
      count.id,
      session.id,
      box.id,
      direction,
      varianceAbs,
      signedVariance,
      box.account_id,
      varianceAccount.id,
      direction === 'GAIN' ? gainAcc.id : null,
      direction === 'LOSS' ? lossAcc.id : null,
      params.userId,
      notes,
    ]
  );
  const adjustmentId = adjCreated.rows[0].id;

  const entryNumber = await allocateJournalEntryNumber(
    client,
    session.fiscal_year_id
  );

  const jeIns = await txQuery<{ id: string; entry_number: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'ADJUSTMENT',
       'CASH_COUNT_VARIANCE', $5::uuid, $6,
       $7::numeric, $8::numeric, 'POSTED',
       1, $9::uuid, $9::uuid, $9::uuid, NOW())
     RETURNING id, entry_number`,
    [
      entryNumber,
      session.fiscal_year_id,
      session.fiscal_period_id,
      entryDate,
      adjustmentId,
      description,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  const posted = await txQuery<CashCountAdjustmentRow>(
    client,
    `UPDATE accounts.cash_count_adjustments
     SET journal_entry_id = $2::uuid,
         status = 'POSTED',
         posted_by = $3::uuid,
         posted_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [adjustmentId, journalId, params.userId]
  );

  const sessionUpd = await txQuery<CashBoxSessionRow>(
    client,
    `UPDATE accounts.cash_box_sessions
     SET version = version + 1,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [session.id]
  );

  return {
    adjustment: posted.rows[0],
    session: sessionUpd.rows[0],
    count,
    created: true,
  };
}

/**
 * التحقق من صلاحية الإغلاق بعد تسوية مرحّلة:
 * الرصيد = المعدود، ولا قيد أحدث من قيد التسوية.
 */
export async function assertCloseAllowedAfterAdjustment(
  client: TxClient,
  params: {
    accountId: string;
    count: CashCountRow;
    adjustment: CashCountAdjustmentRow;
  }
): Promise<void> {
  if (params.adjustment.status !== 'POSTED' || !params.adjustment.journal_entry_id) {
    throw new AccountsHttpError('تسوية فرق الجرد غير مكتملة', 409);
  }
  if (params.adjustment.cash_count_id !== params.count.id) {
    throw new AccountsHttpError('التسوية غير مرتبطة بالجرد الحالي', 409);
  }

  const snap = await captureAccountBookSnapshotTx(client, params.accountId);
  const counted = normalizeMoneyInput(params.count.counted_amount);
  if (!moneyEquals(snap.balance, counted)) {
    throw new AccountsHttpError(
      'الرصيد الدفتري لا يطابق المبلغ المعدود بعد التسوية — أعد الجرد',
      409
    );
  }

  const je = await txQuery<{ id: string; posted_at: Date | string }>(
    client,
    `SELECT id, posted_at FROM accounts.journal_entries
     WHERE id = $1::uuid AND status = 'POSTED'`,
    [params.adjustment.journal_entry_id]
  );
  if (!je.rows[0]) {
    throw new AccountsHttpError('قيد التسوية غير موجود أو غير مرحّل', 409);
  }

  const last = await getLastPostedEntryForAccountTx(client, params.accountId);
  const drift = detectBookDriftSinceCount({
    currentBalance: snap.balance,
    currentLast: last,
    snapshotBalance: counted,
    snapshotEntryId: je.rows[0].id,
    snapshotPostedAt: je.rows[0].posted_at,
  });
  // إن تغيّر آخر قيد عن قيد التسوية → حركة أحدث
  if (last && last.entry_id !== je.rows[0].id) {
    throw new AccountsHttpError(
      'توجد حركة مالية مرحلة بعد قيد التسوية، يجب إعادة الجرد قبل إغلاق الجلسة',
      409
    );
  }
  if (drift.drifted && last && last.entry_id !== je.rows[0].id) {
    throw new AccountsHttpError(
      'توجد حركة مالية مرحلة بعد قيد التسوية، يجب إعادة الجرد قبل إغلاق الجلسة',
      409
    );
  }
}
