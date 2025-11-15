-- إضافة الحقول المطلوبة لجدول الطلاب

-- إضافة university_id
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS university_id VARCHAR(20) UNIQUE;

-- إضافة الحقول الشخصية
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(50),
ADD COLUMN IF NOT EXISTS last_name VARCHAR(50),
ADD COLUMN IF NOT EXISTS middle_name VARCHAR(50),
ADD COLUMN IF NOT EXISTS national_id VARCHAR(20) UNIQUE,
ADD COLUMN IF NOT EXISTS birth_place VARCHAR(100),
ADD COLUMN IF NOT EXISTS nationality VARCHAR(50) DEFAULT 'سعودي',
ADD COLUMN IF NOT EXISTS religion VARCHAR(50) DEFAULT 'مسلم',
ADD COLUMN IF NOT EXISTS marital_status VARCHAR(20) CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed')),
ADD COLUMN IF NOT EXISTS email VARCHAR(100),
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS city VARCHAR(50),
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(50),
ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20);

-- إضافة بيانات الدراسة الإعدادية
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS secondary_school_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS secondary_school_type VARCHAR(20) CHECK (secondary_school_type IN ('public', 'private', 'international')),
ADD COLUMN IF NOT EXISTS secondary_graduation_year VARCHAR(4),
ADD COLUMN IF NOT EXISTS secondary_gpa DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS secondary_total_score DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS secondary_achievements TEXT,
ADD COLUMN IF NOT EXISTS secondary_activities TEXT;

-- إضافة بيانات القبول الجامعي
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS admission_type VARCHAR(20) CHECK (admission_type IN ('regular', 'conditional', 'transfer', 'international')),
ADD COLUMN IF NOT EXISTS major VARCHAR(100),
ADD COLUMN IF NOT EXISTS level VARCHAR(20) CHECK (level IN ('bachelor', 'master', 'phd', 'diploma')),
ADD COLUMN IF NOT EXISTS semester VARCHAR(20),
ADD COLUMN IF NOT EXISTS academic_year VARCHAR(10),
ADD COLUMN IF NOT EXISTS admission_score DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS english_level VARCHAR(20),
ADD COLUMN IF NOT EXISTS math_level VARCHAR(20),
ADD COLUMN IF NOT EXISTS science_level VARCHAR(20);

-- إضافة المستمسكات والوثائق
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS national_id_copy BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS birth_certificate BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS secondary_certificate BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS photo BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS medical_certificate BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS other_documents TEXT;

-- إضافة حالة الطالب
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'graduated', 'withdrawn')),
ADD COLUMN IF NOT EXISTS registration_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES student_affairs.users(id),
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES student_affairs.users(id);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_students_university_id ON student_affairs.students(university_id);
CREATE INDEX IF NOT EXISTS idx_students_national_id ON student_affairs.students(national_id);
CREATE INDEX IF NOT EXISTS idx_students_department ON student_affairs.students(department_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON student_affairs.students(status);
CREATE INDEX IF NOT EXISTS idx_students_registration_date ON student_affairs.students(registration_date);

-- إنشاء دالة لتوليد الرقم الجامعي
CREATE OR REPLACE FUNCTION student_affairs.generate_university_id()
RETURNS VARCHAR(20) AS $$
DECLARE
    current_year VARCHAR(3);
    current_month VARCHAR(2);
    sequence_number VARCHAR(7);
    new_id VARCHAR(20);
BEGIN
    -- الحصول على السنة الحالية (آخر 3 أرقام)
    current_year := RIGHT(EXTRACT(YEAR FROM NOW())::TEXT, 3);
    
    -- الحصول على الشهر الحالي
    current_month := LPAD(EXTRACT(MONTH FROM NOW())::TEXT, 2, '0');
    
    -- الحصول على الرقم التسلسلي التالي
    SELECT COALESCE(MAX(CAST(SUBSTRING(university_id FROM 8) AS INTEGER)), 0) + 1
    INTO sequence_number
    FROM student_affairs.students
    WHERE university_id LIKE 'SH' || current_year || current_month || '%';
    
    -- تكوين الرقم الجامعي
    new_id := 'SH' || current_year || current_month || LPAD(sequence_number::TEXT, 7, '0');
    
    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- إنشاء trigger لتحديث updated_at
CREATE OR REPLACE FUNCTION student_affairs.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_students_updated_at
    BEFORE UPDATE ON student_affairs.students
    FOR EACH ROW
    EXECUTE FUNCTION student_affairs.update_updated_at_column();
