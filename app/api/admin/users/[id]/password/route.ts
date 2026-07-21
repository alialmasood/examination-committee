import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { query } from '@/src/lib/db';
import { requireStudentAffairsAdmin } from '@/src/lib/admin-systems-access';

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/users/[id]/password
 * Body: { password: string, confirm_password: string }
 */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireStudentAffairsAdmin(request);
  if (!auth.ok) return auth.response;

  const { id: userId } = await context.params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json(
      { success: false, message: 'معرّف المستخدم غير صالح' },
      { status: 400 }
    );
  }

  let body: { password?: unknown; confirm_password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: 'جسم الطلب غير صالح' },
      { status: 400 }
    );
  }

  const password = String(body.password ?? '');
  const confirm = String(body.confirm_password ?? '');

  if (password.length < 6) {
    return NextResponse.json(
      { success: false, message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' },
      { status: 400 }
    );
  }
  if (password.length > 128) {
    return NextResponse.json(
      { success: false, message: 'كلمة المرور طويلة جداً' },
      { status: 400 }
    );
  }
  if (password !== confirm) {
    return NextResponse.json(
      { success: false, message: 'تأكيد كلمة المرور غير مطابق' },
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

    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      `UPDATE student_affairs.users
       SET password_hash = $2, is_active = TRUE
       WHERE id = $1::uuid`,
      [userId, passwordHash]
    );

    return NextResponse.json({
      success: true,
      message: `تم تحديث كلمة مرور المستخدم «${existing.rows[0].username}» بنجاح`,
      data: {
        user_id: userId,
        username: existing.rows[0].username,
      },
    });
  } catch (error) {
    console.error('خطأ في تحديث كلمة المرور:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحديث كلمة المرور' },
      { status: 500 }
    );
  }
}
