import { AccountsHttpError } from './auth';

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return new Date(String(value)).getTime();
}

/** تزامن متفائل لجلسات الصندوق */
export function assertCashSessionOptimisticConcurrency(params: {
  currentVersion: number;
  currentUpdatedAt: Date | string;
  expectedVersion: unknown;
  expectedUpdatedAt: unknown;
}): void {
  if (params.expectedVersion == null) {
    throw new AccountsHttpError('رقم الإصدار (version) مطلوب', 400);
  }
  const v = Number(params.expectedVersion);
  if (!Number.isInteger(v) || v < 1) {
    throw new AccountsHttpError('رقم الإصدار غير صالح', 400);
  }
  if (v !== params.currentVersion) {
    throw new AccountsHttpError(
      'تم تعديل الجلسة بواسطة مستخدم آخر، يرجى إعادة التحميل',
      409
    );
  }

  if (params.expectedUpdatedAt == null || params.expectedUpdatedAt === '') {
    throw new AccountsHttpError('حقل updated_at مطلوب للتحقق من التزامن', 400);
  }

  const currentMs = toEpochMs(params.currentUpdatedAt);
  const expectedMs = toEpochMs(params.expectedUpdatedAt);
  if (!Number.isFinite(currentMs) || !Number.isFinite(expectedMs)) {
    throw new AccountsHttpError('قيمة updated_at غير صالحة', 400);
  }
  if (currentMs !== expectedMs) {
    throw new AccountsHttpError(
      'تم تعديل الجلسة بواسطة مستخدم آخر (updated_at)، يرجى إعادة التحميل',
      409
    );
  }
}
