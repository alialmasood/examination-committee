/**
 * تعيين أخطاء/استجابات HTTP لاعتماد/رفض الرواتب 9.B.3
 * لا يعيد تنفيذ منطق النواة — ترجمة فقط.
 */
import { AccountsHttpError } from './auth';
import type { PayrollApprovalCoreResult } from './payroll-approval-core';
import type { serializePayrollRun } from './payroll-runs';

export type ApprovalDecisionHttpErrorCode =
  | 'INVALID_APPROVAL_COMMENT'
  | 'INVALID_REJECTION_REASON'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_VERSION'
  | 'INVALID_UPDATED_AT'
  | 'MISSING_CONFIRMATION'
  | 'INVALID_UUID'
  | 'MALFORMED_JSON'
  | 'FORBIDDEN'
  | 'PAYROLL_SELF_APPROVAL_FORBIDDEN'
  | 'PAYROLL_SELF_REJECTION_FORBIDDEN'
  | 'PAYROLL_RUN_NOT_FOUND'
  | 'PAYROLL_RUN_NOT_UNDER_REVIEW'
  | 'STALE_PAYROLL_RUN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'APPROVAL_INTEGRITY_CONFLICT'
  | 'APPROVAL_ALREADY_DECIDED'
  | 'APPROVAL_CYCLE_CONFLICT'
  | 'PAYROLL_REVIEW_SNAPSHOT_CHANGED'
  | 'PAYROLL_HAS_ERRORS'
  | 'PAYROLL_HAS_BLOCKING_ISSUES'
  | 'PAYROLL_RESULTS_INTEGRITY_FAILED'
  | 'PAYROLL_PERIOD_NOT_OPEN'
  | 'UNSUPPORTED_PAYROLL_CURRENCY'
  | 'PRECONDITION_FAILED'
  | 'TECHNICAL_FAILURE'
  | 'CONFLICT';

const PUBLIC_MESSAGES: Record<ApprovalDecisionHttpErrorCode, string> = {
  INVALID_APPROVAL_COMMENT: 'تعذر قبول تعليق الاعتماد. يجب ألا يتجاوز 500 حرف.',
  INVALID_REJECTION_REASON:
    'يجب إدخال سبب واضح للرفض يتراوح بين 10 و500 حرف.',
  INVALID_IDEMPOTENCY_KEY: 'مفتاح التكرار (idempotency_key) غير صالح.',
  INVALID_VERSION: 'رقم الإصدار (version) غير صالح.',
  INVALID_UPDATED_AT: 'تاريخ التحديث (updated_at) غير صالح.',
  MISSING_CONFIRMATION: 'يجب تأكيد القرار (confirmation: true).',
  INVALID_UUID: 'معرّف التشغيل غير صالح.',
  MALFORMED_JSON: 'جسم الطلب غير صالح.',
  FORBIDDEN: 'ليس لديك صلاحية تنفيذ هذا القرار على تشغيل الرواتب.',
  PAYROLL_SELF_APPROVAL_FORBIDDEN:
    'لا يجوز للمستخدم الذي أرسل تشغيل الرواتب للمراجعة أن يعتمد التشغيل نفسه.',
  PAYROLL_SELF_REJECTION_FORBIDDEN:
    'لا يجوز للمستخدم الذي أرسل تشغيل الرواتب للمراجعة أن يصدر قرار الرفض لنفس التشغيل.',
  PAYROLL_RUN_NOT_FOUND:
    'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.',
  PAYROLL_RUN_NOT_UNDER_REVIEW:
    'لا يمكن اتخاذ قرار اعتماد/رفض إلا والتشغيل قيد المراجعة.',
  STALE_PAYROLL_RUN:
    'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.',
  IDEMPOTENCY_CONFLICT: 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.',
  APPROVAL_INTEGRITY_CONFLICT:
    'تعذر التحقق من عملية سابقة. لم يتم تعديل تشغيل الرواتب.',
  APPROVAL_ALREADY_DECIDED:
    'تم اتخاذ قرار سابق بشأن دورة المراجعة الحالية.',
  APPROVAL_CYCLE_CONFLICT: 'تعارض في دورة المراجعة الحالية.',
  PAYROLL_REVIEW_SNAPSHOT_CHANGED:
    'تغيرت نتائج تشغيل الرواتب بعد إرسالها للمراجعة، لذلك لم يتم اعتمادها.',
  PAYROLL_HAS_ERRORS:
    'لا يمكن اعتماد التشغيل قبل معالجة أخطاء الرواتب.',
  PAYROLL_HAS_BLOCKING_ISSUES:
    'لا يمكن اعتماد التشغيل لوجود مشكلات حاجبة.',
  PAYROLL_RESULTS_INTEGRITY_FAILED:
    'تعذر التحقق من سلامة نتائج الرواتب الحالية.',
  PAYROLL_PERIOD_NOT_OPEN:
    'الفترة الحالية لا تسمح بتنفيذ قرار الاعتماد/الرفض.',
  UNSUPPORTED_PAYROLL_CURRENCY:
    'الإصدار الحالي من الرواتب يدعم الدينار العراقي IQD فقط.',
  PRECONDITION_FAILED: 'تعذر تنفيذ القرار بسبب إعدادات التشغيل الحالية.',
  TECHNICAL_FAILURE:
    'حدث خطأ تقني أثناء تنفيذ القرار. بقيت حالة التشغيل دون تغيير.',
  CONFLICT: 'تعارض في حالة تشغيل الرواتب. يرجى تحديث الصفحة.',
};

