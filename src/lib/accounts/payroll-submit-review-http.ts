/**
 * تعيين أخطاء/استجابات HTTP لإرسال الرواتب للمراجعة 9.B.2
 * لا يعيد تنفيذ منطق النواة — ترجمة فقط.
 */
import { AccountsHttpError } from './auth';
import type { PayrollApprovalCoreResult } from './payroll-approval-core';
import type { serializePayrollRun } from './payroll-runs';

export type SubmitReviewHttpErrorCode =
  | 'INVALID_COMMENT'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_VERSION'
  | 'INVALID_UPDATED_AT'
  | 'MISSING_CONFIRMATION'
  | 'INVALID_UUID'
  | 'MALFORMED_JSON'
  | 'FORBIDDEN'
  | 'PAYROLL_RUN_NOT_FOUND'
  | 'PAYROLL_RUN_NOT_CALCULATED'
  | 'STALE_PAYROLL_RUN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'APPROVAL_INTEGRITY_CONFLICT'
  | 'PAYROLL_HAS_ERRORS'
  | 'PAYROLL_HAS_BLOCKING_ISSUES'
  | 'PAYROLL_SNAPSHOT_INVALID'
  | 'PAYROLL_PERIOD_NOT_OPEN'
  | 'UNSUPPORTED_PAYROLL_CURRENCY'
  | 'PRECONDITION_FAILED'
  | 'TECHNICAL_FAILURE'
  | 'CONFLICT';

const PUBLIC_MESSAGES: Record<SubmitReviewHttpErrorCode, string> = {
  INVALID_COMMENT: 'تعذر قبول التعليق. يجب ألا يتجاوز 500 حرف.',
  INVALID_IDEMPOTENCY_KEY: 'مفتاح التكرار (idempotency_key) غير صالح.',
  INVALID_VERSION: 'رقم الإصدار (version) غير صالح.',
  INVALID_UPDATED_AT: 'تاريخ التحديث (updated_at) غير صالح.',
  MISSING_CONFIRMATION: 'يجب تأكيد طلب الإرسال للمراجعة (confirmation: true).',
  INVALID_UUID: 'معرّف التشغيل غير صالح.',
  MALFORMED_JSON: 'جسم الطلب غير صالح.',
  FORBIDDEN: 'ليس لديك صلاحية إرسال تشغيل الرواتب للمراجعة.',
  PAYROLL_RUN_NOT_FOUND:
    'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.',
  PAYROLL_RUN_NOT_CALCULATED:
    'لا يمكن إرسال تشغيل الرواتب للمراجعة في حالته الحالية.',
  STALE_PAYROLL_RUN:
    'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.',
  IDEMPOTENCY_CONFLICT: 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.',
  APPROVAL_INTEGRITY_CONFLICT:
    'تعذر التحقق من عملية إرسال سابقة. لم يتم تعديل تشغيل الرواتب.',
  PAYROLL_HAS_ERRORS:
    'لا يمكن إرسال تشغيل الرواتب للمراجعة لوجود أخطاء يجب معالجتها أولًا.',
  PAYROLL_HAS_BLOCKING_ISSUES:
    'لا يمكن إرسال تشغيل الرواتب للمراجعة لوجود مشكلات حاجبة.',
  PAYROLL_SNAPSHOT_INVALID: 'تعذر التحقق من سلامة نتائج الرواتب الحالية.',
  PAYROLL_PERIOD_NOT_OPEN:
    'لا يمكن إرسال تشغيل الرواتب للمراجعة لأن الفترة غير متاحة لهذه العملية.',
  UNSUPPORTED_PAYROLL_CURRENCY:
    'الإصدار الحالي من الرواتب يدعم الدينار العراقي IQD فقط.',
  PRECONDITION_FAILED:
    'تعذر إرسال تشغيل الرواتب للمراجعة بسبب إعدادات التشغيل الحالية.',
  TECHNICAL_FAILURE:
    'حدث خطأ تقني أثناء إرسال الرواتب للمراجعة. بقيت حالة التشغيل دون تغيير.',
  CONFLICT: 'تعارض في حالة تشغيل الرواتب. يرجى تحديث الصفحة.',
};

