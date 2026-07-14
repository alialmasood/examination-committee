/**
 * صلاحيات العمليات على الحساب البنكي عبر bank_account_users (4.B).
 * تجاوز الإدارة عبر hasAccountsAdminAccess (دور accounts_admin) — لا تعتمد على username كأساس دائم.
 */
import { AccountsHttpError } from './auth';
import {
  hasAccountsAdminAccess,
  sqlUserIsAccountsAdmin,
} from './accounts-access';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankAccountPermissionFlag =
  | 'can_view'
  | 'can_prepare'
  | 'can_post'
  | 'can_approve'
  | 'can_reconcile';

/**
 * شرط القائمة: Accounts Admin أو can_view على حساب بنكي.
 * userIdParam مثل `$11` — bankAccountIdExpr مثل `v.bank_account_id`.
 */
export function sqlUserCanViewBankAccount(
  userIdParam: string,
  bankAccountIdExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
    OR EXISTS (
      SELECT 1 FROM accounts.bank_account_users bau
      WHERE bau.bank_account_id = ${bankAccountIdExpr}
        AND bau.user_id = ${userIdParam}::uuid
        AND bau.can_view = TRUE
    )
  )`;
}

/**
 * شرط قائمة التحويلات: Admin أو can_view على المصدر والوجهة معاً.
 */
export function sqlUserCanViewBankTransferPair(
  userIdParam: string,
  sourceExpr: string,
  destinationExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
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
  if (await hasAccountsAdminAccess(client, params.userId)) return;

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

export async function assertCanViewBankAccountOrThrowNotFound(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<void> {
  try {
    await assertCanViewBankAccount(client, params);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === 403) {
      throw new AccountsHttpError('الحساب المصرفي غير موجود', 404);
    }
    throw e;
  }
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

export async function assertCanReconcileBankAccount(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<void> {
  await assertBankAccountPermission(client, {
    ...params,
    flag: 'can_reconcile',
    actionLabel: 'تسوية كشف الحساب المصرفي',
  });
}

/** شرط قائمة: Admin أو can_reconcile (عمليات التسوية) — أو can_view للعرض فقط عبر sqlUserCanView */
export function sqlUserCanReconcileBankAccount(
  userIdParam: string,
  bankAccountIdExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
    OR EXISTS (
      SELECT 1 FROM accounts.bank_account_users bau
      WHERE bau.bank_account_id = ${bankAccountIdExpr}
        AND bau.user_id = ${userIdParam}::uuid
        AND bau.can_reconcile = TRUE
    )
  )`;
}

/** قائمة/تفاصيل كشوف: عرض إذا can_view أو can_reconcile أو Admin */
export function sqlUserCanAccessBankStatementAccount(
  userIdParam: string,
  bankAccountIdExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
    OR EXISTS (
      SELECT 1 FROM accounts.bank_account_users bau
      WHERE bau.bank_account_id = ${bankAccountIdExpr}
        AND bau.user_id = ${userIdParam}::uuid
        AND (bau.can_view = TRUE OR bau.can_reconcile = TRUE)
    )
  )`;
}

/** @deprecated استخدم hasAccountsAdminAccess من accounts-access */
export {
  hasAccountsAdminAccess as isAccountsPrivilegedUser,
  isPrivilegedAccountsUsername,
} from './accounts-access';
