/**
 * بيانات عرض الأصول الثابتة 8.A — DEMO فقط، idempotent (تشغيل مرتين بلا تكرار).
 *
 * الاستخدام:
 *  - يُوصَل من seed-accounts-demo.ts عبر: await seedFixedAssetsDemo({ userId, entryDate, ensureAccount })
 *  - أو مباشرة: npx tsx src/scripts/seed-accounts-fixed-assets-demo.ts
 *
 * الثبات (idempotency):
 *  - التصنيفات/المواقع محروسة بالرمز (code) — تُنشأ مرة واحدة.
 *  - الأصول والسيناريوهات محروسة بعلامة ثابتة في حقل notes ('DEMO-FA:<key>') — كل سيناريو
 *    يُنشأ في معاملة واحدة ذرية، فإن وُجِدت علامته تُتخطّى الكتلة بالكامل.
 */
import { query } from '../lib/db';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  createAssetCategory,
  loadAssetCategory,
  type AssetCategoryRow,
} from '../lib/accounts/asset-categories';
import { createAssetLocation } from '../lib/accounts/asset-locations';
import {
  activateFixedAsset,
  createFixedAsset,
  suspendFixedAsset,
} from '../lib/accounts/fixed-assets';
import {
  createDepreciationRun,
  postDepreciationRun,
  voidDepreciationRun,
} from '../lib/accounts/asset-depreciation';
import {
  createAssetDisposal,
  postAssetDisposal,
  voidAssetDisposal,
} from '../lib/accounts/asset-disposals';
import { withTransaction } from '../lib/accounts/with-transaction';
import { closePool } from '../lib/db';

export type SeedFixedAssetsParams = {
  userId: string;
  entryDate: string;
  ensureAccount: (x: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
};

const CAT = {
  computers: 'DEMO-FA-COMPUTERS',
  lab: 'DEMO-FA-LAB',
  furniture: 'DEMO-FA-FURNITURE',
  electrical: 'DEMO-FA-ELECTRICAL',
  vehicles: 'DEMO-FA-VEHICLES',
} as const;

/** ينشئ/يحدّث حساب GL بنوعٍ ورصيدٍ طبيعي محددين (يخدم مجمع الإهلاك: ASSET برصيد CREDIT). */
async function ensureGlWithBalance(
  code: string,
  nameAr: string,
  typeCode: string,
  userId: string,
  normalBalance: 'DEBIT' | 'CREDIT'
): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE accounts.chart_of_accounts
       SET normal_balance=$2, is_group=FALSE, allow_posting=TRUE, is_active=TRUE
       WHERE id=$1`,
      [existing.rows[0].id, normalBalance]
    );
    return existing.rows[0].id as string;
  }
  const type = await query(
    `SELECT id FROM accounts.account_types WHERE code=$1`,
    [typeCode]
  );
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'DEMO 8.A')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, normalBalance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureAssetSequences(fiscalYearId: string): Promise<void> {
  const defs: Array<[string, string]> = [
    ['FIXED_ASSET', 'AST'],
    ['ASSET_MOVEMENT', 'AMV'],
    ['DEPRECIATION_RUN', 'DPR'],
    ['ASSET_DISPOSAL', 'ADS'],
  ];
  for (const [documentType, prefix] of defs) {
    await query(
      `INSERT INTO accounts.document_sequences
        (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
       SELECT $1::varchar, $2::uuid, $3::varchar, 0, 6, TRUE, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts.document_sequences ds
         WHERE ds.document_type=$1::varchar AND ds.fiscal_year_id=$2::uuid
       )`,
      [documentType, fiscalYearId, prefix]
    );
  }
}

async function ensureCategory(
  code: string,
  nameAr: string,
  gl: { asset: string; accum: string; expense: string; gain: string; loss: string },
  opts: {
    useful_life_months?: number | null;
    depreciation_method?: 'STRAIGHT_LINE' | 'NONE';
    capitalization_threshold?: string;
    userId: string;
  }
): Promise<AssetCategoryRow> {
  const existing = await query(
    `SELECT id FROM accounts.asset_categories WHERE UPPER(code)=UPPER($1)`,
    [code]
  );
  if (existing.rows[0]) {
    return withTransaction((c) => loadAssetCategory(c, existing.rows[0].id as string));
  }
  return withTransaction((c) =>
    createAssetCategory(c, {
      code,
      name_ar: nameAr,
      asset_gl_account_id: gl.asset,
      accumulated_depreciation_gl_account_id: gl.accum,
      depreciation_expense_gl_account_id: gl.expense,
      gain_gl_account_id: gl.gain,
      loss_gl_account_id: gl.loss,
      depreciation_method: opts.depreciation_method ?? 'STRAIGHT_LINE',
      useful_life_months:
        opts.useful_life_months === undefined ? 36 : opts.useful_life_months,
      capitalization_threshold: opts.capitalization_threshold ?? '100',
      created_by: opts.userId,
    })
  );
}

async function ensureLocation(
  code: string,
  nameAr: string,
  locationType: string,
  parentId: string | null,
  userId: string
): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.asset_locations WHERE UPPER(code)=UPPER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const row = await withTransaction((c) =>
    createAssetLocation(c, {
      code,
      name_ar: nameAr,
      location_type: locationType,
      parent_location_id: parentId,
      created_by: userId,
    })
  );
  return row.id;
}

async function markerExists(marker: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM accounts.fixed_assets WHERE notes=$1 LIMIT 1`,
    [marker]
  );
  return Boolean(r.rows[0]);
}

