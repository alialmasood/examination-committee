-- إضافة حقل متطلبات خاصة إلى جدول الطلاب
ALTER TABLE student_affairs.students 
ADD COLUMN special_requirements TEXT;
