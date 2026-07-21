-- إنشاء جدول التدريسيين
-- هذا الجدول يحفظ بيانات التدريسيين في الكلية

CREATE SCHEMA IF NOT EXISTS hr;

CREATE TABLE IF NOT EXISTS hr.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- البيانات الشخصية
    full_name VARCHAR(200) NOT NULL,
    full_name_ar VARCHAR(200) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    national_id VARCHAR(20) UNIQUE,
    
    -- البيانات الوظيفية
    employee_id VARCHAR(50) UNIQUE, -- الرقم الوظيفي
    department VARCHAR(100) NOT NULL, -- القسم
    academic_degree VARCHAR(100), -- الدرجة العلمية (ماجستير، دكتوراه، إلخ)
    specialization VARCHAR(200), -- التخصص
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave', 'retired')),
    hire_date DATE, -- تاريخ التعيين
    employment_type VARCHAR(20) DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract')),
    
    -- معلومات إضافية
    notes TEXT,
    
    -- ربط بمستخدم النظام (إذا كان لديه حساب)
    user_id UUID REFERENCES student_affairs.users(id) ON DELETE SET NULL,
    
    -- معلومات النظام
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES student_affairs.users(id),
    updated_by UUID REFERENCES student_affairs.users(id)
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_teachers_department ON hr.teachers(department);
CREATE INDEX IF NOT EXISTS idx_teachers_status ON hr.teachers(status);
CREATE INDEX IF NOT EXISTS idx_teachers_employee_id ON hr.teachers(employee_id);
CREATE INDEX IF NOT EXISTS idx_teachers_full_name ON hr.teachers(full_name);

-- تعليق على الجدول
COMMENT ON TABLE hr.teachers IS 'جدول التدريسيين في الكلية';

