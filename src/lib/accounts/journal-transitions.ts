import { AccountsHttpError } from './auth';

export const JOURNAL_ENTRY_TYPES = [
  'MANUAL',
  'OPENING',
  'RECEIPT',
  'PAYMENT',
  'TRANSFER',
  'STUDENT_FEE',
  'SALARY',
  'ADJUSTMENT',
  'CLOSING',
  'REVERSAL',
] as const;

export type JournalEntryType = (typeof JOURNAL_ENTRY_TYPES)[number];

/** الأنواع المتاحة من الواجهة في الخطوة 2 */
export const UI_JOURNAL_ENTRY_TYPES = ['MANUAL', 'ADJUSTMENT'] as const;

export const JOURNAL_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'REVIEWED',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'REVERSED',
  'CANCELLED',
] as const;

export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export type JournalCapability = 'CREATE' | 'REVIEW' | 'APPROVE' | 'POST' | 'REVERSE' | 'CANCEL';

export type JournalTransitionAction =
  | 'submit'
  | 'review'
  | 'approve'
  | 'post'
  | 'reject'
  | 'return_to_draft'
  | 'cancel'
  | 'reverse';

type TransitionRule = {
  from: JournalStatus[];
  to: JournalStatus;
  capability: JournalCapability;
  requireReason?: boolean;
};

const TRANSITIONS: Record<JournalTransitionAction, TransitionRule> = {
  submit: {
    from: ['DRAFT'],
    to: 'PENDING_REVIEW',
    capability: 'CREATE',
  },
  review: {
    from: ['PENDING_REVIEW'],
    to: 'REVIEWED',
    capability: 'REVIEW',
  },
  approve: {
    from: ['REVIEWED'],
    to: 'APPROVED',
    capability: 'APPROVE',
  },
  post: {
    from: ['APPROVED'],
    to: 'POSTED',
    capability: 'POST',
  },
  reject: {
    from: ['PENDING_REVIEW', 'REVIEWED', 'APPROVED'],
    to: 'REJECTED',
    capability: 'REVIEW',
    requireReason: true,
  },
  return_to_draft: {
    from: ['REJECTED', 'PENDING_REVIEW', 'REVIEWED', 'APPROVED'],
    to: 'DRAFT',
    capability: 'CREATE',
    requireReason: true,
  },
  cancel: {
    from: ['DRAFT', 'REJECTED'],
    to: 'CANCELLED',
    capability: 'CANCEL',
    requireReason: true,
  },
  reverse: {
    from: ['POSTED'],
    to: 'REVERSED',
    capability: 'REVERSE',
    requireReason: true,
  },
};

/**
 * حارس صلاحيات مستقبلية — حالياً أي مستخدم ACCOUNTS يمرّ.
 * لاحقًا: ربط بجداول صلاحيات تفصيلية.
 */
export function assertJournalCapability(
  capability: JournalCapability,
  _ctx?: { userId: string }
): void {
  void capability;
  void _ctx;
  // placeholder for future fine-grained permissions
}

export function assertJournalTransition(
  action: JournalTransitionAction,
  currentStatus: JournalStatus,
  reason?: string | null
): { to: JournalStatus; capability: JournalCapability } {
  const rule = TRANSITIONS[action];
  if (!rule) {
    throw new AccountsHttpError('إجراء غير معروف على القيد', 400);
  }
  if (!rule.from.includes(currentStatus)) {
    throw new AccountsHttpError(
      `لا يمكن تنفيذ «${action}» من الحالة الحالية (${currentStatus})`,
      409
    );
  }
  if (rule.requireReason && (!reason || !String(reason).trim())) {
    throw new AccountsHttpError('سبب العملية مطلوب', 400);
  }
  assertJournalCapability(rule.capability);
  return { to: rule.to, capability: rule.capability };
}

export function canEditJournalHeader(status: JournalStatus): boolean {
  return status === 'DRAFT';
}

export function canDeleteJournal(status: JournalStatus, sourceId: string | null): boolean {
  return status === 'DRAFT' && !sourceId;
}

export const STATUS_LABEL_AR: Record<JournalStatus, string> = {
  DRAFT: 'مسودة',
  PENDING_REVIEW: 'بانتظار المراجعة',
  REVIEWED: 'تمت المراجعة',
  APPROVED: 'معتمد',
  POSTED: 'مرحّل',
  REJECTED: 'مرفوض',
  REVERSED: 'معكوس',
  CANCELLED: 'ملغى',
};

export const TYPE_LABEL_AR: Record<JournalEntryType, string> = {
  MANUAL: 'يدوي',
  OPENING: 'افتتاحي',
  RECEIPT: 'قبض',
  PAYMENT: 'صرف',
  TRANSFER: 'تحويل',
  STUDENT_FEE: 'أقساط طلبة',
  SALARY: 'رواتب',
  ADJUSTMENT: 'تسوية',
  CLOSING: 'إقفال',
  REVERSAL: 'عكسي',
};
