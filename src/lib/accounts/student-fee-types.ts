/**
 * أنواع الرسوم الدراسية وغير الدراسية — المرحلة 5.A
 */
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import {
  moneyIsPositive,
  normalizeMoneyInput,
} from './money';
import { assertPostingAccountWithType } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentFeeCategory =
  | 'TUITION'
  | 'REGISTRATION'
  | 'LAB'
  | 'EXAM'
  | 'SERVICE'
  | 'TRANSPORT'
  | 'ACCOMMODATION'
  | 'OTHER';

export type StudentFeeTypeRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  category: StudentFeeCategory;
  revenue_gl_account_id: string;
  default_amount: string | null;
  currency_code: string;
  requires_cost_center: boolean;
  default_cost_center_id: string | null;
  is_tuition: boolean;
  is_refundable: boolean;
  is_active: boolean;
  description: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const FEE_CATEGORIES = new Set<StudentFeeCategory>([
  'TUITION',
  'REGISTRATION',
  'LAB',
  'EXAM',
  'SERVICE',
  'TRANSPORT',
  'ACCOMMODATION',
  'OTHER',
]);

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

/** حساب إيراد افتراضي لرسوم الطلبة — مرتبط بدليل الحسابات */
export const DEFAULT_FEE_REVENUE_GL_CODE = '4111';

/** ربط فئة الرسم بحساب إيراد مفضل في الدليل */
export const FEE_CATEGORY_REVENUE_GL_CODES: Record<StudentFeeCategory, string[]> = {
  TUITION: ['4111', '4112', '4113'],
  REGISTRATION: ['4120'],
  EXAM: ['4130'],
  LAB: ['4160'],
  SERVICE: ['4140', '4150', '4210'],
  TRANSPORT: ['4170'],
  ACCOMMODATION: ['4190'],
  OTHER: ['4190', '4180'],
};

function preferredRevenueCodesForCategory(
  category: StudentFeeCategory | null | undefined
): string[] {
  const preferred = category ? FEE_CATEGORY_REVENUE_GL_CODES[category] ?? [] : [];
  const fallback = [DEFAULT_FEE_REVENUE_GL_CODE, '4190', '4120'];
  return [...new Set([...preferred, ...fallback])];
}

function requireCode(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز نوع الرسم مطلوب', 400);
  if (s.length > 40) throw new AccountsHttpError('رمز نوع الرسم طويل جداً', 400);
  if (!/^[A-Z0-9_\-]+$/.test(s)) {
    throw new AccountsHttpError('رمز نوع الرسم يحتوي محارف غير مسموحة', 400);
  }
  return s;
}

/** رمز تلقائي بسيط وفريد: FT-001, FT-002, … */
export async function suggestNextFeeTypeCode(client: TxClient): Promise<string> {
  const r = await txQuery<{ next_num: number }>(
    client,
    `SELECT COALESCE(MAX(
       CASE
         WHEN code ~ '^FT-[0-9]+$'
           THEN NULLIF(substring(code from 4), '')::int
         ELSE NULL
       END
     ), 0) + 1 AS next_num
     FROM accounts.student_fee_types`
  );
  let n = Number(r.rows[0]?.next_num ?? 1);
  for (let i = 0; i < 100; i++) {
    const code = `FT-${String(n + i).padStart(3, '0')}`;
    const exists = await txQuery<{ ok: number }>(
      client,
      `SELECT 1 AS ok FROM accounts.student_fee_types WHERE code = $1 LIMIT 1`,
      [code]
    );
    if (!exists.rows[0]) return code;
  }
  throw new AccountsHttpError('تعذر توليد رمز فريد لنوع الرسم', 500);
}

async function resolveFeeTypeCode(
  client: TxClient,
  value: unknown
): Promise<string> {
  const raw = String(value ?? '').trim();
  if (!raw) return suggestNextFeeTypeCode(client);
  return requireCode(raw);
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم نوع الرسم بالعربية مطلوب', 400);
  return s.slice(0, 200);
}

