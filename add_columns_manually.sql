-- إضافة الأعمدة المفقودة يدوياً
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS area VARCHAR(100);

-- التحقق من الأعمدة
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'student_affairs' 
AND table_name = 'students' 
AND column_name IN ('mother_name', 'area');
