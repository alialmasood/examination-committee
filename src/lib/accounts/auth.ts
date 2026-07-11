import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { query } from '@/src/lib/db';
import type { AuthUser } from '@/src/lib/types';

export type AccountsAuthSuccess = {
  user: AuthUser;
  ipAddress: string;
  userAgent: string;
};

export type AccountsAuthFailure = {
  response: NextResponse;
};

export async function requireAccountsAccess(
  request: NextRequest
): Promise<AccountsAuthSuccess | AccountsAuthFailure> {
  const accessToken = request.cookies.get('access_token')?.value;

  if (!accessToken) {
    return {
      response: NextResponse.json(
        { success: false, message: 'يجب تسجيل الدخول للوصول إلى نظام الحسابات' },
        { status: 401 }
      ),
    };
  }

  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return {
      response: NextResponse.json(
        { success: false, message: 'انتهت صلاحية الجلسة أو رمز المصادقة غير صالح' },
        { status: 401 }
      ),
    };
  }

  const user = await validateUser(payload.user_id);
  if (!user) {
    return {
      response: NextResponse.json(
        { success: false, message: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      ),
    };
  }

  const accessResult = await query(
    `SELECT 1
     FROM student_affairs.user_systems us
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE us.user_id = $1
       AND s.code = 'ACCOUNTS'
       AND s.is_active = TRUE
     LIMIT 1`,
    [user.id]
  );

  if (accessResult.rows.length === 0) {
    return {
      response: NextResponse.json(
        { success: false, message: 'ليس لديك صلاحية الوصول إلى نظام الحسابات' },
        { status: 403 }
      ),
    };
  }

  // مكان مخصص لاحقاً لفحص صلاحيات تفصيلية (مثل reopen_period)
  // assertAccountsPermission(user, 'fiscal_periods.reopen')

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  return { user, ipAddress, userAgent };
}

export function isAuthFailure(
  result: AccountsAuthSuccess | AccountsAuthFailure
): result is AccountsAuthFailure {
  return 'response' in result;
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

export function jsonSuccess(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

export function mapPgError(error: unknown): NextResponse {
  const err = error as { code?: string; constraint?: string; message?: string };
  console.error('خطأ قاعدة بيانات نظام الحسابات:', err);

  if (err?.code === '23505') {
    if (err.constraint?.includes('fiscal_years_code') || err.constraint?.includes('uq_fiscal_years_code')) {
      return jsonError('يوجد عام مالي آخر يستخدم الرمز نفسه', 409);
    }
    if (err.constraint?.includes('fiscal_periods') && err.constraint?.includes('code')) {
      return jsonError('رمز الفترة مستخدم مسبقاً ضمن نفس السنة المالية', 409);
    }
    if (err.constraint?.includes('fiscal_periods') && err.constraint?.includes('number')) {
      return jsonError('رقم الفترة مستخدم مسبقاً ضمن نفس السنة المالية', 409);
    }
    if (err.constraint?.includes('cost_centers_code') || err.constraint?.includes('uq_cost_centers_code')) {
      return jsonError('رمز مركز الكلفة مستخدم مسبقاً', 409);
    }
    if (err.constraint?.includes('department')) {
      return jsonError('يوجد مركز كلفة مرتبط بهذا القسم مسبقاً', 409);
    }
    if (err.constraint?.includes('document_sequences')) {
      return jsonError('تسلسل المستند موجود مسبقاً لهذه السنة', 409);
    }
    if (err.constraint?.includes('one_default')) {
      return jsonError('لا يمكن وجود أكثر من سنة مالية افتراضية واحدة', 409);
    }
    return jsonError('تعارض في البيانات: القيمة مكررة', 409);
  }

  if (err?.code === '23503') {
    return jsonError('تعذر إتمام العملية بسبب ارتباط بسجلات أخرى', 409);
  }

  if (err?.code === '23514') {
    return jsonError('البيانات لا تستوفي قواعد التحقق المعتمدة', 400);
  }

  return jsonError('حدث خطأ غير متوقع في الخادم', 500);
}

export class AccountsHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AccountsHttpError';
  }
}
