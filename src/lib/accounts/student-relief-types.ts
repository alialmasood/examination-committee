/**
 * أنواع التخفيضات والمنح والإعفاءات — 5.C.1
 *
 * قرار محاسبي: حساب الترحيل (gl_account_id) يجب أن يكون EXPENSE فقط.
 * لا يوجد CONTRA_REVENUE في محرك الحسابات — التمييز عبر relief_kind.
 */
import { AccountsHttpError } from './auth';
import {
  moneyIsPositive,
  normalizeMoneyInput,
} from './money';
import { assertPostingAccountWithType } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ReliefKind = 'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER';
export type ReliefCalculationType = 'FIXED_AMOUNT' | 'PERCENTAGE';

export type StudentReliefTypeRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  relief_kind: ReliefKind;
  calculation_type: ReliefCalculationType;
  default_value: string | null;
  max_value: string | null;
  gl_account_id: string;
  requires_approval: boolean;
  is_refundable: boolean;
  is_active: boolean;
  description: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const RELIEF_KINDS = new Set<ReliefKind>(['DISCOUNT', 'SCHOLARSHIP', 'WAIVER']);
const CALC_TYPES = new Set<ReliefCalculationType>(['FIXED_AMOUNT', 'PERCENTAGE']);

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

function requireCode(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز نوع التخفيض مطلوب', 400);
  if (s.length > 40) throw new AccountsHttpError('رمز نوع التخفيض طويل جداً', 400);
  if (!/^[A-Z0-9_\-]+$/.test(s)) {
    throw new AccountsHttpError('رمز نوع التخفيض يحتوي محارف غير مسموحة', 400);
  }
  return s;
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم نوع التخفيض بالعربية مطلوب', 400);
  return s.slice(0, 200);
}

function parseReliefKind(value: unknown): ReliefKind {
  const k = String(value ?? '').trim().toUpperCase() as ReliefKind;
  if (!RELIEF_KINDS.has(k)) {
    throw new AccountsHttpError('نوع الإعفاء غير صالح', 400);
  }
  return k;
}

function parseCalculationType(value: unknown): ReliefCalculationType {
  const c = String(value ?? '').trim().toUpperCase() as ReliefCalculationType;
  if (!CALC_TYPES.has(c)) {
    throw new AccountsHttpError('نوع الحساب غير صالح', 400);
  }
  return c;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
}

function parseOptionalMoney(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  try {
    const m = normalizeMoneyInput(value);
    if (!moneyIsPositive(m) && m !== '0.000') {
      throw new AccountsHttpError(`${label} يجب أن يكون أكبر من أو يساوي صفر`, 400);
    }
    return m;
  } catch (e) {
    if (e instanceof AccountsHttpError) throw e;
    throw new AccountsHttpError(`${label} غير صالح`, 400);
  }
}

/**
 * حساب مصروف ترحيلي صالح للتخفيض — EXPENSE فقط (لا CONTRA_REVENUE).
 */
export async function assertValidReliefExpenseGlAccount(
  client: TxClient,
  accountId: string
): Promise<{ id: string; code: string; account_type_code: string }> {
  const glId = String(accountId ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب المصروف الترحيلي مطلوب', 400);

  const acc = await assertPostingAccountWithType(
    client,
    glId,
    'حساب مصروف التخفيض',
    { invalidStatusCode: 400 }
  );
  if (acc.account_type_code !== 'EXPENSE') {
    throw new AccountsHttpError(
      'يجب أن يكون حساب التخفيض من نوع المصروفات (EXPENSE) — لا CONTRA_REVENUE في المحرك',
      400
    );
  }
  if (acc.code.startsWith('111')) {
    throw new AccountsHttpError('لا يمكن استخدام حساب نقدي (111*) كمصروف تخفيض', 400);
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
      `لا يمكن استخدام حساب صندوق نقدي كمصروف تخفيض (${cash.rows[0].code})`,
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
      `لا يمكن استخدام حساب بنكي كمصروف تخفيض (${bank.rows[0].code})`,
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
      'لا يمكن استخدام حساب ذمم طلبة كمصروف تخفيض',
      400
    );
  }

  return {
    id: acc.id,
    code: acc.code,
    account_type_code: acc.account_type_code,
  };
}

export async function listEligibleReliefExpenseGlAccounts(
  client: TxClient
): Promise<
  Array<{ id: string; code: string; name_ar: string; account_type_code: string }>
