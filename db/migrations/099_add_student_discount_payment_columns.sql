-- أعمدة التخفيض والقسط النهائي لصفحة أقساط الطلبة
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'discount_percentage'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN discount_percentage DECIMAL(5,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'final_fee_after_discount'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN final_fee_after_discount DECIMAL(12,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'payment_amount'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN payment_amount NUMERIC(12,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'payment_date'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN payment_date TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'student_affairs'
      AND table_name = 'students'
      AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_payment_status
  ON student_affairs.students (payment_status);

CREATE INDEX IF NOT EXISTS idx_students_payment_date
  ON student_affairs.students (payment_date);
