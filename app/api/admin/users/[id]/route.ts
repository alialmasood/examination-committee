import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { requirePlatformAdmin } from '@/src/lib/admin-systems-access';
import { isPlatformSuperAdminUsername } from '@/src/lib/platform-superadmin';

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/admin/users/[id]
 * حذف حساب مستخدم نهائياً من المنصة (مع روابط أنظمته).
 */
export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const { id: userId } = await context.params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { success: false, message: 'معرّف المستخدم غير صالح' },
      { status: 400 }
    );
  }

  if (userId === auth.user.id) {
    return NextResponse.json(
      { success: false, message: 'لا يمكنك حذف حسابك الحالي' },
      { status: 400 }
    );
  }

  try {
    const existing = await query(
      `SELECT id, username FROM student_affairs.users WHERE id = $1::uuid`,
      [userId]
    );
    if (!existing.rows[0]) {
      return NextResponse.json(
        { success: false, message: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const username = existing.rows[0].username as string;

    if (isPlatformSuperAdminUsername(username)) {
      return NextResponse.json(
        { success: false, message: 'لا يمكن حذف حساب السوبر أدمن' },
        { status: 400 }
      );
    }

    // إزالة الروابط ثم الحساب — آمن حتى لو لم يكن CASCADE مفعّلاً
    await query(`DELETE FROM student_affairs.user_systems WHERE user_id = $1::uuid`, [
      userId,
    ]);

    // جلسات / محاولات دخول إن وُجدت
    await query(`DELETE FROM student_affairs.sessions WHERE user_id = $1::uuid`, [
      userId,
    ]).catch(() => undefined);

    await query(
      `DELETE FROM student_affairs.login_attempts WHERE user_id = $1::uuid`,
      [userId]
    ).catch(() => undefined);

    // أدوار المنصة إن وُجدت
    await query(
      `DELETE FROM platform.user_system_roles WHERE user_id = $1::uuid`,
      [userId]
    ).catch(() => undefined);

    await query(`DELETE FROM student_affairs.users WHERE id = $1::uuid`, [userId]);

    return NextResponse.json({
      success: true,
      message: `تم حذف حساب «${username}» نهائياً`,
      data: { user_id: userId, username },
    });
  } catch (error) {
    console.error('خطأ في حذف الحساب:', error);
    return NextResponse.json(
      {
        success: false,
        message:
          'تعذر حذف الحساب — قد يكون مرتبطاً ببيانات أخرى في النظام. جرّب تعطيله بدلاً من الحذف.',
      },
      { status: 500 }
    );
  }
}
