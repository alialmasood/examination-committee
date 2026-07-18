/**
 * الأصول الثابتة — دورة الحياة الأساسية (8.A).
 *
 * سياسات:
 *  - الرسملة: يُسمح بإنشاء DRAFT تحت حد الرسملة؛ التفعيل (ACTIVE) يتطلب أن تبلغ التكلفة
 *    المرسملة حد التصنيف، أو تجاوزاً صريحاً (override + سبب + صلاحية).
 *  - قيد الاقتناء: للأصول MANUAL/OPENING/DONATION يُنشأ عند التفعيل.
 *    الأصول من المشتريات (PURCHASE) لا تُنشئ قيد اقتناء عند التفعيل (فاتورة المورد سبق أن مدّنت الأصل).
 *  - الأرصدة الافتتاحية: Dr الأصل / Cr حقوق ملكية افتتاحية. عند وجود مجمع إهلاك افتتاحي:
 *    Dr حقوق الملكية / Cr مجمع الإهلاك.
 *  - التبرعات: Dr الأصل / Cr إيراد التبرع (إن حُدّد حساب إيراد التبرع)؛ وإلا يُوثَّق التبسيط
 *    ويبقى الأصل بلا قيد اقتناء.
 * جميع الحسابات بالميلي (بدون float) والعملة IQD.
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  acquireAccountingResourceLocks,
  assetCategoryLock,
  fixedAssetLock,
  glAccountLock,
} from './accounting-locks';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import { maybeFault } from './fixed-assets-faults';
import {
  assertAccumulatedDepreciationGlAccount,
  assertAssetGlAccount,
  assertDepreciationExpenseGlAccount,
  assertDonationRevenueGlAccount,
  assertEquityGlAccount,
  postFixedAssetJournalEntry,
} from './fixed-assets-gl';
import { loadAssetCategory } from './asset-categories';
import { millisToMoney, moneyToMillis, normalizeMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type FixedAssetStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'FULLY_DEPRECIATED'
  | 'DISPOSED'
  | 'CANCELLED';

export type AcquisitionType = 'PURCHASE' | 'MANUAL' | 'DONATION' | 'OPENING';

export type FixedAssetRow = {
  id: string;
  asset_number: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  barcode_value: string | null;
  serial_number: string | null;
  status: FixedAssetStatus;
  acquisition_type: AcquisitionType;
  acquisition_date: string;
  available_for_use_date: string;
  currency_code: string;
  acquisition_cost: string;
  additional_costs: string;
  capitalized_cost: string;
  salvage_value: string;
  depreciable_amount: string;
  useful_life_months: number | null;
  depreciation_method: 'STRAIGHT_LINE' | 'NONE';
  opening_accumulated_depreciation: string;
  accumulated_depreciation: string;
  net_book_value: string;
  asset_gl_account_id: string;
  accumulated_depreciation_gl_account_id: string;
  depreciation_expense_gl_account_id: string;
  donation_contra_gl_account_id: string | null;
  cost_center_id: string | null;
  department_id: string | null;
  location_id: string | null;
  custodian_user_id: string | null;
  supplier_id: string | null;
  purchase_order_id: string | null;
  purchase_order_line_id: string | null;
  fiscal_year_id: string;
  fiscal_period_id: string;
  override_capitalization_threshold: boolean;
  override_threshold_reason: string | null;
  override_threshold_by: string | null;
  override_threshold_at: Date | string | null;
  acquisition_journal_entry_id: string | null;
  last_depreciation_date: string | null;
  last_depreciation_period_id: string | null;
  activated_at: Date | string | null;
  activated_by: string | null;
  suspended_at: Date | string | null;
  suspended_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  disposed_at: Date | string | null;
  disposed_by: string | null;
  notes: string | null;
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
function name(v: unknown) {
  const s = String(v ?? '').trim().slice(0, 300);
  if (!s) throw new AccountsHttpError('اسم الأصل بالعربية مطلوب', 400);
  return s;
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
function acquisitionType(v: unknown): AcquisitionType {
  const s = String(v ?? 'MANUAL').trim().toUpperCase();
  if (s !== 'PURCHASE' && s !== 'MANUAL' && s !== 'DONATION' && s !== 'OPENING') {
    throw new AccountsHttpError('نوع الاقتناء غير صالح', 400);
  }
  return s as AcquisitionType;
}
function optimistic(row: FixedAssetRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

/** يحسب القيمة المتبقية بالميلي = التكلفة × النسبة (بدون float). */
function computeSalvageMillis(capitalizedMillis: bigint, percentRaw: string | number): bigint {
  const scaled = BigInt(Math.round(Number(percentRaw) * 10000)); // نسبة × 10^4
  // salvage = cap × scaled / 10^6 مع تقريب لأقرب ميلي
  const num = capitalizedMillis * scaled;
  const denom = BigInt(1000000);
  const q = num / denom;
  const r = num % denom;
  return r * BigInt(2) >= denom ? q + BigInt(1) : q;
}

