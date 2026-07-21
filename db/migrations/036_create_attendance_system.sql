-- إنشاء نظام الحضور والغياب للطلاب

-- جدول المحاضرات (جداول المحاضرات)
CREATE TABLE IF NOT EXISTS examination_committee.lectures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES examination_committee.teaching_subjects(id) ON DELETE CASCADE,
    lecture_date DATE NOT NULL,
    lecture_time TIME,
    duration_minutes INTEGER DEFAULT 90, -- مدة المحاضرة بالدقائق
    topic VARCHAR(200), -- عنوان المحاضرة
    location VARCHAR(100), -- مكان المحاضرة (قاعة، مختبر، إلخ)
    notes TEXT, -- ملاحظات
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES student_affairs.users(id)
);

-- جدول سجل الحضور والغياب
CREATE TABLE IF NOT EXISTS examination_committee.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID NOT NULL REFERENCES examination_committee.lectures(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'excused')), -- حاضر، غائب، مجاز
    arrival_time TIME, -- وقت الحضور (إذا تم التسجيل الدقيق)
    notes TEXT, -- ملاحظات إضافية
    recorded_by UUID REFERENCES student_affairs.users(id), -- من سجل الحضور
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- تأكد من عدم وجود سجل مكرر لنفس الطالب في نفس المحاضرة
    UNIQUE(lecture_id, student_id)
);

-- جدول تسجيلات الصوت للطلاب (للتعرف على الطلاب بالصوت)
CREATE TABLE IF NOT EXISTS examination_committee.student_voice_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
    audio_file_path VARCHAR(500), -- مسار ملف الصوت
    audio_base64 TEXT, -- أو تخزين الصوت كـ base64
    duration_seconds INTEGER, -- مدة التسجيل بالثواني
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    recorded_by UUID REFERENCES student_affairs.users(id),
    notes TEXT
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_lectures_subject ON examination_committee.lectures(subject_id);
CREATE INDEX IF NOT EXISTS idx_lectures_date ON examination_committee.lectures(lecture_date);
CREATE INDEX IF NOT EXISTS idx_attendance_lecture ON examination_committee.attendance_records(lecture_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON examination_committee.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON examination_committee.attendance_records(status);
CREATE INDEX IF NOT EXISTS idx_voice_samples_student ON examination_committee.student_voice_samples(student_id);

-- تعليقات على الجداول
COMMENT ON TABLE examination_committee.lectures IS 'جدول المحاضرات والجداول الدراسية';
COMMENT ON TABLE examination_committee.attendance_records IS 'سجل الحضور والغياب للطلاب في كل محاضرة';
COMMENT ON TABLE examination_committee.student_voice_samples IS 'عينات الصوت للطلاب للتعرف الصوتي';

