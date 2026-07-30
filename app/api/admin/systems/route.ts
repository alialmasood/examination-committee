import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { requirePlatformAdmin } from '@/src/lib/admin-systems-access';
import {
  DEAN_FULL_NAME,
  DEAN_USERNAME,
  ensureDeanUser,
} from '@/src/lib/dean';
import {
  GENERAL_SUPERVISION_BASE_PATH,
  GENERAL_SUPERVISION_FULL_NAME,
  GENERAL_SUPERVISION_SYSTEM_CODE,
  GENERAL_SUPERVISION_USERNAME,
  ensureGeneralSupervisionUser,
} from '@/src/lib/general-supervision';

async function ensureDeanVisibleInAdmin(): Promise<void> {
  await ensureDeanUser();

  // نظام مراقبة العميد للظهور في قائمة الإدارة
  const hasName = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'student_affairs' AND table_name = 'systems' AND column_name = 'name'
     LIMIT 1`
  );
  if (hasName.rows.length > 0) {
    await query(
      `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
       VALUES ('DEAN', 'Dean Monitoring', 'مراقبة السيد العميد', '/dean', TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`
    );
  } else {
    await query(
      `INSERT INTO student_affairs.systems (code, name_ar, base_path, is_active)
       VALUES ('DEAN', 'مراقبة السيد العميد', '/dean', TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`
    );
  }

  const dean = await query(
    `SELECT id FROM student_affairs.users WHERE username = $1`,
    [DEAN_USERNAME]
  );
  const system = await query(
    `SELECT id FROM student_affairs.systems WHERE code = 'DEAN'`
  );
  if (dean.rows[0] && system.rows[0]) {
    await query(
      `UPDATE student_affairs.users
       SET full_name = COALESCE(NULLIF(TRIM(full_name), ''), $1),
           is_active = TRUE
       WHERE id = $2`,
      [DEAN_FULL_NAME, dean.rows[0].id]
    );
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [dean.rows[0].id, system.rows[0].id]
    );
  }
}

async function ensureGeneralSupervisionVisibleInAdmin(): Promise<void> {
  await ensureGeneralSupervisionUser();

  const hasName = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'student_affairs' AND table_name = 'systems' AND column_name = 'name'
     LIMIT 1`
  );
  if (hasName.rows.length > 0) {
    await query(
      `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
       VALUES ($1, 'General Supervision', $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`,
      [
        GENERAL_SUPERVISION_SYSTEM_CODE,
        GENERAL_SUPERVISION_FULL_NAME,
        GENERAL_SUPERVISION_BASE_PATH,
      ]
    );
  } else {
    await query(
      `INSERT INTO student_affairs.systems (code, name_ar, base_path, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`,
      [
        GENERAL_SUPERVISION_SYSTEM_CODE,
        GENERAL_SUPERVISION_FULL_NAME,
        GENERAL_SUPERVISION_BASE_PATH,
      ]
    );
  }

  const user = await query(
    `SELECT id FROM student_affairs.users WHERE username = $1`,
    [GENERAL_SUPERVISION_USERNAME]
  );
  const system = await query(
    `SELECT id FROM student_affairs.systems WHERE code = $1`,
    [GENERAL_SUPERVISION_SYSTEM_CODE]
  );
  if (user.rows[0] && system.rows[0]) {
    await query(
      `UPDATE student_affairs.users
       SET full_name = COALESCE(NULLIF(TRIM(full_name), ''), $1),
           is_active = TRUE
       WHERE id = $2`,
      [GENERAL_SUPERVISION_FULL_NAME, user.rows[0].id]
    );
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [user.rows[0].id, system.rows[0].id]
    );
  }
}

/**
 * GET /api/admin/systems
 * قائمة الأنظمة مع المستخدمين المرتبطين (بدون كلمات مرور).
 * مصدر مركزي — لا يتطلب الدخول إلى كل نظام على حدة.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    await ensureDeanVisibleInAdmin().catch((e) => {
      console.warn('تعذر تهيئة عرض حساب العميد:', e);
    });
    await ensureGeneralSupervisionVisibleInAdmin().catch((e) => {
      console.warn('تعذر تهيئة عرض حساب الإشراف العامة:', e);
    });

    // لا نعتمد على عمود s.name — قد لا يكون موجوداً في بعض قواعد البيانات
    const systemsRes = await query(
      `SELECT
         s.id::text,
         s.code,
         COALESCE(NULLIF(TRIM(s.name_ar), ''), s.code) AS name_ar,
         s.base_path,
         COALESCE(s.is_active, TRUE) AS is_active
       FROM student_affairs.systems s
       ORDER BY
         CASE
           WHEN s.code = 'STUDENT_AFFAIRS' THEN 0
           WHEN s.code = 'ACCOUNTS' THEN 1
           WHEN s.code = 'DEAN' THEN 2
           WHEN s.code = 'GENERAL_SUPERVISION' THEN 3
           ELSE 4
         END,
         COALESCE(s.name_ar, s.code)`
    );

    // عمود us.role اختياري — بعض الجداول أُنشئت بدونه
    const roleCol = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'student_affairs'
         AND table_name = 'user_systems'
         AND column_name = 'role'
       LIMIT 1`
    );
    const hasRole = roleCol.rows.length > 0;

    const usersRes = await query(
      hasRole
        ? `SELECT
             us.system_id::text AS system_id,
             u.id::text AS user_id,
             u.username,
             u.full_name,
             u.email,
             u.is_active,
             COALESCE(us.role, 'ADMIN') AS role
           FROM student_affairs.user_systems us
           JOIN student_affairs.users u ON u.id = us.user_id
           ORDER BY u.username`
        : `SELECT
             us.system_id::text AS system_id,
             u.id::text AS user_id,
             u.username,
             u.full_name,
             u.email,
             u.is_active,
             'ADMIN' AS role
           FROM student_affairs.user_systems us
           JOIN student_affairs.users u ON u.id = us.user_id
           ORDER BY u.username`
    );

    const usersBySystem = new Map<string, Array<Record<string, unknown>>>();
    for (const row of usersRes.rows) {
      const key = String(row.system_id);
      const list = usersBySystem.get(key) ?? [];
      list.push({
        id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        is_active: row.is_active,
        role: row.role,
      });
      usersBySystem.set(key, list);
    }

    const systems = systemsRes.rows.map((s) => ({
      id: s.id,
      code: s.code,
      name_ar: s.name_ar,
      base_path: s.base_path,
      is_active: s.is_active,
      users: usersBySystem.get(String(s.id)) ?? [],
    }));

    return NextResponse.json({
      success: true,
      data: { systems },
    });
  } catch (error) {
    console.error('خطأ في جلب الأنظمة:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر جلب قائمة الأنظمة' },
      { status: 500 }
    );
  }
}
