-- Migration: 076 — أدوار ذمم الطلبة (viewer / clerk)
-- accounts_admin موجود مسبقاً في 070.
-- صلاحيات التشغيل التفصيلية تُستنتج في student-receivables-access.ts.

BEGIN;

INSERT INTO student_affairs.roles (code, name_ar, name_en)
VALUES
  ('accounts_viewer', 'عارض الحسابات', 'Accounts Viewer'),
  ('accounts_clerk', 'كاتب الحسابات', 'Accounts Clerk')
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM student_affairs.roles WHERE code = 'accounts_viewer'
  ) THEN
    RAISE EXCEPTION '076 validation failed: accounts_viewer role missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM student_affairs.roles WHERE code = 'accounts_clerk'
  ) THEN
    RAISE EXCEPTION '076 validation failed: accounts_clerk role missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM student_affairs.roles WHERE code = 'accounts_admin'
  ) THEN
    RAISE EXCEPTION '076 validation failed: accounts_admin role missing';
  END IF;
END $$;

COMMIT;
