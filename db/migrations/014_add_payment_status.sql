-- إضافة عمود حالة دفع إلى جدول الطلبة
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'student_affairs' 
      AND table_name = 'students' 
      AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
  END IF;
END $$;

-- فهرس لتحسين الاستعلامات على حالة الدفع
CREATE INDEX IF NOT EXISTS idx_students_payment_status
  ON student_affairs.students (payment_status);


