-- إنشاء الجداول المطلوبة للنظام (تتوافق مع الجداول الموجودة)

-- جدول الأنظمة
CREATE TABLE IF NOT EXISTS platform.systems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    base_path VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول ربط المستخدمين بالأنظمة
CREATE TABLE IF NOT EXISTS platform.user_system_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES student_affairs.users(id) ON DELETE CASCADE,
    system_id UUID REFERENCES platform.systems(id) ON DELETE CASCADE,
    role_id UUID REFERENCES student_affairs.roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, system_id)
);

-- جدول الجلسات
CREATE TABLE IF NOT EXISTS platform.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES student_affairs.users(id) ON DELETE CASCADE,
    token_id VARCHAR(100) UNIQUE NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, token_id)
);

-- جدول محاولات تسجيل الدخول
CREATE TABLE IF NOT EXISTS platform.login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES student_affairs.users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    ip_address INET,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_user_system_roles_user_id ON platform.user_system_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_system_roles_system_id ON platform.user_system_roles(system_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON platform.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_id ON platform.sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id ON platform.login_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON platform.login_attempts(attempted_at);