export function serializeFixedAsset(row: FixedAssetRow) {
  return {
    ...row,
    acquisition_date: pgDateOnly(row.acquisition_date as unknown as string),
    available_for_use_date: pgDateOnly(row.available_for_use_date as unknown as string),
    override_threshold_at: iso(row.override_threshold_at),
    activated_at: iso(row.activated_at),
    suspended_at: iso(row.suspended_at),
    cancelled_at: iso(row.cancelled_at),
    disposed_at: iso(row.disposed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadFixedAsset(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<FixedAssetRow> {
  const r = await txQuery<FixedAssetRow>(
    client,
    `SELECT * FROM accounts.fixed_assets WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الأصل الثابت غير موجود', 404);
  return r.rows[0];
}

async function allocateAssetNumber(client: TxClient, fiscalYearId: string): Promise<string> {
  const y = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id=$1`,
    [fiscalYearId]
  );
  if (!y.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  const seq = await nextDocumentNumber(client, {
    documentType: 'FIXED_ASSET',
    fiscalYearId,
    yearLabel: yearLabelFromDate(y.rows[0].start_date),
  });
  return seq.formatted;
}

export type CreateFixedAssetInput = {
  category_id: unknown;
  name_ar: unknown;
  name_en?: unknown;
  description?: unknown;
  barcode_value?: unknown;
  serial_number?: unknown;
  acquisition_type?: unknown;
  acquisition_date: unknown;
  available_for_use_date?: unknown;
  acquisition_cost?: unknown;
  additional_costs?: unknown;
  salvage_value?: unknown;
  useful_life_months?: unknown;
  opening_accumulated_depreciation?: unknown;
  donation_contra_gl_account_id?: unknown;
  cost_center_id?: unknown;
  department_id?: unknown;
  location_id?: unknown;
  custodian_user_id?: unknown;
  supplier_id?: unknown;
  purchase_order_id?: unknown;
  purchase_order_line_id?: unknown;
  fiscal_year_id: unknown;
  fiscal_period_id: unknown;
  notes?: unknown;
  created_by: string;
};

export async function createFixedAsset(
  client: TxClient,
  input: CreateFixedAssetInput
): Promise<FixedAssetRow> {
  const categoryId = String(input.category_id ?? '').trim();
  if (!categoryId) throw new AccountsHttpError('تصنيف الأصل مطلوب', 400);
  await acquireAccountingResourceLocks(client, [assetCategoryLock(categoryId)]);
  const category = await loadAssetCategory(client, categoryId);
  if (!category.is_active) throw new AccountsHttpError('تصنيف الأصل غير فعّال', 409);

  const acqType = acquisitionType(input.acquisition_type);
  const acquisitionDate = pgDateOnly(String(input.acquisition_date ?? '').trim() || new Date());
  const availableDate = input.available_for_use_date
    ? pgDateOnly(String(input.available_for_use_date).trim())
    : acquisitionDate;

  const fiscalYearId = String(input.fiscal_year_id ?? '').trim();
  const fiscalPeriodId = String(input.fiscal_period_id ?? '').trim();
  if (!fiscalYearId || !fiscalPeriodId) {
    throw new AccountsHttpError('السنة والفترة المالية مطلوبتان', 400);
  }
  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: acquisitionDate,
  });

  const acqCost = moneyNonNeg(input.acquisition_cost, 'تكلفة الاقتناء');
  const addlCost = moneyNonNeg(input.additional_costs, 'التكاليف الإضافية');
  const capMillis = moneyToMillis(acqCost) + moneyToMillis(addlCost);
  const capitalized = millisToMoney(capMillis);

  // القيمة المتبقية: من المدخلات أو محسوبة من نسبة التصنيف
  let salvageMillis: bigint;
  if (input.salvage_value != null && input.salvage_value !== '') {
    salvageMillis = moneyToMillis(moneyNonNeg(input.salvage_value, 'القيمة المتبقية'));
  } else {
    salvageMillis = computeSalvageMillis(capMillis, category.salvage_value_percent);
  }
  if (salvageMillis > capMillis) {
    throw new AccountsHttpError('القيمة المتبقية لا يمكن أن تتجاوز التكلفة المرسملة', 400);
  }
  const salvage = millisToMoney(salvageMillis);
  const depreciable = millisToMoney(capMillis - salvageMillis);

  const openingAccum = moneyNonNeg(input.opening_accumulated_depreciation, 'مجمع الإهلاك الافتتاحي');
  if (moneyToMillis(openingAccum) > capMillis - salvageMillis) {
    throw new AccountsHttpError('مجمع الإهلاك الافتتاحي يتجاوز المبلغ القابل للإهلاك', 400);
  }
  const nbv = millisToMoney(capMillis - moneyToMillis(openingAccum));

  const method =
    category.depreciation_method === 'NONE' ? 'NONE' : category.depreciation_method;
  let usefulLife: number | null = null;
  if (input.useful_life_months != null && input.useful_life_months !== '') {
    const n = Number(input.useful_life_months);
    if (!Number.isInteger(n) || n <= 0) {
      throw new AccountsHttpError('العمر الإنتاجي يجب أن يكون عدداً صحيحاً موجباً', 400);
    }
    usefulLife = n;
  } else {
    usefulLife = category.useful_life_months;
  }
  if (method === 'STRAIGHT_LINE' && !usefulLife) {
    throw new AccountsHttpError('العمر الإنتاجي (بالأشهر) مطلوب لطريقة القسط الثابت', 400);
  }

  let donationGl: string | null = null;
  if (acqType === 'DONATION') {
    donationGl = text(input.donation_contra_gl_account_id, 100);
    if (donationGl) await assertDonationRevenueGlAccount(client, donationGl);
  }

  // فحص GL التصنيف (snapshot)
  await assertAssetGlAccount(client, category.asset_gl_account_id);
  await assertAccumulatedDepreciationGlAccount(
    client,
    category.accumulated_depreciation_gl_account_id
  );
  await assertDepreciationExpenseGlAccount(
    client,
    category.depreciation_expense_gl_account_id
  );

  const barcode = text(input.barcode_value, 120);
  if (barcode) {
    const dup = await txQuery(
      client,
      `SELECT 1 FROM accounts.fixed_assets WHERE barcode_value=$1`,
      [barcode]
    );
    if (dup.rows[0]) throw new AccountsHttpError('الباركود مستخدم مسبقاً', 409);
  }

  const assetNumber = await allocateAssetNumber(client, fiscalYearId);

  const r = await txQuery<FixedAssetRow>(
    client,
    `INSERT INTO accounts.fixed_assets (
       asset_number, category_id, name_ar, name_en, description, barcode_value, serial_number,
       status, acquisition_type, acquisition_date, available_for_use_date, currency_code,
       acquisition_cost, additional_costs, capitalized_cost, salvage_value, depreciable_amount,
       useful_life_months, depreciation_method, opening_accumulated_depreciation,
       accumulated_depreciation, net_book_value,
       asset_gl_account_id, accumulated_depreciation_gl_account_id, depreciation_expense_gl_account_id,
       donation_contra_gl_account_id, cost_center_id, department_id, location_id, custodian_user_id,
       supplier_id, purchase_order_id, purchase_order_line_id, fiscal_year_id, fiscal_period_id,
       notes, created_by, updated_by
     ) VALUES (
       $1,$2::uuid,$3,$4,$5,$6,$7,
       'DRAFT',$8,$9::date,$10::date,'IQD',
       $11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,
       $16,$17,$18::numeric,
       $18::numeric,$19::numeric,
       $20::uuid,$21::uuid,$22::uuid,
       $23::uuid,$24::uuid,$25::uuid,$26::uuid,$27::uuid,
       $28::uuid,$29::uuid,$30::uuid,$31::uuid,$32::uuid,
       $33,$34::uuid,$34::uuid
     ) RETURNING *`,
    [
      assetNumber,
      categoryId,
      name(input.name_ar),
      text(input.name_en, 300),
      text(input.description, 4000),
      barcode,
      text(input.serial_number, 120),
      acqType,
      acquisitionDate,
      availableDate,
      acqCost,
      addlCost,
      capitalized,
      salvage,
      depreciable,
      usefulLife,
      method,
      openingAccum,
      nbv,
      category.asset_gl_account_id,
      category.accumulated_depreciation_gl_account_id,
      category.depreciation_expense_gl_account_id,
      donationGl,
      text(input.cost_center_id, 100),
      text(input.department_id, 100),
      text(input.location_id, 100),
      text(input.custodian_user_id, 100),
      text(input.supplier_id, 100),
      text(input.purchase_order_id, 100),
      text(input.purchase_order_line_id, 100),
      fiscalYearId,
      fiscalPeriodId,
      text(input.notes, 4000),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updateFixedAssetDraft(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    description?: unknown;
    barcode_value?: unknown;
    serial_number?: unknown;
    acquisition_cost?: unknown;
    additional_costs?: unknown;
    salvage_value?: unknown;
    useful_life_months?: unknown;
    opening_accumulated_depreciation?: unknown;
    cost_center_id?: unknown;
    department_id?: unknown;
    location_id?: unknown;
    custodian_user_id?: unknown;
    notes?: unknown;
  }
): Promise<FixedAssetRow> {
  await acquireAccountingResourceLocks(client, [fixedAssetLock(p.id)]);
  const row = await loadFixedAsset(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('لا يمكن تعديل أصل غير مسودّة', 409);
  }

  const acqCost =
    p.acquisition_cost === undefined
      ? row.acquisition_cost
      : moneyNonNeg(p.acquisition_cost, 'تكلفة الاقتناء');
  const addlCost =
    p.additional_costs === undefined
      ? row.additional_costs
      : moneyNonNeg(p.additional_costs, 'التكاليف الإضافية');
  const capMillis = moneyToMillis(acqCost) + moneyToMillis(addlCost);

  let salvageMillis: bigint;
  if (p.salvage_value !== undefined && p.salvage_value !== null && p.salvage_value !== '') {
    salvageMillis = moneyToMillis(moneyNonNeg(p.salvage_value, 'القيمة المتبقية'));
  } else if (p.acquisition_cost !== undefined || p.additional_costs !== undefined) {
    const category = await loadAssetCategory(client, row.category_id);
    salvageMillis = computeSalvageMillis(capMillis, category.salvage_value_percent);
  } else {
    salvageMillis = moneyToMillis(row.salvage_value);
  }
  if (salvageMillis > capMillis) {
    throw new AccountsHttpError('القيمة المتبقية لا يمكن أن تتجاوز التكلفة المرسملة', 400);
  }

  const openingAccum =
    p.opening_accumulated_depreciation === undefined
      ? row.opening_accumulated_depreciation
      : moneyNonNeg(p.opening_accumulated_depreciation, 'مجمع الإهلاك الافتتاحي');
  if (moneyToMillis(openingAccum) > capMillis - salvageMillis) {
    throw new AccountsHttpError('مجمع الإهلاك الافتتاحي يتجاوز المبلغ القابل للإهلاك', 400);
  }

  const barcode =
    p.barcode_value === undefined ? row.barcode_value : text(p.barcode_value, 120);
  if (barcode && barcode !== row.barcode_value) {
    const dup = await txQuery(
      client,
      `SELECT 1 FROM accounts.fixed_assets WHERE barcode_value=$1 AND id<>$2::uuid`,
      [barcode, row.id]
    );
    if (dup.rows[0]) throw new AccountsHttpError('الباركود مستخدم مسبقاً', 409);
  }

  let usefulLife = row.useful_life_months;
  if (p.useful_life_months !== undefined) {
    if (p.useful_life_months === null || p.useful_life_months === '') {
      usefulLife = null;
    } else {
      const n = Number(p.useful_life_months);
      if (!Number.isInteger(n) || n <= 0) {
        throw new AccountsHttpError('العمر الإنتاجي غير صالح', 400);
      }
      usefulLife = n;
    }
  }
  if (row.depreciation_method === 'STRAIGHT_LINE' && !usefulLife) {
    throw new AccountsHttpError('العمر الإنتاجي مطلوب لطريقة القسط الثابت', 400);
  }

  const capitalized = millisToMoney(capMillis);
  const salvage = millisToMoney(salvageMillis);
  const depreciable = millisToMoney(capMillis - salvageMillis);
  const nbv = millisToMoney(capMillis - moneyToMillis(openingAccum));

  const r = await txQuery<FixedAssetRow>(
    client,
    `UPDATE accounts.fixed_assets SET
       name_ar=$2, name_en=$3, description=$4, barcode_value=$5, serial_number=$6,
       acquisition_cost=$7::numeric, additional_costs=$8::numeric, capitalized_cost=$9::numeric,
       salvage_value=$10::numeric, depreciable_amount=$11::numeric, useful_life_months=$12,
       opening_accumulated_depreciation=$13::numeric, accumulated_depreciation=$13::numeric,
       net_book_value=$14::numeric, cost_center_id=$15::uuid, department_id=$16::uuid,
       location_id=$17::uuid, custodian_user_id=$18::uuid, notes=$19,
       updated_by=$20::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : name(p.name_ar),
      p.name_en === undefined ? row.name_en : text(p.name_en, 300),
      p.description === undefined ? row.description : text(p.description, 4000),
      barcode,
      p.serial_number === undefined ? row.serial_number : text(p.serial_number, 120),
      acqCost,
      addlCost,
      capitalized,
      salvage,
      depreciable,
      usefulLife,
      openingAccum,
      nbv,
      p.cost_center_id === undefined ? row.cost_center_id : text(p.cost_center_id, 100),
      p.department_id === undefined ? row.department_id : text(p.department_id, 100),
      p.location_id === undefined ? row.location_id : text(p.location_id, 100),
      p.custodian_user_id === undefined
        ? row.custodian_user_id
        : text(p.custodian_user_id, 100),
      p.notes === undefined ? row.notes : text(p.notes, 4000),
      p.userId,
    ]
  );
  return r.rows[0];
}

/**
 * تفعيل الأصل (DRAFT → ACTIVE). يطبّق سياسة الحد ويُنشئ قيد الاقتناء عند اللزوم.
 * hasOverrideCapability: هل يملك المستخدم صلاحية تجاوز حد الرسملة (يُمرَّر من طبقة API).
 */
export async function activateFixedAsset(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    override_capitalization_threshold?: boolean;
    override_threshold_reason?: unknown;
    hasOverrideCapability?: boolean;
    opening_equity_gl_account_id?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<FixedAssetRow> {
  await acquireAccountingResourceLocks(client, [fixedAssetLock(p.id)]);
  const row = await loadFixedAsset(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تفعيل الأصول في حالة المسودّة فقط', 409);
  }

  const category = await loadAssetCategory(client, row.category_id);
  const capMillis = moneyToMillis(row.capitalized_cost);
  const thresholdMillis = moneyToMillis(normalizeMoneyInput(category.capitalization_threshold));

  let override = false;
  let overrideReason: string | null = null;
  if (capMillis < thresholdMillis) {
    if (!p.override_capitalization_threshold) {
      throw new AccountsHttpError(
        'تكلفة الأصل أقل من حد الرسملة — يلزم تجاوز صريح لتفعيله كأصل ثابت',
        409
      );
    }
    if (!p.hasOverrideCapability) {
      throw new AccountsHttpError('ليس لديك صلاحية تجاوز حد الرسملة', 403);
    }
    overrideReason = text(p.override_threshold_reason, 2000);
    if (!overrideReason) {
      throw new AccountsHttpError('سبب تجاوز حد الرسملة مطلوب', 400);
    }
    override = true;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: row.fiscal_year_id,
    fiscalPeriodId: row.fiscal_period_id,
    entryDate: pgDateOnly(row.acquisition_date),
  });

  let journalId: string | null = row.acquisition_journal_entry_id;

  // قيد الاقتناء (لغير المشتريات فقط)
  if (row.acquisition_type !== 'PURCHASE' && !journalId) {
    const lockGls = [
      glAccountLock(row.asset_gl_account_id),
      glAccountLock(row.accumulated_depreciation_gl_account_id),
    ];
    const openingAccumMillis = moneyToMillis(row.opening_accumulated_depreciation);

    if (row.acquisition_type === 'DONATION') {
      if (row.donation_contra_gl_account_id) {
        await assertDonationRevenueGlAccount(client, row.donation_contra_gl_account_id);
        await acquireAccountingResourceLocks(client, [
          ...lockGls,
          glAccountLock(row.donation_contra_gl_account_id),
        ]);
        const je = await postFixedAssetJournalEntry(client, {
          fiscalYearId: row.fiscal_year_id,
          fiscalPeriodId: row.fiscal_period_id,
          entryDate: pgDateOnly(row.acquisition_date),
          sourceType: 'FIXED_ASSET_ACQUISITION',
          sourceId: row.id,
          referenceNumber: row.asset_number,
          description: `اقتناء أصل موهوب — ${row.asset_number} — ${row.name_ar}`,
          userId: p.userId,
          lines: [
            {
              account_id: row.asset_gl_account_id,
              cost_center_id: row.cost_center_id,
              debit_amount: row.capitalized_cost,
              credit_amount: '0',
              description: `أصل موهوب ${row.asset_number}`,
            },
            {
              account_id: row.donation_contra_gl_account_id,
              cost_center_id: row.cost_center_id,
              debit_amount: '0',
              credit_amount: row.capitalized_cost,
              description: `إيراد تبرع — ${row.asset_number}`,
            },
          ],
        });
        journalId = je.id;
      }
      // إن لم يُحدَّد حساب إيراد التبرع → تبسيط موثّق: لا قيد اقتناء
    } else {
      // MANUAL / OPENING → يتطلب حساب حقوق ملكية افتتاحي
      const equityGlId = text(p.opening_equity_gl_account_id, 100);
      if (!equityGlId) {
        throw new AccountsHttpError(
          'حساب حقوق الملكية الافتتاحي مطلوب لتفعيل أصل يدوي/افتتاحي',
          400
        );
      }
      await assertEquityGlAccount(client, equityGlId);
      await acquireAccountingResourceLocks(client, [...lockGls, glAccountLock(equityGlId)]);

      const lines: Array<{
        account_id: string;
        cost_center_id?: string | null;
        debit_amount: string;
        credit_amount: string;
        description?: string | null;
      }> = [
        {
          account_id: row.asset_gl_account_id,
          cost_center_id: row.cost_center_id,
          debit_amount: row.capitalized_cost,
          credit_amount: '0',
          description: `رصيد افتتاحي لأصل ${row.asset_number}`,
        },
        {
          account_id: equityGlId,
          cost_center_id: row.cost_center_id,
          debit_amount: '0',
          credit_amount: row.capitalized_cost,
          description: `مقابل رصيد افتتاحي — ${row.asset_number}`,
        },
      ];
      if (openingAccumMillis > BigInt(0)) {
        lines.push(
          {
            account_id: equityGlId,
            cost_center_id: row.cost_center_id,
            debit_amount: row.opening_accumulated_depreciation,
            credit_amount: '0',
            description: `مقابل مجمع إهلاك افتتاحي — ${row.asset_number}`,
          },
          {
            account_id: row.accumulated_depreciation_gl_account_id,
            cost_center_id: row.cost_center_id,
            debit_amount: '0',
            credit_amount: row.opening_accumulated_depreciation,
            description: `مجمع إهلاك افتتاحي — ${row.asset_number}`,
          }
        );
      }
      const je = await postFixedAssetJournalEntry(client, {
        fiscalYearId: row.fiscal_year_id,
        fiscalPeriodId: row.fiscal_period_id,
        entryDate: pgDateOnly(row.acquisition_date),
        sourceType: 'FIXED_ASSET_ACQUISITION',
        sourceId: row.id,
        referenceNumber: row.asset_number,
        description: `اقتناء/رصيد افتتاحي لأصل — ${row.asset_number} — ${row.name_ar}`,
        userId: p.userId,
        lines,
      });
      journalId = je.id;
    }
  }

  maybeFault('asset_activate_after_journal');

  const r = await txQuery<FixedAssetRow>(
    client,
    `UPDATE accounts.fixed_assets SET
       status='ACTIVE', acquisition_journal_entry_id=COALESCE($2::uuid, acquisition_journal_entry_id),
       override_capitalization_threshold=$3, override_threshold_reason=$4,
       override_threshold_by=CASE WHEN $3 THEN $5::uuid ELSE override_threshold_by END,
       override_threshold_at=CASE WHEN $3 THEN NOW() ELSE override_threshold_at END,
       activated_at=NOW(), activated_by=$5::uuid,
       updated_by=$5::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, journalId, override, overrideReason, p.userId]
  );

  maybeFault('asset_activate_after_status');

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'fixed_asset.activated',
    entityType: 'fixed_asset',
    entityId: row.id,
    oldValues: { status: 'DRAFT' },
    newValues: { status: 'ACTIVE', acquisition_journal_entry_id: journalId, override },
    description: `تفعيل الأصل ${row.asset_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  if (override) {
    await writeFinancialAudit(client, {
      userId: p.userId,
      action: 'fixed_asset.threshold_overridden',
      entityType: 'fixed_asset',
      entityId: row.id,
      newValues: { reason: overrideReason },
      description: `تجاوز حد الرسملة للأصل ${row.asset_number}`,
      ipAddress: p.ipAddress,
      userAgent: p.userAgent,
    });
  }
  return r.rows[0];
}

export async function suspendFixedAsset(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<FixedAssetRow> {
  await acquireAccountingResourceLocks(client, [fixedAssetLock(p.id)]);
  const row = await loadFixedAsset(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  if (row.status !== 'ACTIVE') {
    throw new AccountsHttpError('يمكن إيقاف الأصول النشطة فقط', 409);
  }
  const r = await txQuery<FixedAssetRow>(
    client,
    `UPDATE accounts.fixed_assets SET status='SUSPENDED', suspended_at=NOW(), suspended_by=$2::uuid,
       notes=COALESCE($3, notes), updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId, text(p.reason, 4000)]
  );
  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'fixed_asset.suspended',
    entityType: 'fixed_asset',
    entityId: row.id,
    oldValues: { status: 'ACTIVE' },
    newValues: { status: 'SUSPENDED' },
    description: `إيقاف الأصل ${row.asset_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function reactivateFixedAsset(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<FixedAssetRow> {
  await acquireAccountingResourceLocks(client, [fixedAssetLock(p.id)]);
  const row = await loadFixedAsset(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  if (row.status !== 'SUSPENDED') {
    throw new AccountsHttpError('يمكن إعادة تفعيل الأصول الموقوفة فقط', 409);
  }
  const r = await txQuery<FixedAssetRow>(
    client,
    `UPDATE accounts.fixed_assets SET status='ACTIVE', suspended_at=NULL, suspended_by=NULL,
       updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId]
  );
  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'fixed_asset.reactivated',
    entityType: 'fixed_asset',
    entityId: row.id,
    oldValues: { status: 'SUSPENDED' },
    newValues: { status: 'ACTIVE' },
    description: `إعادة تفعيل الأصل ${row.asset_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function cancelFixedAsset(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<FixedAssetRow> {
  await acquireAccountingResourceLocks(client, [fixedAssetLock(p.id)]);
  const row = await loadFixedAsset(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن إلغاء الأصول في حالة المسودّة فقط', 409);
  }
  if (row.acquisition_journal_entry_id) {
    throw new AccountsHttpError('لا يمكن إلغاء أصل له قيد اقتناء مرحّل', 409);
  }
  const r = await txQuery<FixedAssetRow>(
    client,
    `UPDATE accounts.fixed_assets SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2::uuid,
       cancellation_reason=$3, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId, text(p.reason, 2000)]
  );
  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'fixed_asset.cancelled',
    entityType: 'fixed_asset',
    entityId: row.id,
    oldValues: { status: 'DRAFT' },
    newValues: { status: 'CANCELLED', reason: text(p.reason, 2000) },
    description: `إلغاء الأصل ${row.asset_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function listFixedAssets(
  client: TxClient,
  p: {
    q?: string;
    status?: string | null;
    category_id?: string | null;
    location_id?: string | null;
    custodian_user_id?: string | null;
    department_id?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: FixedAssetRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const q = (p.q ?? '').trim();
  const values: unknown[] = [
    q,
    p.status ?? null,
    p.category_id ?? null,
    p.location_id ?? null,
    p.custodian_user_id ?? null,
    p.department_id ?? null,
  ];
  const where = `WHERE ($1='' OR asset_number ILIKE '%'||$1||'%' OR name_ar ILIKE '%'||$1||'%'
       OR barcode_value ILIKE '%'||$1||'%' OR serial_number ILIKE '%'||$1||'%')
     AND ($2::text IS NULL OR status=$2)
     AND ($3::uuid IS NULL OR category_id=$3::uuid)
     AND ($4::uuid IS NULL OR location_id=$4::uuid)
     AND ($5::uuid IS NULL OR custodian_user_id=$5::uuid)
     AND ($6::uuid IS NULL OR department_id=$6::uuid)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.fixed_assets ${where}`,
    values
  );
  const r = await txQuery<FixedAssetRow>(
    client,
    `SELECT * FROM accounts.fixed_assets ${where} ORDER BY created_at DESC LIMIT $7 OFFSET $8`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
