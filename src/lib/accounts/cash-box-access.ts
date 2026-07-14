/**
 * سياسة رؤية النقد / الصناديق (Sprint A):
 *
 * - Accounts Admin: يرى جميع الصناديق والجلسات والسندات والتحويلات.
 * - أمين الصندوق (تشغيلي): يرى الصناديق التي له عليها تعيين أمين ساري
 *   (cash_box_custodians.valid_to IS NULL) — وليس فقط is_primary.
 * - الجلسات: نفس عزل الصندوق.
 * - سندات الصندوق: عبر cash_box_id المرتبط.
 * - التحويلات النقدية: تظهر إن كان المستخدم يرى المصدر أو الوجهة
 *   (يختلف عن التحويل البنكي الذي يتطلب can_view على الطرفين لأن تخصيص البنك أدق).
 *
 * قيد معروف: جدول الأمناء يدعم primary+ثانوي عبر is_primary؛ العزل الحالي
 * يشمل أي أمين ساري. لا يوجد فرع/قسم منفصل لعزل إضافي.
 */
import { AccountsHttpError } from './auth';
import {
  hasAccountsAdminAccess,
  sqlUserIsAccountsAdmin,
} from './accounts-access';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

/** أمين ساري على الصندوق */
export function sqlUserIsActiveCashBoxCustodian(
  userIdParam: string,
  cashBoxIdExpr: string
): string {
  return `EXISTS (
    SELECT 1 FROM accounts.cash_box_custodians c
    WHERE c.cash_box_id = ${cashBoxIdExpr}
      AND c.user_id = ${userIdParam}::uuid
      AND c.valid_to IS NULL
  )`;
}

export function sqlUserCanViewCashBox(
  userIdParam: string,
  cashBoxIdExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
    OR ${sqlUserIsActiveCashBoxCustodian(userIdParam, cashBoxIdExpr)}
  )`;
}

/** تحويل نقدي: Admin أو أمين على المصدر أو الوجهة */
export function sqlUserCanViewCashTransferPair(
  userIdParam: string,
  sourceBoxExpr: string,
  destBoxExpr: string
): string {
  return `(
    ${sqlUserIsAccountsAdmin(userIdParam)}
    OR ${sqlUserIsActiveCashBoxCustodian(userIdParam, sourceBoxExpr)}
    OR ${sqlUserIsActiveCashBoxCustodian(userIdParam, destBoxExpr)}
  )`;
}

export async function assertCanViewCashBox(
  client: TxClient,
  params: { cashBoxId: string; userId: string }
): Promise<void> {
  if (await hasAccountsAdminAccess(client, params.userId)) return;

  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.cash_box_custodians c
     WHERE c.cash_box_id = $1::uuid
       AND c.user_id = $2::uuid
       AND c.valid_to IS NULL
     LIMIT 1`,
    [params.cashBoxId, params.userId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('ليس لديك صلاحية عرض هذا الصندوق', 403);
  }
}

export async function assertCanViewCashBoxOrThrowNotFound(
  client: TxClient,
  params: { cashBoxId: string; userId: string }
): Promise<void> {
  try {
    await assertCanViewCashBox(client, params);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === 403) {
      throw new AccountsHttpError('الصندوق غير موجود', 404);
    }
    throw e;
  }
}

/** تحويل نقدي: Admin أو أمين على المصدر أو الوجهة */
export async function assertCanViewCashTransfer(
  client: TxClient,
  params: {
    sourceCashBoxId: string;
    destinationCashBoxId: string;
    userId: string;
  }
): Promise<void> {
  if (await hasAccountsAdminAccess(client, params.userId)) return;

  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.cash_box_custodians c
     WHERE c.user_id = $1::uuid
       AND c.valid_to IS NULL
       AND c.cash_box_id IN ($2::uuid, $3::uuid)
     LIMIT 1`,
    [params.userId, params.sourceCashBoxId, params.destinationCashBoxId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('ليس لديك صلاحية عرض هذا التحويل', 403);
  }
}

export async function assertCanViewCashTransferOrThrowNotFound(
  client: TxClient,
  params: {
    sourceCashBoxId: string;
    destinationCashBoxId: string;
    userId: string;
  }
): Promise<void> {
  try {
    await assertCanViewCashTransfer(client, params);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === 403) {
      throw new AccountsHttpError('التحويل غير موجود', 404);
    }
    throw e;
  }
}
