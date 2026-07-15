-- 086: Harden supplier subledger uniqueness (6.A acceptance)
BEGIN;

-- يمنع تطبيق مزدوج لنفس المصدر/نوع الحركة (مثل ذمم الطلبة)
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_ledger_source_entry
  ON accounts.supplier_ledger_entries (source_type, source_id, entry_type);

COMMIT;
