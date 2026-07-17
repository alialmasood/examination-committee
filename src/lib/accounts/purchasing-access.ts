/**
 * صلاحيات دورة المشتريات 7.A — بدون username override.
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

export const PURCHASING_CAPABILITIES = {
  REQ_VIEW: 'purchase_requisitions.view',
  REQ_PREPARE: 'purchase_requisitions.prepare',
  REQ_SUBMIT: 'purchase_requisitions.submit',
  REQ_APPROVE: 'purchase_requisitions.approve',
  REQ_REJECT: 'purchase_requisitions.reject',
  REQ_CANCEL: 'purchase_requisitions.cancel',
  PO_VIEW: 'purchase_orders.view',
  PO_PREPARE: 'purchase_orders.prepare',
  PO_SUBMIT: 'purchase_orders.submit',
  PO_APPROVE: 'purchase_orders.approve',
  PO_REJECT: 'purchase_orders.reject',
  PO_CANCEL: 'purchase_orders.cancel',
  PO_DIRECT: 'purchase_orders.direct_create',
  RECEIPT_VIEW: 'purchase_receipts.view',
  RECEIPT_PREPARE: 'purchase_receipts.prepare',
  RECEIPT_POST: 'purchase_receipts.post',
  RECEIPT_VOID: 'purchase_receipts.void',
  MATCH_VIEW: 'purchase_invoice_matching.view',
  MATCH_PREPARE: 'purchase_invoice_matching.prepare',
  MATCH_OVERRIDE: 'purchase_invoice_matching.override_tolerance',
} as const;

export type PurchasingCapability =
  (typeof PURCHASING_CAPABILITIES)[keyof typeof PURCHASING_CAPABILITIES];

const VIEW_ONLY = new Set<string>([
  PURCHASING_CAPABILITIES.REQ_VIEW,
  PURCHASING_CAPABILITIES.PO_VIEW,
  PURCHASING_CAPABILITIES.RECEIPT_VIEW,
  PURCHASING_CAPABILITIES.MATCH_VIEW,
]);

const CLERK_CAPS = new Set<string>([
  ...VIEW_ONLY,
  PURCHASING_CAPABILITIES.REQ_PREPARE,
  PURCHASING_CAPABILITIES.REQ_SUBMIT,
  PURCHASING_CAPABILITIES.REQ_CANCEL,
  PURCHASING_CAPABILITIES.PO_PREPARE,
  PURCHASING_CAPABILITIES.PO_SUBMIT,
  PURCHASING_CAPABILITIES.PO_DIRECT,
  PURCHASING_CAPABILITIES.RECEIPT_PREPARE,
  PURCHASING_CAPABILITIES.MATCH_PREPARE,
]);

const APPROVER_CAPS = new Set<string>([
  ...VIEW_ONLY,
  PURCHASING_CAPABILITIES.REQ_APPROVE,
  PURCHASING_CAPABILITIES.REQ_REJECT,
  PURCHASING_CAPABILITIES.PO_APPROVE,
  PURCHASING_CAPABILITIES.PO_REJECT,
]);

const ADMIN_CAPS = new Set<string>([
  ...CLERK_CAPS,
  ...APPROVER_CAPS,
  PURCHASING_CAPABILITIES.PO_CANCEL,
  PURCHASING_CAPABILITIES.RECEIPT_POST,
  PURCHASING_CAPABILITIES.RECEIPT_VOID,
  PURCHASING_CAPABILITIES.MATCH_OVERRIDE,
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

export async function getPurchasingCapabilities(
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
  const membership = await runner(
    `SELECT 1 FROM student_affairs.user_systems us
     JOIN student_affairs.systems s ON s.id = us.system_id AND s.code = 'ACCOUNTS'
     WHERE us.user_id = $1::uuid LIMIT 1`,
    [userId]
  );
  if (membership.rows[0]) return new Set(CLERK_CAPS);
  return new Set();
}

export async function hasPurchasingCapability(
  client: TxClient | null,
  userId: string,
  capability: PurchasingCapability
): Promise<boolean> {
  const caps = await getPurchasingCapabilities(client, userId);
  return caps.has(capability);
}

export async function assertPurchasingCapability(
  client: TxClient | null,
  userId: string,
  capability: PurchasingCapability
): Promise<void> {
  if (!(await hasPurchasingCapability(client, userId, capability))) {
    throw new AccountsHttpError('ليس لديك صلاحية تنفيذ هذا الإجراء في المشتريات', 403);
  }
}

export { grantAccountsPlatformRole };
