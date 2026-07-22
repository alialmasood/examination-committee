/**
 * الحسابات المالية للطلبة — المرحلة 5.A
 */
import {
  acquireAccountingResourceLocks,
  chartAccountLock,
  studentAccountLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  yearLabelFromDate,
} from './document-sequences';
import {
  moneyEquals,
  moneyIsZero,
  normalizeSignedMoneyInput,
} from './money';
import { assertPostingAccountWithType } from './posting-account';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from './student-receivables-access';
import {
  assertStudentEligibleForAccount,
} from './students-ref';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

/** أكواد نقد رئيسية شائعة — لا تُستخدم كذمم طلبة */
function isCashMainGlCode(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!c) return false;
  if (c.startsWith('111')) return true;
  return /^111[0-9]$/.test(c);
}

export type StudentAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type StudentAccountRow = {
  id: string;
  student_id: string;
  account_number: string;
  status: StudentAccountStatus;
  currency_code: string;
  receivable_gl_account_id: string;
  department_id: string | null;
  academic_year: string | null;
  opening_reference: string | null;
  notes: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  suspended_at: Date | string | null;
  suspended_by: string | null;
  closed_at: Date | string | null;
  closed_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type StudentAccountListRow = StudentAccountRow & {
  student_full_name_ar?: string | null;
  student_university_id?: string | null;
  student_number?: string | null;
  student_major?: string | null;
  student_admission_type?: string | null;
  receivable_gl_code?: string | null;
  receivable_gl_name_ar?: string | null;
};

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

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError(
      'عملة حساب الطالب في المرحلة الحالية IQD فقط',
      400
    );
  }
  return code;
}