export function publicSubmitReviewMessage(
  code: SubmitReviewHttpErrorCode,
  fallback?: string
): string {
  return PUBLIC_MESSAGES[code] ?? fallback ?? PUBLIC_MESSAGES.TECHNICAL_FAILURE;
}

export function mapSubmitReviewAccountsError(error: AccountsHttpError): {
  status: number;
  code: SubmitReviewHttpErrorCode;
  message: string;
  blockedReasonCode?: string;
} {
  const msg = error.message || '';
  const status = error.status;

  if (status === 403) {
    return { status, code: 'FORBIDDEN', message: publicSubmitReviewMessage('FORBIDDEN') };
  }
  if (status === 404) {
    return {
      status,
      code: 'PAYROLL_RUN_NOT_FOUND',
      message: publicSubmitReviewMessage('PAYROLL_RUN_NOT_FOUND'),
    };
  }

  if (status === 422) {
    if (msg.includes('أخطاء') || msg.includes('error_count')) {
      return {
        status,
        code: 'PAYROLL_HAS_ERRORS',
        message: publicSubmitReviewMessage('PAYROLL_HAS_ERRORS'),
        blockedReasonCode: 'PAYROLL_HAS_ERRORS',
      };
    }
    if (msg.includes('حاجبة') || msg.includes('مشكلات')) {
      return {
        status,
        code: 'PAYROLL_HAS_BLOCKING_ISSUES',
        message: publicSubmitReviewMessage('PAYROLL_HAS_BLOCKING_ISSUES'),
        blockedReasonCode: 'PAYROLL_HAS_BLOCKING_ISSUES',
      };
    }
    if (
      msg.includes('بصمة') ||
      msg.includes('لقطة') ||
      msg.includes('إجماليات') ||
      msg.includes('آثار')
    ) {
      return {
        status,
        code: 'PAYROLL_SNAPSHOT_INVALID',
        message: publicSubmitReviewMessage('PAYROLL_SNAPSHOT_INVALID'),
        blockedReasonCode: 'PAYROLL_SNAPSHOT_INVALID',
      };
    }
    if (msg.includes('فترة') || msg.includes('period')) {
      return {
        status,
        code: 'PAYROLL_PERIOD_NOT_OPEN',
        message: publicSubmitReviewMessage('PAYROLL_PERIOD_NOT_OPEN'),
        blockedReasonCode: 'PAYROLL_PERIOD_NOT_OPEN',
      };
    }
    if (msg.includes('عملة') || msg.includes('IQD')) {
      return {
        status,
        code: 'UNSUPPORTED_PAYROLL_CURRENCY',
        message: publicSubmitReviewMessage('UNSUPPORTED_PAYROLL_CURRENCY'),
        blockedReasonCode: 'UNSUPPORTED_PAYROLL_CURRENCY',
      };
    }
    return {
      status,
      code: 'PRECONDITION_FAILED',
      message: publicSubmitReviewMessage('PRECONDITION_FAILED'),
      blockedReasonCode: 'PRECONDITION_FAILED',
    };
  }

  if (status === 409) {
    if (msg.includes('فترة') || msg.includes('period')) {
      return {
        status: 422,
        code: 'PAYROLL_PERIOD_NOT_OPEN',
        message: publicSubmitReviewMessage('PAYROLL_PERIOD_NOT_OPEN'),
        blockedReasonCode: 'PAYROLL_PERIOD_NOT_OPEN',
      };
    }
    if (msg.includes('IDEMPOTENCY_CONFLICT') || msg.includes('حمولة مختلفة')) {
      return {
        status,
        code: 'IDEMPOTENCY_CONFLICT',
        message: publicSubmitReviewMessage('IDEMPOTENCY_CONFLICT'),
      };
    }
    if (
      msg.includes('APPROVAL_INTEGRITY') ||
      msg.includes('سلامة') ||
      msg.includes('تالف')
    ) {
      return {
        status,
        code: 'APPROVAL_INTEGRITY_CONFLICT',
        message: publicSubmitReviewMessage('APPROVAL_INTEGRITY_CONFLICT'),
      };
    }
    if (
      msg.includes('تزامن') ||
      msg.includes('نسخة') ||
      msg.includes('updated_at') ||
      msg.includes('الإصدار') ||
      (msg.includes('تعديل') && msg.includes('مستخدم'))
    ) {
      return {
        status,
        code: 'STALE_PAYROLL_RUN',
        message: publicSubmitReviewMessage('STALE_PAYROLL_RUN'),
      };
    }
    if (
      msg.includes('CALCULATED') ||
      msg.includes('محتسب') ||
      msg.includes('حالته') ||
      msg.includes('UNDER_REVIEW') ||
      msg.includes('مراجعة') ||
      msg.includes('معتمد') ||
      msg.includes('ملغى') ||
      msg.includes('مسودة')
    ) {
      return {
        status,
        code: 'PAYROLL_RUN_NOT_CALCULATED',
        message: publicSubmitReviewMessage('PAYROLL_RUN_NOT_CALCULATED'),
      };
    }
    return { status, code: 'CONFLICT', message: publicSubmitReviewMessage('CONFLICT') };
  }

  if (status === 400) {
    if (msg.includes('تعليق') || msg.includes('comment')) {
      return {
        status,
        code: 'INVALID_COMMENT',
        message: publicSubmitReviewMessage('INVALID_COMMENT'),
      };
    }
    if (msg.includes('idempotency') || msg.includes('التكرار')) {
      return {
        status,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: publicSubmitReviewMessage('INVALID_IDEMPOTENCY_KEY'),
      };
    }
    if (msg.includes('updated_at')) {
      return {
        status,
        code: 'INVALID_UPDATED_AT',
        message: publicSubmitReviewMessage('INVALID_UPDATED_AT'),
      };
    }
    if (msg.includes('version') || msg.includes('الإصدار')) {
      return {
        status,
        code: 'INVALID_VERSION',
        message: publicSubmitReviewMessage('INVALID_VERSION'),
      };
    }
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: status === 400 ? 'PRECONDITION_FAILED' : 'TECHNICAL_FAILURE',
    message:
      status === 400
        ? msg.slice(0, 200) || publicSubmitReviewMessage('PRECONDITION_FAILED')
        : publicSubmitReviewMessage('TECHNICAL_FAILURE'),
  };
}

