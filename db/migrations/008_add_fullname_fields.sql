-- إضافة حقول الاسم الكامل
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS full_name_ar VARCHAR(255),
ADD COLUMN IF NOT EXISTS nickname VARCHAR(100);

-- تحديث البيانات الموجودة
UPDATE student_affairs.students 
SET full_name = CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))
WHERE full_name IS NULL OR full_name = '';

UPDATE student_affairs.students 
SET full_name_ar = full_name
WHERE full_name_ar IS NULL OR full_name_ar = '';
