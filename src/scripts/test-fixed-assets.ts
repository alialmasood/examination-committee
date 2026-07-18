/**
 * اختبارات قبول الأصول الثابتة 8.A
 * npm run test:fixed-assets
 *
 * تغطي §33: التصنيفات وصحة GL، هرمية المواقع ومنع الدورات، دورة حياة الأصل،
 * تسلسل الأرقام تحت التزامن، معادلات التكلفة، حد الرسملة وتجاوزه، الحركات والعهدة،
 * الإهلاك (القسط الثابت + الشهر الأخير + منع التكرار + FULLY_DEPRECIATED + التجميع + الأعطال)،
 * الاستبعاد (بيع نقدي/بنكي، إتلاف، ربح/خسارة/صفر، الإلغاء)، الرسملة من المشتريات،
 * الصلاحيات (أقل امتياز)، التدقيق، ثبات البذرة، والتحقق (عادي + صارم).
 */
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  moneyEquals,
  moneyToMillis,
  normalizeMoneyInput,
} from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  createAssetCategory,
  loadAssetCategory,
} from '../lib/accounts/asset-categories';
import {
  createAssetLocation,
  updateAssetLocation,
} from '../lib/accounts/asset-locations';
import {
  activateFixedAsset,
  cancelFixedAsset,
  createFixedAsset,
  loadFixedAsset,
  updateFixedAssetDraft,
} from '../lib/accounts/fixed-assets';
import {
  createAssetMovement,
  postAssetMovement,
  voidAssetMovement,
} from '../lib/accounts/asset-movements';
import {
  createDepreciationRun,
  loadDepreciationRun,
  postDepreciationRun,
  voidDepreciationRun,
} from '../lib/accounts/asset-depreciation';
import {
  createAssetDisposal,
  postAssetDisposal,
  voidAssetDisposal,
} from '../lib/accounts/asset-disposals';
import { setFixedAssetFaultForTests } from '../lib/accounts/fixed-assets-faults';
import {
  FIXED_ASSETS_CAPABILITIES,
  assertFixedAssetsCapability,
  getFixedAssetsCapabilities,
  grantAccountsPlatformRole,
  hasFixedAssetsCapability,
} from '../lib/accounts/fixed-assets-access';
import {
  ACCOUNTS_APPROVER_ROLE_CODE,
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import { createSupplier } from '../lib/accounts/suppliers';
import { createSupplierAccount } from '../lib/accounts/supplier-accounts';
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  listPurchaseOrderLines,
  submitPurchaseOrder,
} from '../lib/accounts/purchase-orders';
import {
  createPurchaseReceipt,
  postPurchaseReceipt,
} from '../lib/accounts/purchase-receipts';
import { createSupplierInvoiceFromPurchaseOrder } from '../lib/accounts/purchase-invoice-matching';
import { postSupplierInvoice } from '../lib/accounts/supplier-invoices';
import {
  createAssetsFromPurchasing,
  listCapitalizationCandidates,
} from '../lib/accounts/fixed-assets-from-purchasing';
import { verifyFixedAssets } from '../lib/accounts/verify-fixed-assets';
import { seedFixedAssetsDemo } from './seed-accounts-fixed-assets-demo';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;

function ok(name: string) {
  passCount += 1;
  console.log(`✅ ${name}`);
}
function failed(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err instanceof Error ? err.message : (err ?? ''));
  process.exitCode = 1;
}
async function it(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    failed(name, e);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function throwsHttp(
  fn: () => Promise<unknown>,
  statuses: number | number[],
  includes?: string
) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  try {
    await fn();
  } catch (e) {
    if (e instanceof AccountsHttpError && allowed.includes(e.status)) {
      if (includes && !e.message.includes(includes)) {
        throw new Error(`الرسالة لا تحتوي "${includes}": ${e.message}`);
      }
      return;
    }
    throw e;
  }
  throw new Error(`توقّعنا خطأ ${allowed.join('/')} ولم يحدث`);
}

