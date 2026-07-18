/**
 * إهلاك الأصول الثابتة — القسط الثابت (STRAIGHT_LINE) — 8.A.
 *
 * سياسة الشهر الجزئي:
 *  - يُحتسب إهلاك شهر كامل إذا كان تاريخ الجاهزية للاستخدام (available_for_use_date)
 *    في أو قبل اليوم الأول من الفترة.
 *  - وإلا يبدأ الإهلاك من أول شهر كامل يلي تاريخ الجاهزية (لا يُحتسب إهلاك جزئي للشهر الأول).
 *
 * القسط الشهري = المبلغ القابل للإهلاك ÷ العمر الإنتاجي (بالأشهر). الفترة الأخيرة تأخذ
 * الباقي لضمان بلوغ مجمع الإهلاك للمبلغ القابل للإهلاك بالضبط (معالجة التقريب).
 * جميع الحسابات بالميلي (بدون float).
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  acquireAccountingResourceLocks,
  depreciationRunLock,
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
import { postFixedAssetJournalEntry } from './fixed-assets-gl';
import { millisToMoney, moneyToMillis } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type DepreciationRunRow = {
  id: string;
  run_number: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  period_start: string;
  period_end: string;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  category_id: string | null;
  asset_count: number;
  total_depreciation: string;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  notes: string | null;
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

type EligibleAsset = {
  id: string;
  asset_number: string;
  cost_center_id: string | null;
  depreciable_amount: string;
  accumulated_depreciation: string;
  useful_life_months: number;
  category_id: string;
  depreciation_expense_gl_account_id: string;
  accumulated_depreciation_gl_account_id: string;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const text = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
function optimistic(row: DepreciationRunRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export function serializeDepreciationRun(row: DepreciationRunRow) {
  return {
    ...row,
    period_start: pgDateOnly(row.period_start as unknown as string),
    period_end: pgDateOnly(row.period_end as unknown as string),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** القسط الشهري المستحق لهذه الدورة (بالميلي)، مع تسوية الفترة الأخيرة. */
function computeMonthlyDepreciationMillis(asset: EligibleAsset): {
  amount: bigint;
  isFinal: boolean;
} {
  const depreciable = moneyToMillis(asset.depreciable_amount);
  const accum = moneyToMillis(asset.accumulated_depreciation);
  const remaining = depreciable - accum;
  if (remaining <= BigInt(0)) return { amount: BigInt(0), isFinal: true };
  const monthly = depreciable / BigInt(asset.useful_life_months);
  if (monthly >= remaining) return { amount: remaining, isFinal: true };
  const nextRemaining = remaining - monthly;
  // إن تبقّى أقل من قسط بعد هذا الشهر، فالشهر القادم هو الأخير (ليس هذا)
  return { amount: monthly, isFinal: nextRemaining <= BigInt(0) };
}