function parseCategory(value: unknown): StudentFeeCategory {
  const c = String(value ?? '').trim().toUpperCase() as StudentFeeCategory;
  if (!FEE_CATEGORIES.has(c)) {
    throw new AccountsHttpError('فئة نوع الرسم غير صالحة', 400);
  }
  return c;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة أنواع الرسوم في المرحلة الحالية IQD فقط', 400);
  }
  return code;
}

function assertOptimistic(
  row: StudentFeeTypeRow,
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

export function serializeStudentFeeType(row: StudentFeeTypeRow) {
  return {
    ...row,
    default_amount:
      row.default_amount == null ? null : normalizeMoneyInput(row.default_amount),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/**
 * حساب إيراد صالح: REVENUE ترحيلي فعّال، وليس مرتبطاً بصندوق/بنك/ذمم طلبة.
 */
export async function assertValidRevenueGlAccount(
  client: TxClient,
  accountId: string
): Promise<{ id: string; code: string; account_type_code: string }> {
  const glId = String(accountId ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب الإيراد مطلوب', 400);

  const acc = await assertPostingAccountWithType(
    client,
    glId,
    'حساب الإيراد',
    { invalidStatusCode: 400 }
  );
  if (acc.account_type_code !== 'REVENUE') {
    throw new AccountsHttpError(
      'يجب أن يكون حساب الإيراد من نوع الإيرادات (REVENUE)',
      400
    );
  }

  const cash = await txQuery(
    client,
    `SELECT code FROM accounts.cash_boxes
     WHERE account_id = $1::uuid
       AND status IN ('ACTIVE', 'SUSPENDED', 'DRAFT', 'CLOSED')
     LIMIT 1`,
    [glId]
  );
  if (cash.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب صندوق نقدي كإيراد (${cash.rows[0].code})`,
      400
    );
  }

  const bank = await txQuery(
    client,
    `SELECT code FROM accounts.bank_accounts
     WHERE gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (bank.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب بنكي كإيراد (${bank.rows[0].code})`,
      400
    );
  }

  const recv = await txQuery(
    client,
    `SELECT account_number FROM accounts.student_accounts
     WHERE receivable_gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (recv.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن استخدام حساب ذمم طلبة كحساب إيراد',
      400
    );
  }

  return {
    id: acc.id,
    code: acc.code,
    account_type_code: acc.account_type_code,
  };
}

export async function listEligibleRevenueGlAccounts(
  client: TxClient
): Promise<
  Array<{ id: string; code: string; name_ar: string; account_type_code: string }>
> {
  const r = await txQuery(
    client,
    `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'REVENUE'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb WHERE cb.account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.bank_accounts ba WHERE ba.gl_account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.student_accounts sa
         WHERE sa.receivable_gl_account_id = a.id
       )
     ORDER BY a.code
     LIMIT 500`
  );
  return r.rows as Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
}

async function findRevenueGlByCode(
  client: TxClient,
  code: string
): Promise<{ id: string; code: string; name_ar: string } | null> {
  const r = await txQuery<{ id: string; code: string; name_ar: string }>(
    client,
    `SELECT a.id, a.code, a.name_ar
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE UPPER(a.code) = UPPER($1)
       AND t.code = 'REVENUE'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
     LIMIT 1`,
    [code]
  );
  return r.rows[0] ?? null;
}

/**
 * يضمن وجود حساب إيراد افتراضي لرسوم الطلبة في دليل الحسابات.
 */
export async function ensureDefaultFeeRevenueGlAccount(
  client: TxClient,
  createdBy: string,
  preferredCode: string = DEFAULT_FEE_REVENUE_GL_CODE
): Promise<{ id: string; code: string; name_ar: string }> {
  const existing = await findRevenueGlByCode(client, preferredCode);
  if (existing) {
    await assertValidRevenueGlAccount(client, existing.id);
    return existing;
  }

  const revenueType = await txQuery<{ id: string; normal_balance: string }>(
    client,
    `SELECT id, normal_balance FROM accounts.account_types WHERE code = 'REVENUE' LIMIT 1`
  );
  if (!revenueType.rows[0]) {
    throw new AccountsHttpError(
      'نوع حساب الإيرادات غير موجود — شغّل migrations أو seed دليل الحسابات',
      400
    );
  }

  const parentCandidates = ['4110', '4100', '4000'];
  let parentId: string | null = null;
  let level = 1;
  for (const pCode of parentCandidates) {
    const parent = await txQuery<{ id: string; level: number }>(
      client,
      `SELECT id, level FROM accounts.chart_of_accounts WHERE code = $1 LIMIT 1`,
      [pCode]
    );
    if (parent.rows[0]) {
      parentId = parent.rows[0].id;
      level = Number(parent.rows[0].level) + 1;
      break;
    }
  }

  const sort = await txQuery<{ n: number }>(
    client,
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n
     FROM accounts.chart_of_accounts
     WHERE parent_id IS NOT DISTINCT FROM $1::uuid`,
    [parentId]
  );

  const ins = await txQuery<{ id: string; code: string; name_ar: string }>(
    client,
    `INSERT INTO accounts.chart_of_accounts (
       code, name_ar, name_en, account_type_id, parent_id, level,
       is_group, allow_posting, normal_balance, requires_cost_center,
       is_active, sort_order, source, created_by, updated_by, description
     ) VALUES (
       $1, $2, $3, $4::uuid, $5::uuid, $6,
       FALSE, TRUE, $7, FALSE,
       TRUE, $8, 'SYSTEM', $9::uuid, $9::uuid, $10
     )
     RETURNING id, code, name_ar`,
    [
      preferredCode || DEFAULT_FEE_REVENUE_GL_CODE,
      'أقساط الدراسة الصباحية',
      'Morning Tuition',
      revenueType.rows[0].id,
      parentId,
      level,
      revenueType.rows[0].normal_balance,
      sort.rows[0]?.n ?? 1,
      createdBy,
      'حساب إيراد افتراضي لترحيل رسوم وأنواع رسوم الطلبة',
    ]
  );
  return ins.rows[0];
}

/** يختار حساب الإيراد: المُمرَّر أو حسب الفئة أو أول حساب صالح أو إنشاء افتراضي */
export async function resolveRevenueGlAccount(
  client: TxClient,
  value: unknown,
  createdBy: string,
  category?: StudentFeeCategory | null
): Promise<string> {
  const raw = String(value ?? '').trim();
  if (raw) {
    await assertValidRevenueGlAccount(client, raw);
    return raw;
  }

  for (const code of preferredRevenueCodesForCategory(category)) {
    const found = await findRevenueGlByCode(client, code);
    if (found) {
      await assertValidRevenueGlAccount(client, found.id);
      return found.id;
    }
  }

  const eligible = await listEligibleRevenueGlAccounts(client);
  if (eligible.length > 0) {
    return eligible[0].id;
  }

  const preferred =
    preferredRevenueCodesForCategory(category)[0] || DEFAULT_FEE_REVENUE_GL_CODE;
  const created = await ensureDefaultFeeRevenueGlAccount(
    client,
    createdBy,
    preferred
  );
  return created.id;
}

export async function getDefaultFeeRevenueGlAccount(
  client: TxClient,
  createdBy: string,
  category?: StudentFeeCategory | null
): Promise<{ id: string; code: string; name_ar: string }> {
  for (const code of preferredRevenueCodesForCategory(category)) {
    const found = await findRevenueGlByCode(client, code);
    if (found) {
      await assertValidRevenueGlAccount(client, found.id);
      return found;
    }
  }

  const eligible = await listEligibleRevenueGlAccounts(client);
  if (eligible.length > 0) {
    return {
      id: eligible[0].id,
      code: eligible[0].code,
      name_ar: eligible[0].name_ar,
    };
  }

  const preferred =
    preferredRevenueCodesForCategory(category)[0] || DEFAULT_FEE_REVENUE_GL_CODE;
  return ensureDefaultFeeRevenueGlAccount(client, createdBy, preferred);
}

async function assertCostCenter(
  client: TxClient,
  costCenterId: string | null
): Promise<void> {
  if (!costCenterId) return;
  const r = await txQuery(
    client,
    `SELECT id FROM accounts.cost_centers
     WHERE id = $1::uuid AND is_active = TRUE`,
    [costCenterId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
  }
}

export async function loadStudentFeeType(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentFeeTypeRow> {
  const r = await txQuery<StudentFeeTypeRow>(
    client,
    `SELECT * FROM accounts.student_fee_types WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('نوع الرسم غير موجود', 404);
  return r.rows[0];
}

export async function createStudentFeeType(
  client: TxClient,
  input: {
    code?: unknown;
    name_ar: unknown;
    name_en?: unknown;
    category: unknown;
    revenue_gl_account_id?: unknown;
    default_amount?: unknown;
    currency_code?: unknown;
    requires_cost_center?: unknown;
    default_cost_center_id?: unknown;
    is_tuition?: unknown;
    is_refundable?: unknown;
    description?: unknown;
    created_by: string;
  }
): Promise<StudentFeeTypeRow> {
  const currency = assertIqdOnly(input.currency_code);
  const category = parseCategory(input.category);
  const revenueGlId = await resolveRevenueGlAccount(
    client,
    input.revenue_gl_account_id,
    input.created_by,
    category
  );
  await assertValidRevenueGlAccount(client, revenueGlId);

  let defaultAmount: string | null = null;
  if (input.default_amount != null && input.default_amount !== '') {
    try {
      defaultAmount = normalizeMoneyInput(input.default_amount);
    } catch {
      throw new AccountsHttpError('المبلغ الافتراضي غير صالح', 400);
    }
    if (!moneyIsPositive(defaultAmount)) {
      throw new AccountsHttpError('المبلغ الافتراضي يجب أن يكون أكبر من صفر', 400);
    }
  }

  const requiresCc = bool(input.requires_cost_center, false);
  let defaultCc: string | null = null;
  if (input.default_cost_center_id != null && input.default_cost_center_id !== '') {
    defaultCc = String(input.default_cost_center_id).trim();
  }
  if (requiresCc && !defaultCc) {
    // مسموح — يُفرض عند الترحيل
  }
  await assertCostCenter(client, defaultCc);

  const ins = await txQuery<StudentFeeTypeRow>(
    client,
    `INSERT INTO accounts.student_fee_types (
       code, name_ar, name_en, category, revenue_gl_account_id,
       default_amount, currency_code, requires_cost_center, default_cost_center_id,
       is_tuition, is_refundable, is_active, description, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5::uuid,$6::numeric,$7,$8,$9::uuid,$10,$11,TRUE,$12,$13::uuid,$13::uuid
     ) RETURNING *`,
    [
      await resolveFeeTypeCode(client, input.code),
      requireNameAr(input.name_ar),
      optText(input.name_en, 200),
      category,
      revenueGlId,
      defaultAmount,
      currency,
      requiresCc,
      defaultCc,
      bool(input.is_tuition, category === 'TUITION'),
      bool(input.is_refundable, false),
      optText(input.description, 4000),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateStudentFeeType(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    category?: unknown;
    revenue_gl_account_id?: unknown;
    default_amount?: unknown;
    requires_cost_center?: unknown;
    default_cost_center_id?: unknown;
    is_tuition?: unknown;
    is_refundable?: unknown;
    description?: unknown;
  }
): Promise<StudentFeeTypeRow> {
  const row = await loadStudentFeeType(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);

  let revenueId = row.revenue_gl_account_id;
  if (
    params.revenue_gl_account_id !== undefined &&
    params.revenue_gl_account_id !== ''
  ) {
    revenueId = String(params.revenue_gl_account_id).trim();
    await assertValidRevenueGlAccount(client, revenueId);
  }

  let defaultAmount = row.default_amount;
  if (params.default_amount !== undefined) {
    if (params.default_amount === null || params.default_amount === '') {
      defaultAmount = null;
    } else {
      try {
        defaultAmount = normalizeMoneyInput(params.default_amount);
      } catch {
        throw new AccountsHttpError('المبلغ الافتراضي غير صالح', 400);
      }
      if (!moneyIsPositive(defaultAmount)) {
        throw new AccountsHttpError(
          'المبلغ الافتراضي يجب أن يكون أكبر من صفر',
          400
        );
      }
    }
  }

  const requiresCc =
    params.requires_cost_center !== undefined
      ? bool(params.requires_cost_center, row.requires_cost_center)
      : row.requires_cost_center;

  let defaultCc = row.default_cost_center_id;
  if (params.default_cost_center_id !== undefined) {
    defaultCc =
      params.default_cost_center_id === null ||
      params.default_cost_center_id === ''
        ? null
        : String(params.default_cost_center_id).trim();
  }
  await assertCostCenter(client, defaultCc);

  const upd = await txQuery<StudentFeeTypeRow>(
    client,
    `UPDATE accounts.student_fee_types SET
       name_ar = $2,
       name_en = $3,
       category = $4,
       revenue_gl_account_id = $5::uuid,
       default_amount = $6::numeric,
       requires_cost_center = $7,
       default_cost_center_id = $8::uuid,
       is_tuition = $9,
       is_refundable = $10,
       description = $11,
       updated_by = $12::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      row.id,
      params.name_ar !== undefined
        ? requireNameAr(params.name_ar)
        : row.name_ar,
      params.name_en !== undefined
        ? optText(params.name_en, 200)
        : row.name_en,
      params.category !== undefined
        ? parseCategory(params.category)
        : row.category,
      revenueId,
      defaultAmount,
      requiresCc,
      defaultCc,
      params.is_tuition !== undefined
        ? bool(params.is_tuition, row.is_tuition)
        : row.is_tuition,
      params.is_refundable !== undefined
        ? bool(params.is_refundable, row.is_refundable)
        : row.is_refundable,
      params.description !== undefined
        ? optText(params.description, 4000)
        : row.description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function deactivateStudentFeeType(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<StudentFeeTypeRow> {
  const row = await loadStudentFeeType(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (!row.is_active) return row;

  const upd = await txQuery<StudentFeeTypeRow>(
    client,
    `UPDATE accounts.student_fee_types SET
       is_active = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

export async function listStudentFeeTypes(
  client: TxClient,
  filters: {
    q?: string;
    category?: string | null;
    is_active?: boolean | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: StudentFeeTypeRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (filters.q ?? '').trim();
  const category = filters.category || null;
  const isActive =
    filters.is_active === undefined || filters.is_active === null
      ? null
      : Boolean(filters.is_active);

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_fee_types ft
     WHERE ($1 = '' OR ft.code ILIKE '%'||$1||'%' OR ft.name_ar ILIKE '%'||$1||'%'
            OR COALESCE(ft.name_en,'') ILIKE '%'||$1||'%')
       AND ($2::text IS NULL OR ft.category = $2)
       AND ($3::boolean IS NULL OR ft.is_active = $3)`,
    [q, category, isActive]
  );

  const list = await txQuery<StudentFeeTypeRow>(
    client,
    `SELECT ft.*
     FROM accounts.student_fee_types ft
     WHERE ($1 = '' OR ft.code ILIKE '%'||$1||'%' OR ft.name_ar ILIKE '%'||$1||'%'
            OR COALESCE(ft.name_en,'') ILIKE '%'||$1||'%')
       AND ($2::text IS NULL OR ft.category = $2)
       AND ($3::boolean IS NULL OR ft.is_active = $3)
     ORDER BY ft.code ASC
     LIMIT $4 OFFSET $5`,
    [q, category, isActive, pageSize, offset]
  );

  return {
    rows: list.rows,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}
