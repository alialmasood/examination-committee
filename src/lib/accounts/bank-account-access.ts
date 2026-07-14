/**
 * صلاحيات العمليات على الحساب البنكي عبر bank_account_users (4.B).
 *
 * تجاوز الإدارة:
 * لا يوجد حالياً Role رسمي خاص بـ «Accounts Admin» مربوط بنظام ACCOUNTS
 * (platform.user_system_roles فارغ لـ ACCOUNTS؛ أدوار student_affairs عامة فقط).
 * لذلك التجاوز مؤقت ومركزي هنا فقط عبر مطابقة دقيقة لـ username من قاعدة البيانات.
 * يجب استبداله لاحقاً بصلاحية/دور رسمي دون الاعتماد على أسماء المستخدمين.
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankAccountPermissionFlag =
  | 'can_view'
  | 'can_prepare'
  | 'can_post'
  | 'can_approve'
  | 'can_reconcile';

/** قائمة مؤقتة — مطابقة دقيقة بعد trim + lower للحقل المخزّن فقط */
const PRIVILEGED_ACCOUNTS_USERNAMES = new Set([
  'accounts',
  'admin',
  'superadmin',
  'super_admin',
]);

/** لقوائم SQL — مصدر واحد مع دالة المطابقة أعلاه (حل مؤقت) */
export function privilegedAccountsUsernamesSqlInList(): string {
  return [...PRIVILEGED_ACCOUNTS_USERNAMES]
    .map((u) => `'${u.replace(/'/g, "''")}'`)
    .join(',');
}

/**
 * شرط القائمة: مستخدم privileged أو can_view على حساب بنكي.
 * userIdParam مثل `$11` — bankAccountIdExpr مثل `v.bank_account_id`.
 */
export function sqlUserCanViewBankAccount(
  userIdParam: string,
  bankAccountIdExpr: string
): string {
  const names = privilegedAccountsUsernamesSqlInList();
  return `(
    EXISTS (
      SELECT 1 FROM student_affairs.users u
      WHERE u.id = ${userIdParam}::uuid AND u.is_active = TRUE
        AND LOWER(TRIM(u.username)) IN (${names})
    )
    OR EXISTS (
      SELECT 1 FROM accounts.bank_account_users bau
      WHERE bau.bank_account_id = ${bankAccountIdExpr}
        AND bau.user_id = ${userIdParam}::uuid
        AND bau.can_view = TRUE
    )
  )`;
}

/**
 * شرط قائمة التحويلات: privileged أو can_view على المصدر والوجهة معاً.
 */
export function sqlUserCanViewBankTransferPair(
  userIdParam: string,
  sourceExpr: string,
  destinationExpr: string
): string {
  const names = privilegedAccountsUsernamesSqlInList();
  return `(
    EXISTS (
      SELECT 1 FROM student_affairs.users u
      WHERE u.id = ${userIdParam}::uuid AND u.is_active = TRUE
        AND LOWER(TRIM(u.username)) IN (${names})
    )
    OR (
      EXISTS (
        SELECT 1 FROM accounts.bank_account_users bau_s
        WHERE bau_s.bank_account_id = ${sourceExpr}
          AND bau_s.user_id = ${userIdParam}::uuid
          AND bau_s.can_view = TRUE
      )
      AND EXISTS (
        SELECT 1 FROM accounts.bank_account_users bau_d
        WHERE bau_d.bank_account_id = ${destinationExpr}
          AND bau_d.user_id = ${userIdParam}::uuid
          AND bau_d.can_view = TRUE
      )
    )
  )`;
}

/** مستخدمون نظاميون يُعتبرون حسابات Admin ويتجاوزون تخصيص البنك (حل مؤقت). */
export function isPrivilegedAccountsUsername(
  username: string | null | undefined
): boolean {
  const u = String(username ?? '').trim().toLowerCase();
  if (!u) return false;
  return PRIVILEGED_ACCOUNTS_USERNAMES.has(u);
}

/**
 * يقرأ username من DB بالمعرّف فقط — لا يعتمد على JWT display name أو قيمة عميل.
 */
export async function isAccountsPrivilegedUser(
  client: TxClient,
  userId: string
): Promise<boolean> {
  const r = await txQuery<{ username: string }>(
    client,
    `SELECT username FROM student_affairs.users
     WHERE id = $1::uuid AND is_active = TRUE`,
    [userId]
  );
  if (!r.rows[0]) return false;
  return isPrivilegedAccountsUsername(r.rows[0].username);
}

async function loadAssignmentFlag(
  client: TxClient,
  bankAccountId: string,
  userId: string,
  flag: BankAccountPermissionFlag
): Promise<boolean> {
  const allowedCols: Record<BankAccountPermissionFlag, string> = {
    can_view: 'can_view',
    can_prepare: 'can_prepare',
    can_post: 'can_post',
    can_approve: 'can_approve',
    can_reconcile: 'can_reconcile',
  };
  const col = allowedCols[flag];
  const r = await txQuery(
    client,
    `SELECT ${col} AS allowed
     FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid AND user_id = $2::uuid
     LIMIT 1`,
    [bankAccountId, userId]
  );
  return Boolean(r.rows[0]?.allowed);
}

async function assertBankAccountPermission(
  client: TxClient,
  params: {
    bankAccountId: string;
    userId: string;
    flag: BankAccountPermissionFlag;
    actionLabel: string;
  }
): Promise<void> {
  if (await isAccountsPrivilegedUser(client, params.userId)) return;

  const allowed = await loadAssignmentFlag(
    client,
    params.bankAccountId,
    params.userId,
    params.flag
  );
  if (!allowed) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية ${params.actionLabel} على هذا الحساب المصرفي`,
      403
    );
  }
}

export async function assertCanViewBankAccount(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<void> {
  await assertBankAccountPermission(client, {
    ...params,
    flag: 'can_view',
    actionLabel: 'عرض',
  });
}

export async function assertCanPrepareBankAccount(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<void> {
  await assertBankAccountPermission(client, {
    ...params,
    flag: 'can_prepare',
    actionLabel: 'إعداد/تعديل مسودة',
  });
}

export async function assertCanPostBankAccount(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<void> {
  await assertBankAccountPermission(client, {
    ...params,
    flag: 'can_post',
    actionLabel: 'ترحيل/إلغاء مرحّل',
  });
}
