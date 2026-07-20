/**
 * تعيين أخطاء/استجابات HTTP لإعادة احتساب الرواتب 9.A.2.4.2
 * لا يعيد تنفيذ منطق النواة — ترجمة فقط.
 */
import { AccountsHttpError } from './auth';
import type { RecalculatePayrollRunResult } from './payroll-recalculate-core';
import type { serializePayrollRun } from './payroll-runs';

export type RecalcHttpErrorCode =
  | 'INVALID_REASON'
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
  | 'RECALCULATION_INTEGRITY_CONFLICT'
  | 'UNSUPPORTED_PAYROLL_CURRENCY'
  | 'EMPTY_PERSON_LIST'
  | 'PRECONDITION_FAILED'
  | 'TECHNICAL_FAILURE'
  | 'CONFLICT';

const PUBLIC_MESSAGES: Record<RecalcHttpErrorCode, string> = {
  INVALID_REASON: 'يرجى كتابة سبب واضح لإعادة الاحتساب لا يقل عن 10 أحرف.',
  INVALID_IDEMPOTENCY_KEY: 'مفتاح التكرار (idempotency_key) غير صالح.',
  INVALID_VERSION: 'رقم الإصدار (version) غير صالح.',
  INVALID_UPDATED_AT: 'تاريخ التحديث (updated_at) غير صالح.',
  MISSING_CONFIRMATION: 'يجب تأكيد طلب إعادة الاحتساب (confirmation: true).',
  INVALID_UUID: 'معرّف التشغيل غير صالح.',
  MALFORMED_JSON: 'جسم الطلب غير صالح.',
  FORBIDDEN: 'ليس لديك صلاحية إعادة احتساب الرواتب.',
  PAYROLL_RUN_NOT_FOUND: 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.',
  PAYROLL_RUN_NOT_CALCULATED: 'لا يمكن إعادة احتساب تشغيل الرواتب في حالته الحالية.',
  STALE_PAYROLL_RUN:
    'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.',
  IDEMPOTENCY_CONFLICT: 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.',
  RECALCULATION_INTEGRITY_CONFLICT:
    'تعذر التحقق من عملية إعادة احتساب سابقة. لم يتم تعديل النتائج الحالية.',
  UNSUPPORTED_PAYROLL_CURRENCY:
    'الإصدار الحالي من الرواتب يدعم الدينار العراقي IQD فقط.',
  EMPTY_PERSON_LIST:
    'لا يمكن إعادة الاحتساب لأن قائمة الأشخاص في نطاق التشغيل فارغة.',
  PRECONDITION_FAILED:
    'تعذر إعادة احتساب الرواتب بسبب إعدادات التشغيل الحالية. بقيت النتائج السابقة محفوظة.',
  TECHNICAL_FAILURE:
    'حدث خطأ تقني أثناء إعادة احتساب الرواتب. بقيت النتائج السابقة محفوظة دون تغيير.',
  CONFLICT: 'تعارض في حالة تشغيل الرواتب. يرجى تحديث الصفحة.',
};

export function publicRecalcMessage(code: RecalcHttpErrorCode, fallback?: string): string {
  return PUBLIC_MESSAGES[code] ?? fallback ?? PUBLIC_MESSAGES.TECHNICAL_FAILURE;
}

