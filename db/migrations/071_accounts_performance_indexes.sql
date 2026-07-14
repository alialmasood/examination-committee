-- Migration: 071 — فهارس أداء مركّبة لنظام الحسابات (Sprint A — Architecture Hardening)
--
-- الفهارس المفردة الأساسية (status / account_id / journal_entry_id / بنك أو صندوق منفرد)
-- موجودة مسبقاً من migrations 061/065/066/068/069. هذا الملف يضيف فقط فهارس مركّبة
-- (composite) تخدم أنماط الاستعلام الفعلية: قوائم مُصفّاة بالحالة + مرتّبة بالتاريخ،
-- وربط JOIN بين journal_entry_lines وحساب معيّن ضمن قيد معيّن (لحساب الرصيد الدفتري).
--
-- كل فهرس بـ IF NOT EXISTS — آمن لإعادة التشغيل ولا يُعدّل فهارس 058–070.

BEGIN;

-- =========================
-- journal_entries: قوائم مُصفّاة بالحالة + السنة المالية، مرتّبة بتاريخ القيد
-- (تقارير الفترة/السنة، إغلاق الفترات، لوحات المعلومات)
-- =========================
CREATE INDEX IF NOT EXISTS idx_journal_entries_status_year_date
  ON accounts.journal_entries (status, fiscal_year_id, entry_date);

COMMENT ON INDEX accounts.idx_journal_entries_status_year_date IS
  'يخدم تقارير/لوحات القيود المُصفّاة بالحالة ضمن سنة مالية مرتّبة بالتاريخ (Sprint A)';

-- =========================
-- journal_entry_lines: (account_id, journal_entry_id) — يخدم JOIN حساب الرصيد الدفتري
-- (getAccountBookBalance يربط بـ journal_entries عبر journal_entry_id لكل سطور حساب معيّن)
-- =========================
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_entry
  ON accounts.journal_entry_lines (account_id, journal_entry_id);

COMMENT ON INDEX accounts.idx_journal_entry_lines_account_entry IS
  'يخدم JOIN حساب↔قيد عند تجميع الرصيد الدفتري لحساب معيّن (getAccountBookBalance) — Sprint A';

-- =========================
-- bank_vouchers: قوائم/رصيد حساب مصرفي مُصفّاة بالحالة مرتّبة بتاريخ السند
-- =========================
CREATE INDEX IF NOT EXISTS idx_bank_vouchers_account_status_date
  ON accounts.bank_vouchers (bank_account_id, status, voucher_date);

COMMENT ON INDEX accounts.idx_bank_vouchers_account_status_date IS
  'يخدم حساب/عرض سندات حساب مصرفي معيّن مُصفّاة بالحالة ومرتّبة بالتاريخ — Sprint A';

-- =========================
-- bank_transfers: نفس النمط على طرفي التحويل (مصدر / وجهة)
-- =========================
CREATE INDEX IF NOT EXISTS idx_bank_transfers_source_status_date
  ON accounts.bank_transfers (source_bank_account_id, status, transfer_date);

COMMENT ON INDEX accounts.idx_bank_transfers_source_status_date IS
  'يخدم قوائم/رصيد التحويلات الصادرة من حساب مصرفي مُصفّاة بالحالة ومرتّبة بالتاريخ — Sprint A';

CREATE INDEX IF NOT EXISTS idx_bank_transfers_destination_status_date
  ON accounts.bank_transfers (destination_bank_account_id, status, transfer_date);

COMMENT ON INDEX accounts.idx_bank_transfers_destination_status_date IS
  'يخدم قوائم/رصيد التحويلات الواردة إلى حساب مصرفي مُصفّاة بالحالة ومرتّبة بالتاريخ — Sprint A';

-- =========================
-- cash_vouchers: نفس النمط على مستوى جلسة الصندوق (العمود الفعلي cash_box_session_id)
-- =========================
CREATE INDEX IF NOT EXISTS idx_cash_vouchers_session_status_date
  ON accounts.cash_vouchers (cash_box_session_id, status, voucher_date);

COMMENT ON INDEX accounts.idx_cash_vouchers_session_status_date IS
  'يخدم حساب الرصيد المتوقع لجلسة صندوق (calculateSessionExpectedBalance) مُصفّاة بالحالة ومرتّبة بالتاريخ — Sprint A';

-- =========================
-- cash_transfers: (source_session_id, status) و (destination_session_id, status)
-- تخدم calculateSessionExpectedBalance (SUM FILTER بالحالة لكل طرف)
-- =========================
CREATE INDEX IF NOT EXISTS idx_cash_transfers_source_session_status
  ON accounts.cash_transfers (source_session_id, status);

COMMENT ON INDEX accounts.idx_cash_transfers_source_session_status IS
  'يخدم تجميع التحويلات الصادرة من جلسة مُصفّاة بالحالة (calculateSessionExpectedBalance) — Sprint A';

CREATE INDEX IF NOT EXISTS idx_cash_transfers_destination_session_status
  ON accounts.cash_transfers (destination_session_id, status);

COMMENT ON INDEX accounts.idx_cash_transfers_destination_session_status IS
  'يخدم تجميع التحويلات الواردة إلى جلسة مُصفّاة بالحالة (calculateSessionExpectedBalance) — Sprint A';

-- =========================
-- تحقق: كل الفهارس المركّبة الثمانية موجودة فعلاً
-- =========================
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(idx, ', ') INTO missing
  FROM unnest(ARRAY[
    'idx_journal_entries_status_year_date',
    'idx_journal_entry_lines_account_entry',
    'idx_bank_vouchers_account_status_date',
    'idx_bank_transfers_source_status_date',
    'idx_bank_transfers_destination_status_date',
    'idx_cash_vouchers_session_status_date',
    'idx_cash_transfers_source_session_status',
    'idx_cash_transfers_destination_session_status'
  ]) AS idx
  WHERE to_regclass('accounts.' || idx) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '071 validation failed: missing indexes: %', missing;
  END IF;
END $$;

COMMIT;
