/**
 * تكامل المشتريات ↔ الأصول الثابتة (8.A) — رسملة الأصول من سطور فواتير الموردين.
 *
 * الفكرة المحاسبية:
 *  - عند ترحيل فاتورة المورد، سطر الأصل الثابت يُرحَّل Dr حساب الأصل / Cr ذمم دائنة (انظر supplier-invoices.ts).
 *    أي أن الأصل قد دُمّن (capitalized) في دفتر الأستاذ فعلاً عند الترحيل.
 *  - هذه الوحدة تُنشئ سجلات الأصول الثابتة (fixed_assets) المقابلة لتلك السطور كمسودّات (DRAFT).
 *    تفعيل الأصل لاحقاً (activateFixedAsset) لا يُنشئ قيد اقتناء ثانٍ لأنّ acquisition_type='PURCHASE'
 *    (فاتورة المورد سبق أن مدّنت حساب الأصل) — هذا مؤكَّد في fixed-assets.ts (الشرط acquisition_type !== 'PURCHASE').
 *
 * حارس الرسملة المزدوجة (double-capitalization guard):
 *  - لكل سطر فاتورة مورد، الكمية المتاحة للرسملة = الكمية المفوترة − مجموع الكميات المرسملة سابقاً
 *    (asset_capitalization_sources.quantity المرتبطة بنفس supplier_invoice_line_id).
 *  - العملية تأخذ قفلاً استشارياً على مصدر الرسملة (ASSET_CAPITALIZATION_SOURCE) لسطر الفاتورة،
 *    و FOR UPDATE على سطر الفاتورة وعلى صفوف asset_capitalization_sources القائمة، فلا يمكن لعمليتين
 *    متزامنتين تجاوز الكمية المتاحة. قيد UNIQUE(supplier_invoice_line_id, fixed_asset_id) يمنع الربط المزدوج.
 *
 * تقسيم التكلفة (cost split) بدون float:
 *  - إجمالي السطر (line_total) يُقسَّم على إجمالي وحدات السطر (totalUnits) بالميلي:
 *    perUnit = floor(lineTotalMillis / totalUnits)، والباقي (remainder) يُضاف إلى الوحدة الأخيرة للسطر كله.
 *  - بذلك مجموع تكاليف كل الأصول المُنشأة من السطر = line_total تماماً (تسوية دفتر الأصول مع GL).
 *
 * جميع المبالغ بالميلي عبر money helpers، والعملة IQD. الدالة تعمل داخل معاملة يوفّرها المستدعي.
 */
