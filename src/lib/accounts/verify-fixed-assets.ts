/**
 * تحقق الأصول الثابتة 8.A — اتساق التكاليف والإهلاك والاستبعاد والقيود.
 * منطق التحقق فقط (بلا تنفيذ مباشر) — يشغّله src/scripts/verify-fixed-assets.ts.
 *
 * الفحوصات (mismatch = فشل؛ strict يرقّي التحذيرات/غير المفسَّر إلى فشل):
 *  - معادلات التكلفة: capitalized = acquisition + additional ، salvage ≤ capitalized ،
 *    depreciable = capitalized − salvage ≥ 0.
 *  - صحة حسابات GL للتصنيف والأصل: الأصل ASSET/تفصيلي/قابل للترحيل، مجمع الإهلاك ASSET برصيد
 *    طبيعي دائن، مصروف الإهلاك EXPENSE، الربح REVENUE، الخسارة EXPENSE.
 *  - الأصول ACTIVE تملك الحقول المطلوبة (حساب الأصل، عمر إنتاجي > 0 للقسط الثابت).
 *  - مصادر الرسملة: مجموع كميات الرسملة لكل سطر فاتورة ≤ الكمية المفوترة؛ total_cost=quantity×unit_cost.
 *  - قيد الاقتناء: أصول الشراء (PURCHASE) بلا قيد اقتناء مكرر؛ MANUAL/OPENING/DONATION المرتبطة بقيد
 *    اقتناء يجب أن تكون متوازنة ومرحّلة.
 *  - دورات الإهلاك ↔ القيد: الدورة المرحّلة لها قيد متوازن؛ مجموع سطورها = إجمالي الدورة = مبلغ القيد.
 *  - مجمع الإهلاك لكل أصل = الافتتاحي + مجموع سطور الدورات المرحّلة؛ ويطابق العمود المخزَّن؛
 *    NBV = capitalized − accumulated ≥ salvage؛ لا إهلاك زائد؛ حالة FULLY_DEPRECIATED صحيحة.
 *  - الاستبعاد ↔ القيد: المرحّل له قيد متوازن؛ البيع بمتحصلات يملك حساب متحصلات ضمن القيد؛
 *    الربح/الخسارة = المتحصلات − القيمة الدفترية؛ ليس ربحاً وخسارة معاً.
 *  - اتساق الإلغاء: الدورات/الاستبعادات المُبطَلة لها قيد عكسي.
 *  - تاريخ الحركات: الموقع/العهدة/القسم الحالي لأصل نشط = هدف آخر حركة مرحّلة (تحذير عند التعارض).
 *  - نشاط GL غير مفسَّر على حسابات مجمع الإهلاك (تحذير).
 */
import { moneyToMillis, moneyToMillisSigned, normalizeMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type FixedAssetsVerifyIssue = {
  kind: string;
  detail: string;
  entity_id?: string;
};

export type FixedAssetsVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: FixedAssetsVerifyIssue[];
  warnings: FixedAssetsVerifyIssue[];
  unexplained: FixedAssetsVerifyIssue[];
  summary: {
    categories: number;
    locations: number;
    assets: number;
    assets_active: number;
    assets_disposed: number;
    capitalization_sources: number;
    depreciation_runs_posted: number;
    disposals_posted: number;
  };
};

export type VerifyFixedAssetsOptions = { strict?: boolean };

function ms(v: unknown): bigint {
  return moneyToMillis(normalizeMoneyInput((v ?? 0) as string | number));
}
function msSigned(v: unknown): bigint {
  return moneyToMillisSigned(String(v ?? '0'));
}

