/**
 * تعيين أخطاء/استجابات HTTP لترحيل الرواتب 9.C.2
 */
import { AccountsHttpError } from './auth';
import type { PostPayrollRunCoreResult } from './payroll-posting-core';
import { serializePayrollRun } from './payroll-runs';

export type PayrollPostingHttpErrorCode =
  | 'MALFORMED_JSON'
  | 'INVALID_UUID'
  | 'INVALID_VERSION'
  | 'INVALID_UPDATED_AT'
  | 'INVALID_POSTING_DATE'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_POSTING_COMMENT'
  | 'MISSING_CONFIRMATION'
  | 'FORBIDDEN'
  | 'PAYROLL_RUN_NOT_FOUND'
  | 'PAYROLL_RUN_NOT_APPROVED'
  | 'PAYROLL_ALREADY_POSTED'
  | 'STALE_PAYROLL_RUN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYROLL_POSTING_INTEGRITY_CONFLICT'
  | 'PAYROLL_POSTING_CONFLICT'
  | 'PAYROLL_APPROVAL_INTEGRITY_FAILED'
  | 'PAYROLL_SNAPSHOT_INVALID'
  | 'PAYROLL_HAS_ERRORS'
  | 'PAYROLL_HAS_BLOCKING_ISSUES'
  | 'PAYROLL_CURRENCY_NOT_SUPPORTED'
  | 'FISCAL_PERIOD_NOT_OPEN'
  | 'GL_PERIOD_LOCKED'
  | 'PAYROLL_GL_MAPPING_MISSING'
  | 'PAYROLL_GL_ACCOUNT_INVALID'
  | 'PAYROLL_JOURNAL_UNBALANCED'
  | 'PAYROLL_ROUNDING_EXCEEDED'
  | 'PAYROLL_ROUNDING_ACCOUNT_MISSING'
  | 'PRECONDITION_FAILED'
  | 'TECHNICAL_FAILURE'
  | 'CONFLICT';

const PUBLIC_MESSAGES: Record<PayrollPostingHttpErrorCode, string> = {
  MALFORMED_JSON: 'جسم الطلب غير صالح.',
  INVALID_UUID: 'معرّف التشغيل غير صالح.',
  INVALID_VERSION: 'رقم الإصدار (version) غير صالح.',
  INVALID_UPDATED_AT: 'تاريخ التحديث (updated_at) غير صالح.',
  INVALID_POSTING_DATE:
    'تاريخ الترحيل غير صالح أو لا يقع ضمن فترة مالية متاحة.',
  INVALID_IDEMPOTENCY_KEY: 'مفتاح التكرار (idempotency_key) غير صالح.',
  INVALID_POSTING_COMMENT: 'ملاحظة الترحيل غير صالحة أو تتجاوز 500 حرف.',
  MISSING_CONFIRMATION: 'يجب تأكيد عملية الترحيل (confirmation: true).',
  FORBIDDEN: 'ليس لديك صلاحية ترحيل الرواتب محاسبيًا.',
  PAYROLL_RUN_NOT_FOUND:
    'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.',
  PAYROLL_RUN_NOT_APPROVED:
    'لا يمكن ترحيل تشغيل الرواتب قبل اعتماده رسميًا.',
  PAYROLL_ALREADY_POSTED: 'تم ترحيل تشغيل الرواتب محاسبيًا مسبقًا.',
  STALE_PAYROLL_RUN:
    'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.',
  IDEMPOTENCY_CONFLICT: 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.',
  PAYROLL_POSTING_INTEGRITY_CONFLICT:
    'تعذر التحقق من عملية ترحيل سابقة. لم يتم تعديل تشغيل الرواتب.',
  PAYROLL_POSTING_CONFLICT:
    'تعذر تنفيذ الترحيل بسبب عملية متزامنة. يرجى تحديث الصفحة.',
  PAYROLL_APPROVAL_INTEGRITY_FAILED: 'تعذر التحقق من اعتماد تشغيل الرواتب.',
  PAYROLL_SNAPSHOT_INVALID:
    'تغيرت أو تعذر التحقق من نتائج الرواتب المعتمدة.',
  PAYROLL_HAS_ERRORS: 'لا يمكن ترحيل تشغيل يحتوي على أخطاء احتساب.',
  PAYROLL_HAS_BLOCKING_ISSUES:
    'لا يمكن ترحيل تشغيل يحتوي على مشكلات حاجبة.',
  PAYROLL_CURRENCY_NOT_SUPPORTED:
    'الإصدار الحالي من ترحيل الرواتب يدعم الدينار العراقي IQD فقط.',
  FISCAL_PERIOD_NOT_OPEN:
    'لا يمكن ترحيل الرواتب لأن الفترة المالية غير مفتوحة.',
  GL_PERIOD_LOCKED: 'لا يمكن الترحيل لأن الفترة المحاسبية مقفلة.',
  PAYROLL_GL_MAPPING_MISSING:
    'تعذر ترحيل الرواتب لعدم اكتمال ربط مكونات الرواتب بالحسابات المحاسبية.',
  PAYROLL_GL_ACCOUNT_INVALID:
    'أحد الحسابات المحاسبية المطلوبة غير صالح أو غير نشط.',
  PAYROLL_JOURNAL_UNBALANCED:
    'تعذر إنشاء القيد لأن مجموع المبالغ المدينة لا يساوي مجموع المبالغ الدائنة.',
  PAYROLL_ROUNDING_EXCEEDED: 'فرق التقريب يتجاوز الحد المحاسبي المسموح.',
  PAYROLL_ROUNDING_ACCOUNT_MISSING:
    'يوجد فرق تقريب ولا يوجد حساب تقريب معرّف.',
  PRECONDITION_FAILED: 'تعذر ترحيل الرواتب بسبب إعدادات التشغيل الحالية.',
  TECHNICAL_FAILURE:
    'حدث خطأ تقني أثناء ترحيل الرواتب. لم يتم إنشاء أي قيد وبقي التشغيل معتمدًا.',
  CONFLICT: 'تعارض في حالة تشغيل الرواتب. يرجى تحديث الصفحة.',
};