// ── إعداد الحسابات والمستخدمين ──────────────────────────────────────
async function ensureGl(
  code: string,
  nameAr: string,
  typeCode: 'ASSET' | 'EXPENSE' | 'REVENUE' | 'EQUITY' | 'LIABILITY',
  userId: string,
  normalBalance?: 'DEBIT' | 'CREDIT'
): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`,
    [typeCode]
  );
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const nb = normalBalance ?? (type.rows[0].normal_balance as string);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 8.A')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, nb, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-fa-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_active=TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  if (withAccounts) {
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code='ACCOUNTS'
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [userId]
    );
  }
  return userId;
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

type Ctx = {
  userId: string;
  yearId: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  suffix: string;
  gl: {
    asset: string;
    accum: string;
    expense: string;
    gain: string;
    loss: string;
    equity: string;
    cash: string;
    bank: string;
    payable: string;
  };
  costCenterId: string;
};

let seq = 0;
function uniq(prefix: string, suffix: string): string {
  seq += 1;
  return `${prefix}-${suffix}-${seq}`;
}

async function mkCategory(
  ctx: Ctx,
  over: {
    depreciation_method?: 'STRAIGHT_LINE' | 'NONE';
    useful_life_months?: number | null;
    salvage_value_percent?: string;
    capitalization_threshold?: string;
    withGainLoss?: boolean;
  } = {}
) {
  return withTransaction((c) =>
    createAssetCategory(c, {
      code: uniq('FA-CAT', ctx.suffix),
      name_ar: 'تصنيف اختبار',
      asset_gl_account_id: ctx.gl.asset,
      accumulated_depreciation_gl_account_id: ctx.gl.accum,
      depreciation_expense_gl_account_id: ctx.gl.expense,
      gain_gl_account_id: over.withGainLoss === false ? undefined : ctx.gl.gain,
      loss_gl_account_id: over.withGainLoss === false ? undefined : ctx.gl.loss,
      depreciation_method: over.depreciation_method ?? 'STRAIGHT_LINE',
      useful_life_months:
        over.useful_life_months === undefined ? 12 : over.useful_life_months,
      salvage_value_percent: over.salvage_value_percent ?? '0',
      capitalization_threshold: over.capitalization_threshold ?? '0',
      created_by: ctx.userId,
    })
  );
}

function assetInput(ctx: Ctx, categoryId: string, over: Record<string, unknown> = {}) {
  return {
    category_id: categoryId,
    name_ar: 'أصل اختبار 8.A',
    acquisition_type: 'MANUAL',
    acquisition_date: ctx.periodStart,
    available_for_use_date: ctx.periodStart,
    acquisition_cost: '1000',
    additional_costs: '0',
    salvage_value: '0',
    useful_life_months: 12,
    fiscal_year_id: ctx.yearId,
    fiscal_period_id: ctx.periodId,
    created_by: ctx.userId,
    ...over,
  };
}

async function createAsset(ctx: Ctx, categoryId: string, over: Record<string, unknown> = {}) {
  return withTransaction((c) => createFixedAsset(c, assetInput(ctx, categoryId, over)));
}

async function activate(
  ctx: Ctx,
  asset: { id: string; version: number; updated_at: Date | string },
  over: Record<string, unknown> = {}
) {
  return withTransaction((c) =>
    activateFixedAsset(c, {
      id: asset.id,
      userId: ctx.userId,
      version: asset.version,
      updated_at: asset.updated_at,
      opening_equity_gl_account_id: ctx.gl.equity,
      ...over,
    })
  );
}

async function main() {
  console.log('===== اختبارات قبول الأصول الثابتة 8.A =====');

  let user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    user = await query(
      `SELECT id FROM student_affairs.users WHERE is_active ORDER BY created_at NULLS LAST LIMIT 1`
    );
  }
  if (!user.rows[0]) {
    failed('إعداد: لا يوجد مستخدم');
    return;
  }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id,
            p.start_date::text AS start_date, p.end_date::text AS end_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id=y.id
     WHERE y.status='ACTIVE' AND p.status='OPEN'
     ORDER BY y.is_default DESC, p.start_date LIMIT 1`
  );
  if (!period.rows[0]) {
    failed('إعداد: لا توجد فترة مالية OPEN');
    return;
  }
  const yearId = period.rows[0].year_id as string;
  const periodId = period.rows[0].period_id as string;
  const periodStart = pgDateOnly(period.rows[0].start_date as string);
  const periodEnd = pgDateOnly(period.rows[0].end_date as string);
  await ensureAssetSequences(yearId);

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const gl = {
    asset: await ensureGl(`FA-AST-${suffix}`, 'أصول ثابتة اختبار', 'ASSET', userId),
    accum: await ensureGl(`FA-ACC-${suffix}`, 'مجمع إهلاك اختبار', 'ASSET', userId, 'CREDIT'),
    expense: await ensureGl(`FA-EXP-${suffix}`, 'مصروف إهلاك اختبار', 'EXPENSE', userId),
    gain: await ensureGl(`FA-GAIN-${suffix}`, 'أرباح بيع أصول اختبار', 'REVENUE', userId),
    loss: await ensureGl(`FA-LOSS-${suffix}`, 'خسائر استبعاد اختبار', 'EXPENSE', userId),
    equity: await ensureGl(`FA-EQ-${suffix}`, 'حقوق ملكية افتتاحية اختبار', 'EQUITY', userId),
    cash: await ensureGl(`FA-CASH-${suffix}`, 'نقدية اختبار', 'ASSET', userId),
    bank: await ensureGl(`FA-BANK-${suffix}`, 'بنك اختبار', 'ASSET', userId),
    payable: await ensureGl(`FA-AP-${suffix}`, 'ذمم موردين اختبار', 'LIABILITY', userId),
  };

  let ccRow = await query(
    `SELECT id FROM accounts.cost_centers WHERE LOWER(code)=LOWER($1)`,
    [`FA-CC-${suffix}`]
  );
  if (!ccRow.rows[0]) {
    ccRow = await query(
      `INSERT INTO accounts.cost_centers (code, name_ar, level, is_group, is_active, created_by, description)
       VALUES ($1,'مركز كلفة اختبار',1,FALSE,TRUE,$2,'8.A') RETURNING id`,
      [`FA-CC-${suffix}`, userId]
    );
  }
  const costCenterId = ccRow.rows[0].id as string;

  const ctx: Ctx = {
    userId,
    yearId,
    periodId,
    periodStart,
    periodEnd,
    suffix,
    gl,
    costCenterId,
  };
  ok(`00) إعداد: فترة ${periodStart} + حسابات GL + مركز كلفة`);

  // ═══ التصنيفات ═══
  await it('01) إنشاء تصنيف بحسابات GL صحيحة', async () => {
    const cat = await mkCategory(ctx);
    assert(cat.id && cat.asset_gl_account_id === gl.asset, 'تصنيف غير صحيح');
  });

  await it('02) رفض حساب أصل من نوع خاطئ (EXPENSE)', () =>
    throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetCategory(c, {
            code: uniq('FA-BADA', suffix),
            name_ar: 'تصنيف خاطئ',
            asset_gl_account_id: gl.expense,
            accumulated_depreciation_gl_account_id: gl.accum,
            depreciation_expense_gl_account_id: gl.expense,
            created_by: userId,
          })
        ),
      400
    )
  );

  await it('03) رفض مجمع إهلاك ليس ASSET برصيد دائن', () =>
    throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetCategory(c, {
            code: uniq('FA-BADACC', suffix),
            name_ar: 'تصنيف خاطئ',
            asset_gl_account_id: gl.asset,
            accumulated_depreciation_gl_account_id: gl.asset, // ASSET لكن رصيده مدين
            depreciation_expense_gl_account_id: gl.expense,
            created_by: userId,
          })
        ),
      400
    )
  );

  await it('04) رفض مصروف إهلاك ليس EXPENSE', () =>
    throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetCategory(c, {
            code: uniq('FA-BADEXP', suffix),
            name_ar: 'تصنيف خاطئ',
            asset_gl_account_id: gl.asset,
            accumulated_depreciation_gl_account_id: gl.accum,
            depreciation_expense_gl_account_id: gl.gain, // REVENUE
            created_by: userId,
          })
        ),
      400
    )
  );

  await it('05) رفض رمز تصنيف مكرر', async () => {
    const code = uniq('FA-DUP', suffix);
    await withTransaction((c) =>
      createAssetCategory(c, {
        code,
        name_ar: 'تصنيف أول',
        asset_gl_account_id: gl.asset,
        accumulated_depreciation_gl_account_id: gl.accum,
        depreciation_expense_gl_account_id: gl.expense,
        created_by: userId,
      })
    );
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetCategory(c, {
            code,
            name_ar: 'تصنيف مكرر',
            asset_gl_account_id: gl.asset,
            accumulated_depreciation_gl_account_id: gl.accum,
            depreciation_expense_gl_account_id: gl.expense,
            created_by: userId,
          })
        ),
      409
    );
  });

  // ═══ المواقع ═══
  const building = await withTransaction((c) =>
    createAssetLocation(c, {
      code: uniq('FA-BLD', suffix),
      name_ar: 'مبنى اختبار',
      location_type: 'BUILDING',
      created_by: userId,
    })
  );
  await it('06) إنشاء موقع مبنى (BUILDING)', async () => {
    assert(building.location_type === 'BUILDING', 'نوع الموقع غير صحيح');
  });

  const floor = await withTransaction((c) =>
    createAssetLocation(c, {
      code: uniq('FA-FLR', suffix),
      name_ar: 'طابق اختبار',
      location_type: 'FLOOR',
      parent_location_id: building.id,
      created_by: userId,
    })
  );
  await it('07) إنشاء طابق تحت المبنى', async () => {
    assert(floor.parent_location_id === building.id, 'الأب غير صحيح');
  });

  const room = await withTransaction((c) =>
    createAssetLocation(c, {
      code: uniq('FA-RM', suffix),
      name_ar: 'غرفة اختبار',
      location_type: 'ROOM',
      parent_location_id: floor.id,
      created_by: userId,
    })
  );
  await it('08) إنشاء غرفة تحت الطابق (هرمية)', async () => {
    assert(room.parent_location_id === floor.id, 'الأب غير صحيح');
  });

  await it('09) منع الدورة في هرمية المواقع', () =>
    throwsHttp(
      () =>
        withTransaction((c) =>
          updateAssetLocation(c, {
            id: building.id,
            userId,
            version: building.version,
            updated_at: building.updated_at,
            parent_location_id: room.id, // المبنى تحت غرفته الحفيدة = دورة
          })
        ),
      400
    )
  );

  await it('10) منع أن يكون الموقع أباً لنفسه', () =>
    throwsHttp(
      () =>
        withTransaction((c) =>
          updateAssetLocation(c, {
            id: room.id,
            userId,
            version: room.version,
            updated_at: room.updated_at,
            parent_location_id: room.id,
          })
        ),
      400
    )
  );

  const location2 = await withTransaction((c) =>
    createAssetLocation(c, {
      code: uniq('FA-LAB', suffix),
      name_ar: 'مختبر اختبار',
      location_type: 'LAB',
      parent_location_id: floor.id,
      created_by: userId,
    })
  );

  // ═══ دورة حياة الأصل ═══
  await it('11) إنشاء أصل ينشأ بحالة DRAFT', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    assert(a.status === 'DRAFT', `الحالة ${a.status}`);
    assert(/^AST-/.test(a.asset_number), `رقم الأصل ${a.asset_number}`);
  });

  await it('12) معادلات التكلفة: capitalized/depreciable', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id, {
      acquisition_cost: '1000',
      additional_costs: '250',
      salvage_value: '250',
    });
    assert(moneyEquals(a.capitalized_cost, '1250.000'), `cap=${a.capitalized_cost}`);
    assert(moneyEquals(a.depreciable_amount, '1000.000'), `dep=${a.depreciable_amount}`);
    assert(moneyEquals(a.net_book_value, '1250.000'), `nbv=${a.net_book_value}`);
  });

  await it('13) رفض قيمة متبقية تتجاوز التكلفة', () =>
    throwsHttp(
      async () => {
        const cat = await mkCategory(ctx);
        return createAsset(ctx, cat.id, {
          acquisition_cost: '500',
          additional_costs: '0',
          salvage_value: '600',
        });
      },
      400
    )
  );

  await it('14) منع تفعيل أصل تحت حد الرسملة دون تجاوز', async () => {
    const cat = await mkCategory(ctx, { capitalization_threshold: '1000' });
    const a = await createAsset(ctx, cat.id, { acquisition_cost: '500' });
    await throwsHttp(() => activate(ctx, a), 409);
  });

  await it('15) رفض تجاوز حد الرسملة دون صلاحية (403)', async () => {
    const cat = await mkCategory(ctx, { capitalization_threshold: '1000' });
    const a = await createAsset(ctx, cat.id, { acquisition_cost: '500' });
    await throwsHttp(
      () =>
        activate(ctx, a, {
          override_capitalization_threshold: true,
          override_threshold_reason: 'محاولة',
          hasOverrideCapability: false,
        }),
      403
    );
  });

  await it('16) رفض تجاوز حد الرسملة دون سبب (400)', async () => {
    const cat = await mkCategory(ctx, { capitalization_threshold: '1000' });
    const a = await createAsset(ctx, cat.id, { acquisition_cost: '500' });
    await throwsHttp(
      () =>
        activate(ctx, a, {
          override_capitalization_threshold: true,
          hasOverrideCapability: true,
        }),
      400
    );
  });

  await it('17) تجاوز حد الرسملة بنجاح (صلاحية + سبب) → ACTIVE', async () => {
    const cat = await mkCategory(ctx, { capitalization_threshold: '1000' });
    const a = await createAsset(ctx, cat.id, { acquisition_cost: '500' });
    const res = await activate(ctx, a, {
      override_capitalization_threshold: true,
      override_threshold_reason: 'أصل استراتيجي منخفض القيمة',
      hasOverrideCapability: true,
    });
    assert(res.status === 'ACTIVE', `الحالة ${res.status}`);
    assert(res.override_capitalization_threshold === true, 'لم يُسجَّل التجاوز');
  });

  await it('18) رفض تفعيل أصل يدوي دون حساب حقوق ملكية (400)', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    await throwsHttp(
      () =>
        withTransaction((c) =>
          activateFixedAsset(c, {
            id: a.id,
            userId,
            version: a.version,
            updated_at: a.updated_at,
          })
        ),
      400
    );
  });

  await it('19) تفعيل أصل يدوي ينشئ قيد اقتناء متوازن', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id, { acquisition_cost: '1200' });
    const res = await activate(ctx, a);
    assert(res.status === 'ACTIVE' && res.acquisition_journal_entry_id, 'لا قيد اقتناء');
    const je = await query(
      `SELECT total_debit::text d, total_credit::text cr, status FROM accounts.journal_entries WHERE id=$1`,
      [res.acquisition_journal_entry_id]
    );
    assert(je.rows[0]?.status === 'POSTED', 'القيد غير مرحّل');
    assert(moneyEquals(je.rows[0].d, je.rows[0].cr), 'القيد غير متوازن');
    assert(moneyEquals(je.rows[0].d, '1200.000'), `مبلغ القيد ${je.rows[0].d}`);
  });

  await it('20) منع التفعيل المزدوج', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    const active = await activate(ctx, a);
    await throwsHttp(
      () =>
        withTransaction((c) =>
          activateFixedAsset(c, {
            id: active.id,
            userId,
            version: active.version,
            updated_at: active.updated_at,
            opening_equity_gl_account_id: gl.equity,
          })
        ),
      409
    );
  });

  await it('21) إلغاء أصل DRAFT → CANCELLED', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    const res = await withTransaction((c) =>
      cancelFixedAsset(c, { id: a.id, userId, version: a.version, updated_at: a.updated_at, reason: 'لم نعد نحتاجه' })
    );
    assert(res.status === 'CANCELLED', `الحالة ${res.status}`);
  });

  await it('22) منع إلغاء أصل ACTIVE', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    const active = await activate(ctx, a);
    await throwsHttp(
      () =>
        withTransaction((c) =>
          cancelFixedAsset(c, {
            id: active.id,
            userId,
            version: active.version,
            updated_at: active.updated_at,
            reason: 'x',
          })
        ),
      409
    );
  });

  await it('23) منع تعديل الأصل بعد التفعيل', async () => {
    const cat = await mkCategory(ctx);
    const a = await createAsset(ctx, cat.id);
    const active = await activate(ctx, a);
    await throwsHttp(
      () =>
        withTransaction((c) =>
          updateFixedAssetDraft(c, {
            id: active.id,
            userId,
            version: active.version,
            updated_at: active.updated_at,
            name_ar: 'محاولة تعديل',
          })
        ),
      409
    );
  });

  await it('24) تسلسل أرقام الأصول تحت التزامن (فريدة)', async () => {
    const cat = await mkCategory(ctx);
    const [a1, a2] = await Promise.all([
      createAsset(ctx, cat.id),
      createAsset(ctx, cat.id),
    ]);
    assert(a1.asset_number !== a2.asset_number, `تكرار: ${a1.asset_number}`);
  });

  await it('25) أصل افتتاحي بمجمع إهلاك افتتاحي (قيد متوازن)', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 12 });
    const a = await createAsset(ctx, cat.id, {
      acquisition_type: 'OPENING',
      acquisition_cost: '1200',
      opening_accumulated_depreciation: '300',
    });
    assert(moneyEquals(a.accumulated_depreciation, '300.000'), 'مجمع افتتاحي غير مخزَّن');
    const res = await activate(ctx, a);
    assert(res.status === 'ACTIVE' && res.acquisition_journal_entry_id, 'لا قيد');
    const je = await query(
      `SELECT total_debit::text d, total_credit::text cr FROM accounts.journal_entries WHERE id=$1`,
      [res.acquisition_journal_entry_id]
    );
    assert(moneyEquals(je.rows[0].d, je.rows[0].cr), 'القيد غير متوازن');
  });

  // ═══ الحركات ═══
  const dept = await query(`SELECT id FROM student_affairs.departments LIMIT 1`);
  const deptId = (dept.rows[0]?.id as string | undefined) ?? null;
  const custodian2 = await upsertUser(`fa-cust-${suffix}`, true);

  async function activeAssetWithLocation(catOver = {}) {
    const cat = await mkCategory(ctx, { depreciation_method: 'NONE', useful_life_months: null, ...catOver });
    const a = await createAsset(ctx, cat.id, {
      location_id: building.id,
      custodian_user_id: userId,
      department_id: deptId,
      useful_life_months: null,
    });
    return activate(ctx, a);
  }

  await it('26) إنشاء حركة أصل DRAFT', async () => {
    const asset = await activeAssetWithLocation();
    const mv = await withTransaction((c) =>
      createAssetMovement(c, {
        fixed_asset_id: asset.id,
        movement_type: 'LOCATION',
        to_location_id: location2.id,
        reason: 'نقل اختبار',
        created_by: userId,
      })
    );
    assert(mv.status === 'DRAFT', `الحالة ${mv.status}`);
  });

  await it('27) رفض حركة بلا وجهة', async () => {
    const asset = await activeAssetWithLocation();
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetMovement(c, {
            fixed_asset_id: asset.id,
            movement_type: 'LOCATION',
            created_by: userId,
          })
        ),
      400
    );
  });

  await it('28) رفض حركة لأصل DRAFT', async () => {
    const cat = await mkCategory(ctx, { depreciation_method: 'NONE', useful_life_months: null });
    const a = await createAsset(ctx, cat.id, { useful_life_months: null });
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetMovement(c, {
            fixed_asset_id: a.id,
            movement_type: 'LOCATION',
            to_location_id: location2.id,
            created_by: userId,
          })
        ),
      409
    );
  });

  await it('29) ترحيل حركة يحدّث الموقع/العهدة/القسم الحالي', async () => {
    const asset = await activeAssetWithLocation();
    const mv = await withTransaction((c) =>
      createAssetMovement(c, {
        fixed_asset_id: asset.id,
        movement_type: 'MIXED',
        to_location_id: location2.id,
        to_custodian_user_id: custodian2,
        created_by: userId,
      })
    );
    await withTransaction((c) =>
      postAssetMovement(c, { id: mv.id, userId, version: mv.version, updated_at: mv.updated_at })
    );
    const after = await withTransaction((c) => loadFixedAsset(c, asset.id));
    assert(after.location_id === location2.id, 'الموقع لم يتحدّث');
    assert(after.custodian_user_id === custodian2, 'العهدة لم تتحدّث');
  });

  await it('30) إلغاء حركة يعيد القيم السابقة', async () => {
    const asset = await activeAssetWithLocation();
    const mv = await withTransaction((c) =>
      createAssetMovement(c, {
        fixed_asset_id: asset.id,
        movement_type: 'LOCATION',
        to_location_id: location2.id,
        created_by: userId,
      })
    );
    const posted = await withTransaction((c) =>
      postAssetMovement(c, { id: mv.id, userId, version: mv.version, updated_at: mv.updated_at })
    );
    await withTransaction((c) =>
      voidAssetMovement(c, {
        id: posted.id,
        userId,
        version: posted.version,
        updated_at: posted.updated_at,
        reason: 'تراجع',
      })
    );
    const after = await withTransaction((c) => loadFixedAsset(c, asset.id));
    assert(after.location_id === building.id, `الموقع لم يُستعَد: ${after.location_id}`);
  });

  await it('31) ترحيل حركة متزامن — واحدة تفوز', async () => {
    const asset = await activeAssetWithLocation();
    const mv = await withTransaction((c) =>
      createAssetMovement(c, {
        fixed_asset_id: asset.id,
        movement_type: 'LOCATION',
        to_location_id: location2.id,
        created_by: userId,
      })
    );
    const results = await Promise.allSettled([
      withTransaction((c) =>
        postAssetMovement(c, { id: mv.id, userId, version: mv.version, updated_at: mv.updated_at })
      ),
      withTransaction((c) =>
        postAssetMovement(c, { id: mv.id, userId, version: mv.version, updated_at: mv.updated_at })
      ),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    assert(okN === 1, `نجح ${okN} (المتوقع 1)`);
  });

  // ═══ الإهلاك ═══
  // تجميع متعدد التصنيفات (غير مُرشَّح): يُهلك كل الأصول المؤهّلة الحالية.
  await it('32) دورة إهلاك متعددة التصنيفات: قيد متوازن + تجميع', async () => {
    const catA = await mkCategory(ctx, { useful_life_months: 10 });
    await mkCategory(ctx, { useful_life_months: 20 });
    const expenseB = await ensureGl(`FA-EXP2-${suffix}`, 'مصروف إهلاك 2', 'EXPENSE', userId);
    // catB بمصروف مختلف
    await withTransaction((c) =>
      createAssetCategory(c, {
        code: uniq('FA-CATB2', suffix),
        name_ar: 'تصنيف ب',
        asset_gl_account_id: gl.asset,
        accumulated_depreciation_gl_account_id: gl.accum,
        depreciation_expense_gl_account_id: expenseB,
        useful_life_months: 20,
        created_by: userId,
      })
    );
    const aA = await activate(ctx, await createAsset(ctx, catA.id, { acquisition_cost: '1000', cost_center_id: costCenterId }));
    const bCat = await withTransaction((c) =>
      createAssetCategory(c, {
        code: uniq('FA-CATB3', suffix),
        name_ar: 'تصنيف ب2',
        asset_gl_account_id: gl.asset,
        accumulated_depreciation_gl_account_id: gl.accum,
        depreciation_expense_gl_account_id: expenseB,
        useful_life_months: 20,
        created_by: userId,
      })
    );
    const aB = await activate(ctx, await createAsset(ctx, bCat.id, { acquisition_cost: '2000' }));
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, created_by: userId })
    );
    const posted = await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    assert(posted.status === 'POSTED' && posted.journal_entry_id, 'الدورة لم تُرحّل');
    const je = await query(
      `SELECT total_debit::text d, total_credit::text cr FROM accounts.journal_entries WHERE id=$1`,
      [posted.journal_entry_id]
    );
    assert(moneyEquals(je.rows[0].d, je.rows[0].cr), 'القيد غير متوازن');
    const debitGls = await query(
      `SELECT DISTINCT account_id FROM accounts.journal_entry_lines
       WHERE journal_entry_id=$1 AND debit_amount>0`,
      [posted.journal_entry_id]
    );
    assert(debitGls.rows.length >= 2, `حسابات مصروف مدينة=${debitGls.rows.length} (المتوقع ≥2)`);
    void aA;
    void aB;
  });

  await it('33) مركز الكلفة محفوظ في قيد الإهلاك', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 10 });
    await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000', cost_center_id: costCenterId }));
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    const posted = await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    const lines = await query(
      `SELECT cost_center_id FROM accounts.journal_entry_lines
       WHERE journal_entry_id=$1 AND cost_center_id=$2`,
      [posted.journal_entry_id, costCenterId]
    );
    assert(lines.rows.length >= 1, 'مركز الكلفة غير محفوظ في القيد');
  });

  await it('34) حساب القسط الثابت (depreciable ÷ العمر)', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 10 });
    await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000', useful_life_months: 10 }));
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    assert(moneyEquals(run.run.total_depreciation, '100.000'), `القسط=${run.run.total_depreciation}`);
  });

  await it('35) ترحيل الإهلاك: مدين مصروف = دائن مجمع', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 10 });
    await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000', useful_life_months: 10 }));
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    const posted = await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    const dr = await query(
      `SELECT COALESCE(SUM(debit_amount),0)::text d FROM accounts.journal_entry_lines
       WHERE journal_entry_id=$1 AND account_id=$2`,
      [posted.journal_entry_id, gl.expense]
    );
    const crr = await query(
      `SELECT COALESCE(SUM(credit_amount),0)::text c FROM accounts.journal_entry_lines
       WHERE journal_entry_id=$1 AND account_id=$2`,
      [posted.journal_entry_id, gl.accum]
    );
    assert(moneyEquals(dr.rows[0].d, '100.000'), `مدين مصروف=${dr.rows[0].d}`);
    assert(moneyEquals(crr.rows[0].c, '100.000'), `دائن مجمع=${crr.rows[0].c}`);
  });

  await it('36) منع تكرار الإهلاك لنفس الفترة', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 10 });
    await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000' }));
    await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
        ),
      409
    );
  });

  await it('37) الشهر الأخير يأخذ الباقي + FULLY_DEPRECIATED', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 12 });
    const a = await createAsset(ctx, cat.id, {
      acquisition_type: 'OPENING',
      acquisition_cost: '1000',
      opening_accumulated_depreciation: '950',
    });
    const active = await activate(ctx, a);
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    assert(moneyEquals(run.run.total_depreciation, '50.000'), `الباقي=${run.run.total_depreciation}`);
    await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    const after = await withTransaction((c) => loadFixedAsset(c, active.id));
    assert(after.status === 'FULLY_DEPRECIATED', `الحالة ${after.status}`);
    assert(moneyEquals(after.accumulated_depreciation, '1000.000'), `المجمع=${after.accumulated_depreciation}`);
    assert(moneyEquals(after.net_book_value, '0.000'), `NBV=${after.net_book_value}`);
  });

  await it('38) إلغاء دورة إهلاك يعيد المجمع + قيد عكسي', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 10 });
    const active = await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000' }));
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    const posted = await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    const voided = await withTransaction((c) =>
      voidDepreciationRun(c, {
        id: posted.id,
        userId,
        version: posted.version,
        updated_at: posted.updated_at,
        reason: 'اختبار عكس',
      })
    );
    assert(voided.status === 'VOIDED' && voided.reversal_journal_entry_id, 'لا قيد عكسي');
    const after = await withTransaction((c) => loadFixedAsset(c, active.id));
    assert(moneyEquals(after.accumulated_depreciation, '0.000'), `المجمع لم يُستعَد: ${after.accumulated_depreciation}`);
  });

  // أعطال الإهلاك — تراجع كامل
  async function depFaultCase(point: Parameters<typeof setFixedAssetFaultForTests>[0], label: string) {
    await it(label, async () => {
      const cat = await mkCategory(ctx, { useful_life_months: 10 });
      const active = await activate(ctx, await createAsset(ctx, cat.id, { acquisition_cost: '1000' }));
      const run = await withTransaction((c) =>
        createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
      );
      setFixedAssetFaultForTests(point);
      try {
        await withTransaction((c) =>
          postDepreciationRun(c, {
            id: run.run.id,
            userId,
            version: run.run.version,
            updated_at: run.run.updated_at,
          })
        );
        throw new Error('توقّعنا فشلاً');
      } catch (e) {
        if (e instanceof Error && e.message === 'توقّعنا فشلاً') throw e;
      } finally {
        setFixedAssetFaultForTests(null);
      }
      const runAfter = await withTransaction((c) => loadDepreciationRun(c, run.run.id));
      const asset = await withTransaction((c) => loadFixedAsset(c, active.id));
      const je = await query(
        `SELECT COUNT(*)::int n FROM accounts.journal_entries WHERE source_type='DEPRECIATION_RUN' AND source_id=$1`,
        [run.run.id]
      );
      assert(runAfter.status === 'DRAFT', `الدورة ${runAfter.status}`);
      assert(moneyEquals(asset.accumulated_depreciation, '0.000'), `المجمع تغيّر: ${asset.accumulated_depreciation}`);
      assert(Number(je.rows[0].n) === 0, `قيد يتيم: ${je.rows[0].n}`);
    });
  }
  await depFaultCase('dep_after_journal', '39) عطل بعد القيد — تراجع كامل');
  await depFaultCase('dep_after_first_asset', '40) عطل بعد أول أصل — تراجع كامل');
  await depFaultCase('dep_after_all_assets', '41) عطل بعد كل الأصول — تراجع كامل');
  await depFaultCase('dep_after_run_status', '42) عطل بعد حالة الدورة — تراجع كامل');

  await it('43) رفض إهلاك على فترة غير مفتوحة (مغلقة)', async () => {
    const closed = await query(
      `INSERT INTO accounts.fiscal_periods
        (fiscal_year_id, period_number, code, name_ar, start_date, end_date, status, created_by)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(period_number),0)+1 FROM accounts.fiscal_periods WHERE fiscal_year_id=$1),
         $2, 'فترة مغلقة اختبار', '2099-01-01'::date, '2099-01-31'::date, 'CLOSED', $3
       )
       RETURNING id`,
      [yearId, `FA-CLOSED-${suffix}`, userId]
    );
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createDepreciationRun(c, { fiscal_period_id: closed.rows[0].id, created_by: userId })
        ),
      409
    );
  });

  // ═══ الاستبعاد ═══
  async function disposableAsset(cost = '1000') {
    const cat = await mkCategory(ctx, { depreciation_method: 'NONE', useful_life_months: null, withGainLoss: true });
    const a = await createAsset(ctx, cat.id, { acquisition_cost: cost, useful_life_months: null });
    return activate(ctx, a);
  }

  await it('44) إنشاء استبعاد DRAFT', async () => {
    const asset = await disposableAsset();
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '1000',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    assert(d.status === 'DRAFT', `الحالة ${d.status}`);
  });

  await it('45) بيع نقدي بربح (proceeds > NBV)', async () => {
    const asset = await disposableAsset('1000');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '1200',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    assert(moneyEquals(d.gain_loss_amount, '200.000'), `الربح=${d.gain_loss_amount}`);
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    assert(posted.status === 'POSTED' && posted.gain_gl_account_id && !posted.loss_gl_account_id, 'ربح غير صحيح');
    const after = await withTransaction((c) => loadFixedAsset(c, asset.id));
    assert(after.status === 'DISPOSED', `الأصل ${after.status}`);
  });

  await it('46) بيع بنكي (حساب متحصلات = بنك)', async () => {
    const asset = await disposableAsset('1000');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '1000',
        proceeds_gl_account_id: gl.bank,
        created_by: userId,
      })
    );
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    const line = await query(
      `SELECT COUNT(*)::int n FROM accounts.journal_entry_lines
       WHERE journal_entry_id=$1 AND account_id=$2 AND debit_amount>0`,
      [posted.journal_entry_id, gl.bank]
    );
    assert(Number(line.rows[0].n) >= 1, 'لا سطر مدين للبنك');
  });

  await it('47) إتلاف (SCRAP) بخسارة كامل القيمة الدفترية', async () => {
    const asset = await disposableAsset('600');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SCRAP',
        reason: 'تالف',
        created_by: userId,
      })
    );
    assert(moneyEquals(d.gain_loss_amount, '-600.000'), `الخسارة=${d.gain_loss_amount}`);
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    assert(posted.status === 'POSTED' && posted.loss_gl_account_id, 'خسارة غير صحيحة');
  });

  await it('48) استبعاد بلا ربح ولا خسارة (أصل مستهلك بالكامل)', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 12 });
    const a = await createAsset(ctx, cat.id, {
      acquisition_type: 'OPENING',
      acquisition_cost: '1000',
      opening_accumulated_depreciation: '950',
    });
    const active = await activate(ctx, a);
    const run = await withTransaction((c) =>
      createDepreciationRun(c, { fiscal_period_id: periodId, category_id: cat.id, created_by: userId })
    );
    await withTransaction((c) =>
      postDepreciationRun(c, {
        id: run.run.id,
        userId,
        version: run.run.version,
        updated_at: run.run.updated_at,
      })
    );
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: active.id,
        disposal_date: periodStart,
        disposal_type: 'SCRAP',
        created_by: userId,
      })
    );
    assert(moneyEquals(d.gain_loss_amount, '0.000'), `ربح/خسارة=${d.gain_loss_amount}`);
    assert(!d.gain_gl_account_id && !d.loss_gl_account_id, 'حساب ربح/خسارة غير متوقع');
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    const je = await query(
      `SELECT total_debit::text d, total_credit::text cr FROM accounts.journal_entries WHERE id=$1`,
      [posted.journal_entry_id]
    );
    assert(moneyEquals(je.rows[0].d, je.rows[0].cr), 'القيد غير متوازن');
  });

  await it('49) بيع بخسارة (proceeds < NBV)', async () => {
    const asset = await disposableAsset('1000');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '800',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    assert(moneyEquals(d.gain_loss_amount, '-200.000'), `الخسارة=${d.gain_loss_amount}`);
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    assert(posted.loss_gl_account_id && !posted.gain_gl_account_id, 'خسارة غير صحيحة');
  });

  await it('50) لا قيد مكرر للاستبعاد المرحّل', async () => {
    const asset = await disposableAsset('500');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '500',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    const je = await query(
      `SELECT COUNT(*)::int n FROM accounts.journal_entries WHERE source_type='ASSET_DISPOSAL' AND source_id=$1`,
      [posted.id]
    );
    assert(Number(je.rows[0].n) === 1, `عدد القيود=${je.rows[0].n}`);
  });

  await it('51) إلغاء استبعاد يعيد الأصل + قيد عكسي', async () => {
    const asset = await disposableAsset('1000');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '1000',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    const voided = await withTransaction((c) =>
      voidAssetDisposal(c, {
        id: posted.id,
        userId,
        version: posted.version,
        updated_at: posted.updated_at,
        reason: 'تراجع',
      })
    );
    assert(voided.status === 'VOIDED' && voided.reversal_journal_entry_id, 'لا قيد عكسي');
    const after = await withTransaction((c) => loadFixedAsset(c, asset.id));
    assert(after.status !== 'DISPOSED', `الأصل ما زال ${after.status}`);
  });

  await it('52) ترحيل استبعاد متزامن على نفس السجل — واحد يفوز', async () => {
    const asset = await disposableAsset('700');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '700',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    const results = await Promise.allSettled([
      withTransaction((c) =>
        postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
      ),
      withTransaction((c) =>
        postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
      ),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    assert(okN === 1, `نجح ${okN} (المتوقع 1)`);
  });

  // ═══ الرسملة من المشتريات ═══
  async function buildInvoiceLine(catId: string, qty: string, price: string): Promise<string> {
    const supplier = await withTransaction((c) =>
      createSupplier(c, {
        name_ar: `مورد أصول اختبار ${uniq('S', suffix)}`,
        supplier_type: 'LOCAL',
        currency_code: 'IQD',
        created_by: userId,
      })
    );
    const account = await withTransaction((c) =>
      createSupplierAccount(c, {
        supplier_id: supplier.id,
        payable_gl_account_id: gl.payable,
        currency_code: 'IQD',
        created_by: userId,
      })
    );
    return withTransaction(async (c) => {
      const po = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: periodStart,
        lines: [
          {
            purchase_kind: 'NON_STOCK_ITEM',
            description: 'أصل ثابت مرشّح',
            ordered_quantity: qty,
            unit_price: price,
            expense_gl_account_id: gl.expense,
          },
        ],
        created_by: userId,
      });
      const sub = await submitPurchaseOrder(c, {
        id: po.id,
        userId,
        version: po.version,
        updated_at: po.updated_at,
      });
      const app = await approvePurchaseOrder(c, {
        id: sub.id,
        userId,
        version: sub.version,
        updated_at: sub.updated_at,
      });
      const poLine = (await listPurchaseOrderLines(c, app.id))[0]!;
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: app.id,
        receipt_date: periodStart,
        received_by: userId,
        lines: [
          { purchase_order_line_id: poLine.id, received_quantity: qty, accepted_quantity: qty },
        ],
        created_by: userId,
      });
      await postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
      const inv = await createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: app.id,
        supplier_invoice_number: uniq('FA-VINV', suffix),
        invoice_date: periodStart,
        lines: [{ purchase_order_line_id: poLine.id, quantity: qty, unit_price: price }],
        created_by: userId,
      });
      await acquireJournalEntriesLock(c);
      await postSupplierInvoice(c, {
        id: inv.invoice.id,
        userId,
        version: inv.invoice.version,
        updated_at: inv.invoice.updated_at,
      });
      const line = await c.query(
        `SELECT id FROM accounts.supplier_invoice_lines WHERE supplier_invoice_id=$1 ORDER BY line_number LIMIT 1`,
        [inv.invoice.id]
      );
      const lineId = line.rows[0].id as string;
      await c.query(
        `UPDATE accounts.supplier_invoice_lines SET is_fixed_asset=TRUE, asset_category_id=$2::uuid WHERE id=$1`,
        [lineId, catId]
      );
      return lineId;
    });
  }

  const purchCat = await mkCategory(ctx, { useful_life_months: 24 });
  let purchLineId: string | null = null;
  try {
    purchLineId = await buildInvoiceLine(purchCat.id, '3', '500');
  } catch (e) {
    failed('إعداد الرسملة من المشتريات', e);
  }

  await it('53) listCapitalizationCandidates يعرض السطر المرشّح', async () => {
    assert(purchLineId, 'لم يُهيّأ سطر الفاتورة');
    const candidates = await withTransaction((c) => listCapitalizationCandidates(c));
    assert(Array.isArray(candidates.rows), 'الناتج لا يحتوي rows');
    assert(
      candidates.rows.some((r) => r.supplier_invoice_line_id === purchLineId),
      'السطر المرشّح غير موجود'
    );
  });

  await it('54) createAssetsFromPurchasing ينشئ أصل شراء', async () => {
    assert(purchLineId, 'لم يُهيّأ سطر الفاتورة');
    await withTransaction((c) =>
      createAssetsFromPurchasing(c, {
        supplier_invoice_line_id: purchLineId!,
        quantity: '3',
        category_id: purchCat.id,
        name_ar: 'حاسوب من المشتريات',
        available_for_use_date: periodStart,
        useful_life_months: 24,
        created_by: userId,
        userId,
      })
    );
    const assets = await query(
      `SELECT fa.acquisition_type FROM accounts.fixed_assets fa
       JOIN accounts.asset_capitalization_sources acs ON acs.fixed_asset_id=fa.id
       WHERE acs.supplier_invoice_line_id=$1`,
      [purchLineId]
    );
    assert(assets.rows.length >= 1, 'لم يُنشأ أصل');
    assert(assets.rows.every((r) => r.acquisition_type === 'PURCHASE'), 'نوع الاقتناء ليس PURCHASE');
  });

  await it('55) مجموع كميات الرسملة = الكمية المفوترة', async () => {
    assert(purchLineId, 'لم يُهيّأ سطر الفاتورة');
    const r = await query(
      `SELECT COALESCE(SUM(quantity),0)::text q FROM accounts.asset_capitalization_sources WHERE supplier_invoice_line_id=$1`,
      [purchLineId]
    );
    assert(moneyEquals(r.rows[0].q, '3.000'), `المجموع=${r.rows[0].q}`);
  });

  await it('56) مجموع تكلفة التوزيع = قيمة السطر (3×500=1500)', async () => {
    assert(purchLineId, 'لم يُهيّأ سطر الفاتورة');
    const r = await query(
      `SELECT COALESCE(SUM(total_cost),0)::text t FROM accounts.asset_capitalization_sources WHERE supplier_invoice_line_id=$1`,
      [purchLineId]
    );
    assert(moneyEquals(r.rows[0].t, '1500.000'), `التكلفة=${r.rows[0].t}`);
  });

  await it('57) منع الرسملة المزدوجة لنفس السطر', async () => {
    assert(purchLineId, 'لم يُهيّأ سطر الفاتورة');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetsFromPurchasing(c, {
            supplier_invoice_line_id: purchLineId!,
            quantity: '3',
            category_id: purchCat.id,
            name_ar: 'تكرار',
            created_by: userId,
            userId,
          })
        ),
      [400, 409]
    );
  });

  await it('58) منع تجاوز الكمية المفوترة عند الرسملة', async () => {
    const cat = await mkCategory(ctx, { useful_life_months: 24 });
    const lineId = await buildInvoiceLine(cat.id, '2', '400');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          createAssetsFromPurchasing(c, {
            supplier_invoice_line_id: lineId,
            quantity: '5',
            category_id: cat.id,
            name_ar: 'تجاوز الكمية',
            created_by: userId,
            userId,
          })
        ),
      [400, 409]
    );
  });

  // ═══ الصلاحيات (أقل امتياز) ═══
  const viewerId = await upsertUser(`fa-view-${suffix}`, true);
  const clerkId = await upsertUser(`fa-clerk-${suffix}`, true);
  const approverId = await upsertUser(`fa-appr-${suffix}`, true);
  const bareId = await upsertUser(`fa-bare-${suffix}`, true);
  const outsiderId = await upsertUser(`fa-out-${suffix}`, false);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
  await grantAccountsPlatformRole(approverId, ACCOUNTS_APPROVER_ROLE_CODE);
  const C = FIXED_ASSETS_CAPABILITIES;

  await it('59) صلاحيات المُشاهد (عرض نعم، تحضير/تفعيل لا)', async () => {
    assert(await hasFixedAssetsCapability(null, viewerId, C.ASSET_VIEW), 'يجب أن يرى');
    assert(!(await hasFixedAssetsCapability(null, viewerId, C.ASSET_PREPARE)), 'لا يحضّر');
    assert(!(await hasFixedAssetsCapability(null, viewerId, C.ASSET_ACTIVATE)), 'لا يفعّل');
  });

  await it('60) صلاحيات الكاتب (تحضير/إدارة تصنيف نعم، تفعيل/ترحيل إهلاك لا)', async () => {
    assert(await hasFixedAssetsCapability(null, clerkId, C.ASSET_PREPARE), 'يحضّر');
    assert(await hasFixedAssetsCapability(null, clerkId, C.CATEGORY_MANAGE), 'يدير التصنيفات');
    assert(!(await hasFixedAssetsCapability(null, clerkId, C.ASSET_ACTIVATE)), 'لا يفعّل');
    assert(!(await hasFixedAssetsCapability(null, clerkId, C.DEP_POST)), 'لا يرحّل إهلاكاً');
  });

  await it('61) صلاحيات المعتمِد (تفعيل/ترحيل نعم، إلغاء/تجاوز لا)', async () => {
    assert(await hasFixedAssetsCapability(null, approverId, C.ASSET_ACTIVATE), 'يفعّل');
    assert(await hasFixedAssetsCapability(null, approverId, C.DEP_POST), 'يرحّل إهلاكاً');
    assert(await hasFixedAssetsCapability(null, approverId, C.DISPOSAL_POST), 'يرحّل استبعاداً');
    assert(!(await hasFixedAssetsCapability(null, approverId, C.ASSET_CANCEL)), 'لا يلغي');
    assert(!(await hasFixedAssetsCapability(null, approverId, C.ASSET_THRESHOLD_OVERRIDE)), 'لا يتجاوز');
  });

  await it('62) صلاحيات المدير (إلغاء/تجاوز/إبطال إهلاك نعم)', async () => {
    assert(await hasFixedAssetsCapability(null, userId, C.ASSET_CANCEL), 'يلغي');
    assert(await hasFixedAssetsCapability(null, userId, C.ASSET_THRESHOLD_OVERRIDE), 'يتجاوز');
    assert(await hasFixedAssetsCapability(null, userId, C.DEP_VOID), 'يبطل إهلاكاً');
  });

  await it('63) أقل امتياز: عضو ACCOUNTS بلا دور = VIEW_ONLY فقط', async () => {
    const caps = await getFixedAssetsCapabilities(null, bareId);
    assert(caps.has(C.ASSET_VIEW), 'يجب أن يرى');
    assert(!caps.has(C.ASSET_PREPARE), 'لا يحضّر');
    assert(!caps.has(C.CATEGORY_MANAGE), 'لا يدير');
    assert(!caps.has(C.ASSET_ACTIVATE), 'لا يفعّل');
  });

  await it('64) assertFixedAssetsCapability يرمي 403 للمُشاهد على التفعيل', () =>
    throwsHttp(() => assertFixedAssetsCapability(null, viewerId, C.ASSET_ACTIVATE), 403)
  );

  await it('65) مستخدم خارج ACCOUNTS بلا أي صلاحية (IDOR)', async () => {
    assert(!(await hasFixedAssetsCapability(null, outsiderId, C.ASSET_VIEW)), 'يجب ألا يرى');
    await throwsHttp(() => assertFixedAssetsCapability(null, outsiderId, C.ASSET_VIEW), 403);
  });

  await it('66) أقل امتياز: تحضير مرفوض لعضو بلا دور (403)', () =>
    throwsHttp(() => assertFixedAssetsCapability(null, bareId, C.ASSET_PREPARE), 403)
  );

  // ═══ التدقيق ═══
  await it('67) كتابة سجل تدقيق عند التفعيل', async () => {
    const cat = await mkCategory(ctx);
    const active = await activate(ctx, await createAsset(ctx, cat.id));
    const audit = await query(
      `SELECT 1 FROM accounts.financial_audit_log WHERE action='fixed_asset.activated' AND entity_id=$1 LIMIT 1`,
      [active.id]
    );
    assert(audit.rows.length === 1, 'لا سجل تدقيق للتفعيل');
  });

  await it('68) كتابة سجل تدقيق عند الاستبعاد', async () => {
    const asset = await disposableAsset('300');
    const d = await withTransaction((c) =>
      createAssetDisposal(c, {
        fixed_asset_id: asset.id,
        disposal_date: periodStart,
        disposal_type: 'SALE',
        proceeds_amount: '300',
        proceeds_gl_account_id: gl.cash,
        created_by: userId,
      })
    );
    const posted = await withTransaction((c) =>
      postAssetDisposal(c, { id: d.id, userId, version: d.version, updated_at: d.updated_at })
    );
    const audit = await query(
      `SELECT 1 FROM accounts.financial_audit_log WHERE action='asset_disposal.posted' AND entity_id=$1 LIMIT 1`,
      [posted.id]
    );
    assert(audit.rows.length === 1, 'لا سجل تدقيق للاستبعاد');
  });

  // ═══ ثبات البذرة ═══
  const seedEnsureAccount = async (x: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => ({ id: await ensureGl(x.code, x.nameAr, x.typeCode as 'ASSET', x.userId) });

  await it('69) البذرة idempotent (تشغيل مرتين بلا تكرار)', async () => {
    await seedFixedAssetsDemo({ userId, entryDate: periodStart, ensureAccount: seedEnsureAccount });
    await seedFixedAssetsDemo({ userId, entryDate: periodStart, ensureAccount: seedEnsureAccount });
    const cats = await query(
      `SELECT COUNT(*)::int n FROM accounts.asset_categories WHERE code='DEMO-FA-COMPUTERS'`
    );
    assert(Number(cats.rows[0].n) === 1, `تكرار تصنيفات البذرة: ${cats.rows[0].n}`);
  });

  // ═══ التحقق ═══
  await it('70) verifyFixedAssets ينجح (عادي)', async () => {
    const v = await withTransaction((c) => verifyFixedAssets(c));
    assert(v.ok, `فروق: ${JSON.stringify(v.mismatches.slice(0, 5))}`);
  });

  await it('71) verifyFixedAssets ينجح (strict)', async () => {
    const v = await withTransaction((c) => verifyFixedAssets(c, { strict: true }));
    assert(
      v.ok,
      `strict فشل — فروق: ${JSON.stringify(v.mismatches.slice(0, 5))} تحذيرات: ${JSON.stringify(
        v.warnings.slice(0, 5)
      )} غير مفسَّر: ${JSON.stringify(v.unexplained.slice(0, 5))}`
    );
  });

  console.log(
    `\n===== النتيجة: ${failCount ? 'فشل' : 'نجاح'} — نجح ${passCount} / فشل ${failCount} =====`
  );
}

void normalizeMoneyInput;
void moneyToMillis;
void pgDateOnly;
void loadAssetCategory;

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    setFixedAssetFaultForTests(null);
    await closePool();
  });
