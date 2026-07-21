-- إنشاء نظام التقويم الجامعي للتدريسيين

-- جدول الأحداث في التقويم
CREATE TABLE IF NOT EXISTS examination_committee.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID REFERENCES hr.teachers(id) ON DELETE CASCADE,
    
    -- معلومات الحدث الأساسية
    title VARCHAR(200) NOT NULL, -- عنوان الحدث
    description TEXT, -- وصف الحدث
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('lecture', 'exam', 'meeting', 'task', 'announcement', 'special')), -- نوع الحدث
    event_category VARCHAR(50), -- تصنيف إضافي (مثل: 'monthly_exam', 'final_exam', 'lab_session', إلخ)
    
    -- التاريخ والوقت
    start_date DATE NOT NULL, -- تاريخ البداية
    end_date DATE, -- تاريخ النهاية (للأحداث التي تمتد لعدة أيام)
    start_time TIME, -- وقت البداية
    end_time TIME, -- وقت النهاية
    all_day BOOLEAN DEFAULT FALSE, -- حدث طوال اليوم
    
    -- الموقع والمكان
    location VARCHAR(200), -- المكان (قاعة، مختبر، إلخ)
    
    -- الربط بالمحاضرات والمواد الدراسية
    lecture_id UUID REFERENCES examination_committee.lectures(id) ON DELETE SET NULL, -- ربط بمحاضرة موجودة
    subject_id UUID REFERENCES examination_committee.teaching_subjects(id) ON DELETE SET NULL, -- ربط بمادة دراسية
    
    -- معلومات إضافية للأحداث الخاصة
    color VARCHAR(7) DEFAULT '#DC2626', -- لون الحدث في التقويم
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')), -- الأولوية
    reminder_minutes INTEGER, -- تذكير قبل الحدث بالدقائق (مثل: 15, 30, 60)
    
    -- حالة الحدث
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')), -- حالة الحدث
    
    -- المشاركة والتوزيع
    is_shared_with_students BOOLEAN DEFAULT FALSE, -- مشاركة مع الطلبة
    is_shared_with_teachers BOOLEAN DEFAULT FALSE, -- مشاركة مع التدريسيين الآخرين
    shared_with_departments TEXT[], -- الأقسام المشاركة معها
    shared_with_stages TEXT[], -- المراحل المشاركة معها
    shared_with_study_types TEXT[], -- أنواع الدراسة المشاركة معها
    
    -- معلومات المهام (إذا كان نوع الحدث = task)
    task_assigned_to TEXT[], -- الأشخاص المسؤولين عن المهمة
    task_due_date DATE, -- تاريخ انتهاء المهمة
    
    -- معلومات الامتحان (إذا كان نوع الحدث = exam)
    exam_type VARCHAR(50), -- نوع الامتحان (monthly, midterm, final, quiz, إلخ)
    exam_duration_minutes INTEGER, -- مدة الامتحان بالدقائق
    
    -- ملفات وموارد
    attachments JSONB, -- قائمة بملفات مرفقة (مسارات الملفات، أسماء، إلخ)
    
    -- معلومات الإشعارات
    send_notification BOOLEAN DEFAULT FALSE, -- إرسال إشعار للطلبة/التدريسيين
    notification_sent_at TIMESTAMPTZ, -- وقت إرسال الإشعار
    
    -- معلومات إضافية
    notes TEXT, -- ملاحظات إضافية
    metadata JSONB, -- بيانات إضافية مرنة
    
    -- معلومات التتبع
    created_by UUID REFERENCES student_affairs.users(id),
    updated_by UUID REFERENCES student_affairs.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ربط متكرر (للأحداث الدورية)
    is_recurring BOOLEAN DEFAULT FALSE, -- حدث متكرر
    recurrence_pattern VARCHAR(100), -- نمط التكرار (daily, weekly, monthly, yearly, إلخ)
    recurrence_end_date DATE, -- تاريخ انتهاء التكرار
    recurrence_count INTEGER, -- عدد مرات التكرار
    
    -- الأمان والخصوصية
    is_public BOOLEAN DEFAULT FALSE, -- حدث عام (يمكن للجميع رؤيته)
    visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')) -- مستوى الرؤية
);