export async function seedFixedAssetsDemo(p: SeedFixedAssetsParams): Promise<void> {
  const entryDate = pgDateOnly(p.entryDate);

  // السياق المالي: فترة مفتوحة تغطّي التاريخ
  const ctxRow = await query(
    `SELECT p.fiscal_year_id, p.id AS period_id
     FROM accounts.fiscal_periods p
     JOIN accounts.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE p.status='OPEN' AND p.start_date <= $1::date AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date DESC LIMIT 1`,
    [entryDate]
  );
  if (!ctxRow.rows[0]) {
    console.log('⚠ تخطّي 8.A DEMO: لا توجد فترة مالية مفتوحة تغطّي التاريخ — شغّل seed:accounts-demo أولاً');
    return;
  }
  const fiscalYearId = ctxRow.rows[0].fiscal_year_id as string;
  const fiscalPeriodId = ctxRow.rows[0].period_id as string;
  await ensureAssetSequences(fiscalYearId);

  // حسابات GL (إعادة الاستخدام إن وُجدت، وإلا إنشاء أدنى الحسابات)
  const assetGl = (await p.ensureAccount({ code: 'DEMO-FA-ASSET', nameAr: 'أصول ثابتة DEMO', typeCode: 'ASSET', userId: p.userId })).id;
  const expenseGl = (await p.ensureAccount({ code: 'DEMO-FA-DEP-EXP', nameAr: 'مصروف إهلاك DEMO', typeCode: 'EXPENSE', userId: p.userId })).id;
  const gainGl = (await p.ensureAccount({ code: 'DEMO-FA-GAIN', nameAr: 'أرباح بيع أصول DEMO', typeCode: 'REVENUE', userId: p.userId })).id;
  const lossGl = (await p.ensureAccount({ code: 'DEMO-FA-LOSS', nameAr: 'خسائر استبعاد أصول DEMO', typeCode: 'EXPENSE', userId: p.userId })).id;
  const equityGl = (await p.ensureAccount({ code: 'DEMO-FA-EQUITY', nameAr: 'حقوق ملكية افتتاحية DEMO', typeCode: 'EQUITY', userId: p.userId })).id;
  const cashGl = (await p.ensureAccount({ code: 'DEMO-FA-CASH', nameAr: 'نقدية استبعاد DEMO', typeCode: 'ASSET', userId: p.userId })).id;
  const bankGl = (await p.ensureAccount({ code: 'DEMO-FA-BANK', nameAr: 'بنك استبعاد DEMO', typeCode: 'ASSET', userId: p.userId })).id;
  // مجمع الإهلاك: ASSET برصيد طبيعي دائن (عرض معاكس contra-asset)
  const accumGl = await ensureGlWithBalance('DEMO-FA-ACCUM-DEP', 'مجمع إهلاك DEMO', 'ASSET', p.userId, 'CREDIT');

  const gl = { asset: assetGl, accum: accumGl, expense: expenseGl, gain: gainGl, loss: lossGl };

  // ── التصنيفات الخمسة ───────────────────────────────────────────────
  const computers = await ensureCategory(CAT.computers, 'حواسيب DEMO', gl, { useful_life_months: 36, userId: p.userId });
  const lab = await ensureCategory(CAT.lab, 'أجهزة مختبر DEMO', gl, { useful_life_months: 60, userId: p.userId });
  const furniture = await ensureCategory(CAT.furniture, 'أثاث DEMO', gl, { useful_life_months: 120, userId: p.userId });
  const electrical = await ensureCategory(CAT.electrical, 'أجهزة كهربائية DEMO', gl, { useful_life_months: 48, capitalization_threshold: '1000', userId: p.userId });
  const vehicles = await ensureCategory(CAT.vehicles, 'مركبات DEMO', gl, { useful_life_months: 84, userId: p.userId });

  // ── المواقع (هرمية: مبنى → طابق → غرفة/مختبر/مكتب/مستودع) ──────────
  const building = await ensureLocation('DEMO-LOC-BLD', 'المبنى الرئيسي DEMO', 'BUILDING', null, p.userId);
  const floor = await ensureLocation('DEMO-LOC-FLR1', 'الطابق الأول DEMO', 'FLOOR', building, p.userId);
  const room = await ensureLocation('DEMO-LOC-ROOM1', 'غرفة 101 DEMO', 'ROOM', floor, p.userId);
  const labLoc = await ensureLocation('DEMO-LOC-LAB1', 'مختبر الحاسوب DEMO', 'LAB', floor, p.userId);
  const office = await ensureLocation('DEMO-LOC-OFF1', 'مكتب الإدارة DEMO', 'OFFICE', floor, p.userId);
  await ensureLocation('DEMO-LOC-WH1', 'مستودع DEMO', 'WAREHOUSE', building, p.userId);

  const baseAsset = (categoryId: string, marker: string, over: Record<string, unknown> = {}) => ({
    category_id: categoryId,
    name_ar: `أصل عرض ${marker}`,
    acquisition_type: 'MANUAL',
    acquisition_date: entryDate,
    available_for_use_date: entryDate,
    acquisition_cost: '3600',
    additional_costs: '0',
    salvage_value: '0',
    useful_life_months: 36,
    fiscal_year_id: fiscalYearId,
    fiscal_period_id: fiscalPeriodId,
    notes: marker,
    created_by: p.userId,
    ...over,
  });

  // ── أصل DRAFT (حواسيب) ────────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:draft'))) {
    await withTransaction((c) =>
      createFixedAsset(c, baseAsset(computers.id, 'DEMO-FA:draft', { location_id: room }))
    );
  }

  // ── أصل ACTIVE (حواسيب) ───────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:active'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(computers.id, 'DEMO-FA:active', {
        location_id: labLoc,
        custodian_user_id: p.userId,
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
    });
  }

  // ── أصل SUSPENDED (مختبر) ─────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:suspended'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(lab.id, 'DEMO-FA:suspended', {
        useful_life_months: 60, location_id: labLoc, custodian_user_id: p.userId,
      }));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      await suspendFixedAsset(c, {
        id: active.id, userId: p.userId, version: active.version, updated_at: active.updated_at,
        reason: 'إيقاف مؤقت DEMO',
      });
    });
  }

  // ── أصل افتتاحي بمجمع إهلاك (أثاث) ─────────────────────────────────
  if (!(await markerExists('DEMO-FA:opening'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(furniture.id, 'DEMO-FA:opening', {
        acquisition_type: 'OPENING',
        useful_life_months: 120,
        acquisition_cost: '12000',
        opening_accumulated_depreciation: '3000',
        location_id: office,
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
    });
  }

  // ── أصل منخفض القيمة بتجاوز حد الرسملة (كهربائية) ──────────────────
  if (!(await markerExists('DEMO-FA:lowvalue'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(electrical.id, 'DEMO-FA:lowvalue', {
        useful_life_months: 48,
        acquisition_cost: '500', // أقل من حد 1000
        location_id: room,
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
        override_capitalization_threshold: true,
        override_threshold_reason: 'أصل استراتيجي منخفض القيمة DEMO',
        hasOverrideCapability: true,
      });
    });
  }

  // ── دورة إهلاك DRAFT (تصنيف مخصص لعزل الدورة) ─────────────────────
  const depDraftCat = await ensureCategory('DEMO-FA-DEP-DRAFT', 'تصنيف إهلاك مسودّة DEMO', gl, { useful_life_months: 12, userId: p.userId });
  if (!(await markerExists('DEMO-FA:dep-draft'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(depDraftCat.id, 'DEMO-FA:dep-draft', {
        useful_life_months: 12, acquisition_cost: '1200',
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      await createDepreciationRun(c, { fiscal_period_id: fiscalPeriodId, category_id: depDraftCat.id, created_by: p.userId });
    });
  }

  // ── دورة إهلاك POSTED ─────────────────────────────────────────────
  const depPostedCat = await ensureCategory('DEMO-FA-DEP-POSTED', 'تصنيف إهلاك مرحّل DEMO', gl, { useful_life_months: 12, userId: p.userId });
  if (!(await markerExists('DEMO-FA:dep-posted'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(depPostedCat.id, 'DEMO-FA:dep-posted', {
        useful_life_months: 12, acquisition_cost: '1200',
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const run = await createDepreciationRun(c, { fiscal_period_id: fiscalPeriodId, category_id: depPostedCat.id, created_by: p.userId });
      await postDepreciationRun(c, { id: run.run.id, userId: p.userId, version: run.run.version, updated_at: run.run.updated_at });
    });
  }

  // ── دورة إهلاك VOID ───────────────────────────────────────────────
  const depVoidCat = await ensureCategory('DEMO-FA-DEP-VOID', 'تصنيف إهلاك مُبطَل DEMO', gl, { useful_life_months: 12, userId: p.userId });
  if (!(await markerExists('DEMO-FA:dep-void'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(depVoidCat.id, 'DEMO-FA:dep-void', {
        useful_life_months: 12, acquisition_cost: '1200',
      }));
      await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const run = await createDepreciationRun(c, { fiscal_period_id: fiscalPeriodId, category_id: depVoidCat.id, created_by: p.userId });
      const posted = await postDepreciationRun(c, { id: run.run.id, userId: p.userId, version: run.run.version, updated_at: run.run.updated_at });
      await voidDepreciationRun(c, { id: posted.id, userId: p.userId, version: posted.version, updated_at: posted.updated_at, reason: 'إبطال عرض DEMO' });
    });
  }

  // أصول الاستبعاد: تصنيف بطريقة NONE لتثبيت القيمة الدفترية
  const disposalCat = await ensureCategory('DEMO-FA-DISPOSAL', 'تصنيف استبعاد DEMO', gl, { depreciation_method: 'NONE', useful_life_months: null, userId: p.userId });
  const disposalAsset = (marker: string, cost: string) => baseAsset(disposalCat.id, marker, {
    depreciation_method: undefined, useful_life_months: null, acquisition_cost: cost, location_id: office, custodian_user_id: p.userId,
  });

  // ── استبعاد بيع نقدي ──────────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:sale-cash'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, disposalAsset('DEMO-FA:sale-cash', '2000'));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const d = await createAssetDisposal(c, {
        fixed_asset_id: active.id, disposal_date: entryDate, disposal_type: 'SALE', proceeds_amount: '2200',
        proceeds_gl_account_id: cashGl, buyer_name: 'مشترٍ DEMO', created_by: p.userId,
      });
      await postAssetDisposal(c, { id: d.id, userId: p.userId, version: d.version, updated_at: d.updated_at });
    });
  }

  // ── استبعاد بيع بنكي ──────────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:sale-bank'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, disposalAsset('DEMO-FA:sale-bank', '2000'));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const d = await createAssetDisposal(c, {
        fixed_asset_id: active.id, disposal_date: entryDate, disposal_type: 'SALE', proceeds_amount: '1800',
        proceeds_gl_account_id: bankGl, buyer_name: 'مشترٍ بنكي DEMO', created_by: p.userId,
      });
      await postAssetDisposal(c, { id: d.id, userId: p.userId, version: d.version, updated_at: d.updated_at });
    });
  }

  // ── استبعاد إتلاف (SCRAP) ─────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:scrap'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, disposalAsset('DEMO-FA:scrap', '900'));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const d = await createAssetDisposal(c, {
        fixed_asset_id: active.id, disposal_date: entryDate, disposal_type: 'SCRAP', reason: 'تلف كامل DEMO', created_by: p.userId,
      });
      await postAssetDisposal(c, { id: d.id, userId: p.userId, version: d.version, updated_at: d.updated_at });
    });
  }

  // ── استبعاد مُبطَل (VOID) ──────────────────────────────────────────
  if (!(await markerExists('DEMO-FA:disposal-void'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, disposalAsset('DEMO-FA:disposal-void', '1500'));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const d = await createAssetDisposal(c, {
        fixed_asset_id: active.id, disposal_date: entryDate, disposal_type: 'SALE', proceeds_amount: '1500',
        proceeds_gl_account_id: cashGl, created_by: p.userId,
      });
      const posted = await postAssetDisposal(c, { id: d.id, userId: p.userId, version: d.version, updated_at: d.updated_at });
      await voidAssetDisposal(c, { id: posted.id, userId: p.userId, version: posted.version, updated_at: posted.updated_at, reason: 'تراجع عرض DEMO' });
    });
  }

  // مركبة مباعة (تصنيف vehicles) — لعرض حالة DISPOSED ضمن تصنيف مسمّى
  if (!(await markerExists('DEMO-FA:vehicle-sold'))) {
    await withTransaction(async (c) => {
      const a = await createFixedAsset(c, baseAsset(vehicles.id, 'DEMO-FA:vehicle-sold', {
        depreciation_method: undefined, useful_life_months: 84, acquisition_cost: '50000',
        location_id: building, custodian_user_id: p.userId,
      }));
      const active = await activateFixedAsset(c, {
        id: a.id, userId: p.userId, version: a.version, updated_at: a.updated_at,
        opening_equity_gl_account_id: equityGl,
      });
      const d = await createAssetDisposal(c, {
        fixed_asset_id: active.id, disposal_date: entryDate, disposal_type: 'SALE', proceeds_amount: '52000',
        proceeds_gl_account_id: bankGl, buyer_name: 'معرض سيارات DEMO', created_by: p.userId,
      });
      await postAssetDisposal(c, { id: d.id, userId: p.userId, version: d.version, updated_at: d.updated_at });
    });
  }

  // ── طباعة روابط العرض ──────────────────────────────────────────────
  const assets = await query(
    `SELECT id, asset_number, name_ar, status FROM accounts.fixed_assets
     WHERE notes LIKE 'DEMO-FA:%' ORDER BY notes`
  );
  console.log('✓ بيانات الأصول الثابتة DEMO 8.A جاهزة');
  console.log('  - القائمة: /accounts/fixed-assets');
  for (const row of assets.rows) {
    console.log(`  - ${row.name_ar} (${row.asset_number}, ${row.status}) → /accounts/fixed-assets/assets/${row.id}`);
  }
}