export function publicApprovalDecisionMessage(
  code: ApprovalDecisionHttpErrorCode,
  fallback?: string
): string {
  return PUBLIC_MESSAGES[code] ?? fallback ?? PUBLIC_MESSAGES.TECHNICAL_FAILURE;
}

export function mapApprovalDecisionAccountsError(
  error: AccountsHttpError,
  op: 'APPROVE' | 'REJECT'
): {
  status: number;
  code: ApprovalDecisionHttpErrorCode;
  message: string;
  blockedReasonCode?: string;
} {
  const msg = error.message || '';
  const status = error.status;

  if (status === 403) {
    if (msg.includes('فصل الواجبات') || msg.includes('مرسل المراجعة')) {
      if (op === 'APPROVE' || msg.includes('يعتمد')) {
        return {
          status: 403,
          code: 'PAYROLL_SELF_APPROVAL_FORBIDDEN',
          message: publicApprovalDecisionMessage('PAYROLL_SELF_APPROVAL_FORBIDDEN'),
        };
      }
      return {
        status: 403,
        code: 'PAYROLL_SELF_REJECTION_FORBIDDEN',
        message: publicApprovalDecisionMessage('PAYROLL_SELF_REJECTION_FORBIDDEN'),
      };
    }
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: publicApprovalDecisionMessage('FORBIDDEN'),
    };
  }

  if (status === 404) {
    return {
      status,
      code: 'PAYROLL_RUN_NOT_FOUND',
      message: publicApprovalDecisionMessage('PAYROLL_RUN_NOT_FOUND'),
    };
  }

  if (status === 422) {
    if (msg.includes('أخطاء') || msg.includes('error_count')) {
      return {
        status,
        code: 'PAYROLL_HAS_ERRORS',
        message: publicApprovalDecisionMessage('PAYROLL_HAS_ERRORS'),
        blockedReasonCode: 'PAYROLL_HAS_ERRORS',
      };
    }
    if (msg.includes('حاجبة') || msg.includes('مشكلات')) {
      return {
        status,
        code: 'PAYROLL_HAS_BLOCKING_ISSUES',
        message: publicApprovalDecisionMessage('PAYROLL_HAS_BLOCKING_ISSUES'),
        blockedReasonCode: 'PAYROLL_HAS_BLOCKING_ISSUES',
      };
    }
    if (msg.includes('إجماليات') || msg.includes('آثار') || msg.includes('بصمة') || msg.includes('لقطة')) {
      return {
        status,
        code: 'PAYROLL_RESULTS_INTEGRITY_FAILED',
        message: publicApprovalDecisionMessage('PAYROLL_RESULTS_INTEGRITY_FAILED'),
        blockedReasonCode: 'PAYROLL_RESULTS_INTEGRITY_FAILED',
      };
    }
    if (msg.includes('فترة')) {
      return {
        status,
        code: 'PAYROLL_PERIOD_NOT_OPEN',
        message: publicApprovalDecisionMessage('PAYROLL_PERIOD_NOT_OPEN'),
        blockedReasonCode: 'PAYROLL_PERIOD_NOT_OPEN',
      };
    }
    if (msg.includes('عملة') || msg.includes('IQD')) {
      return {
        status,
        code: 'UNSUPPORTED_PAYROLL_CURRENCY',
        message: publicApprovalDecisionMessage('UNSUPPORTED_PAYROLL_CURRENCY'),
        blockedReasonCode: 'UNSUPPORTED_PAYROLL_CURRENCY',
      };
    }
    return {
      status,
      code: 'PRECONDITION_FAILED',
      message: publicApprovalDecisionMessage('PRECONDITION_FAILED'),
      blockedReasonCode: 'PRECONDITION_FAILED',
    };
  }

  if (status === 409) {
    if (msg.includes('فترة')) {
      return {
        status: 422,
        code: 'PAYROLL_PERIOD_NOT_OPEN',
        message: publicApprovalDecisionMessage('PAYROLL_PERIOD_NOT_OPEN'),
        blockedReasonCode: 'PAYROLL_PERIOD_NOT_OPEN',
      };
    }
    if (msg.includes('IDEMPOTENCY_CONFLICT') || msg.includes('حمولة مختلفة')) {
      return {
        status,
        code: 'IDEMPOTENCY_CONFLICT',
        message: publicApprovalDecisionMessage('IDEMPOTENCY_CONFLICT'),
      };
    }
    if (msg.includes('APPROVAL_INTEGRITY') || msg.includes('سلامة') || msg.includes('تالف')) {
      return {
        status,
        code: 'APPROVAL_INTEGRITY_CONFLICT',
        message: publicApprovalDecisionMessage('APPROVAL_INTEGRITY_CONFLICT'),
      };
    }
    if (
      msg.includes('انتهت مسبقاً') ||
      msg.includes('اعتماد أو رفض') ||
      msg.includes('لا يمكن الاعتماد مجدداً') ||
      msg.includes('لا يمكن الرفض مجدداً')
    ) {
      return {
        status,
        code: 'APPROVAL_ALREADY_DECIDED',
        message: publicApprovalDecisionMessage('APPROVAL_ALREADY_DECIDED'),
      };
    }
    if (msg.includes('قفل مراجعة') || msg.includes('لا تطابق قفل') || msg.includes('بصمة اللقطة الحالية')) {
      return {
        status,
        code: 'PAYROLL_REVIEW_SNAPSHOT_CHANGED',
        message: publicApprovalDecisionMessage('PAYROLL_REVIEW_SNAPSHOT_CHANGED'),
      };
    }
    if (
      msg.includes('تزامن') ||
      msg.includes('updated_at') ||
      msg.includes('الإصدار') ||
      (msg.includes('تعديل') && msg.includes('مستخدم'))
    ) {
      return {
        status,
        code: 'STALE_PAYROLL_RUN',
        message: publicApprovalDecisionMessage('STALE_PAYROLL_RUN'),
      };
    }
    if (
      msg.includes('UNDER_REVIEW') ||
      msg.includes('قيد المراجعة') ||
      msg.includes('حالته') ||
      msg.includes('محتسب') ||
      msg.includes('CALCULATED') ||
      msg.includes('معتمد') ||
      msg.includes('ملغى')
    ) {
      return {
        status,
        code: 'PAYROLL_RUN_NOT_UNDER_REVIEW',
        message: publicApprovalDecisionMessage('PAYROLL_RUN_NOT_UNDER_REVIEW'),
      };
    }
    if (msg.includes('دورة')) {
      return {
        status,
        code: 'APPROVAL_CYCLE_CONFLICT',
        message: publicApprovalDecisionMessage('APPROVAL_CYCLE_CONFLICT'),
      };
    }
    return { status, code: 'CONFLICT', message: publicApprovalDecisionMessage('CONFLICT') };
  }

  if (status === 400) {
    if (msg.includes('سبب') || msg.includes('reason')) {
      return {
        status,
        code: 'INVALID_REJECTION_REASON',
        message: publicApprovalDecisionMessage('INVALID_REJECTION_REASON'),
      };
    }
    if (msg.includes('تعليق') || msg.includes('comment')) {
      return {
        status,
        code: 'INVALID_APPROVAL_COMMENT',
        message: publicApprovalDecisionMessage('INVALID_APPROVAL_COMMENT'),
      };
    }
    if (msg.includes('idempotency') || msg.includes('التكرار')) {
      return {
        status,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: publicApprovalDecisionMessage('INVALID_IDEMPOTENCY_KEY'),
      };
    }
    if (msg.includes('updated_at')) {
      return {
        status,
        code: 'INVALID_UPDATED_AT',
        message: publicApprovalDecisionMessage('INVALID_UPDATED_AT'),
      };
    }
    if (msg.includes('version') || msg.includes('الإصدار')) {
      return {
        status,
        code: 'INVALID_VERSION',
        message: publicApprovalDecisionMessage('INVALID_VERSION'),
      };
    }
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: status === 400 ? 'PRECONDITION_FAILED' : 'TECHNICAL_FAILURE',
    message:
      status === 400
        ? msg.slice(0, 200) || publicApprovalDecisionMessage('PRECONDITION_FAILED')
        : publicApprovalDecisionMessage('TECHNICAL_FAILURE'),
  };
}

