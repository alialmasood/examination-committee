-- Migration: مصدر الحساب وترتيب الأشقاء في دليل الحسابات
-- Schema: accounts
-- لا يعدّل migration 058 أو 059

BEGIN;

-- مصدر الحساب: SYSTEM من الـ seed، USER من الواجهة/API
ALTER TABLE accounts.chart_of_accounts
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'USER';

ALTER TABLE accounts.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_accounts_source_check;

ALTER TABLE accounts.chart_of_accounts
  ADD CONSTRAINT chart_accounts_source_check
  CHECK (source IN ('SYSTEM', 'USER'));

COMMENT ON COLUMN accounts.chart_of_accounts.source IS
  'SYSTEM = من seed النظام، USER = أنشأه مستخدم. لا يمنع التعديل.';

-- الحسابات الحالية أُنشئت عبر seed الخطوة 1
UPDATE accounts.chart_of_accounts
SET source = 'SYSTEM'
WHERE source IS DISTINCT FROM 'SYSTEM';

-- ترتيب الأشقاء
ALTER TABLE accounts.chart_of_accounts
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1;

ALTER TABLE accounts.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_accounts_sort_order_positive;

ALTER TABLE accounts.chart_of_accounts
  ADD CONSTRAINT chart_accounts_sort_order_positive
  CHECK (sort_order > 0);

-- تعبئة أولية حسب الكود داخل كل أب
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY parent_id
      ORDER BY code ASC
    )::int AS rn
  FROM accounts.chart_of_accounts
)
UPDATE accounts.chart_of_accounts c
SET sort_order = ranked.rn
FROM ranked
WHERE c.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_sort_order
  ON accounts.chart_of_accounts (sort_order);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_source
  ON accounts.chart_of_accounts (source);

-- فريد اختياري لترتيب الأشقاء تحت نفس الأب (الجذور: parent_id NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_of_accounts_sibling_sort
  ON accounts.chart_of_accounts (
    (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    sort_order
  );

COMMIT;
