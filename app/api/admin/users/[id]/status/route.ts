import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { requirePlatformAdmin } from '@/src/lib/admin-systems-access';
import { isPlatformSuperAdminUsername } from '@/src/lib/platform-superadmin';

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/users/[id]/status
 * Body: { is_active: boolean }
 * تفعيل أو تعطيل حساب مستخدم من بوابة إدارة المنصة.
 */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const { id: userId } = await context.params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { success: false, message: 'معرّف المستخدم غير صالح' },
      { status: 400 }
    );
  }

  let body: { is_active?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: 'جسم الطلب غير صالح' },
      { status: 400 }
    );
  }

  if (typeof body.is_active !== 'boolean') {
    return NextResponse.json(
      { success: false, message: 'قيمة الحالة مطلوبة (true أو false)' },
      { status: 400 }
    );
  }

  const isActive = body.is_active;

  if (userId === auth.user.id && !isActive) {
    return NextResponse.json(
      { success: false, message: 'لا يمكنك تعطيل حسابك الحالي' },
      { status: 400 }
    );
  }

  try {
    const existing = await query(
      `SELECT id, username, is_active FROM student_affairs.users WHERE id = $1::uuid`,
      [userId]
    );
    if (!existing.rows[0]) {
      return NextResponse.json(
        { success: false, message: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const username = existing.rows[0].username as string;
    if (isPlatformSuperAdminUsername(username) && !isActive) {
      return NextResponse.json(
        { success: false, message: 'لا يمكن تعطيل حساب السوبر أدمن' },
        { status: 400 }
      );
    }

    await query(
      `UPDATE student_affairs.users
       SET is_active = $2
       WHERE id = $1::uuid`,
      [userId, isActive]
    );

    return NextResponse.json({
      success: true,
      message: isActive
        ? `تم تنشيط حساب «${username}» بنجاح`
        : `تم تعطيل حساب «${username}» بنجاح`,
      data: {
        user_id: userId,
        username,
        is_active: isActive,
      },
    });
  } catch (error) {
    console.error('خطأ في تحديث حالة الحساب:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحديث حالة الحساب' },
      { status: 500 }
    );
  }
}
