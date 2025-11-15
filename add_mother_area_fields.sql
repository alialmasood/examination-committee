-- إضافة حقول اسم الأم والمنطقة
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS area VARCHAR(100);