type UserRef = { id: string; display_name: string } | null;

export function pickApprovalDecisionRunResponse(
  run: ReturnType<typeof serializePayrollRun> | PayrollApprovalCoreResult['run'],
  refs: {
    submitted_by?: UserRef;
    approved_by?: UserRef;
  } = {}
) {
  return {
    id: run.id,
    status: run.status,
    version: run.version,
    updated_at: run.updated_at,
    approval_cycle: Number(run.approval_cycle ?? 0),
    review_snapshot_hash: run.review_snapshot_hash,
    approved_snapshot_hash: run.approved_snapshot_hash ?? null,
    submitted_for_review_at: run.submitted_for_review_at,
    submitted_for_review_by: refs.submitted_by ?? null,
    approved_at: run.approved_at ?? null,
    approved_by: refs.approved_by ?? null,
    people_count: run.people_count,
    error_count: run.error_count,
    warning_count: run.warning_count,
    gross_total: String(run.gross_total),
    deduction_total: String(run.deduction_total),
    employer_contribution_total: String(run.employer_contribution_total),
    net_total: String(run.net_total),
  };
}

export function buildApproveHttpSuccess(
  result: PayrollApprovalCoreResult,
  comment: string,
  refs: { submitted_by: UserRef; approved_by: UserRef }
) {
  return {
    ok: true,
    success: true,
    idempotent_replay: result.idempotent_replay,
    run: pickApprovalDecisionRunResponse(result.run, refs),
    decision: {
      action: 'APPROVED' as const,
      comment: comment || null,
      approval_cycle: result.action.approval_cycle,
      snapshot_hash: result.action.snapshot_hash,
      decided_at: result.action.created_at,
    },
  };
}

export function buildRejectHttpSuccess(
  result: PayrollApprovalCoreResult,
  reason: string
) {
  return {
    ok: true,
    success: true,
    idempotent_replay: result.idempotent_replay,
    run: pickApprovalDecisionRunResponse(result.run, {
      submitted_by: null,
      approved_by: null,
    }),
    decision: {
      action: 'REJECTED' as const,
      reason,
      approval_cycle: result.action.approval_cycle,
      snapshot_hash: result.action.snapshot_hash,
      decided_at: result.action.created_at,
    },
  };
}