export async function loadDepreciationRun(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<DepreciationRunRow> {
  const r = await txQuery<DepreciationRunRow>(
    client,
    `SELECT * FROM accounts.depreciation_runs WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('دورة الإهلاك غير موجودة', 404);
  return r.rows[0];
}

async function allocateRunNumber(client: TxClient, fiscalYearId: string): Promise<string> {
  const y = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id=$1`,
    [fiscalYearId]
  );
  if (!y.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  const seq = await nextDocumentNumber(client, {
    documentType: 'DEPRECIATION_RUN',
    fiscalYearId,
    yearLabel: yearLabelFromDate(y.rows[0].start_date),
  });
  return seq.formatted;
}

/**
 * إنشاء دورة إهلاك (DRAFT) وحساب سطورها للأصول المؤهّلة في الفترة.
 * الأصول المؤهّلة: ACTIVE، طريقة القسط الثابت، لم تُستهلك بالكامل، تاريخ الجاهزية ≤ بداية الفترة،
 * ولم تُحتسب لها دورة (DRAFT/POSTED) لنفس الفترة.
 */
export async function createDepreciationRun(
  client: TxClient,
  input: {
    fiscal_period_id: unknown;
    category_id?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<{ run: DepreciationRunRow; lineCount: number }> {
  const periodId = String(input.fiscal_period_id ?? '').trim();
  if (!periodId) throw new AccountsHttpError('الفترة المحاسبية مطلوبة', 400);

  const period = await txQuery<{
    id: string;
    fiscal_year_id: string;
    status: string;
    start_date: string;
    end_date: string;
  }>(
    client,
    `SELECT id, fiscal_year_id, status, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods WHERE id=$1::uuid`,
    [periodId]
  );
  if (!period.rows[0]) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
  const p = period.rows[0];
  if (p.status !== 'OPEN') {
    throw new AccountsHttpError('يجب أن تكون الفترة المحاسبية مفتوحة (OPEN)', 409);
  }
  const periodStart = pgDateOnly(p.start_date);
  const periodEnd = pgDateOnly(p.end_date);
  const categoryId = text(input.category_id, 100);

  const eligible = await txQuery<EligibleAsset>(
    client,
    `SELECT fa.id, fa.asset_number, fa.cost_center_id, fa.depreciable_amount,
            fa.accumulated_depreciation, fa.useful_life_months, fa.category_id,
            fa.depreciation_expense_gl_account_id, fa.accumulated_depreciation_gl_account_id
     FROM accounts.fixed_assets fa
     WHERE fa.status='ACTIVE'
       AND fa.depreciation_method='STRAIGHT_LINE'
       AND fa.useful_life_months IS NOT NULL
       AND fa.available_for_use_date <= $1::date
       AND fa.accumulated_depreciation < fa.depreciable_amount
       AND ($2::uuid IS NULL OR fa.category_id=$2::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM accounts.depreciation_run_lines drl
         JOIN accounts.depreciation_runs dr ON dr.id=drl.run_id
         WHERE drl.fixed_asset_id=fa.id AND dr.fiscal_period_id=$3::uuid
           AND dr.status IN ('DRAFT','POSTED')
       )
     ORDER BY fa.asset_number`,
    [periodStart, categoryId, periodId]
  );

  if (eligible.rows.length === 0) {
    throw new AccountsHttpError('لا توجد أصول مؤهّلة للإهلاك في هذه الفترة', 409);
  }

  const runNumber = await allocateRunNumber(client, p.fiscal_year_id);
  const runIns = await txQuery<DepreciationRunRow>(
    client,
    `INSERT INTO accounts.depreciation_runs
      (run_number, fiscal_year_id, fiscal_period_id, period_start, period_end, status,
       category_id, asset_count, total_depreciation, notes, created_by, updated_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::date,$5::date,'DRAFT',$6::uuid,0,0,$7,$8::uuid,$8::uuid)
     RETURNING *`,
    [runNumber, p.fiscal_year_id, periodId, periodStart, periodEnd, categoryId, text(input.notes, 4000), input.created_by]
  );
  const run = runIns.rows[0];

  let totalMillis = BigInt(0);
  let count = 0;
  for (const asset of eligible.rows) {
    const { amount, isFinal } = computeMonthlyDepreciationMillis(asset);
    if (amount <= BigInt(0)) continue;
    const opening = moneyToMillis(asset.accumulated_depreciation);
    const closing = opening + amount;
    const capNbvMillis = closing; // للعرض فقط؛ NBV الفعلي = capitalized - closing
    await txQuery(
      client,
      `INSERT INTO accounts.depreciation_run_lines
        (run_id, fixed_asset_id, category_id, depreciation_expense_gl_account_id,
         accumulated_depreciation_gl_account_id, opening_accumulated, depreciation_amount,
         closing_accumulated, net_book_value, months_depreciated, is_final_period)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8::numeric,$9::numeric,1,$10)`,
      [
        run.id,
        asset.id,
        asset.category_id,
        asset.depreciation_expense_gl_account_id,
        asset.accumulated_depreciation_gl_account_id,
        millisToMoney(opening),
        millisToMoney(amount),
        millisToMoney(closing),
        millisToMoney(capNbvMillis),
        isFinal,
      ]
    );
    totalMillis += amount;
    count += 1;
  }

  const updated = await txQuery<DepreciationRunRow>(
    client,
    `UPDATE accounts.depreciation_runs SET asset_count=$2, total_depreciation=$3::numeric,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [run.id, count, millisToMoney(totalMillis)]
  );

  await writeFinancialAudit(client, {
    userId: input.created_by,
    action: 'depreciation_run.created',
    entityType: 'depreciation_run',
    entityId: run.id,
    newValues: { run_number: runNumber, asset_count: count, total: millisToMoney(totalMillis) },
    description: `إنشاء دورة إهلاك ${runNumber}`,
  });

  return { run: updated.rows[0], lineCount: count };
}

/**
 * إعادة احتساب دورة إهلاك DRAFT: يحذف السطور السابقة ويعيد بناءها للأصول المؤهّلة
 * في نفس الفترة/التصنيف، ثم يعيد حساب الإجمالي والعدد. يُمنع بعد POST/VOID.
 * transaction واحدة (يوفّرها المستدعي)، قفل على الدورة، وAudit.
 */
export async function recalculateDepreciationRun(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version?: unknown;
    updated_at?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<{ run: DepreciationRunRow; lineCount: number }> {
  await acquireAccountingResourceLocks(client, [depreciationRunLock(p.id)]);
  const run = await loadDepreciationRun(client, p.id, true);
  if (run.status !== 'DRAFT') {
    throw new AccountsHttpError(
      'لا يمكن إعادة احتساب دورة إهلاك بعد ترحيلها أو إلغائها (DRAFT فقط)',
      409
    );
  }
  if (p.version !== undefined || p.updated_at !== undefined) {
    optimistic(run, p.version, p.updated_at);
  }

  const periodStart = pgDateOnly(run.period_start);
  const eligible = await txQuery<EligibleAsset>(
    client,
    `SELECT fa.id, fa.asset_number, fa.cost_center_id, fa.depreciable_amount,
            fa.accumulated_depreciation, fa.useful_life_months, fa.category_id,
            fa.depreciation_expense_gl_account_id, fa.accumulated_depreciation_gl_account_id
     FROM accounts.fixed_assets fa
     WHERE fa.status='ACTIVE'
       AND fa.depreciation_method='STRAIGHT_LINE'
       AND fa.useful_life_months IS NOT NULL
       AND fa.available_for_use_date <= $1::date
       AND fa.accumulated_depreciation < fa.depreciable_amount
       AND ($2::uuid IS NULL OR fa.category_id=$2::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM accounts.depreciation_run_lines drl
         JOIN accounts.depreciation_runs dr ON dr.id=drl.run_id
         WHERE drl.fixed_asset_id=fa.id AND dr.fiscal_period_id=$3::uuid
           AND dr.status IN ('DRAFT','POSTED') AND dr.id <> $4::uuid
       )
     ORDER BY fa.asset_number`,
    [periodStart, run.category_id, run.fiscal_period_id, run.id]
  );

  // احذف السطور السابقة ثم أعد بناءها
  await txQuery(client, `DELETE FROM accounts.depreciation_run_lines WHERE run_id=$1::uuid`, [run.id]);

  let totalMillis = BigInt(0);
  let count = 0;
  for (const asset of eligible.rows) {
    const { amount, isFinal } = computeMonthlyDepreciationMillis(asset);
    if (amount <= BigInt(0)) continue;
    const opening = moneyToMillis(asset.accumulated_depreciation);
    const closing = opening + amount;
    await txQuery(
      client,
      `INSERT INTO accounts.depreciation_run_lines
        (run_id, fixed_asset_id, category_id, depreciation_expense_gl_account_id,
         accumulated_depreciation_gl_account_id, opening_accumulated, depreciation_amount,
         closing_accumulated, net_book_value, months_depreciated, is_final_period)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8::numeric,$9::numeric,1,$10)`,
      [
        run.id,
        asset.id,
        asset.category_id,
        asset.depreciation_expense_gl_account_id,
        asset.accumulated_depreciation_gl_account_id,
        millisToMoney(opening),
        millisToMoney(amount),
        millisToMoney(closing),
        millisToMoney(closing),
        isFinal,
      ]
    );
    totalMillis += amount;
    count += 1;
  }

  const updated = await txQuery<DepreciationRunRow>(
    client,
    `UPDATE accounts.depreciation_runs SET asset_count=$2, total_depreciation=$3::numeric,
       updated_at=NOW(), version=version+1, updated_by=$4::uuid WHERE id=$1::uuid RETURNING *`,
    [run.id, count, millisToMoney(totalMillis), p.userId]
  );

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'depreciation_run.calculated',
    entityType: 'depreciation_run',
    entityId: run.id,
    oldValues: { asset_count: run.asset_count, total: run.total_depreciation },
    newValues: { asset_count: count, total: millisToMoney(totalMillis) },
    description: `إعادة احتساب دورة إهلاك ${run.run_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });

  return { run: updated.rows[0], lineCount: count };
}

export async function postDepreciationRun(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<DepreciationRunRow> {
  await acquireAccountingResourceLocks(client, [depreciationRunLock(p.id)]);
  const run = await loadDepreciationRun(client, p.id, true);
  optimistic(run, p.version, p.updated_at);
  if (run.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل دورات الإهلاك في حالة المسودّة فقط', 409);
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: run.fiscal_year_id,
    fiscalPeriodId: run.fiscal_period_id,
    entryDate: pgDateOnly(run.period_end),
  });

  const lines = await txQuery<{
    id: string;
    fixed_asset_id: string;
    depreciation_expense_gl_account_id: string;
    accumulated_depreciation_gl_account_id: string;
    depreciation_amount: string;
    closing_accumulated: string;
    is_final_period: boolean;
  }>(
    client,
    `SELECT drl.id, drl.fixed_asset_id, drl.depreciation_expense_gl_account_id,
            drl.accumulated_depreciation_gl_account_id, drl.depreciation_amount,
            drl.closing_accumulated, drl.is_final_period, fa.cost_center_id
     FROM accounts.depreciation_run_lines drl
     JOIN accounts.fixed_assets fa ON fa.id=drl.fixed_asset_id
     WHERE drl.run_id=$1::uuid
     ORDER BY drl.id`,
    [run.id]
  );
  if (lines.rows.length === 0) {
    throw new AccountsHttpError('لا توجد سطور في هذه الدورة', 409);
  }

  // قفل حسابات GL وأصول الدورة
  const assetIds = lines.rows.map((l) => l.fixed_asset_id);
  const glIds = new Set<string>();
  for (const l of lines.rows) {
    glIds.add(l.depreciation_expense_gl_account_id);
    glIds.add(l.accumulated_depreciation_gl_account_id);
  }
  await acquireAccountingResourceLocks(client, [
    ...assetIds.map((id) => fixedAssetLock(id)),
    ...[...glIds].map((id) => glAccountLock(id)),
  ]);

  // تجميع القيد: مدين مصروف الإهلاك / دائن مجمع الإهلاك (مجمّع حسب GL + مركز الكلفة)
  const debitMap = new Map<string, { gl: string; cc: string | null; millis: bigint }>();
  const creditMap = new Map<string, { gl: string; cc: string | null; millis: bigint }>();
  for (const l of lines.rows as Array<(typeof lines.rows)[number] & { cost_center_id: string | null }>) {
    const cc = l.cost_center_id ?? null;
    const amt = moneyToMillis(l.depreciation_amount);
    if (amt <= BigInt(0)) continue;
    const dk = `${l.depreciation_expense_gl_account_id}|${cc ?? ''}`;
    const ck = `${l.accumulated_depreciation_gl_account_id}|${cc ?? ''}`;
    const d = debitMap.get(dk) ?? { gl: l.depreciation_expense_gl_account_id, cc, millis: BigInt(0) };
    d.millis += amt;
    debitMap.set(dk, d);
    const c = creditMap.get(ck) ?? { gl: l.accumulated_depreciation_gl_account_id, cc, millis: BigInt(0) };
    c.millis += amt;
    creditMap.set(ck, c);
  }

  const jeLines: Array<{
    account_id: string;
    cost_center_id?: string | null;
    debit_amount: string;
    credit_amount: string;
    description?: string | null;
  }> = [];
  for (const d of debitMap.values()) {
    jeLines.push({
      account_id: d.gl,
      cost_center_id: d.cc,
      debit_amount: millisToMoney(d.millis),
      credit_amount: '0',
      description: `مصروف إهلاك — ${run.run_number}`,
    });
  }
  for (const c of creditMap.values()) {
    jeLines.push({
      account_id: c.gl,
      cost_center_id: c.cc,
      debit_amount: '0',
      credit_amount: millisToMoney(c.millis),
      description: `مجمع إهلاك — ${run.run_number}`,
    });
  }

  const je = await postFixedAssetJournalEntry(client, {
    fiscalYearId: run.fiscal_year_id,
    fiscalPeriodId: run.fiscal_period_id,
    entryDate: pgDateOnly(run.period_end),
    sourceType: 'DEPRECIATION_RUN',
    sourceId: run.id,
    referenceNumber: run.run_number,
    description: `قيد إهلاك دوري — ${run.run_number}`,
    userId: p.userId,
    lines: jeLines,
  });

  maybeFault('dep_after_journal');

  // تحديث الأصول
  let first = true;
  for (const l of lines.rows) {
    await txQuery(
      client,
      `UPDATE accounts.fixed_assets SET
         accumulated_depreciation=$2::numeric,
         net_book_value=(capitalized_cost - $2::numeric),
         last_depreciation_date=$3::date, last_depreciation_period_id=$4::uuid,
         status=CASE WHEN $5 THEN 'FULLY_DEPRECIATED' ELSE status END,
         updated_by=$6::uuid, updated_at=NOW(), version=version+1
       WHERE id=$1::uuid`,
      [
        l.fixed_asset_id,
        l.closing_accumulated,
        pgDateOnly(run.period_end),
        run.fiscal_period_id,
        l.is_final_period,
        p.userId,
      ]
    );
    if (first) {
      maybeFault('dep_after_first_asset');
      first = false;
    }
  }

  maybeFault('dep_after_all_assets');

  const updated = await txQuery<DepreciationRunRow>(
    client,
    `UPDATE accounts.depreciation_runs SET status='POSTED', journal_entry_id=$2::uuid,
       posted_at=NOW(), posted_by=$3::uuid, updated_by=$3::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [run.id, je.id, p.userId]
  );

  maybeFault('dep_after_run_status');

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'depreciation_run.posted',
    entityType: 'depreciation_run',
    entityId: run.id,
    newValues: { journal_entry_id: je.id, entry_number: je.entry_number },
    description: `ترحيل دورة إهلاك ${run.run_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return updated.rows[0];
}

export async function voidDepreciationRun(
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
): Promise<DepreciationRunRow> {
  await acquireAccountingResourceLocks(client, [depreciationRunLock(p.id)]);
  const run = await loadDepreciationRun(client, p.id, true);
  optimistic(run, p.version, p.updated_at);
  if (run.status !== 'POSTED') {
    throw new AccountsHttpError('يمكن إلغاء دورات الإهلاك المرحّلة فقط', 409);
  }

  const lines = await txQuery<{
    fixed_asset_id: string;
    depreciation_amount: string;
    opening_accumulated: string;
  }>(
    client,
    `SELECT fixed_asset_id, depreciation_amount, opening_accumulated
     FROM accounts.depreciation_run_lines WHERE run_id=$1::uuid`,
    [run.id]
  );

  await acquireAccountingResourceLocks(
    client,
    lines.rows.map((l) => fixedAssetLock(l.fixed_asset_id))
  );

  // عكس القيد
  let reversalId: string | null = null;
  if (run.journal_entry_id) {
    const original = await loadJournalEntry(client, run.journal_entry_id, true);
    const reversalDate =
      p.reversalDate != null && p.reversalDate !== ''
        ? pgDateOnly(String(p.reversalDate).trim())
        : pgDateOnly(run.period_end);
    const reversal = await createReversalEntry(client, {
      original,
      reversalDate,
      reason: `إلغاء دورة إهلاك ${run.run_number}`,
      userId: p.userId,
      ipAddress: p.ipAddress,
      userAgent: p.userAgent,
    });
    reversalId = reversal.id;
  }

  // استعادة مجمع الإهلاك في الأصول
  for (const l of lines.rows) {
    await txQuery(
      client,
      `UPDATE accounts.fixed_assets SET
         accumulated_depreciation=$2::numeric,
         net_book_value=(capitalized_cost - $2::numeric),
         status=CASE WHEN status='FULLY_DEPRECIATED' THEN 'ACTIVE' ELSE status END,
         last_depreciation_date=NULL, last_depreciation_period_id=NULL,
         updated_by=$3::uuid, updated_at=NOW(), version=version+1
       WHERE id=$1::uuid`,
      [l.fixed_asset_id, l.opening_accumulated, p.userId]
    );
  }

  const updated = await txQuery<DepreciationRunRow>(
    client,
    `UPDATE accounts.depreciation_runs SET status='VOIDED', reversal_journal_entry_id=$2::uuid,
       voided_at=NOW(), voided_by=$3::uuid, void_reason=$4, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [run.id, reversalId, p.userId, text(p.reason, 2000)]
  );

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'depreciation_run.voided',
    entityType: 'depreciation_run',
    entityId: run.id,
    oldValues: { status: 'POSTED' },
    newValues: { status: 'VOIDED', reversal_journal_entry_id: reversalId },
    description: `إلغاء دورة إهلاك ${run.run_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return updated.rows[0];
}

export async function listDepreciationRuns(
  client: TxClient,
  p: { status?: string | null; page?: number; page_size?: number }
): Promise<{ rows: DepreciationRunRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const values: unknown[] = [p.status ?? null];
  const where = `WHERE ($1::text IS NULL OR status=$1)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.depreciation_runs ${where}`,
    values
  );
  const r = await txQuery<DepreciationRunRow>(
    client,
    `SELECT * FROM accounts.depreciation_runs ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}

export async function listDepreciationRunLines(
  client: TxClient,
  runId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await txQuery(
    client,
    `SELECT drl.*, fa.asset_number, fa.name_ar AS asset_name
     FROM accounts.depreciation_run_lines drl
     JOIN accounts.fixed_assets fa ON fa.id=drl.fixed_asset_id
     WHERE drl.run_id=$1::uuid ORDER BY fa.asset_number`,
    [runId]
  );
  return r.rows;
}
