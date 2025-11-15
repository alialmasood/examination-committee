-- إضافة عمود الفحص الطبي
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS medical_examination VARCHAR(255);

-- التحقق من العمود
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'student_affairs' 
AND table_name = 'students' 
AND column_name = 'medical_examination';
