/**
 * حارس جاهزية التشغيل للترحيل (محدّث 9.B.1).
 *
 * الترحيل الفعلي خارج هذه المرحلة — يشترط APPROVED + تطابق بصمة الاعتماد.
 * لا endpoint ترحيل هنا.
 */
import { AccountsHttpError } from './auth';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';

export type PayrollRunPostingCheck = {
  status: string;
  error_count: number | string;
  snapshot_hash?: string | null;
  approved_snapshot_hash?: string | null;
};

export type PostingGuardOptions = {
  /** عدد Issues حاجبة (ERROR) — اختياري؛ إن > 0 يُرفض الترحيل */
  blocking_issues_count?: number;
  /** إن false صراحةً: آثار غير متماسكة مع الملخص */
  artifacts_match?: boolean;
  /** حقول الاعتماد الظاهرة ناقصة */
  approval_fields_complete?: boolean;
};

/** يتحقق أن التشغيل جاهز للترحيل — يرمي 409 عربي عند الفشل. */
export function assertPayrollRunReadyForPosting(
  run: PayrollRunPostingCheck,
  options: PostingGuardOptions = {}
): void {
  if (run.status !== 'APPROVED') {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل رواتب غير معتمد',
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
  if (!isPayrollSnapshotHash(run.approved_snapshot_hash)) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل بلا بصمة اعتماد صالحة',
      409
    );
  }
  if (String(run.approved_snapshot_hash) !== String(run.snapshot_hash)) {
    throw new AccountsHttpError(
      'بصمة الاعتماد لا تطابق لقطة التشغيل الحالية — رُفض الترحيل',
      409
    );
  }
  if (options.approval_fields_complete === false) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل بلا حقول اعتماد مكتملة',
      409
    );
  }
  if (options.artifacts_match === false) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل تشغيل بانحراف آثار الاحتساب عن الملخص',
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
