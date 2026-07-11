import { AccountsHttpError } from './auth';
import { getActivePrimaryCustodian } from './cash-box-custodians';

/**
 * صلاحية فتح/تشغيل جلسة الصندوق.
 * حالياً: الأمين الأساسي الساري فقط.
 * قابل للتوسع لاحقاً بقدرات (capabilities) دون كسر الاستدعاء.
 */
export async function assertCanOperateCashSession(
  client: Parameters<typeof getActivePrimaryCustodian>[0],
  params: {
    cashBoxId: string;
    userId: string;
    actionLabel?: string;
  }
): Promise<{ primaryUserId: string }> {
  const primary = await getActivePrimaryCustodian(client, params.cashBoxId);
  if (!primary) {
    throw new AccountsHttpError('يلزم تعيين أمين أساسي ساري للصندوق', 409);
  }

  // Guard قابل للتوسع: لاحقاً OR hasCapability(user, 'cashbox.session.operate')
  if (primary.user_id !== params.userId) {
    throw new AccountsHttpError(
      params.actionLabel
        ? `غير مخوّل: ${params.actionLabel} — يجب أن تكون الأمين الأساسي للصندوق`
        : 'غير مخوّل بتشغيل جلسة هذا الصندوق — يجب أن تكون الأمين الأساسي',
      403
    );
  }

  return { primaryUserId: primary.user_id };
}