export async function verifyFixedAssets(
  client: TxClient,
  options: VerifyFixedAssetsOptions = {}
): Promise<FixedAssetsVerifyResult> {
  const strict = options.strict === true;
  const mismatches: FixedAssetsVerifyIssue[] = [];
  const warnings: FixedAssetsVerifyIssue[] = [];
  const unexplained: FixedAssetsVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) =>
    warnings.push({ kind, detail, entity_id });

  // ── حسابات GL: نجمعها مرة واحدة للفحص ──────────────────────────────
  const gls = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
    account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.is_active, a.is_group, a.allow_posting, a.normal_balance,
            t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id`
  );
  const glById = new Map(gls.rows.map((g) => [g.id, g] as const));

  function checkGl(
    id: string | null,
    expectType: string,
    label: string,
    entityId: string,
    opts: { normalBalance?: 'DEBIT' | 'CREDIT'; required?: boolean } = {}
  ) {
    if (!id) {
      if (opts.required) fail('gl_missing', `${label} مفقود`, entityId);
      return;
    }
    const gl = glById.get(id);
    if (!gl) {
      fail('gl_not_found', `${label} (${id}) غير موجود بدليل الحسابات`, entityId);
      return;
    }
    if (gl.account_type_code !== expectType) {
      fail(
        'gl_type',
        `${label} (${gl.code}) نوعه ${gl.account_type_code} والمتوقع ${expectType}`,
        entityId
      );
    }
    if (!gl.is_active || gl.is_group || !gl.allow_posting) {
      fail('gl_posting', `${label} (${gl.code}) يجب أن يكون تفصيلياً قابلاً للترحيل وفعّالاً`, entityId);
    }
    if (opts.normalBalance && gl.normal_balance !== opts.normalBalance) {
      fail(
        'gl_balance',
        `${label} (${gl.code}) رصيده الطبيعي ${gl.normal_balance} والمتوقع ${opts.normalBalance}`,
        entityId
      );
    }
  }

  // ── التصنيفات ─────────────────────────────────────────────────────
  const categories = await txQuery<{
    id: string;
    code: string;
    asset_gl_account_id: string;
    accumulated_depreciation_gl_account_id: string;
    depreciation_expense_gl_account_id: string;
    gain_gl_account_id: string | null;
    loss_gl_account_id: string | null;
    depreciation_method: string;
    useful_life_months: number | null;
  }>(client, `SELECT * FROM accounts.asset_categories`);

  for (const c of categories.rows) {
    checkGl(c.asset_gl_account_id, 'ASSET', `تصنيف ${c.code}: حساب الأصل`, c.id, {
      required: true,
    });
    checkGl(
      c.accumulated_depreciation_gl_account_id,
      'ASSET',
      `تصنيف ${c.code}: مجمع الإهلاك`,
      c.id,
      { normalBalance: 'CREDIT', required: true }
    );
    checkGl(
      c.depreciation_expense_gl_account_id,
      'EXPENSE',
      `تصنيف ${c.code}: مصروف الإهلاك`,
      c.id,
      { required: true }
    );
    checkGl(c.gain_gl_account_id, 'REVENUE', `تصنيف ${c.code}: حساب الربح`, c.id);
    checkGl(c.loss_gl_account_id, 'EXPENSE', `تصنيف ${c.code}: حساب الخسارة`, c.id);
  }

  const locations = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.asset_locations`
  );

  // ── الأصول ────────────────────────────────────────────────────────
  const assets = await txQuery<{
    id: string;
    asset_number: string;
    status: string;
    acquisition_type: string;
    acquisition_cost: string;
    additional_costs: string;
    capitalized_cost: string;
    salvage_value: string;
    depreciable_amount: string;
    accumulated_depreciation: string;
    opening_accumulated_depreciation: string;
    net_book_value: string;
    useful_life_months: number | null;
    depreciation_method: string;
    asset_gl_account_id: string;
    accumulated_depreciation_gl_account_id: string;
    depreciation_expense_gl_account_id: string;
    acquisition_journal_entry_id: string | null;
    location_id: string | null;
    custodian_user_id: string | null;
    department_id: string | null;
  }>(client, `SELECT * FROM accounts.fixed_assets`);

  let activeCount = 0;
  let disposedCount = 0;

  // مجمع الإهلاك المتوقع من سطور الدورات المرحّلة
  const postedDep = await txQuery<{ fixed_asset_id: string; total: string }>(
    client,
    `SELECT drl.fixed_asset_id, COALESCE(SUM(drl.depreciation_amount),0)::text AS total
     FROM accounts.depreciation_run_lines drl
     JOIN accounts.depreciation_runs dr ON dr.id = drl.run_id
     WHERE dr.status = 'POSTED'
     GROUP BY drl.fixed_asset_id`
  );
  const postedDepByAsset = new Map(postedDep.rows.map((r) => [r.fixed_asset_id, ms(r.total)]));

  for (const a of assets.rows) {
    if (a.status === 'ACTIVE') activeCount += 1;
    if (a.status === 'DISPOSED') disposedCount += 1;

    const acq = ms(a.acquisition_cost);
    const addl = ms(a.additional_costs);
    const cap = ms(a.capitalized_cost);
    const salvage = ms(a.salvage_value);
    const depreciable = ms(a.depreciable_amount);
    const accum = ms(a.accumulated_depreciation);
    const opening = ms(a.opening_accumulated_depreciation);
    const nbv = msSigned(a.net_book_value);

    if (cap !== acq + addl) {
      fail('cost_equation', `الأصل ${a.asset_number}: capitalized ≠ acquisition + additional`, a.id);
    }
    if (salvage > cap) {
      fail('salvage_gt_cost', `الأصل ${a.asset_number}: salvage > capitalized`, a.id);
    }
    if (depreciable !== cap - salvage) {
      fail('depreciable_equation', `الأصل ${a.asset_number}: depreciable ≠ capitalized − salvage`, a.id);
    }
    if (depreciable < BigInt(0)) {
      fail('depreciable_negative', `الأصل ${a.asset_number}: depreciable < 0`, a.id);
    }
    if (accum > depreciable) {
      fail(
        'over_depreciation',
        `الأصل ${a.asset_number}: accumulated (${a.accumulated_depreciation}) > depreciable (${a.depreciable_amount})`,
        a.id
      );
    }

    // مطابقة مجمع الإهلاك بالسطور المرحّلة
    const expectedAccum = opening + (postedDepByAsset.get(a.id) ?? BigInt(0));
    if (expectedAccum !== accum) {
      fail(
        'accumulated_mismatch',
        `الأصل ${a.asset_number}: accumulated المخزَّن (${a.accumulated_depreciation}) ≠ المتوقع من الدورات (${expectedAccum.toString()} millis)`,
        a.id
      );
    }

    // NBV: للأصول غير المستبعَدة = capitalized − accumulated ≥ salvage
    if (a.status !== 'DISPOSED') {
      if (nbv !== cap - accum) {
        fail('nbv_equation', `الأصل ${a.asset_number}: NBV ≠ capitalized − accumulated`, a.id);
      }
      if (nbv < salvage) {
        fail('nbv_below_salvage', `الأصل ${a.asset_number}: NBV < salvage`, a.id);
      }
    }

    // حالة FULLY_DEPRECIATED
    if (depreciable > BigInt(0)) {
      if (a.status === 'FULLY_DEPRECIATED' && accum !== depreciable) {
        fail('fully_dep_status', `الأصل ${a.asset_number}: FULLY_DEPRECIATED لكن accumulated ≠ depreciable`, a.id);
      }
      if (a.status === 'ACTIVE' && accum >= depreciable) {
        warn('fully_dep_missing', `الأصل ${a.asset_number}: مستهلك بالكامل لكن حالته ACTIVE`, a.id);
      }
    }

    // حسابات GL في لقطة الأصل
    checkGl(a.asset_gl_account_id, 'ASSET', `الأصل ${a.asset_number}: حساب الأصل`, a.id, {
      required: true,
    });
    checkGl(
      a.accumulated_depreciation_gl_account_id,
      'ASSET',
      `الأصل ${a.asset_number}: مجمع الإهلاك`,
      a.id,
      { normalBalance: 'CREDIT', required: true }
    );
    checkGl(
      a.depreciation_expense_gl_account_id,
      'EXPENSE',
      `الأصل ${a.asset_number}: مصروف الإهلاك`,
      a.id,
      { required: true }
    );

    // الأصول ACTIVE: الحقول المطلوبة
    if (['ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED'].includes(a.status)) {
      if (a.depreciation_method === 'STRAIGHT_LINE' && !(a.useful_life_months && a.useful_life_months > 0)) {
        fail('missing_useful_life', `الأصل ${a.asset_number}: عمر إنتاجي مطلوب للقسط الثابت`, a.id);
      }
    }

    // قيد الاقتناء
    if (a.acquisition_type === 'PURCHASE' && a.acquisition_journal_entry_id) {
      fail(
        'purchase_dup_acquisition_je',
        `الأصل ${a.asset_number}: أصل شراء له قيد اقتناء (الفاتورة مدّنت الأصل مسبقاً)`,
        a.id
      );
    }
  }

  // قيود الاقتناء لغير الشراء: متوازنة ومرحّلة
  const acqJes = await txQuery<{
    id: string;
    asset_number: string;
    je_id: string;
    status: string;
    total_debit: string;
    total_credit: string;
  }>(
    client,
    `SELECT fa.id, fa.asset_number, je.id AS je_id, je.status,
            je.total_debit::text, je.total_credit::text
     FROM accounts.fixed_assets fa
     JOIN accounts.journal_entries je ON je.id = fa.acquisition_journal_entry_id
     WHERE fa.acquisition_type <> 'PURCHASE'`
  );
  for (const j of acqJes.rows) {
    if (j.status !== 'POSTED') {
      fail('acq_je_not_posted', `الأصل ${j.asset_number}: قيد الاقتناء غير مرحّل (${j.status})`, j.id);
    }
    if (ms(j.total_debit) !== ms(j.total_credit)) {
      fail('acq_je_unbalanced', `الأصل ${j.asset_number}: قيد الاقتناء غير متوازن`, j.id);
    }
  }

  // ── مصادر الرسملة ─────────────────────────────────────────────────
  const capSources = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.asset_capitalization_sources`
  );

  // total_cost = quantity × unit_cost لكل مصدر
  const acsRows = await txQuery<{
    id: string;
    quantity: string;
    unit_cost: string;
    total_cost: string;
    supplier_invoice_line_id: string | null;
  }>(
    client,
    `SELECT id, quantity::text, unit_cost::text, total_cost::text, supplier_invoice_line_id
     FROM accounts.asset_capitalization_sources`
  );
  for (const s of acsRows.rows) {
    const q = ms(s.quantity);
    const unit = ms(s.unit_cost);
    const total = ms(s.total_cost);
    // total_cost بالميلي = quantity(millis) × unit(millis) / 1000
    const expected = (q * unit) / BigInt(1000);
    if (total !== expected) {
      fail(
        'acs_total_cost',
        `مصدر رسملة ${s.id}: total_cost (${s.total_cost}) ≠ quantity×unit_cost`,
        s.id
      );
    }
  }

  // مجموع كميات الرسملة لكل سطر فاتورة ≤ الكمية المفوترة، ومجموع التكلفة ≤ قيمة السطر
  const perInvoiceLine = await txQuery<{
    supplier_invoice_line_id: string;
    cap_qty: string;
    cap_total: string;
    invoiced_qty: string;
    line_total: string;
  }>(
    client,
    `SELECT acs.supplier_invoice_line_id,
            COALESCE(SUM(acs.quantity),0)::text AS cap_qty,
            COALESCE(SUM(acs.total_cost),0)::text AS cap_total,
            sil.quantity::text AS invoiced_qty,
            sil.line_total::text AS line_total
     FROM accounts.asset_capitalization_sources acs
     JOIN accounts.supplier_invoice_lines sil ON sil.id = acs.supplier_invoice_line_id
     WHERE acs.supplier_invoice_line_id IS NOT NULL
     GROUP BY acs.supplier_invoice_line_id, sil.quantity, sil.line_total`
  );
  for (const r of perInvoiceLine.rows) {
    if (ms(r.cap_qty) > ms(r.invoiced_qty)) {
      fail(
        'over_capitalization',
        `سطر فاتورة ${r.supplier_invoice_line_id}: مجموع كميات الرسملة (${r.cap_qty}) > المفوتر (${r.invoiced_qty})`,
        r.supplier_invoice_line_id
      );
    }
    if (ms(r.cap_total) > ms(r.line_total)) {
      fail(
        'capitalized_value',
        `سطر فاتورة ${r.supplier_invoice_line_id}: تكلفة الرسملة (${r.cap_total}) > قيمة السطر (${r.line_total})`,
        r.supplier_invoice_line_id
      );
    }
  }

  // ── دورات الإهلاك ─────────────────────────────────────────────────
  const runs = await txQuery<{
    id: string;
    run_number: string;
    status: string;
    total_depreciation: string;
    journal_entry_id: string | null;
    reversal_journal_entry_id: string | null;
    lines_total: string;
    je_debit: string | null;
    je_credit: string | null;
    je_status: string | null;
  }>(
    client,
    `SELECT dr.id, dr.run_number, dr.status, dr.total_depreciation::text,
            dr.journal_entry_id, dr.reversal_journal_entry_id,
            COALESCE((SELECT SUM(depreciation_amount) FROM accounts.depreciation_run_lines
                      WHERE run_id = dr.id),0)::text AS lines_total,
            je.total_debit::text AS je_debit, je.total_credit::text AS je_credit, je.status AS je_status
     FROM accounts.depreciation_runs dr
     LEFT JOIN accounts.journal_entries je ON je.id = dr.journal_entry_id`
  );
  let runsPosted = 0;
  for (const r of runs.rows) {
    if (ms(r.lines_total) !== ms(r.total_depreciation)) {
      fail('run_total', `دورة ${r.run_number}: مجموع السطور ≠ إجمالي الدورة`, r.id);
    }
    if (r.status === 'POSTED') {
      runsPosted += 1;
      if (!r.journal_entry_id) {
        fail('run_no_je', `دورة ${r.run_number}: مرحّلة بلا قيد`, r.id);
      } else {
        if (ms(r.je_debit) !== ms(r.je_credit)) {
          fail('run_je_unbalanced', `دورة ${r.run_number}: قيد الإهلاك غير متوازن`, r.id);
        }
        if (ms(r.je_debit) !== ms(r.total_depreciation)) {
          fail('run_je_amount', `دورة ${r.run_number}: مبلغ القيد ≠ إجمالي الدورة`, r.id);
        }
        if (r.je_status !== 'POSTED') {
          fail('run_je_status', `دورة ${r.run_number}: قيد الإهلاك غير مرحّل`, r.id);
        }
      }
    }
    if (r.status === 'DRAFT' && r.journal_entry_id) {
      fail('run_draft_has_je', `دورة ${r.run_number}: مسودّة لها قيد`, r.id);
    }
    if (r.status === 'VOIDED' && r.journal_entry_id && !r.reversal_journal_entry_id) {
      fail('run_void_no_reversal', `دورة ${r.run_number}: مُبطَلة بلا قيد عكسي`, r.id);
    }
  }

  // ── الاستبعادات ───────────────────────────────────────────────────
  const disposals = await txQuery<{
    id: string;
    disposal_number: string;
    disposal_type: string;
    status: string;
    disposal_cost: string;
    accumulated_depreciation: string;
    net_book_value: string;
    proceeds_amount: string;
    gain_loss_amount: string;
    proceeds_gl_account_id: string | null;
    gain_gl_account_id: string | null;
    loss_gl_account_id: string | null;
    journal_entry_id: string | null;
    reversal_journal_entry_id: string | null;
    je_debit: string | null;
    je_credit: string | null;
    je_status: string | null;
    asset_status: string;
  }>(
    client,
    `SELECT d.id, d.disposal_number, d.disposal_type, d.status, d.disposal_cost::text,
            d.accumulated_depreciation::text, d.net_book_value::text, d.proceeds_amount::text,
            d.gain_loss_amount::text, d.proceeds_gl_account_id, d.gain_gl_account_id,
            d.loss_gl_account_id, d.journal_entry_id, d.reversal_journal_entry_id,
            je.total_debit::text AS je_debit, je.total_credit::text AS je_credit,
            je.status AS je_status, fa.status AS asset_status
     FROM accounts.asset_disposals d
     JOIN accounts.fixed_assets fa ON fa.id = d.fixed_asset_id
     LEFT JOIN accounts.journal_entries je ON je.id = d.journal_entry_id`
  );
  let disposalsPosted = 0;
  for (const d of disposals.rows) {
    // الربح/الخسارة = المتحصلات − القيمة الدفترية
    const nbvAtDisposal = ms(d.disposal_cost) - ms(d.accumulated_depreciation);
    const expectedGl = ms(d.proceeds_amount) - nbvAtDisposal;
    if (msSigned(d.gain_loss_amount) !== expectedGl) {
      fail('disposal_gainloss', `استبعاد ${d.disposal_number}: gain_loss ≠ proceeds − NBV`, d.id);
    }
    if (d.gain_gl_account_id && d.loss_gl_account_id) {
      fail('disposal_both_gainloss', `استبعاد ${d.disposal_number}: ربح وخسارة معاً`, d.id);
    }
    if (expectedGl > BigInt(0) && d.status === 'POSTED' && !d.gain_gl_account_id) {
      fail('disposal_gain_gl', `استبعاد ${d.disposal_number}: ربح بلا حساب ربح`, d.id);
    }
    if (expectedGl < BigInt(0) && d.status === 'POSTED' && !d.loss_gl_account_id) {
      fail('disposal_loss_gl', `استبعاد ${d.disposal_number}: خسارة بلا حساب خسارة`, d.id);
    }

    if (d.status === 'POSTED') {
      disposalsPosted += 1;
      if (!d.journal_entry_id) {
        fail('disposal_no_je', `استبعاد ${d.disposal_number}: مرحّل بلا قيد`, d.id);
      } else if (ms(d.je_debit) !== ms(d.je_credit)) {
        fail('disposal_je_unbalanced', `استبعاد ${d.disposal_number}: القيد غير متوازن`, d.id);
      }
      if (d.disposal_type === 'SALE' && ms(d.proceeds_amount) > BigInt(0) && !d.proceeds_gl_account_id) {
        fail('sale_no_proceeds_gl', `بيع ${d.disposal_number}: بلا حساب متحصلات (نقدية/بنك)`, d.id);
      }
      if (d.asset_status !== 'DISPOSED') {
        fail('disposal_asset_status', `استبعاد ${d.disposal_number}: الأصل ليس DISPOSED`, d.id);
      }
    }
    if (d.status === 'VOIDED') {
      if (d.journal_entry_id && !d.reversal_journal_entry_id) {
        fail('disposal_void_no_reversal', `استبعاد ${d.disposal_number}: مُبطَل بلا قيد عكسي`, d.id);
      }
      if (d.asset_status === 'DISPOSED') {
        fail('disposal_void_asset', `استبعاد ${d.disposal_number}: مُبطَل لكن الأصل DISPOSED`, d.id);
      }
    }
  }

  // متحصلات البيع ضمن سطور القيد (نقدية/بنك)
  const saleProceeds = await txQuery<{ disposal_number: string; id: string; hit: number }>(
    client,
    `SELECT d.disposal_number, d.id,
            (SELECT COUNT(*)::int FROM accounts.journal_entry_lines jl
             WHERE jl.journal_entry_id = d.journal_entry_id
               AND jl.account_id = d.proceeds_gl_account_id
               AND jl.debit_amount > 0) AS hit
     FROM accounts.asset_disposals d
     WHERE d.status='POSTED' AND d.disposal_type='SALE'
       AND d.proceeds_gl_account_id IS NOT NULL AND d.proceeds_amount > 0`
  );
  for (const s of saleProceeds.rows) {
    if (Number(s.hit) < 1) {
      fail('sale_proceeds_line', `بيع ${s.disposal_number}: لا سطر مدين لحساب المتحصلات`, s.id);
    }
  }

  // ── تاريخ الحركات: مطابقة الوضع الحالي بآخر حركة مرحّلة ──────────────
  const movementMismatch = await txQuery<{
    asset_number: string;
    id: string;
  }>(
    client,
    `WITH latest AS (
       SELECT DISTINCT ON (m.fixed_asset_id) m.fixed_asset_id,
              m.to_location_id, m.to_department_id, m.to_custodian_user_id,
              m.from_location_id, m.from_department_id, m.from_custodian_user_id
       FROM accounts.asset_movements m
       WHERE m.status='POSTED'
       ORDER BY m.fixed_asset_id, m.posted_at DESC NULLS LAST, m.created_at DESC
     )
     SELECT fa.asset_number, fa.id
     FROM accounts.fixed_assets fa
     JOIN latest l ON l.fixed_asset_id = fa.id
     WHERE fa.status IN ('ACTIVE','SUSPENDED','FULLY_DEPRECIATED')
       AND (
         fa.location_id IS DISTINCT FROM COALESCE(l.to_location_id, l.from_location_id, fa.location_id)
         OR fa.custodian_user_id IS DISTINCT FROM COALESCE(l.to_custodian_user_id, l.from_custodian_user_id, fa.custodian_user_id)
         OR fa.department_id IS DISTINCT FROM COALESCE(l.to_department_id, l.from_department_id, fa.department_id)
       )`
  );
  for (const m of movementMismatch.rows) {
    warn('movement_current_mismatch', `الأصل ${m.asset_number}: الوضع الحالي لا يطابق آخر حركة مرحّلة`, m.id);
  }

  // ── أيتام (تحذير؛ strict: فشل) ────────────────────────────────────
  const orphanCap = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.asset_capitalization_sources acs
     LEFT JOIN accounts.fixed_assets fa ON fa.id = acs.fixed_asset_id
     WHERE fa.id IS NULL`
  );
  if (Number(orphanCap.rows[0]?.n) > 0) {
    warn('orphan_capitalization', `مصادر رسملة يتيمة: ${orphanCap.rows[0]?.n}`);
  }

  // ── نشاط GL غير مفسَّر على حسابات مجمع الإهلاك ─────────────────────
  const unexplainedRows = await txQuery<{ entry_number: string; id: string; source_type: string | null }>(
    client,
    `SELECT DISTINCT je.entry_number, je.id, je.source_type
     FROM accounts.journal_entry_lines jl
     JOIN accounts.journal_entries je ON je.id = jl.journal_entry_id
     WHERE jl.account_id IN (
        SELECT accumulated_depreciation_gl_account_id FROM accounts.asset_categories
     )
     AND COALESCE(je.is_reversal, FALSE) = FALSE
     AND COALESCE(je.source_type,'') NOT IN (
        'FIXED_ASSET_ACQUISITION','DEPRECIATION_RUN','ASSET_DISPOSAL','REVERSAL'
     )`
  );
  for (const u of unexplainedRows.rows) {
    unexplained.push({
      kind: 'unexplained_accum_gl',
      detail: `قيد ${u.entry_number}: نشاط على مجمع إهلاك بمصدر غير متوقع (${u.source_type ?? 'NULL'})`,
      entity_id: u.id,
    });
  }

  const summary = {
    categories: categories.rows.length,
    locations: Number(locations.rows[0]?.n ?? 0),
    assets: assets.rows.length,
    assets_active: activeCount,
    assets_disposed: disposedCount,
    capitalization_sources: Number(capSources.rows[0]?.n ?? 0),
    depreciation_runs_posted: runsPosted,
    disposals_posted: disposalsPosted,
  };

  const ok =
    mismatches.length === 0 &&
    (!strict || (warnings.length === 0 && unexplained.length === 0));

  return { ok, strict, mismatches, warnings, unexplained, summary };
}
