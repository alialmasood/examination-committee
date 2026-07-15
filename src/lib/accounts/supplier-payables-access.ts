/**
 * صلاحيات الموردين والذمم الدائنة (6.A).
 *
 * المصدر الرسمي: دور platform ACCOUNTS عبر user_system_roles
 * (accounts_viewer | accounts_clerk | accounts_admin).
 *
 * سياسة:
 * - Viewer: عرض فقط
 * - Clerk: إدارة موردين + إعداد فواتير DRAFT + أنواع فواتير — دون POST/VOID
 * - Admin: الكل بما فيه إغلاق الحساب المالي
 *
 * لا username override.
 */
import { AccountsHttpError } from './auth';
import {
  ACCOUNTS_ADMIN_ROLE_CODE,
  ACCOUNTS_PLATFORM_SYSTEM_CODE,
  hasAccountsAdminAccess,
} from './accounts-access';
import {
  ACCOUNTS_APPROVER_ROLE_CODE,
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
  grantAccountsPlatformRole,
} from './student-receivables-access';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { query } from '@/src/lib/db';

export const SUPPLIER_PAYABLES_CAPABILITIES = {
  VIEW: 'suppliers.view',
  MANAGE: 'suppliers.manage',
  INVOICE_TYPES_MANAGE: 'supplier_invoice_types.manage',
  INVOICES_PREPARE: 'supplier_invoices.prepare',
  INVOICES_POST: 'supplier_invoices.post',
  INVOICES_VOID: 'supplier_invoices.void',
  CLOSE: 'supplier_accounts.close',
} as const;

export type SupplierPayablesCapability =
  (typeof SUPPLIER_PAYABLES_CAPABILITIES)[keyof typeof SUPPLIER_PAYABLES_CAPABILITIES];

const VIEW_ONLY = new Set<string>([SUPPLIER_PAYABLES_CAPABILITIES.VIEW]);

const CLERK_CAPS = new Set<string>([
  SUPPLIER_PAYABLES_CAPABILITIES.VIEW,
  SUPPLIER_PAYABLES_CAPABILITIES.MANAGE,
  SUPPLIER_PAYABLES_CAPABILITIES.INVOICE_TYPES_MANAGE,
  SUPPLIER_PAYABLES_CAPABILITIES.INVOICES_PREPARE,
]);

const APPROVER_CAPS = new Set<string>([SUPPLIER_PAYABLES_CAPABILITIES.VIEW]);

const ADMIN_CAPS = new Set<string>([
  ...CLERK_CAPS,
  SUPPLIER_PAYABLES_CAPABILITIES.INVOICES_POST,
  SUPPLIER_PAYABLES_CAPABILITIES.INVOICES_VOID,
  SUPPLIER_PAYABLES_CAPABILITIES.CLOSE,
]);

type Runner = (
  text: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

function runnerFor(client: TxClient | null): Runner {
  return client != null
    ? (text, params) => txQuery(client, text, params)
    : (text, params) => query(text, params);
}

async function loadAccountsPlatformRoleCode(
  runner: Runner,
  userId: string
): Promise<string | null> {
  const r = await runner(
    `SELECT r.code
     FROM platform.user_system_roles usr
     JOIN platform.systems ps ON ps.id = usr.system_id
       AND ps.code = $2 AND ps.is_active = TRUE
     JOIN student_affairs.roles r ON r.id = usr.role_id
     WHERE usr.user_id = $1::uuid
     LIMIT 1`,
    [userId, ACCOUNTS_PLATFORM_SYSTEM_CODE]
  );
  return (r.rows[0]?.code as string | undefined) ?? null;
}

async function hasAccountsSystemMembership(
  runner: Runner,
  userId: string
): Promise<boolean> {
  const r = await runner(
    `SELECT 1
     FROM student_affairs.user_systems us
     JOIN student_affairs.systems s ON s.id = us.system_id AND s.code = 'ACCOUNTS'
     WHERE us.user_id = $1::uuid
     LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0;
}

export async function getSupplierPayablesCapabilities(
  client: TxClient | null,
  userId: string
): Promise<Set<string>> {
  const runner = runnerFor(client);

  if (await hasAccountsAdminAccess(client, userId)) {
    return new Set(ADMIN_CAPS);
  }

  const roleCode = await loadAccountsPlatformRoleCode(runner, userId);

  if (roleCode === ACCOUNTS_ADMIN_ROLE_CODE) {
    return new Set(ADMIN_CAPS);
  }
  if (roleCode === ACCOUNTS_CLERK_ROLE_CODE) {
    return new Set(CLERK_CAPS);
  }
  if (roleCode === ACCOUNTS_APPROVER_ROLE_CODE) {
    return new Set(APPROVER_CAPS);
  }
  if (roleCode === ACCOUNTS_VIEWER_ROLE_CODE) {
    return new Set(VIEW_ONLY);
  }

  if (await hasAccountsSystemMembership(runner, userId)) {
    return new Set(CLERK_CAPS);
  }

  return new Set();
}

export async function hasSupplierPayablesCapability(
  client: TxClient | null,
  userId: string,
  capability: string
): Promise<boolean> {
  const caps = await getSupplierPayablesCapabilities(client, userId);
  return caps.has(capability);
}

export async function assertSupplierPayablesCapability(
  client: TxClient | null,
  userId: string,
  capability: string
): Promise<void> {
  if (!(await hasSupplierPayablesCapability(client, userId, capability))) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${capability})`,
      403
    );
  }
}

export { grantAccountsPlatformRole };
