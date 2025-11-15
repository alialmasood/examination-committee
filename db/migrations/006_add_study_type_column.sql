-- Migration: إضافة عمود نوع الدراسة (study_type) إلى جدول students
-- Date: 2025-10-25

-- إضافة عمود study_type
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS study_type VARCHAR(20) DEFAULT 'morning';

-- إضافة قيد للتحقق من القيم (إذا لم يكن موجود)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_study_type' 
        AND conrelid = 'student_affairs.students'::regclass
    ) THEN
        ALTER TABLE student_affairs.students
        ADD CONSTRAINT check_study_type 
        CHECK (study_type IN ('morning', 'evening'));
    END IF;
END $$;

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.study_type IS 'نوع الدراسة (صباحي أو مسائي)';