import {
  acquireAccountingResourceLocks,
  assetCapitalizationSourceLock,
  purchaseOrderLineLock,
  purchaseOrderLock,
  supplierInvoiceLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  FIXED_ASSETS_CAPABILITIES,
  assertFixedAssetsCapability,
} from './fixed-assets-access';
import {
  createFixedAsset,
  type FixedAssetRow,
} from './fixed-assets';
import { millisToMoney, moneyToMillis, normalizeMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

/** مرشّح رسملة — سطر فاتورة مورد لأصل ثابت مع الكمية المتبقية. */
export type CapitalizationCandidateRow = {
  supplier_invoice_id: string;
  supplier_invoice_number: string;
  supplier_invoice_line_id: string;
  purchase_order_id: string | null;
  purchase_order_line_id: string | null;
  purchase_receipt_id: string | null;
  purchase_receipt_line_id: string | null;
  asset_category_id: string;
  category_name: string;
  item_description: string;
  quantity: string;
  already_capitalized: string;
  remaining: string;
  unit_cost: string;
  line_total: string;
  supplier_id: string;
  supplier_name: string;
};

export type ListCapitalizationCandidatesFilters = {
  supplier_id?: string | null;
  supplier_invoice_id?: string | null;
  asset_category_id?: string | null;
  purchase_order_id?: string | null;
  page?: number;
  page_size?: number;
};

/**
 * يعيد سطور فواتير الموردين (المرحّلة POSTED) التي تُعدّ أصولاً ثابتة (is_fixed_asset مع تصنيف أصل)
 * والتي لا تزال لها كمية متبقية للرسملة (المفوتر − المرسمل سابقاً > 0).
 */
export async function listCapitalizationCandidates(
  client: TxClient,
  filters: ListCapitalizationCandidatesFilters = {}
): Promise<{
  rows: CapitalizationCandidateRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.page_size ?? 50));
  const offset = (page - 1) * pageSize;

  const values: unknown[] = [
    filters.supplier_id ?? null,
    filters.supplier_invoice_id ?? null,
    filters.asset_category_id ?? null,
    filters.purchase_order_id ?? null,
  ];

  // remaining = sil.quantity − COALESCE(مجموع الكميات المرسملة, 0)
  const baseFrom = `
    FROM accounts.supplier_invoice_lines sil
    JOIN accounts.supplier_invoices si ON si.id = sil.supplier_invoice_id
    JOIN accounts.suppliers s ON s.id = si.supplier_id
    JOIN accounts.asset_categories ac ON ac.id = sil.asset_category_id
    LEFT JOIN accounts.purchase_receipt_lines prl ON prl.id = sil.purchase_receipt_line_id
    LEFT JOIN accounts.purchase_receipts pr ON pr.id = prl.receipt_id
    LEFT JOIN (
      SELECT supplier_invoice_line_id, COALESCE(SUM(quantity), 0) AS capitalized_qty
      FROM accounts.asset_capitalization_sources
      WHERE supplier_invoice_line_id IS NOT NULL
      GROUP BY supplier_invoice_line_id
    ) cap ON cap.supplier_invoice_line_id = sil.id
    WHERE si.status = 'POSTED'
      AND sil.is_fixed_asset = TRUE
      AND sil.asset_category_id IS NOT NULL
      AND (sil.quantity - COALESCE(cap.capitalized_qty, 0)) > 0
      AND ($1::uuid IS NULL OR si.supplier_id = $1::uuid)
      AND ($2::uuid IS NULL OR si.id = $2::uuid)
      AND ($3::uuid IS NULL OR sil.asset_category_id = $3::uuid)
      AND ($4::uuid IS NULL OR si.purchase_order_id = $4::uuid)`;

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total ${baseFrom}`,
    values
  );

  const list = await txQuery<CapitalizationCandidateRow>(
    client,
    `SELECT
       si.id AS supplier_invoice_id,
       si.supplier_invoice_number,
       sil.id AS supplier_invoice_line_id,
       si.purchase_order_id,
       sil.purchase_order_line_id,
       pr.id AS purchase_receipt_id,
       sil.purchase_receipt_line_id,
       sil.asset_category_id,
       ac.name_ar AS category_name,
       sil.description AS item_description,
       sil.quantity::text AS quantity,
       COALESCE(cap.capitalized_qty, 0)::text AS already_capitalized,
       (sil.quantity - COALESCE(cap.capitalized_qty, 0))::text AS remaining,
       sil.unit_price::text AS unit_cost,
       sil.line_total::text AS line_total,
       si.supplier_id,
       s.name_ar AS supplier_name
     ${baseFrom}
     ORDER BY si.invoice_date DESC, si.created_at DESC, sil.line_number
     LIMIT $5 OFFSET $6`,
    [...values, pageSize, offset]
  );

  return {
    rows: list.rows.map((r) => ({
      ...r,
      quantity: normalizeMoneyInput(r.quantity),
      already_capitalized: normalizeMoneyInput(r.already_capitalized),
      remaining: normalizeMoneyInput(r.remaining),
      unit_cost: normalizeMoneyInput(r.unit_cost),
      line_total: normalizeMoneyInput(r.line_total),
    })),
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}

export type CreateAssetsFromPurchasingInput = {
  supplier_invoice_line_id: unknown;
  /** عدد وحدات الأصول المطلوب إنشاؤها (افتراضياً كل الكمية المتبقية). */
  quantity?: unknown;
  /** تصنيف بديل اختياري (افتراضياً تصنيف السطر). */
  category_id?: unknown;
  name_ar?: unknown;
  location_id?: unknown;
  custodian_user_id?: unknown;
  department_id?: unknown;
  available_for_use_date?: unknown;
  useful_life_months?: unknown;
  created_by: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
};

type InvoiceLineJoin = {
  supplier_invoice_id: string;
  purchase_order_id: string | null;
  purchase_order_line_id: string | null;
  purchase_receipt_line_id: string | null;
  purchase_receipt_id: string | null;
  asset_category_id: string | null;
  is_fixed_asset: boolean;
  quantity: string;
  unit_price: string;
  line_total: string;
  description: string;
  invoice_status: string;
  supplier_id: string | null;
  fiscal_year_id: string;
  fiscal_period_id: string;
  invoice_date: string;
  supplier_invoice_number: string;
};

function positiveIntUnits(value: string, label: string): number {
  // الكمية مخزَّنة كـ NUMERIC(…,3)؛ وحدات الأصول يجب أن تكون أعداداً صحيحة.
  const millis = moneyToMillis(normalizeMoneyInput(value));
  if (millis % BigInt(1000) !== BigInt(0)) {
    throw new AccountsHttpError(`${label} يجب أن تكون عدداً صحيحاً من الوحدات`, 400);
  }
  return Number(millis / BigInt(1000));
}

/**
 * ينشئ أصولاً ثابتة (DRAFT) من سطر فاتورة مورد مرحّلة.
 * راجع رأس الملف لشرح حارس الرسملة المزدوجة وتقسيم التكلفة.
 */
export async function createAssetsFromPurchasing(
  client: TxClient,
  input: CreateAssetsFromPurchasingInput
): Promise<{ assets: FixedAssetRow[]; count: number }> {
  // 1) صلاحية الرسملة (تأكيد دفاعي — طبقة الـ API تؤكد أيضاً).
  await assertFixedAssetsCapability(
    client,
    input.userId,
    FIXED_ASSETS_CAPABILITIES.ASSET_CAPITALIZE
  );

  const lineId = String(input.supplier_invoice_line_id ?? '').trim();
  if (!lineId) throw new AccountsHttpError('معرّف سطر فاتورة المورد مطلوب', 400);

  // 2) قراءة أولية (بدون قفل) لجمع مفاتيح الأقفال.
  const peek = await txQuery<InvoiceLineJoin>(
    client,
    `SELECT
       sil.supplier_invoice_id,
       si.purchase_order_id,
       sil.purchase_order_line_id,
       sil.purchase_receipt_line_id,
       pr.id AS purchase_receipt_id,
       sil.asset_category_id,
       sil.is_fixed_asset,
       sil.quantity::text AS quantity,
       sil.unit_price::text AS unit_price,
       sil.line_total::text AS line_total,
       sil.description,
       si.status AS invoice_status,
       si.supplier_id,
       si.fiscal_year_id,
       si.fiscal_period_id,
       si.invoice_date::text AS invoice_date,
       si.supplier_invoice_number
     FROM accounts.supplier_invoice_lines sil
     JOIN accounts.supplier_invoices si ON si.id = sil.supplier_invoice_id
     LEFT JOIN accounts.purchase_receipt_lines prl ON prl.id = sil.purchase_receipt_line_id
     LEFT JOIN accounts.purchase_receipts pr ON pr.id = prl.receipt_id
     WHERE sil.id = $1::uuid`,
    [lineId]
  );
  const line = peek.rows[0];
  if (!line) throw new AccountsHttpError('سطر فاتورة المورد غير موجود', 404);

  // 3) قفل صف الفاتورة (FOR UPDATE) أولاً — قبل الأقفال الاستشارية — لمطابقة ترتيب الأقفال في
  //    voidSupplierInvoice (صف الفاتورة ثم الأقفال الاستشارية) وتجنّب انعكاس الترتيب/الـ deadlock.
  //    نعيد قراءة الحالة الحالية للفاتورة (منع سباق TOCTOU مع VOID متزامن).
  const invLock = await txQuery<{ status: string }>(
    client,
    `SELECT status FROM accounts.supplier_invoices WHERE id = $1::uuid FOR UPDATE`,
    [line.supplier_invoice_id]
  );
  const freshInvoiceStatus = invLock.rows[0]?.status ?? line.invoice_status;

  // 4) أقفال استشارية: مصدر الرسملة (سطر الفاتورة) + الفاتورة + أمر/سطر الشراء.
  await acquireAccountingResourceLocks(client, [
    assetCapitalizationSourceLock(lineId),
    supplierInvoiceLock(line.supplier_invoice_id),
    ...(line.purchase_order_id ? [purchaseOrderLock(line.purchase_order_id)] : []),
    ...(line.purchase_order_line_id
      ? [purchaseOrderLineLock(line.purchase_order_line_id)]
      : []),
  ]);

  // 5) FOR UPDATE على سطر الفاتورة وعلى صفوف مصادر الرسملة القائمة (منع تجاوز الكمية).
  await txQuery(
    client,
    `SELECT id FROM accounts.supplier_invoice_lines WHERE id = $1::uuid FOR UPDATE`,
    [lineId]
  );
  const existing = await txQuery<{ quantity: string }>(
    client,
    `SELECT quantity::text AS quantity
     FROM accounts.asset_capitalization_sources
     WHERE supplier_invoice_line_id = $1::uuid
     FOR UPDATE`,
    [lineId]
  );

  // 6) التحقق: الفاتورة مرحّلة (بالحالة الحالية بعد القفل)، والسطر سطر أصل ثابت مع تصنيف.
  if (freshInvoiceStatus !== 'POSTED') {
    throw new AccountsHttpError(
      'لا يمكن رسملة أصل إلا من فاتورة مورد مرحّلة (POSTED)',
      409
    );
  }
  if (!line.is_fixed_asset || !line.asset_category_id) {
    throw new AccountsHttpError(
      'هذا السطر ليس سطر أصل ثابت أو يفتقر إلى تصنيف الأصل',
      400
    );
  }

  // 7) حساب المتبقي بالوحدات الصحيحة.
  const totalUnits = positiveIntUnits(line.quantity, 'الكمية المفوترة');
  if (totalUnits <= 0) {
    throw new AccountsHttpError('الكمية المفوترة للسطر غير صالحة للرسملة', 400);
  }
  let alreadyMillis = BigInt(0);
  for (const e of existing.rows) {
    alreadyMillis += moneyToMillis(normalizeMoneyInput(e.quantity));
  }
  const alreadyUnits = Number(alreadyMillis / BigInt(1000));
  const remainingUnits = totalUnits - alreadyUnits;
  if (remainingUnits <= 0) {
    throw new AccountsHttpError('لا توجد كمية متبقية للرسملة في هذا السطر', 409);
  }

  let requestedUnits: number;
  if (input.quantity == null || input.quantity === '') {
    requestedUnits = remainingUnits;
  } else {
    const n = Number(input.quantity);
    if (!Number.isInteger(n) || n <= 0) {
      throw new AccountsHttpError('عدد وحدات الأصول يجب أن يكون عدداً صحيحاً موجباً', 400);
    }
    requestedUnits = n;
  }
  if (requestedUnits > remainingUnits) {
    throw new AccountsHttpError(
      `عدد الوحدات المطلوب (${requestedUnits}) يتجاوز المتبقي للرسملة (${remainingUnits})`,
      409
    );
  }

  // 8) تقسيم التكلفة بالميلي: perUnit = floor(line_total / totalUnits)، والباقي للوحدة الأخيرة للسطر كله.
  const lineTotalMillis = moneyToMillis(normalizeMoneyInput(line.line_total));
  const perUnitMillis = lineTotalMillis / BigInt(totalUnits);
  const remainderMillis = lineTotalMillis - perUnitMillis * BigInt(totalUnits);

  const categoryId =
    input.category_id != null && String(input.category_id).trim()
      ? String(input.category_id).trim()
      : line.asset_category_id;
  const baseName =
    input.name_ar != null && String(input.name_ar).trim()
      ? String(input.name_ar).trim()
      : line.description;
  const availableDate =
    input.available_for_use_date != null && input.available_for_use_date !== ''
      ? String(input.available_for_use_date).trim()
      : undefined;

  const createdAssets: FixedAssetRow[] = [];

  // الوحدات المُنشأة تأخذ الفهارس العالمية [alreadyUnits, alreadyUnits + requestedUnits).
  for (let k = 0; k < requestedUnits; k++) {
    const globalIndex = alreadyUnits + k; // فهرس الوحدة ضمن السطر كله (0-based)
    const isLastUnitOfLine = globalIndex === totalUnits - 1;
    const unitMillis = perUnitMillis + (isLastUnitOfLine ? remainderMillis : BigInt(0));
    const unitCost = millisToMoney(unitMillis);

    const nameAr =
      totalUnits > 1 ? `${baseName} (${globalIndex + 1}/${totalUnits})` : baseName;

    const asset = await createFixedAsset(client, {
      category_id: categoryId,
      name_ar: nameAr,
      acquisition_type: 'PURCHASE',
      acquisition_date: line.invoice_date,
      available_for_use_date: availableDate,
      acquisition_cost: unitCost,
      additional_costs: '0',
      useful_life_months: input.useful_life_months,
      department_id: input.department_id,
      location_id: input.location_id,
      custodian_user_id: input.custodian_user_id,
      supplier_id: line.supplier_id,
      purchase_order_id: line.purchase_order_id,
      purchase_order_line_id: line.purchase_order_line_id,
      fiscal_year_id: line.fiscal_year_id,
      fiscal_period_id: line.fiscal_period_id,
      created_by: input.created_by,
    });

    // صف مصدر الرسملة (quantity=1) — قيد UNIQUE يمنع الربط المزدوج لنفس السطر بنفس الأصل.
    await txQuery(
      client,
      `INSERT INTO accounts.asset_capitalization_sources (
         fixed_asset_id, purchase_order_id, purchase_order_line_id,
         purchase_receipt_id, purchase_receipt_line_id,
         supplier_invoice_id, supplier_invoice_line_id,
         quantity, unit_cost, total_cost, created_by
       ) VALUES (
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
         1,$8::numeric,$8::numeric,$9::uuid
       )`,
      [
        asset.id,
        line.purchase_order_id,
        line.purchase_order_line_id,
        line.purchase_receipt_id,
        line.purchase_receipt_line_id,
        line.supplier_invoice_id,
        lineId,
        unitCost,
        input.created_by,
      ]
    );

    createdAssets.push(asset);
  }

  // 9) تحديث capitalized_quantity على سطر أمر الشراء (مع حارس عدم تجاوز الكمية المفوترة).
  if (line.purchase_order_line_id) {
    const poLine = await txQuery<{
      invoiced_quantity: string;
      capitalized_quantity: string;
    }>(
      client,
      `SELECT invoiced_quantity::text AS invoiced_quantity,
              capitalized_quantity::text AS capitalized_quantity
       FROM accounts.purchase_order_lines
       WHERE id = $1::uuid
       FOR UPDATE`,
      [line.purchase_order_line_id]
    );
    if (poLine.rows[0]) {
      const invoicedMillis = moneyToMillis(
        normalizeMoneyInput(poLine.rows[0].invoiced_quantity)
      );
      const currentCapMillis = moneyToMillis(
        normalizeMoneyInput(poLine.rows[0].capitalized_quantity)
      );
      const addMillis = BigInt(requestedUnits) * BigInt(1000);
      const newCapMillis = currentCapMillis + addMillis;
      if (newCapMillis > invoicedMillis) {
        throw new AccountsHttpError(
          'الكمية المرسملة تتجاوز الكمية المفوترة في سطر أمر الشراء',
          409
        );
      }
      await txQuery(
        client,
        `UPDATE accounts.purchase_order_lines
         SET capitalized_quantity = $2::numeric, updated_at = NOW()
         WHERE id = $1::uuid`,
        [line.purchase_order_line_id, millisToMoney(newCapMillis)]
      );
    }
  }

  // 10) تدقيق واحد لمجموعة الأصول المُنشأة.
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'fixed_asset.capitalized_from_purchasing',
    entityType: 'supplier_invoice_line',
    entityId: lineId,
    newValues: {
      supplier_invoice_id: line.supplier_invoice_id,
      supplier_invoice_number: line.supplier_invoice_number,
      purchase_order_id: line.purchase_order_id,
      purchase_order_line_id: line.purchase_order_line_id,
      asset_category_id: categoryId,
      units_created: requestedUnits,
      line_total: normalizeMoneyInput(line.line_total),
      assets: createdAssets.map((a) => ({
        id: a.id,
        asset_number: a.asset_number,
        capitalized_cost: a.capitalized_cost,
      })),
    },
    description: `رسملة ${requestedUnits} أصل/أصول من سطر فاتورة المورد ${line.supplier_invoice_number}`,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { assets: createdAssets, count: createdAssets.length };
}
