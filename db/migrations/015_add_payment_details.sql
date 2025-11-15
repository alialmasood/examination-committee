-- إضافة تفاصيل الدفع إلى جدول الطلبة
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='student_affairs' AND table_name='students' AND column_name='payment_amount'
  ) THEN
    ALTER TABLE student_affairs.students ADD COLUMN payment_amount NUMERIC(12,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='student_affairs' AND table_name='students' AND column_name='payment_date'
  ) THEN
    ALTER TABLE student_affairs.students ADD COLUMN payment_date TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_payment_date ON student_affairs.students (payment_date);


