-- تحديث شامل لقاعدة البيانات - جميع الحقول الجديدة
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS area VARCHAR(100),
ADD COLUMN IF NOT EXISTS exam_attempt VARCHAR(20),
ADD COLUMN IF NOT EXISTS exam_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS exam_password VARCHAR(50),
ADD COLUMN IF NOT EXISTS branch VARCHAR(100),
ADD COLUMN IF NOT EXISTS medical_examination VARCHAR(255);

-- التحقق من جميع الأعمدة
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'student_affairs' 
AND table_name = 'students' 
AND column_name IN ('mother_name', 'area', 'exam_attempt', 'exam_number', 'exam_password', 'branch', 'medical_examination');
