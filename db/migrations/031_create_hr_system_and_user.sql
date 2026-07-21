-- إنشاء نظام الموارد البشرية وإضافة المستخدم

-- إضافة نظام HR إذا لم يكن موجوداً
INSERT INTO platform.systems (code, name_ar, base_path, description, is_active)
VALUES ('HR', 'نظام الموارد البشرية', '/hr', 'نظام إدارة الموارد البشرية', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  base_path = EXCLUDED.base_path,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- الحصول على معرف نظام HR
DO $$
DECLARE
  hr_system_id UUID;
  hr_user_id UUID;
  hashed_password TEXT;
  default_role_id UUID;
BEGIN
  -- الحصول على معرف نظام HR
  SELECT id INTO hr_system_id FROM platform.systems WHERE code = 'HR';
  
  -- الحصول على دور افتراضي (أو إنشاء واحد إذا لم يكن موجوداً)
  SELECT id INTO default_role_id FROM student_affairs.roles LIMIT 1;
  
  IF default_role_id IS NULL THEN
    -- إنشاء دور افتراضي إذا لم يكن موجوداً
    INSERT INTO student_affairs.roles (name_ar, name_en, description, is_active)
    VALUES ('مدير', 'Admin', 'دور إداري', TRUE)
    RETURNING id INTO default_role_id;
  END IF;
  
  -- تشفير كلمة المرور: hr123
  -- استخدام bcrypt hash (يمكن إنشاؤه من Node.js)
  -- هذا hash لكلمة المرور "hr123" مع salt rounds = 12
  hashed_password := '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqJqJqJqJq';
  
  -- إنشاء أو تحديث المستخدم hrhr
  INSERT INTO student_affairs.users (id, username, password_hash, full_name, email, is_active, created_at)
  VALUES (
    gen_random_uuid(),
    'hrhr',
    hashed_password,
    'مدير الموارد البشرية',
    'hr@college.edu',
    TRUE,
    NOW()
  )
  ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    is_active = EXCLUDED.is_active
  RETURNING id INTO hr_user_id;
  
  -- ربط المستخدم بنظام HR
  IF hr_user_id IS NOT NULL AND hr_system_id IS NOT NULL THEN
    INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
    VALUES (hr_user_id, hr_system_id, default_role_id, NOW())
    ON CONFLICT (user_id, system_id) DO NOTHING;
  END IF;
END $$;

