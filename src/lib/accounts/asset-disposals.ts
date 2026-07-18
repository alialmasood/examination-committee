/**
 * استبعاد الأصول الثابتة — بيع / إتلاف / تلف / فقد / تبرع خارج (8.A).
 *
 * محاسبة الاستبعاد (§20):
 *   Cr حساب الأصل            (التكلفة المرسملة)
 *   Dr مجمع الإهلاك          (مجمع الإهلاك المتراكم)
 *   Dr النقدية/البنك         (المتحصلات — للبيع فقط)
 *   Dr خسارة الاستبعاد       (إن كانت القيمة الدفترية > المتحصلات)
 *   Cr ربح بيع الأصول        (إن كانت المتحصلات > القيمة الدفترية)
 * القيمة الدفترية = التكلفة المرسملة − مجمع الإهلاك.
 * الربح/الخسارة = المتحصلات − القيمة الدفترية.
 * جميع الحسابات بالميلي (بدون float). العملة IQD.
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  acquireAccountingResourceLocks,
  assetDisposalLock,
  fixedAssetLock,
  glAccountLock,
} from './accounting-locks';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import {
  assertFiscalContextForEntry,
  createReversalEntry,
  loadJournalEntry,
} from './journal-entries';
import { maybeFault } from './fixed-assets-faults';
import {
  assertGainGlAccount,
  assertLossGlAccount,
  assertProceedsGlAccount,
  postFixedAssetJournalEntry,
} from './fixed-assets-gl';
import { loadAssetCategory } from './asset-categories';
import { loadFixedAsset } from './fixed-assets';
import { millisToMoney, moneyToMillis, moneyToMillisSigned, normalizeMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const DISPOSAL_TYPES = ['SALE', 'SCRAP', 'DAMAGE', 'LOSS', 'DONATION_OUT'] as const;
type DisposalType = (typeof DISPOSAL_TYPES)[number];

export type AssetDisposalRow = {
  id: string;
  disposal_number: string;
  fixed_asset_id: string;
  disposal_type: DisposalType;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  disposal_date: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  disposal_cost: string;
  accumulated_depreciation: string;
  net_book_value: string;
  proceeds_amount: string;
  gain_loss_amount: string;
  proceeds_gl_account_id: string | null;
  gain_gl_account_id: string | null;
  loss_gl_account_id: string | null;
  buyer_name: string | null;
  reason: string | null;
  notes: string | null;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  posted_at: Date | string | null;
  posted_by: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const text = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
function disposalType(v: unknown): DisposalType {
  const s = String(v ?? '').trim().toUpperCase();
  if (!DISPOSAL_TYPES.includes(s as DisposalType)) {
    throw new AccountsHttpError('نوع الاستبعاد غير صالح', 400);
  }
  return s as DisposalType;
}
function moneyNonNeg(v: unknown, label: string): string {
  try {
    const n = normalizeMoneyInput(v ?? 0);
    if (moneyToMillis(n) < BigInt(0)) throw new Error();
    return n;
  } catch {
    throw new AccountsHttpError(`قيمة ${label} غير صالحة`, 400);
  }
}
function optimistic(row: AssetDisposalRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export function serializeAssetDisposal(row: AssetDisposalRow) {
  return {
    ...row,
    disposal_date: pgDateOnly(row.disposal_date as unknown as string),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadAssetDisposal(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<AssetDisposalRow> {
  const r = await txQuery<AssetDisposalRow>(
    client,
    `SELECT * FROM accounts.asset_disposals WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('سجل الاستبعاد غير موجود', 404);
  return r.rows[0];
}

async function allocateDisposalNumber(client: TxClient, fiscalYearId: string): Promise<string> {
  const y = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id=$1`,
    [fiscalYearId]
  );
  if (!y.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  const seq = await nextDocumentNumber(client, {
    documentType: 'ASSET_DISPOSAL',
    fiscalYearId,
    yearLabel: yearLabelFromDate(y.rows[0].start_date),
  });
  return seq.formatted;
}

export async function createAssetDisposal(
  client: TxClient,
  input: {
    fixed_asset_id: unknown;
    disposal_type: unknown;
    disposal_date?: unknown;
    proceeds_amount?: unknown;
    proceeds_gl_account_id?: unknown;
    gain_gl_account_id?: unknown;
    loss_gl_account_id?: unknown;
    buyer_name?: unknown;
    reason?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<AssetDisposalRow> {
  const assetId = String(input.fixed_asset_id ?? '').trim();
  if (!assetId) throw new AccountsHttpError('الأصل مطلوب', 400);
  await acquireAccountingResourceLocks(client, [fixedAssetLock(assetId)]);
  const asset = await loadFixedAsset(client, assetId);
  if (!['ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED'].includes(asset.status)) {
    throw new AccountsHttpError('لا يمكن استبعاد الأصل في حالته الحالية', 409);
  }
  const type = disposalType(input.disposal_type);
  const disposalDate = input.disposal_date
    ? pgDateOnly(String(input.disposal_date).trim())
    : pgDateOnly(new Date());

  // الفترة المحاسبية المفتوحة التي تغطي التاريخ
  const period = await txQuery<{ id: string; fiscal_year_id: string; status: string }>(
    client,
    `SELECT id, fiscal_year_id, status FROM accounts.fiscal_periods
     WHERE start_date <= $1::date AND end_date >= $1::date
     ORDER BY start_date DESC LIMIT 1`,
    [disposalDate]
  );
  if (!period.rows[0]) throw new AccountsHttpError('لا توجد فترة محاسبية تغطي تاريخ الاستبعاد', 400);

  const capMillis = moneyToMillis(asset.capitalized_cost);
  const accumMillis = moneyToMillis(asset.accumulated_depreciation);
  const nbvMillis = capMillis - accumMillis;
  const proceeds = type === 'SALE' ? moneyNonNeg(input.proceeds_amount, 'المتحصلات') : '0';
  const proceedsMillis = moneyToMillis(proceeds);
  const gainLossMillis = proceedsMillis - nbvMillis; // موجب=ربح، سالب=خسارة

  const category = await loadAssetCategory(client, asset.category_id);
  let proceedsGl = text(input.proceeds_gl_account_id, 100);
  const gainGl = text(input.gain_gl_account_id, 100) ?? category.gain_gl_account_id;
  const lossGl = text(input.loss_gl_account_id, 100) ?? category.loss_gl_account_id;

  if (type === 'SALE') {
    if (proceedsMillis > BigInt(0) && !proceedsGl) {
      throw new AccountsHttpError('حساب متحصلات البيع (نقدية/بنك) مطلوب', 400);
    }
    if (proceedsGl) await assertProceedsGlAccount(client, proceedsGl);
  } else {
    proceedsGl = null;
  }
  if (gainLossMillis > BigInt(0)) {
    if (!gainGl) throw new AccountsHttpError('حساب أرباح بيع الأصول مطلوب', 400);
    await assertGainGlAccount(client, gainGl);
  } else if (gainLossMillis < BigInt(0)) {
    if (!lossGl) throw new AccountsHttpError('حساب خسائر استبعاد الأصول مطلوب', 400);
    await assertLossGlAccount(client, lossGl);
  }

  const number = await allocateDisposalNumber(client, period.rows[0].fiscal_year_id);
  const r = await txQuery<AssetDisposalRow>(
    client,
    `INSERT INTO accounts.asset_disposals
      (disposal_number, fixed_asset_id, disposal_type, status, disposal_date,
       fiscal_year_id, fiscal_period_id, disposal_cost, accumulated_depreciation, net_book_value,
       proceeds_amount, gain_loss_amount, proceeds_gl_account_id, gain_gl_account_id, loss_gl_account_id,
       buyer_name, reason, notes, created_by, updated_by)
     VALUES ($1,$2::uuid,$3,'DRAFT',$4::date,$5::uuid,$6::uuid,$7::numeric,$8::numeric,$9::numeric,
       $10::numeric,$11::numeric,$12::uuid,$13::uuid,$14::uuid,$15,$16,$17,$18::uuid,$18::uuid)
     RETURNING *`,
    [
      number,
      assetId,
      type,
      disposalDate,
      period.rows[0].fiscal_year_id,
      period.rows[0].id,
      asset.capitalized_cost,
      asset.accumulated_depreciation,
      millisToMoney(nbvMillis),
      proceeds,
      millisToMoney(gainLossMillis),
      proceedsGl,
      gainLossMillis > BigInt(0) ? gainGl : null,
      gainLossMillis < BigInt(0) ? lossGl : null,
      text(input.buyer_name, 200),
      text(input.reason, 2000),
      text(input.notes, 4000),
      input.created_by,
    ]
  );
  await writeFinancialAudit(client, {
    userId: input.created_by,
    action: 'asset_disposal.created',
    entityType: 'asset_disposal',
    entityId: r.rows[0].id,
    newValues: serializeAssetDisposal(r.rows[0]),
    description: `إنشاء استبعاد أصل ${number}`,
  });
  return r.rows[0];
}

export async function postAssetDisposal(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<AssetDisposalRow> {
  await acquireAccountingResourceLocks(client, [assetDisposalLock(p.id)]);
  const disp = await loadAssetDisposal(client, p.id, true);
  optimistic(disp, p.version, p.updated_at);
  if (disp.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل الاستبعاد في حالة المسودّة فقط', 409);
  }
  await acquireAccountingResourceLocks(client, [fixedAssetLock(disp.fixed_asset_id)]);
  const asset = await loadFixedAsset(client, disp.fixed_asset_id, true);
  if (!['ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED'].includes(asset.status)) {
    throw new AccountsHttpError('لا يمكن ترحيل استبعاد لأصل في حالته الحالية', 409);
  }
  // تأكد أن قيم الأصل لم تتغيّر منذ الإنشاء (اتساق snapshot)
  if (
    moneyToMillis(asset.capitalized_cost) !== moneyToMillis(disp.disposal_cost) ||
    moneyToMillis(asset.accumulated_depreciation) !== moneyToMillis(disp.accumulated_depreciation)
  ) {
    throw new AccountsHttpError(
      'تغيّرت قيم الأصل منذ إنشاء الاستبعاد — أعد إنشاء الاستبعاد',
      409
    );
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: disp.fiscal_year_id,
    fiscalPeriodId: disp.fiscal_period_id,
    entryDate: pgDateOnly(disp.disposal_date),
  });

  const glLocks = [
    glAccountLock(asset.asset_gl_account_id),
    glAccountLock(asset.accumulated_depreciation_gl_account_id),
  ];
  if (disp.proceeds_gl_account_id) glLocks.push(glAccountLock(disp.proceeds_gl_account_id));
  if (disp.gain_gl_account_id) glLocks.push(glAccountLock(disp.gain_gl_account_id));
  if (disp.loss_gl_account_id) glLocks.push(glAccountLock(disp.loss_gl_account_id));
  await acquireAccountingResourceLocks(client, glLocks);

  const accumMillis = moneyToMillis(disp.accumulated_depreciation);
  const proceedsMillis = moneyToMillis(disp.proceeds_amount);
  const gainLossMillis = moneyToMillisSigned(disp.gain_loss_amount);
  const cc = asset.cost_center_id;

  const lines: Array<{
    account_id: string;
    cost_center_id?: string | null;
    debit_amount: string;
    credit_amount: string;
    description?: string | null;
  }> = [
    {
      account_id: asset.asset_gl_account_id,
      cost_center_id: cc,
      debit_amount: '0',
      credit_amount: disp.disposal_cost,
      description: `استبعاد أصل ${asset.asset_number}`,
    },
  ];
  if (accumMillis > BigInt(0)) {
    lines.push({
      account_id: asset.accumulated_depreciation_gl_account_id,
      cost_center_id: cc,
      debit_amount: disp.accumulated_depreciation,
      credit_amount: '0',
      description: `إلغاء مجمع إهلاك — ${asset.asset_number}`,
    });
  }
  if (proceedsMillis > BigInt(0) && disp.proceeds_gl_account_id) {
    lines.push({
      account_id: disp.proceeds_gl_account_id,
      cost_center_id: cc,
      debit_amount: disp.proceeds_amount,
      credit_amount: '0',
      description: `متحصلات بيع — ${asset.asset_number}`,
    });
  }
  if (gainLossMillis > BigInt(0) && disp.gain_gl_account_id) {
    lines.push({
      account_id: disp.gain_gl_account_id,
      cost_center_id: cc,
      debit_amount: '0',
      credit_amount: millisToMoney(gainLossMillis),
      description: `ربح بيع أصل — ${asset.asset_number}`,
    });
  } else if (gainLossMillis < BigInt(0) && disp.loss_gl_account_id) {
    lines.push({
      account_id: disp.loss_gl_account_id,
      cost_center_id: cc,
      debit_amount: millisToMoney(-gainLossMillis),
      credit_amount: '0',
      description: `خسارة استبعاد أصل — ${asset.asset_number}`,
    });
  }

  maybeFault('disposal_after_voucher');

  const je = await postFixedAssetJournalEntry(client, {
    fiscalYearId: disp.fiscal_year_id,
    fiscalPeriodId: disp.fiscal_period_id,
    entryDate: pgDateOnly(disp.disposal_date),
    sourceType: 'ASSET_DISPOSAL',
    sourceId: disp.id,
    referenceNumber: disp.disposal_number,
    description: `استبعاد أصل — ${disp.disposal_number} — ${asset.asset_number}`,
    userId: p.userId,
    lines,
  });

  maybeFault('disposal_after_journal');

  await txQuery(
    client,
    `UPDATE accounts.fixed_assets SET status='DISPOSED', disposed_at=NOW(), disposed_by=$2::uuid,
       net_book_value=0, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [asset.id, p.userId]
  );

  maybeFault('disposal_after_asset_status');

  const r = await txQuery<AssetDisposalRow>(
    client,
    `UPDATE accounts.asset_disposals SET status='POSTED', journal_entry_id=$2::uuid,
       posted_at=NOW(), posted_by=$3::uuid, updated_by=$3::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [disp.id, je.id, p.userId]
  );

  maybeFault('disposal_after_disposal_status');

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'asset_disposal.posted',
    entityType: 'asset_disposal',
    entityId: disp.id,
    newValues: { journal_entry_id: je.id, entry_number: je.entry_number },
    description: `ترحيل استبعاد أصل ${disp.disposal_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function voidAssetDisposal(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
    reversalDate?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<AssetDisposalRow> {
  await acquireAccountingResourceLocks(client, [assetDisposalLock(p.id)]);
  const disp = await loadAssetDisposal(client, p.id, true);
  optimistic(disp, p.version, p.updated_at);
  if (disp.status !== 'POSTED') {
    throw new AccountsHttpError('يمكن إلغاء الاستبعادات المرحّلة فقط', 409);
  }
  await acquireAccountingResourceLocks(client, [fixedAssetLock(disp.fixed_asset_id)]);
  const asset = await loadFixedAsset(client, disp.fixed_asset_id, true);

  let reversalId: string | null = null;
  if (disp.journal_entry_id) {
    const original = await loadJournalEntry(client, disp.journal_entry_id, true);
    const reversalDate =
      p.reversalDate != null && p.reversalDate !== ''
        ? pgDateOnly(String(p.reversalDate).trim())
        : pgDateOnly(disp.disposal_date);
    const reversal = await createReversalEntry(client, {
      original,
      reversalDate,
      reason: `إلغاء استبعاد أصل ${disp.disposal_number}`,
      userId: p.userId,
      ipAddress: p.ipAddress,
      userAgent: p.userAgent,
    });
    reversalId = reversal.id;
  }

  // استعادة الأصل: نشط أو مستهلك بالكامل حسب مجمع الإهلاك
  const capMillis = moneyToMillis(disp.disposal_cost);
  const accumMillis = moneyToMillis(disp.accumulated_depreciation);
  const depreciable = moneyToMillis(asset.depreciable_amount);
  const restoredStatus = accumMillis >= depreciable && depreciable > BigInt(0)
    ? 'FULLY_DEPRECIATED'
    : 'ACTIVE';
  await txQuery(
    client,
    `UPDATE accounts.fixed_assets SET status=$2, disposed_at=NULL, disposed_by=NULL,
       net_book_value=$3::numeric, updated_by=$4::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [asset.id, restoredStatus, millisToMoney(capMillis - accumMillis), p.userId]
  );

  const r = await txQuery<AssetDisposalRow>(
    client,
    `UPDATE accounts.asset_disposals SET status='VOIDED', reversal_journal_entry_id=$2::uuid,
       voided_at=NOW(), voided_by=$3::uuid, void_reason=$4, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [disp.id, reversalId, p.userId, text(p.reason, 2000)]
  );
  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'asset_disposal.voided',
    entityType: 'asset_disposal',
    entityId: disp.id,
    oldValues: { status: 'POSTED' },
    newValues: { status: 'VOIDED', reversal_journal_entry_id: reversalId },
    description: `إلغاء استبعاد أصل ${disp.disposal_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function listAssetDisposals(
  client: TxClient,
  p: {
    fixed_asset_id?: string | null;
    status?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: AssetDisposalRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const values: unknown[] = [p.fixed_asset_id ?? null, p.status ?? null];
  const where = `WHERE ($1::uuid IS NULL OR fixed_asset_id=$1::uuid)
     AND ($2::text IS NULL OR status=$2)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.asset_disposals ${where}`,
    values
  );
  const r = await txQuery<AssetDisposalRow>(
    client,
    `SELECT * FROM accounts.asset_disposals ${where} ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
