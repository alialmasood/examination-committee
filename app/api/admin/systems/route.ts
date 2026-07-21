import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { requireStudentAffairsAdmin } from '@/src/lib/admin-systems-access';

/**
 * GET /api/admin/systems
 * قائمة الأنظمة مع المستخدمين المرتبطين (بدون كلمات مرور).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStudentAffairsAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const systemsRes = await query(
      `SELECT
         s.id::text,
         s.code,
         COALESCE(s.name_ar, s.name, s.code) AS name_ar,
         s.base_path,
         COALESCE(s.is_active, TRUE) AS is_active
       FROM student_affairs.systems s
       ORDER BY
         CASE WHEN s.code = 'STUDENT_AFFAIRS' THEN 0 ELSE 1 END,
         COALESCE(s.name_ar, s.code)`
    );

    const usersRes = await query(
      `SELECT
         us.system_id::text AS system_id,
         u.id::text AS user_id,
         u.username,
         u.full_name,
         u.email,
         u.is_active,
         COALESCE(us.role, 'USER') AS role
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
