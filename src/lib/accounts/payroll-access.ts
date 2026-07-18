/**
 * صلاحيات الرواتب 9.A.1 — Least Privilege (بدون username override).
 *
 * عضوية ACCOUNTS المجرّدة → VIEW_ONLY فقط.
 * الإعداد المالي الحسّاس (المكوّنات/الخرائط) مقصور على Accounts Admin في هذه المرحلة.
 *
 * السياسة:
 *   accounts_viewer   → payroll_view
 *   accounts_clerk    → payroll_view + manage_people + manage_contracts + manage_assignments
 *   accounts_approver → payroll_view
 *   accounts_admin    → جميع صلاحيات 9.A.1
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

export const PAYROLL_CAPABILITIES = {
  VIEW: 'payroll_view',
  MANAGE_PEOPLE: 'payroll_manage_people',
  MANAGE_CONTRACTS: 'payroll_manage_contracts',
  MANAGE_ASSIGNMENTS: 'payroll_manage_assignments',
  MANAGE_COMPONENTS: 'payroll_manage_components',
  MANAGE_MAPPINGS: 'payroll_manage_mappings',
  ADMIN: 'payroll_admin',
} as const;

export type PayrollCapability =
  (typeof PAYROLL_CAPABILITIES)[keyof typeof PAYROLL_CAPABILITIES];

const VIEW_ONLY = new Set<string>([PAYROLL_CAPABILITIES.VIEW]);

const CLERK_CAPS = new Set<string>([
  ...VIEW_ONLY,
  PAYROLL_CAPABILITIES.MANAGE_PEOPLE,
  PAYROLL_CAPABILITIES.MANAGE_CONTRACTS,
  PAYROLL_CAPABILITIES.MANAGE_ASSIGNMENTS,
]);

const APPROVER_CAPS = new Set<string>([...VIEW_ONLY]);

const ADMIN_CAPS = new Set<string>([
  ...CLERK_CAPS,
  PAYROLL_CAPABILITIES.MANAGE_COMPONENTS,
  PAYROLL_CAPABILITIES.MANAGE_MAPPINGS,
  PAYROLL_CAPABILITIES.ADMIN,
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

export async function getPayrollCapabilities(
  client: TxClient | null,
  userId: string
): Promise<Set<string>> {
  if (await hasAccountsAdminAccess(client, userId)) return new Set(ADMIN_CAPS);
  const runner = runnerFor(client);
  const code = await loadAccountsPlatformRoleCode(runner, userId);
  if (code === ACCOUNTS_ADMIN_ROLE_CODE) return new Set(ADMIN_CAPS);
  if (code === ACCOUNTS_APPROVER_ROLE_CODE) return new Set(APPROVER_CAPS);
  if (code === ACCOUNTS_VIEWER_ROLE_CODE) return new Set(VIEW_ONLY);
  if (code === ACCOUNTS_CLERK_ROLE_CODE) return new Set(CLERK_CAPS);
  /**
   * Least Privilege: عضوية ACCOUNTS وحدها دون دور platform صريح → VIEW_ONLY فقط.
   * لا ترقية ضمنية.
   */
  const membership = await runner(
    `SELECT 1 FROM student_affairs.user_systems us
     JOIN student_affairs.systems s ON s.id = us.system_id AND s.code = 'ACCOUNTS'
     WHERE us.user_id = $1::uuid LIMIT 1`,
    [userId]
  );
  if (membership.rows[0]) return new Set(VIEW_ONLY);
  return new Set();
}

export async function hasPayrollCapability(
  client: TxClient | null,
  userId: string,
  capability: PayrollCapability
): Promise<boolean> {
  const caps = await getPayrollCapabilities(client, userId);
  return caps.has(capability);
}

export async function assertPayrollCapability(
  client: TxClient | null,
  userId: string,
  capability: PayrollCapability
): Promise<void> {
  if (!(await hasPayrollCapability(client, userId, capability))) {
    throw new AccountsHttpError('ليس لديك صلاحية تنفيذ هذا الإجراء في الرواتب', 403);
  }
}

export { grantAccountsPlatformRole };
