-- 079: فهرس فريد على external_reference لمطالبات الطلبة (للتراجع عند التفعيل)
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_charges_external_reference
  ON accounts.student_charges (external_reference)
  WHERE external_reference IS NOT NULL;

COMMIT;
