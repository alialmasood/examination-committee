/**
 * فحص مشترك لحساب الترحيل (posting account) — يُستخدم قبل أي قيد محاسبي للتحقق من أن
 * الحساب المُستهدف تفصيلي (ليس مجموعاً)، قابل للترحيل، وفعّال.
 *
 * استُخرج من نسخ متطابقة تقريباً كانت مكرّرة في: bank-vouchers.ts، cash-vouchers.ts،
 * cash-transfers.ts، bank-transfers.ts، cash-count-adjustments.ts (Sprint A — Architecture
 * Hardening). كل موقع استدعاء يحافظ على كود الحالة (400/409) الذي كان يستخدمه سابقاً عبر
 * `invalidStatusCode` لتفادي أي تغيير سلوك.
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PostingAccount = {
  id: string;
  code: string;
  requires_cost_center: boolean;
};

export type PostingAccountWithType = PostingAccount & {
  account_type_code: string;
};

export type AssertPostingAccountOptions = {
  /** كود حالة HTTP عند حساب غير صالح للترحيل (مجموع/غير ترحيلي/معطّل) — افتراضي 409 */
  invalidStatusCode?: number;
};

/** يتحقق من أن الحساب موجود، تفصيلي، قابل للترحيل، وفعّال. يعيد الحقول الأساسية اللازمة للترحيل. */
export async function assertPostingAccount(
  client: TxClient,
  accountId: string,
  label: string,
  options?: AssertPostingAccountOptions
): Promise<PostingAccount> {
  const invalidStatusCode = options?.invalidStatusCode ?? 409;
  const r = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    requires_cost_center: boolean;
  }>(
    client,
    `SELECT id, code, is_active, is_group, allow_posting, requires_cost_center
     FROM accounts.chart_of_accounts WHERE id = $1::uuid`,
    [accountId]
  );
  if (!r.rows[0]) throw new AccountsHttpError(`${label} غير موجود`, 404);
  const a = r.rows[0];
  if (!a.is_active || a.is_group || !a.allow_posting) {
    throw new AccountsHttpError(
      `${label} يجب أن يكون تفصيلياً وقابلاً للترحيل وفعّالاً`,
      invalidStatusCode
    );
  }
  return {
    id: a.id,
    code: a.code,
    requires_cost_center: a.requires_cost_center,
  };
}

/** نفس الفحص أعلاه، مع إرفاق كود نوع الحساب (account_types.code) — تحتاجه bank-transfers. */
export async function assertPostingAccountWithType(
  client: TxClient,
  accountId: string,
  label: string,
  options?: AssertPostingAccountOptions
): Promise<PostingAccountWithType> {
  const invalidStatusCode = options?.invalidStatusCode ?? 409;
  const r = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    requires_cost_center: boolean;
    account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.is_active, a.is_group, a.allow_posting,
            a.requires_cost_center, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1::uuid`,
    [accountId]
  );
  if (!r.rows[0]) throw new AccountsHttpError(`${label} غير موجود`, 404);
  const a = r.rows[0];
  if (!a.is_active || a.is_group || !a.allow_posting) {
    throw new AccountsHttpError(
      `${label} يجب أن يكون تفصيلياً وترحيلياً وفعّالاً`,
      invalidStatusCode
    );
  }
  return {
    id: a.id,
    code: a.code,
    requires_cost_center: a.requires_cost_center,
    account_type_code: a.account_type_code,
  };
}
