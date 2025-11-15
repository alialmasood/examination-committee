-- إسقاط الجدول القديم إذا كان موجوداً
DROP TABLE IF EXISTS examination_committee.sub_master_grades CASCADE;

-- إنشاء جدول درجات السب ماستر للمواد التدريسية
-- هذا الجدول يحفظ درجات الطلاب في كل مادة تدريسية
CREATE TABLE examination_committee.sub_master_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- ربط المادة التدريسية
    subject_id UUID NOT NULL REFERENCES examination_committee.teaching_subjects(id) ON DELETE CASCADE,
    
    -- ربط الطالب
    student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
    
    -- السنة الأكاديمية والفصل الدراسي
    academic_year VARCHAR(10) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    
    -- السعي 40 درجة
    sae_40 DECIMAL(5,2),
    
    -- الدور الأول
    first_practical_25 DECIMAL(5,2),
    first_theory_35 DECIMAL(5,2),
    first_total_60 DECIMAL(5,2),
    first_final_100 DECIMAL(5,2),
    
    -- الدور الثاني
    second_practical_25 DECIMAL(5,2),
    second_theory_35 DECIMAL(5,2),
    second_total_60 DECIMAL(5,2),
    second_final_100 DECIMAL(5,2),
    
    -- معلومات إضافية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES student_affairs.users(id),
    updated_by UUID REFERENCES student_affairs.users(id),
    
    -- تأكد من عدم وجود سجل مكرر لنفس الطالب في نفس المادة والسنة والفصل
    UNIQUE(student_id, subject_id, academic_year, semester)
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX idx_sub_master_grades_subject ON examination_committee.sub_master_grades(subject_id);
CREATE INDEX idx_sub_master_grades_student ON examination_committee.sub_master_grades(student_id);
CREATE INDEX idx_sub_master_grades_year_semester ON examination_committee.sub_master_grades(academic_year, semester);

-- تعليق على الجدول
COMMENT ON TABLE examination_committee.sub_master_grades IS 'جدول درجات السب ماستر للطلاب في كل مادة تدريسية';

