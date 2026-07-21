-- إنشاء نظام امتحانات الأشهر والدرجات الفصلية

-- جدول امتحانات الأشهر
CREATE TABLE IF NOT EXISTS examination_committee.monthly_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES examination_committee.teaching_subjects(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
    academic_year VARCHAR(10) NOT NULL,
    semester VARCHAR(20) NOT NULL CHECK (semester IN ('first', 'second')),
    
    -- امتحان الشهر الأول
    month1_exam_date DATE,
    month1_theory_score DECIMAL(5,2), -- الدرجة النظري
    month1_practical_score DECIMAL(5,2), -- الدرجة العملي (إن وجد)
    month1_total_score DECIMAL(5,2), -- المجموع
    
    -- امتحان الشهر الثاني
    month2_exam_date DATE,
    month2_theory_score DECIMAL(5,2),
    month2_practical_score DECIMAL(5,2),
    month2_total_score DECIMAL(5,2),
    
    -- امتحان الشهر الثالث (اختياري)
    month3_exam_date DATE,
    month3_theory_score DECIMAL(5,2),
    month3_practical_score DECIMAL(5,2),
    month3_total_score DECIMAL(5,2),
    
    -- السعي الفصلي (40 درجة)
    semester_attendance_score DECIMAL(5,2) DEFAULT 0, -- السعي
    semester_attendance_max DECIMAL(5,2) DEFAULT 40, -- الحد الأقصى للسعي
    
    -- المجموع النهائي (يمكن حسابه تلقائياً)
    final_total_score DECIMAL(5,2),
    
    -- معلومات إضافية
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES student_affairs.users(id),
    updated_by UUID REFERENCES student_affairs.users(id),
    
    -- تأكد من عدم وجود سجل مكرر
    UNIQUE(student_id, subject_id, academic_year, semester)
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_monthly_exams_subject ON examination_committee.monthly_exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_monthly_exams_student ON examination_committee.monthly_exams(student_id);
CREATE INDEX IF NOT EXISTS idx_monthly_exams_year_semester ON examination_committee.monthly_exams(academic_year, semester);

-- تعليق على الجدول
COMMENT ON TABLE examination_committee.monthly_exams IS 'درجات امتحانات الأشهر (1، 2، 3) والسعي الفصلي';