export function mapRecalcAccountsError(error: AccountsHttpError): {
  status: number;
  code: RecalcHttpErrorCode;
  message: string;
  blockedReasonCode?: string;
} {
  const msg = error.message || '';
  const status = error.status;

  if (status === 403) {
    return { status, code: 'FORBIDDEN', message: publicRecalcMessage('FORBIDDEN') };
  }
  if (status === 404) {
    return {
      status,
      code: 'PAYROLL_RUN_NOT_FOUND',
      message: publicRecalcMessage('PAYROLL_RUN_NOT_FOUND'),
    };
  }

  if (status === 422) {
    if (msg.includes('EMPTY_PERSON_LIST') || msg.includes('فارغة')) {
      return {
        status,
        code: 'EMPTY_PERSON_LIST',
        message: publicRecalcMessage('EMPTY_PERSON_LIST'),
        blockedReasonCode: 'EMPTY_PERSON_LIST',
      };
    }
    if (
      msg.includes('UNSUPPORTED_PAYROLL_CURRENCY') ||
      msg.includes('عملة') ||
      msg.includes('IQD')
    ) {
      return {
        status,
        code: 'UNSUPPORTED_PAYROLL_CURRENCY',
        message: publicRecalcMessage('UNSUPPORTED_PAYROLL_CURRENCY'),
        blockedReasonCode: 'UNSUPPORTED_PAYROLL_CURRENCY',
      };
    }
    return {
      status,
      code: 'PRECONDITION_FAILED',
      message: publicRecalcMessage('PRECONDITION_FAILED'),
      blockedReasonCode: 'PRECONDITION_FAILED',
    };
  }

  if (status === 409) {
    if (msg.includes('IDEMPOTENCY_CONFLICT') || msg.includes('حمولة مختلفة')) {
      return {
        status,
        code: 'IDEMPOTENCY_CONFLICT',
        message: publicRecalcMessage('IDEMPOTENCY_CONFLICT'),
      };
    }
    if (
      msg.includes('DUPLICATE_RECALC_AUDIT') ||
      msg.includes('تالف') ||
      msg.includes('ناقص') ||
      msg.includes('سلامة')
    ) {
      return {
        status,
        code: 'RECALCULATION_INTEGRITY_CONFLICT',
        message: publicRecalcMessage('RECALCULATION_INTEGRITY_CONFLICT'),
      };
    }
    if (
      msg.includes('مسودة') ||
      msg.includes('ملغى') ||
      msg.includes('قيد الاحتساب') ||
      msg.includes('حالته') ||
      msg.includes('استخدم احتساب')
    ) {
      return {
        status,
        code: 'PAYROLL_RUN_NOT_CALCULATED',
        message: publicRecalcMessage('PAYROLL_RUN_NOT_CALCULATED'),
      };
    }
    if (
      msg.includes('تزامن') ||
      msg.includes('تعديل') ||
      msg.includes('نسخة') ||
      msg.includes('updated_at') ||
      msg.includes('الإصدار')
    ) {
      return {
        status,
        code: 'STALE_PAYROLL_RUN',
        message: publicRecalcMessage('STALE_PAYROLL_RUN'),
      };
    }
    return { status, code: 'CONFLICT', message: publicRecalcMessage('CONFLICT') };
  }

  if (status === 400) {
    if (msg.includes('سبب')) {
      return {
        status,
        code: 'INVALID_REASON',
        message: publicRecalcMessage('INVALID_REASON'),
      };
    }
    if (msg.includes('idempotency') || msg.includes('التكرار')) {
      return {
        status,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: publicRecalcMessage('INVALID_IDEMPOTENCY_KEY'),
      };
    }
    if (msg.includes('updated_at')) {
      return {
        status,
        code: 'INVALID_UPDATED_AT',
        message: publicRecalcMessage('INVALID_UPDATED_AT'),
      };
    }
    if (msg.includes('version') || msg.includes('الإصدار')) {
      return {
        status,
        code: 'INVALID_VERSION',
        message: publicRecalcMessage('INVALID_VERSION'),
      };
    }
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: status === 400 ? 'PRECONDITION_FAILED' : 'TECHNICAL_FAILURE',
    message:
      status === 400
        ? msg.slice(0, 200) || publicRecalcMessage('PRECONDITION_FAILED')
        : publicRecalcMessage('TECHNICAL_FAILURE'),
  };
}

export function pickRecalcRunResponse(
  run: ReturnType<typeof serializePayrollRun> | RecalculatePayrollRunResult['run']
) {
  return {
    id: run.id,
    status: run.status,
    version: run.version,
    updated_at: run.updated_at,
    calculated_at: run.calculated_at,
    people_count: run.people_count,
    error_count: run.error_count,
    warning_count: run.warning_count,
    gross_total: String(run.gross_total),
    deduction_total: String(run.deduction_total),
    employer_contribution_total: String(run.employer_contribution_total),
    net_total: String(run.net_total),
    snapshot_hash: run.snapshot_hash,
  };
}

export function buildRecalculateHttpSuccess(
  result: RecalculatePayrollRunResult,
  reason: string
) {
  const prev = result.previous_summary;
  return {
    ok: true,
    success: true,
    idempotent_replay: result.idempotent_replay,
    run: pickRecalcRunResponse(result.run),
    recalculation: {
      reason,
      previous_snapshot_hash: prev.snapshot_hash,
      new_snapshot_hash: String(result.run.snapshot_hash ?? ''),
      previous_people_count: prev.people_count,
      new_people_count: Number(result.run.people_count),
      previous_error_count: prev.error_count,
      new_error_count: Number(result.run.error_count),
      previous_warning_count: prev.warning_count,
      new_warning_count: Number(result.run.warning_count),
      previous_gross_total: String(prev.gross_total),
      new_gross_total: String(result.run.gross_total),
      previous_deduction_total: String(prev.deduction_total),
      new_deduction_total: String(result.run.deduction_total),
      previous_employer_contribution_total: String(prev.employer_contribution_total),
      new_employer_contribution_total: String(result.run.employer_contribution_total),
      previous_net_total: String(prev.net_total),
      new_net_total: String(result.run.net_total),
      previous_calculated_at: prev.calculated_at,
      new_calculated_at: result.run.calculated_at,
      no_change: String(prev.snapshot_hash) === String(result.run.snapshot_hash ?? ''),
    },
    summary: {
      calculated_people: result.summary.calculated_people,
      error_people: result.summary.error_people,
      excluded_people: result.summary.excluded_people,
      blocking_issues: result.issues.blocking,
      warnings: result.issues.warnings,
    },
  };
}
