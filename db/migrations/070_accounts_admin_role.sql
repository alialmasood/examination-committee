-- Migration: 070 — Accounts Admin role (بديل دائم لتجاوز username)
-- يضيف دور accounts_admin ويربط مستخدمي الإدارة الحاليين دون حذف صلاحيات تشغيلية.

BEGIN;

INSERT INTO student_affairs.roles (code, name_ar, name_en)
VALUES ('accounts_admin', 'مدير الحسابات', 'Accounts Admin')
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en;

INSERT INTO platform.systems (code, name_ar, base_path, description, is_active)
VALUES (
  'ACCOUNTS',
  'نظام الحسابات',
  '/accounts',
  'نظام الحسابات المالية — صلاحيات تفصيلية عبر user_system_roles',
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  base_path = EXCLUDED.base_path,
  description = COALESCE(EXCLUDED.description, platform.systems.description),
  is_active = TRUE,
  updated_at = NOW();

-- منح accounts_admin لمستخدمي ACCOUNTS الذين كانوا ضمن قائمة username المؤقتة
INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
SELECT
  u.id,
  ps.id,
  r.id,
  NOW()
FROM student_affairs.users u
JOIN student_affairs.user_systems us ON us.user_id = u.id
JOIN student_affairs.systems sas ON sas.id = us.system_id AND sas.code = 'ACCOUNTS'
CROSS JOIN platform.systems ps
CROSS JOIN student_affairs.roles r
WHERE ps.code = 'ACCOUNTS'
  AND r.code = 'accounts_admin'
  AND u.is_active = TRUE
  AND LOWER(TRIM(u.username)) IN ('accounts', 'admin', 'superadmin', 'super_admin')
ON CONFLICT (user_id, system_id) DO UPDATE SET
  role_id = EXCLUDED.role_id;

-- تحقق: الدور موجود ونظام platform.ACCOUNTS موجود
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM student_affairs.roles WHERE code = 'accounts_admin'
  ) THEN
    RAISE EXCEPTION '070 validation failed: accounts_admin role missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.systems WHERE code = 'ACCOUNTS' AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION '070 validation failed: platform.systems ACCOUNTS missing';
  END IF;
END $$;

COMMIT;