// ── تشغيل مباشر عبر tsx (بدون التأثير عند الاستيراد من الاختبارات/الأب) ──
const invokedDirectly = /seed-accounts-fixed-assets-demo\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  (async () => {
    const user = await query(
      `SELECT u.id FROM student_affairs.users u
       JOIN student_affairs.user_systems us ON us.user_id=u.id
       JOIN student_affairs.systems s ON s.id=us.system_id
       WHERE s.code='ACCOUNTS' AND u.is_active
       ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
    );
    if (!user.rows[0]) {
      console.error('لا يوجد مستخدم ACCOUNTS فعّال — شغّل seed:accounts أولاً');
      process.exitCode = 1;
      return;
    }
    const userId = user.rows[0].id as string;
    const period = await query(
      `SELECT p.start_date::text AS start_date
       FROM accounts.fiscal_periods p
       JOIN accounts.fiscal_years y ON y.id=p.fiscal_year_id
       WHERE p.status='OPEN' ORDER BY y.is_default DESC, p.start_date LIMIT 1`
    );
    if (!period.rows[0]) {
      console.error('لا توجد فترة مالية مفتوحة — شغّل seed:accounts-demo أولاً');
      process.exitCode = 1;
      return;
    }
    const entryDate = pgDateOnly(period.rows[0].start_date as string);
    const ensureAccount = async (x: { code: string; nameAr: string; typeCode: string; userId: string }) => {
      const normal = x.typeCode === 'REVENUE' || x.typeCode === 'LIABILITY' || x.typeCode === 'EQUITY' ? 'CREDIT' : 'DEBIT';
      return { id: await ensureGlWithBalance(x.code, x.nameAr, x.typeCode, x.userId, normal) };
    };
    await seedFixedAssetsDemo({ userId, entryDate, ensureAccount });
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
