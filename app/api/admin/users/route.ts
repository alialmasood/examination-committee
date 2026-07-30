import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { query } from '@/src/lib/db';
import { requirePlatformAdmin } from '@/src/lib/admin-systems-access';
import { grantAccountsAdminRole } from '@/src/lib/accounts/accounts-access';
import {
  DEAN_FULL_NAME,
  DEAN_USERNAME,
  ensureDeanUser,
  isDeanUsername,
} from '@/src/lib/dean';
import {
  GENERAL_SUPERVISION_FULL_NAME,
  GENERAL_SUPERVISION_USERNAME,
  ensureGeneralSupervisionUser,
  isGeneralSupervisionUsername,
} from '@/src/lib/general-supervision';

/** أنظمة تشغيلية يمكن إنشاؤها/ربطها من لوحة المنصة */
export const CREATABLE_SYSTEMS: Array<{
  code: string;
  name_ar: string;
  base_path: string;
  englishName: string;
}> = [
  {
    code: 'STUDENT_AFFAIRS',
    name_ar: 'شؤون الطلبة والتسجيل',
    base_path: '/student-affairs',
    englishName: 'Student Affairs',
  },
  {
    code: 'ACCOUNTS',
    name_ar: 'نظام الحسابات',
    base_path: '/accounts',
    englishName: 'Accounts',
  },
  {
    code: 'DEAN',
    name_ar: 'مراقبة السيد العميد',
    base_path: '/dean',
    englishName: 'Dean Monitoring',
  },
  {
    code: 'GENERAL_SUPERVISION',
    name_ar: 'لوحة إشراف عامة',
    base_path: '/general-supervision',
    englishName: 'General Supervision',
  },
  {
    code: 'HR',
    name_ar: 'الموارد البشرية',
    base_path: '/hr',
    englishName: 'HR',
  },
  {
    code: 'CYBER',
    name_ar: 'الأمن السيبراني',
    base_path: '/cyber',
    englishName: 'Cybersecurity',
  },
  {
    code: 'OPTICS',
    name_ar: 'تقنيات البصريات',
    base_path: '/optics',
    englishName: 'Optics',
  },
  {
    code: 'PHYSICS',
    name_ar: 'الفيزياء الصحية',
    base_path: '/physics',
    englishName: 'Health Physics',
  },
  {
    code: 'OIL',
    name_ar: 'النفط والغاز',
    base_path: '/oil',
    englishName: 'Oil & Gas',
  },
  {
    code: 'HEALTH',
    name_ar: 'صحة المجتمع',
    base_path: '/health',
    englishName: 'Community Health',
  },
  {
    code: 'EMERGENCY',
    name_ar: 'طب الطوارئ',
    base_path: '/emergency',
    englishName: 'Emergency Medicine',
  },
  {
    code: 'THERAPY',
    name_ar: 'العلاج الطبيعي',
    base_path: '/therapy',
    englishName: 'Physical Therapy',
  },
  {
    code: 'CONSTRUCTION',
    name_ar: 'البناء والإنشاءات',
    base_path: '/construction',
    englishName: 'Construction',
  },
];