-- جدول المشاركين في الأحداث (للأحداث المشتركة)
CREATE TABLE IF NOT EXISTS examination_committee.calendar_event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES examination_committee.calendar_events(id) ON DELETE CASCADE,
    participant_type VARCHAR(20) NOT NULL CHECK (participant_type IN ('student', 'teacher', 'department', 'stage', 'study_type')), -- نوع المشارك
    participant_id UUID, -- معرف المشارك (إذا كان طالب أو تدريسي)
    participant_identifier VARCHAR(200), -- معرف نصي (إذا كان قسم، مرحلة، إلخ)
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'tentative')), -- حالة المشاركة
    response_date TIMESTAMPTZ, -- تاريخ الرد
    notes TEXT, -- ملاحظات من المشارك
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء فهرس فريد للمشاركين (بدون COALESCE في UNIQUE مباشرة)
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_participants_unique ON examination_committee.calendar_event_participants(
    event_id, 
    participant_type, 
    COALESCE(participant_id::TEXT, participant_identifier)
);

-- جدول إشعارات التقويم
CREATE TABLE IF NOT EXISTS examination_committee.calendar_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES examination_committee.calendar_events(id) ON DELETE CASCADE,
    recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('student', 'teacher', 'all_students', 'all_teachers')), -- نوع المستقبل
    recipient_id UUID, -- معرف المستقبل
    notification_type VARCHAR(50) NOT NULL, -- نوع الإشعار (email, sms, push, in_app)
    title VARCHAR(200) NOT NULL, -- عنوان الإشعار
    message TEXT NOT NULL, -- نص الإشعار
    sent_at TIMESTAMPTZ, -- وقت الإرسال
    read_at TIMESTAMPTZ, -- وقت القراءة
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'read')),
    error_message TEXT, -- رسالة الخطأ (إذا فشل الإرسال)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_calendar_events_teacher ON examination_committee.calendar_events(teacher_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON examination_committee.calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_end_date ON examination_committee.calendar_events(end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_type ON examination_committee.calendar_events(event_type);
CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON examination_committee.calendar_events(status);
CREATE INDEX IF NOT EXISTS idx_calendar_events_lecture ON examination_committee.calendar_events(lecture_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_subject ON examination_committee.calendar_events(subject_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_shared ON examination_committee.calendar_events(is_shared_with_students, is_shared_with_teachers);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date_range ON examination_committee.calendar_events(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_calendar_participants_event ON examination_committee.calendar_event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_participants_participant ON examination_committee.calendar_event_participants(participant_type, participant_id);

CREATE INDEX IF NOT EXISTS idx_calendar_notifications_event ON examination_committee.calendar_notifications(event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_recipient ON examination_committee.calendar_notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_status ON examination_committee.calendar_notifications(status);

-- تعليقات على الجداول
COMMENT ON TABLE examination_committee.calendar_events IS 'الأحداث في التقويم الجامعي للتدريسيين (محاضرات، امتحانات، اجتماعات، مهام، إلخ)';
COMMENT ON TABLE examination_committee.calendar_event_participants IS 'المشاركون في الأحداث المشتركة';
COMMENT ON TABLE examination_committee.calendar_notifications IS 'إشعارات الأحداث في التقويم';

COMMENT ON COLUMN examination_committee.calendar_events.event_type IS 'نوع الحدث: lecture (محاضرة), exam (امتحان), meeting (اجتماع), task (مهمة), announcement (إعلان), special (مناسبة خاصة)';
COMMENT ON COLUMN examination_committee.calendar_events.visibility IS 'مستوى الرؤية: private (خاص), shared (مشترك), public (عام)';
COMMENT ON COLUMN examination_committee.calendar_events.recurrence_pattern IS 'نمط التكرار: daily, weekly, monthly, yearly, custom';

