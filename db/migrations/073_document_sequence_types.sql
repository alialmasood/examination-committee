-- Migration: 073 — جدول مرجعي لأنواع تسلسل المستندات (Sprint A)
--
-- يستبدل قيد CHECK الثابت على accounts.document_sequences.document_type بجدول مرجعي
-- + مفتاح خارجي، لتسهيل إضافة أنواع مستندات جديدة دون migration جديدة لكل نوع.
-- يبقي جميع صفوف document_sequences الحالية صالحة (نفس القيم المسموحة تماماً).
--
-- المرجع: src/lib/accounts/document-sequences.ts::DOCUMENT_SEQUENCE_DEFAULTS
-- يجب أن يبقى متزامناً مع البذر أدناه (نفس document_type/prefix).

BEGIN;

CREATE TABLE IF NOT EXISTS accounts.document_sequence_types (
  code VARCHAR(50) PRIMARY KEY,
  name_ar VARCHAR(200) NOT NULL,
  prefix_default VARCHAR(20) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_sequence_types_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT document_sequence_types_name_ar_not_blank_check CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT document_sequence_types_prefix_not_blank_check CHECK (length(trim(prefix_default)) > 0)
);

COMMENT ON TABLE accounts.document_sequence_types IS
  'مرجع أنواع تسلسل المستندات المحاسبية — يستبدل CHECK الثابت على document_sequences.document_type';

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('JOURNAL_ENTRY', 'قيد محاسبي', 'JV', TRUE),
  ('RECEIPT_VOUCHER', 'سند قبض نقدي', 'RV', TRUE),
  ('PAYMENT_VOUCHER', 'سند صرف نقدي', 'PV', TRUE),
  ('FINANCIAL_TRANSFER', 'تحويل نقدي بين الصناديق', 'TR', TRUE),
  ('OPENING_BALANCE', 'رصيد افتتاحي', 'OB', TRUE),
  ('BANK_RECEIPT_VOUCHER', 'سند قبض مصرفي', 'BRV', TRUE),
  ('BANK_PAYMENT_VOUCHER', 'سند صرف مصرفي', 'BPV', TRUE),
  ('BANK_TRANSFER_VOUCHER', 'تحويل بين حسابات مصرفية', 'BTR', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

-- تحقق مسبق: كل قيم document_type الحالية في document_sequences موجودة في الجدول المرجعي
-- (يفشل الـ migration بوضوح إن ظهر نوع غير متوقع قبل حذف القيد)
DO $$
DECLARE
  unknown_types TEXT;
BEGIN
  SELECT string_agg(DISTINCT ds.document_type, ', ') INTO unknown_types
  FROM accounts.document_sequences ds
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts.document_sequence_types t WHERE t.code = ds.document_type
  );
  IF unknown_types IS NOT NULL THEN
    RAISE EXCEPTION '073 validation failed: unknown document_type values not in reference table: %', unknown_types;
  END IF;
END $$;

-- استبدال CHECK الثابت بـ FK على الجدول المرجعي
ALTER TABLE accounts.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_type_check;

ALTER TABLE accounts.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_document_type_fkey;

ALTER TABLE accounts.document_sequences
  ADD CONSTRAINT document_sequences_document_type_fkey
  FOREIGN KEY (document_type) REFERENCES accounts.document_sequence_types(code)
  ON DELETE RESTRICT;

-- =========================
-- تحقق نهائي: القيد موجود، الجدول المرجعي يحتوي الأنواع الثمانية، وكل صفوف
-- document_sequences الحالية لا تزال صالحة (تحقق ضمني عبر نجاح إضافة FK أعلاه)
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_sequences_document_type_fkey'
  ) THEN
    RAISE EXCEPTION '073 validation failed: FK document_sequences_document_type_fkey missing';
  END IF;
  IF (SELECT COUNT(*) FROM accounts.document_sequence_types) < 8 THEN
    RAISE EXCEPTION '073 validation failed: expected at least 8 seeded document sequence types';
  END IF;
END $$;

COMMIT;
