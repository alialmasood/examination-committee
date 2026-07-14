/**
 * صلاحيات مستحقات الطلبة (Student Receivables 5.A).
 *
 * المصدر الرسمي: دور واحد لكل مستخدم على نظام platform ACCOUNTS عبر
 * platform.user_system_roles (accounts_viewer | accounts_clerk | accounts_admin).
 *
 * سياسة مؤقتة: مستخدم لديه عضوية student_affairs ACCOUNTS دون دور
 * viewer/clerk/admin يحصل على نفس صلاحيات accounts_clerk التشغيلية
 * (كل شيء عدا student_accounts.close). أزل هذا بعد اكتمال منح الأدوار.
 *
 * مهم: لا تُمنح أي من هذه القدرات عبر username.
 * الإغلاق و«كل الصلاحيات» فقط عبر hasAccountsAdminAccess (دور رسمي + fallback legacy مؤقت).
 */
import { AccountsHttpError } from './auth';
import {
  ACCOUNTS_ADMIN_ROLE_CODE,
  ACCOUNTS_PLATFORM_SYSTEM_CODE,
  hasAccountsAdminAccess,
} from './accounts-access';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { query } from '@/src/lib/db';

export const STUDENT_RECEIVABLES_CAPABILITIES = {
  VIEW: 'student_accounts.view',
  MANAGE: 'student_accounts.manage',
  FEE_TYPES_MANAGE: 'student_fee_types.manage',
  CHARGES_PREPARE: 'student_charges.prepare',
  CHARGES_POST: 'student_charges.post',
  CHARGES_VOID: 'student_charges.void',
  CLOSE: 'student_accounts.close',
} as const;

export type StudentReceivablesCapability =
  (typeof STUDENT_RECEIVABLES_CAPABILITIES)[keyof typeof STUDENT_RECEIVABLES_CAPABILITIES];

export const ACCOUNTS_VIEWER_ROLE_CODE = 'accounts_viewer';
export const ACCOUNTS_CLERK_ROLE_CODE = 'accounts_clerk';

const VIEW_ONLY = new Set<string>([STUDENT_RECEIVABLES_CAPABILITIES.VIEW]);

const CLERK_CAPS = new Set<string>([
  STUDENT_RECEIVABLES_CAPABILITIES.VIEW,
  STUDENT_RECEIVABLES_CAPABILITIES.MANAGE,
  STUDENT_RECEIVABLES_CAPABILITIES.FEE_TYPES_MANAGE,
  STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_PREPARE,
  STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_POST,
  STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_VOID,
]);

const ADMIN_CAPS = new Set<string>([
  ...CLERK_CAPS,
  STUDENT_RECEIVABLES_CAPABILITIES.CLOSE,
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

/**
 * يستنتج مجموعة القدرات من الدور الرسمي / Admin / العضوية المؤقتة.
 * لا يعتمد على username لأي قدرة من قدرات 5.A (ما عدا مسار Admin عبر hasAccountsAdminAccess).
 */
export async function getStudentReceivablesCapabilities(
  client: TxClient | null,
  userId: string
): Promise<Set<string>> {
  const runner = runnerFor(client);

  // Admin: كل القدرات بما فيها الإغلاق — عبر hasAccountsAdminAccess فقط
  if (await hasAccountsAdminAccess(client, userId)) {
    return new Set(ADMIN_CAPS);
  }

  const roleCode = await loadAccountsPlatformRoleCode(runner, userId);

  if (roleCode === ACCOUNTS_ADMIN_ROLE_CODE) {
    // دفاع إضافي إن تغيّر مسار Admin لاحقاً
    return new Set(ADMIN_CAPS);
  }
  if (roleCode === ACCOUNTS_CLERK_ROLE_CODE) {
    return new Set(CLERK_CAPS);
  }
  if (roleCode === ACCOUNTS_VIEWER_ROLE_CODE) {
    return new Set(VIEW_ONLY);
  }

  // سياسة مؤقتة: عضوية ACCOUNTS بلا دور viewer/clerk/admin → clerk تشغيلي
  if (await hasAccountsSystemMembership(runner, userId)) {
    return new Set(CLERK_CAPS);
  }

  return new Set();
}

export async function hasStudentReceivablesCapability(
  client: TxClient | null,
  userId: string,
  capability: string
): Promise<boolean> {
  const caps = await getStudentReceivablesCapabilities(client, userId);
  return caps.has(capability);
}

export async function assertStudentReceivablesCapability(
  client: TxClient | null,
  userId: string,
  capability: string
): Promise<void> {
  if (!(await hasStudentReceivablesCapability(client, userId, capability))) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${capability})`,
      403
    );
  }
}

/** منح دور platform ACCOUNTS (للاختبارات / الأدوات الإدارية) */
export async function grantAccountsPlatformRole(
  userId: string,
  roleCode:
    | typeof ACCOUNTS_VIEWER_ROLE_CODE
    | typeof ACCOUNTS_CLERK_ROLE_CODE
    | typeof ACCOUNTS_ADMIN_ROLE_CODE
): Promise<void> {
  const names: Record<string, { ar: string; en: string }> = {
    [ACCOUNTS_VIEWER_ROLE_CODE]: {
      ar: 'عارض الحسابات',
      en: 'Accounts Viewer',
    },
    [ACCOUNTS_CLERK_ROLE_CODE]: {
      ar: 'كاتب الحسابات',
      en: 'Accounts Clerk',
    },
    [ACCOUNTS_ADMIN_ROLE_CODE]: {
      ar: 'مدير الحسابات',
      en: 'Accounts Admin',
    },
  };
  const n = names[roleCode];
  await query(
    `INSERT INTO student_affairs.roles (code, name_ar, name_en)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING`,
    [roleCode, n.ar, n.en]
  );
  await query(
    `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active)
     VALUES ($1, 'نظام الحسابات', '/accounts',
             'نظام الحسابات المالية — صلاحيات تفصيلية عبر user_system_roles', TRUE)
     ON CONFLICT (code) DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
    [ACCOUNTS_PLATFORM_SYSTEM_CODE]
  );
  await query(
    `INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
     SELECT $1::uuid, ps.id, r.id, NOW()
     FROM platform.systems ps
     CROSS JOIN student_affairs.roles r
     WHERE ps.code = $2 AND r.code = $3
     ON CONFLICT (user_id, system_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [userId, ACCOUNTS_PLATFORM_SYSTEM_CODE, roleCode]
  );
}
