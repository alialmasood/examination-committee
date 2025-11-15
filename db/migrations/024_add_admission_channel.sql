-- إضافة عمود admission_channel إلى جدول الطلاب
ALTER TABLE student_affairs.students
ADD COLUMN IF NOT EXISTS admission_channel VARCHAR(50);

-- إضافة تعليق على العمود
COMMENT ON COLUMN student_affairs.students.admission_channel IS 'قناة القبول: general, martyrs, social_care, special_needs, political_prisoners, siblings_married, minister_directive, dean_approval, faculty_children, top_students';

