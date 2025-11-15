-- إنشاء جدول المواد التدريسية
-- هذا الجدول يحفظ المواد التدريسية لكل قسم

-- إنشاء schema إذا لم يكن موجوداً
CREATE SCHEMA IF NOT EXISTS examination_committee;

CREATE TABLE IF NOT EXISTS examination_committee.teaching_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department VARCHAR(100) NOT NULL, -- القسم
    material_name VARCHAR(200) NOT NULL, -- اسم المادة
    instructor_name VARCHAR(200) NOT NULL, -- اسم التدريسي
    semester VARCHAR(20) NOT NULL, -- 'first' or 'second'
    academic_year VARCHAR(10) NOT NULL, -- سنة أكاديمية (مثلا 2024-2025)
    
    -- معلومات إضافية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES student_affairs.users(id),
    updated_by UUID REFERENCES student_affairs.users(id)
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_department ON examination_committee.teaching_subjects(department);
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_year_semester ON examination_committee.teaching_subjects(academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_instructor ON examination_committee.teaching_subjects(instructor_name);

-- تعليق على الجدول
COMMENT ON TABLE examination_committee.teaching_subjects IS 'جدول المواد التدريسية لكل قسم';

