/**
 * صلاحيات الأصول الثابتة 8.A — Least Privilege (بدون username override).
 * عضوية ACCOUNTS وحدها → VIEW_ONLY فقط. الإعداد/الترحيل يتطلب دور platform صريح.
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

export const FIXED_ASSETS_CAPABILITIES = {
  // بيانات مرجعية (تصنيفات/مواقع)
  CATEGORY_VIEW: 'asset_categories.view',
  CATEGORY_MANAGE: 'asset_categories.manage',
  LOCATION_VIEW: 'asset_locations.view',
  LOCATION_MANAGE: 'asset_locations.manage',
  // الأصول
  ASSET_VIEW: 'fixed_assets.view',
  ASSET_PREPARE: 'fixed_assets.prepare',
  ASSET_ACTIVATE: 'fixed_assets.activate',
  ASSET_SUSPEND: 'fixed_assets.suspend',
  ASSET_CANCEL: 'fixed_assets.cancel',
  ASSET_THRESHOLD_OVERRIDE: 'fixed_assets.threshold_override',
  ASSET_CAPITALIZE: 'fixed_assets.capitalize_from_purchasing',
  // الحركات
  MOVEMENT_VIEW: 'asset_movements.view',
  MOVEMENT_PREPARE: 'asset_movements.prepare',
  MOVEMENT_POST: 'asset_movements.post',
  MOVEMENT_VOID: 'asset_movements.void',
  // الإهلاك
  DEP_VIEW: 'depreciation.view',
  DEP_PREPARE: 'depreciation.prepare',
  DEP_POST: 'depreciation.post',
  DEP_VOID: 'depreciation.void',
  // الاستبعاد
  DISPOSAL_VIEW: 'asset_disposals.view',
  DISPOSAL_PREPARE: 'asset_disposals.prepare',
  DISPOSAL_POST: 'asset_disposals.post',
  DISPOSAL_VOID: 'asset_disposals.void',
} as const;

export type FixedAssetsCapability =
  (typeof FIXED_ASSETS_CAPABILITIES)[keyof typeof FIXED_ASSETS_CAPABILITIES];

const VIEW_ONLY = new Set<string>([
  FIXED_ASSETS_CAPABILITIES.CATEGORY_VIEW,
  FIXED_ASSETS_CAPABILITIES.LOCATION_VIEW,
  FIXED_ASSETS_CAPABILITIES.ASSET_VIEW,
  FIXED_ASSETS_CAPABILITIES.MOVEMENT_VIEW,
  FIXED_ASSETS_CAPABILITIES.DEP_VIEW,
  FIXED_ASSETS_CAPABILITIES.DISPOSAL_VIEW,
]);

const CLERK_CAPS = new Set<string>([
  ...VIEW_ONLY,
  FIXED_ASSETS_CAPABILITIES.CATEGORY_MANAGE,
  FIXED_ASSETS_CAPABILITIES.LOCATION_MANAGE,
  FIXED_ASSETS_CAPABILITIES.ASSET_PREPARE,
  FIXED_ASSETS_CAPABILITIES.ASSET_CAPITALIZE,
  FIXED_ASSETS_CAPABILITIES.MOVEMENT_PREPARE,
  FIXED_ASSETS_CAPABILITIES.DEP_PREPARE,
  FIXED_ASSETS_CAPABILITIES.DISPOSAL_PREPARE,
]);

const APPROVER_CAPS = new Set<string>([
  ...VIEW_ONLY,
  FIXED_ASSETS_CAPABILITIES.ASSET_ACTIVATE,
  FIXED_ASSETS_CAPABILITIES.ASSET_SUSPEND,
  FIXED_ASSETS_CAPABILITIES.MOVEMENT_POST,
  FIXED_ASSETS_CAPABILITIES.DEP_POST,
  FIXED_ASSETS_CAPABILITIES.DISPOSAL_POST,
]);

const ADMIN_CAPS = new Set<string>([
  ...CLERK_CAPS,
  ...APPROVER_CAPS,
  FIXED_ASSETS_CAPABILITIES.ASSET_CANCEL,
  FIXED_ASSETS_CAPABILITIES.ASSET_THRESHOLD_OVERRIDE,
  FIXED_ASSETS_CAPABILITIES.MOVEMENT_VOID,
  FIXED_ASSETS_CAPABILITIES.DEP_VOID,
  FIXED_ASSETS_CAPABILITIES.DISPOSAL_VOID,
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

export async function getFixedAssetsCapabilities(
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
   * Least Privilege (8.A): عضوية ACCOUNTS وحدها دون دور platform صريح → VIEW_ONLY فقط.
   * لا ترقية ضمنية إلى CLERK_CAPS.
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

export async function hasFixedAssetsCapability(
  client: TxClient | null,
  userId: string,
  capability: FixedAssetsCapability
): Promise<boolean> {
  const caps = await getFixedAssetsCapabilities(client, userId);
  return caps.has(capability);
}

export async function assertFixedAssetsCapability(
  client: TxClient | null,
  userId: string,
  capability: FixedAssetsCapability
): Promise<void> {
  if (!(await hasFixedAssetsCapability(client, userId, capability))) {
    throw new AccountsHttpError('ليس لديك صلاحية تنفيذ هذا الإجراء في الأصول الثابتة', 403);
  }
}

export { grantAccountsPlatformRole };
