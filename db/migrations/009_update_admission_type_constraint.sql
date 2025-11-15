-- تحديث constraint لحقل admission_type ليتضمن القيم الجديدة
-- إزالة constraint القديم
ALTER TABLE student_affairs.students 
DROP CONSTRAINT IF EXISTS students_admission_type_check;

-- إضافة constraint جديد مع القيم المحدثة
ALTER TABLE student_affairs.students
ADD CONSTRAINT students_admission_type_check 
CHECK (admission_type IN ('first', 'second', 'third', 'fourth', 'regular', 'conditional', 'transfer', 'international'));