> {
  const r = await txQuery(
    client,
    `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'EXPENSE'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND a.code NOT LIKE '111%'
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

export function serializeStudentReliefType(row: StudentReliefTypeRow) {
  return {
    ...row,
    default_value:
      row.default_value == null ? null : normalizeMoneyInput(row.default_value),
    max_value: row.max_value == null ? null : normalizeMoneyInput(row.max_value),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadStudentReliefType(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentReliefTypeRow> {
  const r = await txQuery<StudentReliefTypeRow>(
    client,
    `SELECT * FROM accounts.student_relief_types WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('نوع التخفيض غير موجود', 404);
  return r.rows[0];
}

export async function createStudentReliefType(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    relief_kind: unknown;
    calculation_type: unknown;
    default_value?: unknown;
    max_value?: unknown;
    gl_account_id: unknown;
    requires_approval?: unknown;
    description?: unknown;
    created_by: string;
  }
): Promise<StudentReliefTypeRow> {
  await assertValidReliefExpenseGlAccount(
    client,
    String(input.gl_account_id ?? '')
  );

  const ins = await txQuery<StudentReliefTypeRow>(
    client,
    `INSERT INTO accounts.student_relief_types (
       code, name_ar, name_en, relief_kind, calculation_type,
       default_value, max_value, gl_account_id,
       requires_approval, is_refundable, is_active, description,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::uuid,
       $9,FALSE,TRUE,$10,$11::uuid,$11::uuid
     ) RETURNING *`,
    [
      requireCode(input.code),
      requireNameAr(input.name_ar),
      optText(input.name_en, 200),
      parseReliefKind(input.relief_kind),
      parseCalculationType(input.calculation_type),
      parseOptionalMoney(input.default_value, 'القيمة الافتراضية'),
      parseOptionalMoney(input.max_value, 'الحد الأقصى'),
      String(input.gl_account_id).trim(),
      bool(input.requires_approval, true),
      optText(input.description, 4000),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateStudentReliefType(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    name_ar?: unknown;
    name_en?: unknown;
    relief_kind?: unknown;
    calculation_type?: unknown;
    default_value?: unknown;
    max_value?: unknown;
    gl_account_id?: unknown;
    requires_approval?: unknown;
    description?: unknown;
  }
): Promise<StudentReliefTypeRow> {
  const row = await loadStudentReliefType(client, params.id, true);

  let glId = row.gl_account_id;
  if (params.gl_account_id !== undefined && params.gl_account_id !== '') {
    glId = String(params.gl_account_id).trim();
    await assertValidReliefExpenseGlAccount(client, glId);
  }

  let defaultValue = row.default_value;
  if (params.default_value !== undefined) {
    defaultValue = parseOptionalMoney(params.default_value, 'القيمة الافتراضية');
  }
  let maxValue = row.max_value;
  if (params.max_value !== undefined) {
    maxValue = parseOptionalMoney(params.max_value, 'الحد الأقصى');
  }

  const upd = await txQuery<StudentReliefTypeRow>(
    client,
    `UPDATE accounts.student_relief_types SET
       name_ar = $2,
       name_en = $3,
       relief_kind = $4,
       calculation_type = $5,
       default_value = $6::numeric,
       max_value = $7::numeric,
       gl_account_id = $8::uuid,
       requires_approval = $9,
       description = $10,
       updated_by = $11::uuid,
       updated_at = NOW()
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
      params.relief_kind !== undefined
        ? parseReliefKind(params.relief_kind)
        : row.relief_kind,
      params.calculation_type !== undefined
        ? parseCalculationType(params.calculation_type)
        : row.calculation_type,
      defaultValue,
      maxValue,
      glId,
      params.requires_approval !== undefined
        ? bool(params.requires_approval, row.requires_approval)
        : row.requires_approval,
      params.description !== undefined
        ? optText(params.description, 4000)
        : row.description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function deactivateStudentReliefType(
  client: TxClient,
  params: { id: string; userId: string }
): Promise<StudentReliefTypeRow> {
  const row = await loadStudentReliefType(client, params.id, true);
  if (!row.is_active) return row;

  const activeUse = await txQuery(
    client,
    `SELECT 1 FROM accounts.student_reliefs
     WHERE relief_type_id = $1::uuid
       AND status NOT IN ('VOID', 'REJECTED', 'POSTED')
     LIMIT 1`,
    [row.id]
  );
  if (activeUse.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن إلغاء تفعيل نوع مرتبط بطلبات تخفيض نشطة',
      409
    );
  }

  const upd = await txQuery<StudentReliefTypeRow>(
    client,
    `UPDATE accounts.student_relief_types SET
       is_active = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

export async function listStudentReliefTypes(
  client: TxClient,
  filters: {
    q?: string;
    relief_kind?: string | null;
    is_active?: boolean | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentReliefTypeRow & {
      gl_code?: string | null;
      gl_name_ar?: string | null;
    }
  >;
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (filters.q ?? '').trim();

  const where = `
    WHERE ($1 = '' OR srt.code ILIKE '%'||$1||'%'
           OR srt.name_ar ILIKE '%'||$1||'%'
           OR COALESCE(srt.name_en,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR srt.relief_kind = $2)
      AND ($3::boolean IS NULL OR srt.is_active = $3)
  `;
  const params = [q, filters.relief_kind || null, filters.is_active ?? null];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_relief_types srt
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT srt.*,
            a.code AS gl_code,
            a.name_ar AS gl_name_ar
     FROM accounts.student_relief_types srt
     JOIN accounts.chart_of_accounts a ON a.id = srt.gl_account_id
     ${where}
     ORDER BY srt.code
     LIMIT $4 OFFSET $5`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentReliefTypeRow & {
        gl_code?: string | null;
        gl_name_ar?: string | null;
      }
    >,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}

export async function getStudentReliefType(
  client: TxClient,
  id: string
): Promise<
  StudentReliefTypeRow & {
    gl_code?: string | null;
    gl_name_ar?: string | null;
  }
> {
  const r = await txQuery(
    client,
    `SELECT srt.*,
            a.code AS gl_code,
            a.name_ar AS gl_name_ar
     FROM accounts.student_relief_types srt
     JOIN accounts.chart_of_accounts a ON a.id = srt.gl_account_id
     WHERE srt.id = $1::uuid`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('نوع التخفيض غير موجود', 404);
  return r.rows[0] as StudentReliefTypeRow & {
    gl_code?: string | null;
    gl_name_ar?: string | null;
  };
}
