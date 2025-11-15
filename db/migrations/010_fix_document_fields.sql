-- إصلاح حقول المستمسكات والوثائق لحفظ أسماء الملفات
-- تغيير نوع البيانات من BOOLEAN إلى TEXT

-- تغيير حقل صورة الهوية الوطنية
ALTER TABLE student_affairs.students 
ALTER COLUMN national_id_copy TYPE TEXT;

-- تغيير حقل شهادة الميلاد
ALTER TABLE student_affairs.students 
ALTER COLUMN birth_certificate TYPE TEXT;

-- تغيير حقل شهادة الثانوية
ALTER TABLE student_affairs.students 
ALTER COLUMN secondary_certificate TYPE TEXT;

-- تغيير حقل الصورة الشخصية
ALTER TABLE student_affairs.students 
ALTER COLUMN photo TYPE TEXT;

-- تغيير حقل الشهادة الطبية
ALTER TABLE student_affairs.students 
ALTER COLUMN medical_certificate TYPE TEXT;

-- إضافة تعليقات توضيحية
COMMENT ON COLUMN student_affairs.students.national_id_copy IS 'اسم ملف صورة الهوية الوطنية';
COMMENT ON COLUMN student_affairs.students.birth_certificate IS 'اسم ملف شهادة الميلاد';
COMMENT ON COLUMN student_affairs.students.secondary_certificate IS 'اسم ملف شهادة الثانوية';
COMMENT ON COLUMN student_affairs.students.photo IS 'اسم ملف الصورة الشخصية';
COMMENT ON COLUMN student_affairs.students.medical_certificate IS 'اسم ملف الشهادة الطبية';
COMMENT ON COLUMN student_affairs.students.other_documents IS 'أسماء ملفات الوثائق الأخرى';
