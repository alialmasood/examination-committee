import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import bcrypt from 'bcrypt';

// POST - إنشاء حساب للتدريسي
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // التحقق من وجود التدريسي
    const teacherResult = await query(
      'SELECT id, full_name, full_name_ar, email, user_id FROM hr.teachers WHERE id = $1',
      [id]
    );

    if (teacherResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'التدريسي غير موجود'
        },
        { status: 404 }
      );
    }

    const teacher = teacherResult.rows[0];

    // التحقق من وجود حساب بالفعل
    if (teacher.user_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'لدى التدريسي حساب بالفعل في النظام'
        },
        { status: 400 }
      );
    }

    // التحقق من البيانات المطلوبة
    if (!body.username || !body.password) {
      return NextResponse.json(
        {
          success: false,
          error: 'اسم المستخدم وكلمة المرور مطلوبان'
        },
        { status: 400 }
      );
    }

    // التحقق من قوة كلمة المرور
    if (body.password.length < 6) {
      return NextResponse.json(
        {
          success: false,
          error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'
        },
        { status: 400 }
      );
    }

    const username = body.username.trim();
    const password = body.password;

    // التحقق من عدم وجود اسم المستخدم مسبقاً
    const existingUser = await query(
      'SELECT id FROM student_affairs.users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'اسم المستخدم موجود مسبقاً، يرجى اختيار اسم آخر'
        },
        { status: 400 }
      );
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 12);

    // إنشاء المستخدم
    const userResult = await query(
      `INSERT INTO student_affairs.users 
       (username, email, full_name, password_hash, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, username, email, full_name`,
      [
        username,
        teacher.email || null,
        teacher.full_name_ar || teacher.full_name,
        hashedPassword,
        true
      ]
    );

    const userId = userResult.rows[0].id;

    // ربط المستخدم بنظام HR
    const hrSystemResult = await query(
      'SELECT id FROM platform.systems WHERE code = $1',
      ['HR']
    );

    if (hrSystemResult.rows.length > 0) {
      const hrSystemId = hrSystemResult.rows[0].id;
      // الحصول على دور USER أو إنشاء واحد إذا لم يكن موجوداً
      const roleResult = await query(
        'SELECT id FROM student_affairs.roles WHERE code = $1 OR code = $2 LIMIT 1',
        ['user', 'USER']
      );
      
      let roleId: string | null = null;
      if (roleResult.rows.length > 0) {
        roleId = roleResult.rows[0].id;
      } else {
        // إنشاء دور USER إذا لم يكن موجوداً
        const newRoleResult = await query(
          `INSERT INTO student_affairs.roles (code, name_ar, description, is_active)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          ['USER', 'مستخدم', 'دور المستخدم العادي', true]
        );
        roleId = newRoleResult.rows[0].id;
      }

      // ربط المستخدم بالنظام باستخدام platform.user_system_roles
      await query(
        `INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [userId, hrSystemId, roleId]
      );
    }

    // تحديث التدريسي بربطه بالمستخدم
    await query(
      'UPDATE hr.teachers SET user_id = $1, updated_at = NOW() WHERE id = $2',
      [userId, id]
    );

    return NextResponse.json({
      success: true,
      data: {
        user_id: userId,
        username,
        password, // إرجاع كلمة المرور لمرة واحدة فقط
        message: 'تم إنشاء الحساب بنجاح'
      }
    });
  } catch (error: any) {
    console.error('خطأ في إنشاء حساب التدريسي:', error);
    
    if (error.code === '23505' && error.constraint?.includes('username')) {
      return NextResponse.json(
        {
          success: false,
          error: 'اسم المستخدم موجود مسبقاً'
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في إنشاء الحساب'
      },
      { status: 500 }
    );
  }
}

// دالة لإنشاء اسم مستخدم افتراضي
function generateUsername(fullName: string): string {
  // إزالة المسافات والأرقام وتحويل إلى حروف إنجليزية
  const name = fullName
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  
  // استخدام أول 10 أحرف أو أقل + timestamp للتفرد
  const timestamp = Date.now().toString().slice(-4);
  return `${name.slice(0, 6)}${timestamp}`;
}

// دالة لإنشاء كلمة مرور افتراضية
function generateDefaultPassword(): string {
  // كلمة مرور افتراضية: hr + 6 أرقام عشوائية
  const randomNumbers = Math.floor(100000 + Math.random() * 900000);
  return `hr${randomNumbers}`;
}

