-- Migration: 072 — إسقاط أرصدة دليل الحسابات (Balance Projection) — Sprint A
--
-- ⚠️ القرار المعماري (وثّقه docs/accounts-architecture-sprint-a.md):
-- مصدر الحقيقة يبقى قيود journal_entries بحالة POSTED (نفس ما تستخدمه
-- accounts/account-book-balance.ts::getAccountBookBalance عبر SUM(debit-credit)).
-- هذا الجدول مجرد "إسقاط/تجميع" (materialized projection) لتسريع القراءة لاحقاً —
-- لا يوجد أي مسار كتابة (write-path) مرتبط بترحيل القيود في هذا الـ Sprint.
-- التحديث الحي (live upsert عند post/void) مؤجّل لسبرنت لاحق. التعبئة تتم فقط عبر
-- npm run accounts:rebuild-balances (إعادة بناء كاملة من الصفر) والتحقق عبر
-- npm run accounts:verify-balances (بلا كتابة).
--
-- المستوى: سنوي فقط (fiscal_period_id NULL دائماً في Sprint A) — تبسيطاً للنطاق.
-- currency_code NULL يعني تجميع العملة الوظيفية/الدفترية كما هو الحال حالياً
-- (المحرك في معظمه دفتر واحد — single book).

BEGIN;

CREATE TABLE IF NOT EXISTS accounts.gl_account_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  currency_code CHAR(3),
  debit_total NUMERIC(18,3) NOT NULL DEFAULT 0,
  credit_total NUMERIC(18,3) NOT NULL DEFAULT 0,
  balance NUMERIC(18,3) NOT NULL DEFAULT 0,
  last_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT gl_account_balances_totals_nonneg_check CHECK (
    debit_total >= 0 AND credit_total >= 0
  ),
  CONSTRAINT gl_account_balances_balance_matches_check CHECK (
    balance = debit_total - credit_total
  ),
  CONSTRAINT gl_account_balances_row_version_positive_check CHECK (row_version >= 1),
  CONSTRAINT gl_account_balances_currency_len_check CHECK (
    currency_code IS NULL OR char_length(currency_code) = 3
  )
);

-- مفتاح فريد للمستوى (سنة، فترة اختيارية، حساب، عملة اختيارية) — NULLS NOT DISTINCT
-- يمنع ازدواج صف السنة-فقط (period NULL) لنفس الحساب/العملة (PostgreSQL 15+).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_account_balances_level
  ON accounts.gl_account_balances
  (fiscal_year_id, fiscal_period_id, gl_account_id, currency_code)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_gl_account_balances_account
  ON accounts.gl_account_balances (gl_account_id);

CREATE INDEX IF NOT EXISTS idx_gl_account_balances_year
  ON accounts.gl_account_balances (fiscal_year_id);

COMMENT ON TABLE accounts.gl_account_balances IS
  'إسقاط أرصدة دليل الحسابات (SUM مُجمّع مسبقاً) — مصدر الحقيقة يبقى journal_entries POSTED. '
  'Sprint A: مستوى سنوي فقط (fiscal_period_id = NULL دائماً)، بلا مسار كتابة حي. '
  'يُبنى فقط عبر npm run accounts:rebuild-balances، ويُتحقق منه عبر npm run accounts:verify-balances.';
COMMENT ON COLUMN accounts.gl_account_balances.fiscal_period_id IS
  'NULL = تجميع على مستوى السنة كاملة (الوضع المفضّل والوحيد المُستخدم في Sprint A)';
COMMENT ON COLUMN accounts.gl_account_balances.currency_code IS
  'NULL = تجميع العملة الوظيفية/الدفترية كما تُحتسب حالياً (دفتر واحد أساساً)';
COMMENT ON COLUMN accounts.gl_account_balances.balance IS
  'debit_total - credit_total — يطابق منطق getAccountBookBalance (مدين - دائن)';
COMMENT ON COLUMN accounts.gl_account_balances.row_version IS
  'إصدار للتزامن المتفائل عند إضافة مسار الكتابة الحي لاحقاً';

-- =========================
-- سجل تطبيق القيود على الإسقاط — يمنع التطبيق المزدوج عند إضافة مسار الكتابة لاحقاً
-- =========================
CREATE TABLE IF NOT EXISTS accounts.gl_balance_applications (
  journal_entry_id UUID PRIMARY KEY
    REFERENCES accounts.journal_entries(id) ON DELETE CASCADE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE accounts.gl_balance_applications IS
  'سجل تحصين ضد التطبيق المزدوج لقيد POSTED على accounts.gl_account_balances — '
  'غير مُستخدم في Sprint A (لا يوجد مسار كتابة حي بعد)؛ جاهز لسبرنت لاحق.';

-- =========================
-- تحقق: الجدولان موجودان + القيد الفريد موجود
-- =========================
DO $$
BEGIN
  IF to_regclass('accounts.gl_account_balances') IS NULL THEN
    RAISE EXCEPTION '072 validation failed: accounts.gl_account_balances missing';
  END IF;
  IF to_regclass('accounts.gl_balance_applications') IS NULL THEN
    RAISE EXCEPTION '072 validation failed: accounts.gl_balance_applications missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'accounts' AND indexname = 'uq_gl_account_balances_level'
  ) THEN
    RAISE EXCEPTION '072 validation failed: uq_gl_account_balances_level missing';
  END IF;
END $$;

COMMIT;
