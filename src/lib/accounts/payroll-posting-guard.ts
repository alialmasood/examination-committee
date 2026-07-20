/**
 * حارس جاهزية التشغيل للترحيل/الاعتماد/الدفع (9.A.2.3.2).
 *
 * Posting / Approval / Payment يجب أن يستدعوا assertPayrollRunReadyForPosting لاحقاً.
 * لا endpoint ترحيل في هذه المرحلة — هذا الملف للتحقق المسبق فقط.
 */
import { AccountsHttpError } from './auth';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';

export type PayrollRunPostingCheck = {
  status: string;
  error_count: number | string;
  snapshot_hash?: string | null;
};

export type PostingGuardOptions = {
  /** عدد Issues حاجبة (ERROR) — اختياري؛ إن > 0 يُرفض الترحيل */
  blocking_issues_count?: number;
};

/** يتحقق أن التشغيل جاهز للترحيل/الاعتماد/الدفع — يرمي 409 عربي عند الفشل. */
export function assertPayrollRunReadyForPosting(
  run: PayrollRunPostingCheck,
  options: PostingGuardOptions = {}
): void {
  if (run.status !== 'CALCULATED') {
    throw new AccountsHttpError(
      'لا يمكن ترحيل أو اعتماد تشغيل رواتب غير محتسب',
      409
    );
  }
  if (Number(run.error_count) > 0) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل يحتوي على أخطاء احتساب — راجع المشكلات أولاً',
      409
    );
  }
  if (!isPayrollSnapshotHash(run.snapshot_hash)) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل بلا بصمة لقطة صالحة',
      409
    );
  }
  const blocking = options.blocking_issues_count;
  if (blocking != null && blocking > 0) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل يحتوي على مشكلات حاجبة',
      409
    );
  }
}

/** نسخة منطقية — true إذا كان التشغيل جاهزاً للترحيل. */
export function isPayrollRunReadyForPosting(
  run: PayrollRunPostingCheck,
  options: PostingGuardOptions = {}
): boolean {
  try {
    assertPayrollRunReadyForPosting(run, options);
    return true;
  } catch {
    return false;
  }
}