export function pickSubmitReviewRunResponse(
  run: ReturnType<typeof serializePayrollRun> | PayrollApprovalCoreResult['run'],
  submitter?: { id: string; display_name: string } | null
) {
  return {
    id: run.id,
    status: run.status,
    version: run.version,
    updated_at: run.updated_at,
    approval_cycle: Number(run.approval_cycle ?? 0),
    review_snapshot_hash: run.review_snapshot_hash,
    submitted_for_review_at: run.submitted_for_review_at,
    submitted_for_review_by: submitter
      ? submitter
      : run.submitted_for_review_by
        ? { id: String(run.submitted_for_review_by), display_name: '' }
        : null,
    people_count: run.people_count,
    error_count: run.error_count,
    warning_count: run.warning_count,
    gross_total: String(run.gross_total),
    deduction_total: String(run.deduction_total),
    employer_contribution_total: String(run.employer_contribution_total),
    net_total: String(run.net_total),
  };
}

export function buildSubmitReviewHttpSuccess(
  result: PayrollApprovalCoreResult,
  comment: string,
  submitter: { id: string; display_name: string } | null
) {
  return {
    ok: true,
    success: true,
    idempotent_replay: result.idempotent_replay,
    run: pickSubmitReviewRunResponse(result.run, submitter),
    submission: {
      action: 'SUBMITTED_FOR_REVIEW' as const,
      comment: comment || null,
      approval_cycle: result.action.approval_cycle,
      snapshot_hash: result.action.snapshot_hash,
      submitted_at: result.action.created_at,
    },
  };
}
