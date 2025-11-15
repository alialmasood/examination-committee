-- إضافة عمود academic_status إلى جدول الطلاب
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'student_affairs' 
      AND table_name = 'students' 
      AND column_name = 'academic_status'
  ) THEN
    ALTER TABLE student_affairs.students
      ADD COLUMN academic_status VARCHAR(100) DEFAULT 'مستمر';
    
    -- تحديث القيم الموجودة إلى 'مستمر'
    UPDATE student_affairs.students
    SET academic_status = 'مستمر'
    WHERE academic_status IS NULL;
    
    -- فهرس لتحسين الاستعلامات على الحالة الأكاديمية
    CREATE INDEX IF NOT EXISTS idx_students_academic_status
      ON student_affairs.students (academic_status);
  END IF;
END $$;