async function systemsHasNameColumn(): Promise<boolean> {
  const r = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'student_affairs'
       AND table_name = 'systems'
       AND column_name = 'name'
     LIMIT 1`
  );
  return r.rows.length > 0;
}

async function upsertSystem(code: string, nameAr: string, basePath: string, englishName: string) {
  const hasName = await systemsHasNameColumn();
  if (hasName) {
    const res = await query(
      `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (code)
       DO UPDATE SET
         name = EXCLUDED.name,
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE
       RETURNING id::text AS id, code, name_ar, base_path`,
      [code, englishName, nameAr, basePath]
    );
    return res.rows[0];
  }
  const res = await query(
    `INSERT INTO student_affairs.systems (code, name_ar, base_path, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (code)
     DO UPDATE SET
       name_ar = EXCLUDED.name_ar,
       base_path = EXCLUDED.base_path,
       is_active = TRUE
     RETURNING id::text AS id, code, name_ar, base_path`,
    [code, nameAr, basePath]
  );
  return res.rows[0];
}

/**
 * POST /api/admin/users
 * إنشاء حساب جديد وربطه بنظام/صلاحية محددة.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    let username = String(body.username || '')
      .trim()
      .toLowerCase();
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim() || null;
    const password = String(body.password || '');
    const confirmPassword = String(body.confirm_password || '');
    const systemCode = String(body.system_code || '')
      .trim()
      .toUpperCase();
    const role = String(body.role || 'ADMIN')
      .trim()
      .toUpperCase() || 'ADMIN';

    if (!systemCode) {
      return NextResponse.json(
        { success: false, message: 'يجب اختيار صلاحية / نظام الحساب' },
        { status: 400 }
      );
    }

    const catalog = CREATABLE_SYSTEMS.find((s) => s.code === systemCode);
    if (!catalog) {
      return NextResponse.json(
        { success: false, message: 'نظام/صلاحية غير معتمدة' },
        { status: 400 }
      );
    }

    // حساب مراقبة العميد يستخدم دائماً اليوزر dean
    if (systemCode === 'DEAN') {
      username = DEAN_USERNAME;
    }
    // حساب الإشراف العامة يستخدم دائماً اليوزر rahmaan
    if (systemCode === 'GENERAL_SUPERVISION') {
      username = GENERAL_SUPERVISION_USERNAME;
    }

    if (!username || username.length < 3) {
      return NextResponse.json(
        { success: false, message: 'اسم المستخدم يجب ألا يقل عن 3 أحرف' },
        { status: 400 }
      );
    }
    if (!/^[a-z0-9._-]+$/i.test(username)) {
      return NextResponse.json(
        {
          success: false,
          message: 'اسم المستخدم يقبل حروفاً إنجليزية وأرقاماً و . _ - فقط',
        },
        { status: 400 }
      );
    }
    if (!fullName && systemCode !== 'DEAN' && systemCode !== 'GENERAL_SUPERVISION') {
      return NextResponse.json(
        { success: false, message: 'الاسم الكامل مطلوب' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' },
        { status: 400 }
      );
    }
    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: 'تأكيد كلمة المرور غير مطابق' },
        { status: 400 }
      );
    }

    const existing = await query(
      `SELECT id::text AS id, username FROM student_affairs.users WHERE username = $1`,
      [username]
    );

    const isFixedAccount =
      systemCode === 'DEAN' || systemCode === 'GENERAL_SUPERVISION';

    // لغير الحسابات الثابتة: منع تكرار اسم المستخدم
    if (existing.rows[0] && !isFixedAccount) {
      return NextResponse.json(
        { success: false, message: `اسم المستخدم «${username}» مستخدم مسبقاً` },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const resolvedFullName =
      fullName ||
      (systemCode === 'DEAN'
        ? DEAN_FULL_NAME
        : systemCode === 'GENERAL_SUPERVISION'
          ? GENERAL_SUPERVISION_FULL_NAME
          : username);

    let userId: string;
    if (existing.rows[0] && isFixedAccount) {
      // تحديث الحساب الثابت الموجود (كلمة المرور + الاسم)
      const updated = await query(
        `UPDATE student_affairs.users
         SET password_hash = $1,
             full_name = $2,
             email = COALESCE($3, email),
             is_active = TRUE
         WHERE username = $4
         RETURNING id::text AS id`,
        [passwordHash, resolvedFullName, email, username]
      );
      userId = updated.rows[0].id;
    } else {
      const inserted = await query(
        `INSERT INTO student_affairs.users
           (username, email, full_name, password_hash, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id::text AS id`,
        [username, email, resolvedFullName, passwordHash]
      );
      userId = inserted.rows[0].id;
    }

    const system = await upsertSystem(
      catalog.code,
      catalog.name_ar,
      catalog.base_path,
      catalog.englishName
    );

    // ربط المستخدم بالنظام (عمود role اختياري)
    const roleCol = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'student_affairs'
         AND table_name = 'user_systems'
         AND column_name = 'role'
       LIMIT 1`
    );
    if (roleCol.rows.length > 0) {
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id, role)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT (user_id, system_id)
         DO UPDATE SET role = EXCLUDED.role`,
        [userId, system.id, role]
      );
    } else {
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [userId, system.id]
      );
    }

    if (systemCode === 'ACCOUNTS') {
      await grantAccountsAdminRole(userId).catch((e) => {
        console.warn('تعذر منح دور accounts_admin:', e);
      });
    }

    if (systemCode === 'DEAN') {
      await ensureDeanUser();
    }
    if (systemCode === 'GENERAL_SUPERVISION') {
      await ensureGeneralSupervisionUser();
    }

    return NextResponse.json({
      success: true,
      message:
        systemCode === 'DEAN' && existing.rows[0]
          ? 'تم تحديث حساب مراقبة السيد العميد بنجاح'
          : systemCode === 'GENERAL_SUPERVISION' && existing.rows[0]
            ? 'تم تحديث حساب لوحة إشراف عامة بنجاح'
            : `تم إنشاء الحساب وربطه بنظام «${catalog.name_ar}»`,
      data: {
        user_id: userId,
        username,
        full_name: resolvedFullName,
        system_code: system.code,
        system_name_ar: catalog.name_ar,
        role,
        is_dean: isDeanUsername(username),
        is_general_supervision: isGeneralSupervisionUsername(username),
      },
    });
  } catch (error) {
    console.error('خطأ في إنشاء الحساب:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر إنشاء الحساب' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/users
 * قائمة الصلاحيات/الأنظمة المتاحة عند الإنشاء.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    success: true,
    data: {
      systems: CREATABLE_SYSTEMS.map((s) => ({
        code: s.code,
        name_ar: s.name_ar,
        base_path: s.base_path,
      })),
    },
  });
}