export function publicPostingMessage(
  code: PayrollPostingHttpErrorCode,
  fallback?: string
): string {
  return PUBLIC_MESSAGES[code] ?? fallback ?? PUBLIC_MESSAGES.TECHNICAL_FAILURE;
}

export function mapPayrollPostingAccountsError(error: AccountsHttpError): {
  status: number;
  code: PayrollPostingHttpErrorCode;
  message: string;
  blockedReasonCode?: string;
} {
  const msg = error.message || '';
  const status = error.status;

  if (status === 403) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: publicPostingMessage('FORBIDDEN'),
      blockedReasonCode: 'FORBIDDEN',
    };
  }
  if (status === 404) {
    return {
      status: 404,
      code: 'PAYROLL_RUN_NOT_FOUND',
      message: publicPostingMessage('PAYROLL_RUN_NOT_FOUND'),
    };
  }
  if (status === 400) {
    if (msg.includes('تاريخ الترحيل') || msg.includes('posting')) {
      return {
        status: 400,
        code: 'INVALID_POSTING_DATE',
        message: publicPostingMessage('INVALID_POSTING_DATE'),
      };
    }
    if (msg.includes('تعليق') || msg.includes('ملاحظة')) {
      return {
        status: 400,
        code: 'INVALID_POSTING_COMMENT',
        message: publicPostingMessage('INVALID_POSTING_COMMENT'),
      };
    }
    if (msg.includes('مفتاح') || msg.includes('idempotency')) {
      return {
        status: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: publicPostingMessage('INVALID_IDEMPOTENCY_KEY'),
      };
    }
    if (msg.includes('تأكيد')) {
      return {
        status: 400,
        code: 'MISSING_CONFIRMATION',
        message: publicPostingMessage('MISSING_CONFIRMATION'),
      };
    }
    return {
      status: 400,
      code: 'PRECONDITION_FAILED',
      message: msg.slice(0, 200) || publicPostingMessage('PRECONDITION_FAILED'),
    };
  }

  if (status === 409) {
    if (msg.includes('مفتاح') && msg.includes('مختلفة')) {
      return {
        status: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        message: publicPostingMessage('IDEMPOTENCY_CONFLICT'),
      };
    }
    if (msg.includes('مسبق') || msg.includes('مرحّل') || msg.includes('ترحيل هذا')) {
      return {
        status: 409,
        code: 'PAYROLL_ALREADY_POSTED',
        message: publicPostingMessage('PAYROLL_ALREADY_POSTED'),
        blockedReasonCode: 'PAYROLL_ALREADY_POSTED',
      };
    }
    if (msg.includes('معتمد') || msg.includes('APPROVED')) {
      return {
        status: 409,
        code: 'PAYROLL_RUN_NOT_APPROVED',
        message: publicPostingMessage('PAYROLL_RUN_NOT_APPROVED'),
        blockedReasonCode: 'PAYROLL_RUN_NOT_APPROVED',
      };
    }
    if (msg.includes('مستخدم آخر') || msg.includes('إصدار')) {
      return {
        status: 409,
        code: 'STALE_PAYROLL_RUN',
        message: publicPostingMessage('STALE_PAYROLL_RUN'),
      };
    }
    if (msg.includes('سلامة') || msg.includes('تالف') || msg.includes('تحقق من ترحيل')) {
      return {
        status: 409,
        code: 'PAYROLL_POSTING_INTEGRITY_CONFLICT',
        message: publicPostingMessage('PAYROLL_POSTING_INTEGRITY_CONFLICT'),
      };
    }
    if (msg.includes('فترة مالية') || msg.includes('مفتوحة')) {
      return {
        status: 409,
        code: 'FISCAL_PERIOD_NOT_OPEN',
        message: publicPostingMessage('FISCAL_PERIOD_NOT_OPEN'),
        blockedReasonCode: 'FISCAL_PERIOD_NOT_OPEN',
      };
    }
    return {
      status: 409,
      code: 'PAYROLL_POSTING_CONFLICT',
      message: publicPostingMessage('PAYROLL_POSTING_CONFLICT'),
      blockedReasonCode: 'PAYROLL_POSTING_CONFLICT',
    };
  }

  if (status === 422) {
    if (msg.includes('اعتماد') || msg.includes('approval')) {
      return {
        status: 422,
        code: 'PAYROLL_APPROVAL_INTEGRITY_FAILED',
        message: publicPostingMessage('PAYROLL_APPROVAL_INTEGRITY_FAILED'),
        blockedReasonCode: 'PAYROLL_APPROVAL_INTEGRITY_FAILED',
      };
    }
    if (msg.includes('بصمة') || msg.includes('لقطة') || msg.includes('snapshot')) {
      return {
        status: 422,
        code: 'PAYROLL_SNAPSHOT_INVALID',
        message: publicPostingMessage('PAYROLL_SNAPSHOT_INVALID'),
        blockedReasonCode: 'PAYROLL_SNAPSHOT_INVALID',
      };
    }
    if (msg.includes('أخطاء')) {
      return {
        status: 422,
        code: 'PAYROLL_HAS_ERRORS',
        message: publicPostingMessage('PAYROLL_HAS_ERRORS'),
        blockedReasonCode: 'PAYROLL_HAS_ERRORS',
      };
    }
    if (msg.includes('حاجب')) {
      return {
        status: 422,
        code: 'PAYROLL_HAS_BLOCKING_ISSUES',
        message: publicPostingMessage('PAYROLL_HAS_BLOCKING_ISSUES'),
        blockedReasonCode: 'PAYROLL_HAS_BLOCKING_ISSUES',
      };
    }
    if (msg.includes('IQD') || msg.includes('عملة')) {
      return {
        status: 422,
        code: 'PAYROLL_CURRENCY_NOT_SUPPORTED',
        message: publicPostingMessage('PAYROLL_CURRENCY_NOT_SUPPORTED'),
        blockedReasonCode: 'PAYROLL_CURRENCY_NOT_SUPPORTED',
      };
    }
    if (msg.includes('ربط') || msg.includes('مصروف مفقود') || msg.includes('payable')) {
      return {
        status: 422,
        code: 'PAYROLL_GL_MAPPING_MISSING',
        message: publicPostingMessage('PAYROLL_GL_MAPPING_MISSING'),
        blockedReasonCode: 'PAYROLL_GL_MAPPING_MISSING',
      };
    }
    if (msg.includes('حساب') && (msg.includes('غير صالح') || msg.includes('نشط'))) {
      return {
        status: 422,
        code: 'PAYROLL_GL_ACCOUNT_INVALID',
        message: publicPostingMessage('PAYROLL_GL_ACCOUNT_INVALID'),
        blockedReasonCode: 'PAYROLL_GL_ACCOUNT_INVALID',
      };
    }
    if (msg.includes('متوازن') || msg.includes('توازن')) {
      if (msg.includes('تقريب') && msg.includes('يتجاوز')) {
        return {
          status: 422,
          code: 'PAYROLL_ROUNDING_EXCEEDED',
          message: publicPostingMessage('PAYROLL_ROUNDING_EXCEEDED'),
          blockedReasonCode: 'PAYROLL_ROUNDING_EXCEEDED',
        };
      }
      return {
        status: 422,
        code: 'PAYROLL_JOURNAL_UNBALANCED',
        message: publicPostingMessage('PAYROLL_JOURNAL_UNBALANCED'),
        blockedReasonCode: 'PAYROLL_JOURNAL_UNBALANCED',
      };
    }
    if (msg.includes('تقريب') && msg.includes('ROUNDING')) {
      return {
        status: 422,
        code: 'PAYROLL_ROUNDING_ACCOUNT_MISSING',
        message: publicPostingMessage('PAYROLL_ROUNDING_ACCOUNT_MISSING'),
        blockedReasonCode: 'PAYROLL_ROUNDING_ACCOUNT_MISSING',
      };
    }
    if (msg.includes('تقريب') && msg.includes('يتجاوز')) {
      return {
        status: 422,
        code: 'PAYROLL_ROUNDING_EXCEEDED',
        message: publicPostingMessage('PAYROLL_ROUNDING_EXCEEDED'),
        blockedReasonCode: 'PAYROLL_ROUNDING_EXCEEDED',
      };
    }
    return {
      status: 422,
      code: 'PRECONDITION_FAILED',
      message: msg.slice(0, 220) || publicPostingMessage('PRECONDITION_FAILED'),
      blockedReasonCode: 'PRECONDITION_FAILED',
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: 'TECHNICAL_FAILURE',
    message: publicPostingMessage('TECHNICAL_FAILURE'),
  };
}