function assertOptimistic(
  row: StudentAccountRow,
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

export function serializeStudentAccount(row: StudentAccountRow) {
  return {
    ...row,
    suspended_at: iso(row.suspended_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** حساب ذمم طلبة: ASSET ترحيلي فعّال — ليس صندوقاً (حساب تشغيلي أو مغلق) ولا بنكاً ولا نقد 111* */
export async function assertValidReceivableGlAccount(
  client: TxClient,
  accountId: string
): Promise<{
  id: string;
  code: string;
  name_ar?: string;
  requires_cost_center: boolean;
}> {
  const glId = String(accountId ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب الذمم المدينة مطلوب', 400);

  const acc = await assertPostingAccountWithType(
    client,
    glId,
    'حساب الذمم المدينة',
    { invalidStatusCode: 400 }
  );
  if (acc.account_type_code !== 'ASSET') {
    throw new AccountsHttpError(
      'يجب أن يكون حساب الذمم من نوع الأصول (ASSET)',
      400
    );
  }

  if (isCashMainGlCode(acc.code)) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب نقد رئيسي كذمم طلبة (${acc.code})`,
      400
    );
  }

  const cash = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.cash_boxes
     WHERE account_id = $1::uuid OR closed_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (cash.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب صندوق نقدي كذمم طلبة (${cash.rows[0].code})`,
      400
    );
  }

  const bank = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.bank_accounts
     WHERE gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (bank.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب بنكي كذمم طلبة (${bank.rows[0].code})`,
      400
    );
  }

  return {
    id: acc.id,
    code: acc.code,
    requires_cost_center: acc.requires_cost_center,
  };
}

export async function listEligibleReceivableGlAccounts(
  client: TxClient
): Promise<
  Array<{ id: string; code: string; name_ar: string; account_type_code: string }>
> {
  const r = await txQuery(
    client,
    `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND a.code NOT LIKE '111%'
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb
         WHERE cb.account_id = a.id OR cb.closed_account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.bank_accounts ba WHERE ba.gl_account_id = a.id
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

async function getDefaultActiveFiscalYear(
  client: TxClient
): Promise<{ id: string; start_date: string }> {
  const r = await txQuery<{ id: string; start_date: string }>(
    client,
    `SELECT id, start_date::text AS start_date
     FROM accounts.fiscal_years
     WHERE status = 'ACTIVE'
     ORDER BY is_default DESC, start_date DESC
     LIMIT 1`
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('لا توجد سنة مالية نشطة', 409);
  }
  return r.rows[0];
}

export async function allocateStudentAccountNumber(
  client: TxClient
): Promise<string> {
  const year = await getDefaultActiveFiscalYear(client);
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'STUDENT_ACCOUNT', $1::uuid, 'STA', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'STUDENT_ACCOUNT' AND fiscal_year_id = $1::uuid
     )`,
    [year.id]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'STUDENT_ACCOUNT',
      fiscalYearId: year.id,
      yearLabel: yearLabelFromDate(year.start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم الحساب المالي';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadStudentAccount(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentAccountRow> {
  const r = await txQuery<StudentAccountRow>(
    client,
    `SELECT * FROM accounts.student_accounts WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الحساب المالي للطالب غير موجود', 404);
  return r.rows[0];
}

export async function findStudentAccountByStudentCurrency(
  client: TxClient,
  studentId: string,
  currencyCode = 'IQD'
): Promise<StudentAccountRow | null> {
  const r = await txQuery<StudentAccountRow>(
    client,
    `SELECT * FROM accounts.student_accounts
     WHERE student_id = $1::uuid AND currency_code = $2
     LIMIT 1`,
    [studentId, currencyCode]
  );
  return r.rows[0] ?? null;
}

/** حساب ذمم الطلبة الافتراضي من دليل الحسابات (1131 ثم 1132) */
export async function resolveDefaultStudentReceivableGlId(
  client: TxClient
): Promise<string | null> {
  const preferred = await txQuery<{ id: string }>(
    client,
    `SELECT a.id
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND a.code = ANY($1::text[])
     ORDER BY CASE a.code WHEN '1131' THEN 0 WHEN '1132' THEN 1 ELSE 2 END
     LIMIT 1`,
    [['1131', '1132']]
  );
  if (preferred.rows[0]?.id) return preferred.rows[0].id;

  const eligible = await listEligibleReceivableGlAccounts(client);
  return eligible[0]?.id ?? null;
}

/**
 * إنشاء حسابات مالية للطلبة الذين أكملوا الدفع من صفحة الأقساط
 * ولم يُنشأ لهم حساب في accounts.student_accounts بعد.
 */
export async function ensureStudentAccountsForPaidStudents(
  client: TxClient,
  createdBy: string,
  options?: { studentIds?: string[] }
): Promise<{ created: number; skipped: number }> {
  const receivableGlId = await resolveDefaultStudentReceivableGlId(client);
  if (!receivableGlId) {
    return { created: 0, skipped: 0 };
  }

  const studentFilter = options?.studentIds?.length
    ? `AND s.id = ANY($1::uuid[])`
    : '';
  const params: unknown[] = options?.studentIds?.length
    ? [options.studentIds]
    : [];

  const missing = await txQuery<{ id: string; academic_year: string | null }>(
    client,
    `SELECT s.id, s.academic_year
     FROM student_affairs.students s
     WHERE COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') = 'paid'
       AND LOWER(TRIM(COALESCE(s.status, 'active'))) = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM accounts.student_accounts sa
         WHERE sa.student_id = s.id AND sa.currency_code = 'IQD'
       )
       ${studentFilter}
     ORDER BY s.payment_date DESC NULLS LAST, s.updated_at DESC NULLS LAST
     LIMIT 2000`,
    params
  );

  let created = 0;
  let skipped = 0;
  for (const row of missing.rows) {
    try {
      await getOrCreateStudentAccount(client, {
        student_id: row.id,
        receivable_gl_account_id: receivableGlId,
        academic_year: row.academic_year,
        notes: 'مزامنة تلقائية بعد تأكيد الدفع من أقساط الطلبة',
        created_by: createdBy,
      });
      created += 1;
    } catch (err) {
      skipped += 1;
      console.error('تعذر إنشاء حساب مالي لطالب مسدد:', row.id, err);
    }
  }

  return { created, skipped };
}

/** رصيد دفتر الطالب = مجموع المدين − مجموع الدائن (لا يشمل opening_reference) */
export async function getStudentAccountBalance(
  client: TxClient,
  studentAccountId: string
): Promise<string> {
  const r = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text AS balance
     FROM accounts.student_ledger_entries
     WHERE student_account_id = $1::uuid
       AND entry_type <> 'OPENING_REFERENCE'`,
    [studentAccountId]
  );
  return normalizeSignedMoneyInput(r.rows[0]?.balance ?? '0');
}

export async function assertStudentAccountActiveForCharges(
  client: TxClient,
  account: StudentAccountRow
): Promise<void> {
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء مطالبة على حساب مغلق', 409);
  }
  if (account.status === 'SUSPENDED') {
    throw new AccountsHttpError(
      'لا يمكن إنشاء مطالبة على حساب معلّق',
      409
    );
  }
  if (account.status !== 'ACTIVE') {
    throw new AccountsHttpError('حالة الحساب المالي لا تسمح بالمطالبات', 409);
  }
}

export async function createStudentAccount(
  client: TxClient,
  input: {
    student_id: unknown;
    receivable_gl_account_id: unknown;
    currency_code?: unknown;
    department_id?: unknown;
    academic_year?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<StudentAccountRow> {
  const studentId = String(input.student_id ?? '').trim();
  if (!studentId) throw new AccountsHttpError('معرّف الطالب مطلوب', 400);

  const student = await assertStudentEligibleForAccount(client, studentId);
  const currency = assertIqdOnly(input.currency_code);

  const existing = await findStudentAccountByStudentCurrency(
    client,
    studentId,
    currency
  );
  if (existing) {
    throw new AccountsHttpError(
      'يوجد حساب مالي لهذا الطالب بنفس العملة مسبقاً',
      409
    );
  }

  const gl = await assertValidReceivableGlAccount(
    client,
    String(input.receivable_gl_account_id ?? '')
  );

  const accountNumber = await allocateStudentAccountNumber(client);

  const departmentId: string | null =
    input.department_id != null && input.department_id !== ''
      ? String(input.department_id).trim()
      : student.department_id;

  const ins = await txQuery<StudentAccountRow>(
    client,
    `INSERT INTO accounts.student_accounts (
       student_id, account_number, status, currency_code,
       receivable_gl_account_id, department_id, academic_year,
       opening_reference, notes, created_by, updated_by
     ) VALUES (
       $1::uuid, $2, 'ACTIVE', $3, $4::uuid, $5::uuid, $6, $7, $8, $9::uuid, $9::uuid
     ) RETURNING *`,
    [
      studentId,
      accountNumber,
      currency,
      gl.id,
      departmentId,
      optText(input.academic_year, 20) ?? student.academic_year,
      optText(input.opening_reference, 2000),
      optText(input.notes, 4000),
      input.created_by,
    ]
  );

  const row = ins.rows[0];
  await acquireAccountingResourceLocks(client, [
    studentAccountLock(row.id),
    chartAccountLock(row.receivable_gl_account_id),
  ]);
  return row;
}

export async function getOrCreateStudentAccount(
  client: TxClient,
  input: {
    student_id: unknown;
    receivable_gl_account_id: unknown;
    currency_code?: unknown;
    department_id?: unknown;
    academic_year?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<{ account: StudentAccountRow; created: boolean }> {
  const studentId = String(input.student_id ?? '').trim();
  if (!studentId) throw new AccountsHttpError('معرّف الطالب مطلوب', 400);
  const currency = assertIqdOnly(input.currency_code);

  const existing = await findStudentAccountByStudentCurrency(
    client,
    studentId,
    currency
  );
  if (existing) {
    return { account: existing, created: false };
  }
  const account = await createStudentAccount(client, input);
  return { account, created: true };
}

export async function updateStudentAccount(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    department_id?: unknown;
    academic_year?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
    receivable_gl_account_id?: unknown;
  }
): Promise<StudentAccountRow> {
  const acc = await loadStudentAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعديل حساب مالي مغلق', 409);
  }

  await acquireAccountingResourceLocks(client, [
    studentAccountLock(acc.id),
    chartAccountLock(acc.receivable_gl_account_id),
  ]);

  let glId = acc.receivable_gl_account_id;
  if (
    params.receivable_gl_account_id !== undefined &&
    params.receivable_gl_account_id !== ''
  ) {
    const posted = await txQuery(
      client,
      `SELECT 1 FROM accounts.student_charges
       WHERE student_account_id = $1::uuid AND status <> 'DRAFT' AND status <> 'VOID'
       LIMIT 1`,
      [acc.id]
    );
    if (posted.rows[0]) {
      throw new AccountsHttpError(
        'لا يمكن تغيير حساب الذمم بعد وجود مطالبات مرحّلة',
        409
      );
    }
    const gl = await assertValidReceivableGlAccount(
      client,
      String(params.receivable_gl_account_id)
    );
    glId = gl.id;
  }

  let departmentId = acc.department_id;
  if (params.department_id !== undefined) {
    departmentId =
      params.department_id === null || params.department_id === ''
        ? null
        : String(params.department_id).trim();
  }

  const upd = await txQuery<StudentAccountRow>(
    client,
    `UPDATE accounts.student_accounts SET
       receivable_gl_account_id = $2::uuid,
       department_id = $3::uuid,
       academic_year = $4,
       opening_reference = $5,
       notes = $6,
       updated_by = $7::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      acc.id,
      glId,
      departmentId,
      params.academic_year !== undefined
        ? optText(params.academic_year, 20)
        : acc.academic_year,
      params.opening_reference !== undefined
        ? optText(params.opening_reference, 2000)
        : acc.opening_reference,
      params.notes !== undefined ? optText(params.notes, 4000) : acc.notes,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function suspendStudentAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<StudentAccountRow> {
  const acc = await loadStudentAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعليق حساب مغلق', 409);
  }
  if (acc.status === 'SUSPENDED') return acc;

  await acquireAccountingResourceLocks(client, [
    studentAccountLock(acc.id),
    chartAccountLock(acc.receivable_gl_account_id),
  ]);

  const upd = await txQuery<StudentAccountRow>(
    client,
    `UPDATE accounts.student_accounts SET
       status = 'SUSPENDED',
       suspended_at = NOW(),
       suspended_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function activateStudentAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<StudentAccountRow> {
  const acc = await loadStudentAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إعادة فتح حساب مغلق', 409);
  }
  if (acc.status === 'ACTIVE') return acc;

  await assertValidReceivableGlAccount(client, acc.receivable_gl_account_id);
  await acquireAccountingResourceLocks(client, [
    studentAccountLock(acc.id),
    chartAccountLock(acc.receivable_gl_account_id),
  ]);

  const upd = await txQuery<StudentAccountRow>(
    client,
    `UPDATE accounts.student_accounts SET
       status = 'ACTIVE',
       suspended_at = NULL,
       suspended_by = NULL,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function closeStudentAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<StudentAccountRow> {
  await assertStudentReceivablesCapability(
    client,
    params.userId,
    STUDENT_RECEIVABLES_CAPABILITIES.CLOSE
  );

  const acc = await loadStudentAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') return acc;

  await acquireAccountingResourceLocks(client, [
    studentAccountLock(acc.id),
    chartAccountLock(acc.receivable_gl_account_id),
  ]);

  const balance = await getStudentAccountBalance(client, acc.id);
  if (!moneyIsZero(balance) && !moneyEquals(balance, '0')) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق الحساب المالي لأن رصيد الطالب غير صفري',
      409
    );
  }

  const openDraft = await txQuery(
    client,
    `SELECT 1 FROM accounts.student_charges
     WHERE student_account_id = $1::uuid AND status = 'DRAFT'
     LIMIT 1`,
    [acc.id]
  );
  if (openDraft.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق الحساب لوجود مطالبات مسودة',
      409
    );
  }

  const upd = await txQuery<StudentAccountRow>(
    client,
    `UPDATE accounts.student_accounts SET
       status = 'CLOSED',
       closed_at = NOW(),
       closed_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function listStudentAccounts(
  client: TxClient,
  filters: {
    q?: string;
    status?: string | null;
    department_id?: string | null;
    admission_type?: string | null;
    academic_year?: string | null;
    has_balance?: boolean | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: StudentAccountListRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.page_size ?? 20));
  const offset = (page - 1) * pageSize;
  const q = (filters.q ?? '').trim();
  const status = filters.status || null;
  const departmentId = filters.department_id || null;
  const admissionType = filters.admission_type || null;
  const academicYear = filters.academic_year || null;
  const hasBalance =
    filters.has_balance === undefined || filters.has_balance === null
      ? null
      : Boolean(filters.has_balance);

  const where = `
    WHERE ($1 = '' OR sa.account_number ILIKE '%'||$1||'%'
           OR COALESCE(s.university_id,'') ILIKE '%'||$1||'%'
           OR COALESCE(s.student_number,'') ILIKE '%'||$1||'%'
           OR COALESCE(s.full_name_ar,'') ILIKE '%'||$1||'%'
           OR COALESCE(s.full_name,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR sa.status = $2)
      AND ($3::uuid IS NULL OR sa.department_id = $3::uuid OR s.department_id = $3::uuid)
      AND ($4::text IS NULL OR s.admission_type = $4)
      AND ($5::text IS NULL OR sa.academic_year = $5 OR s.academic_year = $5)
      AND COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') = 'paid'
      AND (
        $6::boolean IS NULL
        OR (
          $6 = TRUE AND COALESCE((
            SELECT SUM(le.debit_amount - le.credit_amount)
            FROM accounts.student_ledger_entries le
            WHERE le.student_account_id = sa.id
              AND le.entry_type <> 'OPENING_REFERENCE'
          ), 0) <> 0
        )
        OR (
          $6 = FALSE AND COALESCE((
            SELECT SUM(le.debit_amount - le.credit_amount)
            FROM accounts.student_ledger_entries le
            WHERE le.student_account_id = sa.id
              AND le.entry_type <> 'OPENING_REFERENCE'
          ), 0) = 0
        )
      )
  `;
  const params = [q, status, departmentId, admissionType, academicYear, hasBalance];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_accounts sa
     JOIN student_affairs.students s ON s.id = sa.student_id
     ${where}`,
    params
  );

  const list = await txQuery<StudentAccountListRow>(
    client,
    `SELECT sa.*,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
            s.university_id AS student_university_id,
            COALESCE(NULLIF(TRIM(s.student_number), ''), s.university_id) AS student_number,
            s.major AS student_major,
            s.admission_type AS student_admission_type,
            a.code AS receivable_gl_code,
            a.name_ar AS receivable_gl_name_ar
     FROM accounts.student_accounts sa
     JOIN student_affairs.students s ON s.id = sa.student_id
     LEFT JOIN accounts.chart_of_accounts a ON a.id = sa.receivable_gl_account_id
     ${where}
     ORDER BY sa.account_number ASC
     LIMIT $7 OFFSET $8`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}