export function journalDisplayUrl(journalEntryId: string): string {
  return `/accounts/entries?highlight=${encodeURIComponent(journalEntryId)}`;
}

export function buildPostingHttpSuccess(
  result: PostPayrollRunCoreResult,
  comment: string | null,
  postedBy: { id: string; display_name: string } | null
) {
  const run = serializePayrollRun(result.run);
  return {
    ok: true,
    success: true,
    idempotent_replay: result.replayed,
    run: {
      id: run.id,
      status: run.status,
      version: run.version,
      updated_at: run.updated_at,
      approval_cycle: run.approval_cycle,
      posted_at: run.posted_at,
      posted_by: postedBy,
      posted_snapshot_hash: run.posted_snapshot_hash,
      posting_date: result.posting.posting_date,
      gross_total: run.gross_total,
      deduction_total: run.deduction_total,
      employer_contribution_total: run.employer_contribution_total,
      net_total: run.net_total,
    },
    posting: {
      id: result.posting.id,
      posting_date: result.posting.posting_date,
      journal_entry: {
        id: result.posting.journal_entry_id,
        document_number: result.posting.entry_number,
        status: 'POSTED',
        entry_type: 'SALARY',
        debit_total: result.posting.total_debit,
        credit_total: result.posting.total_credit,
        display_url: journalDisplayUrl(result.posting.journal_entry_id),
      },
      posted_at: result.posting.posted_at,
      comment: comment || null,
    },
    data: {
      run,
      posting: {
        id: result.posting.id,
        journal_entry_id: result.posting.journal_entry_id,
        entry_number: result.posting.entry_number,
        posting_date: result.posting.posting_date,
        posted_at: result.posting.posted_at,
        total_debit: result.posting.total_debit,
        total_credit: result.posting.total_credit,
        display_url: journalDisplayUrl(result.posting.journal_entry_id),
        comment: comment || null,
        replayed: result.replayed,
      },
    },
  };
}
