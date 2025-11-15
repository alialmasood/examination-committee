const STAGE_CODE_MAP: Record<string, string> = {
  first: 'first',
  '1': 'first',
  stage1: 'first',
  'المرحلة الأولى': 'first',
  'المرحلة الأولى': 'first',
  second: 'second',
  '2': 'second',
  stage2: 'second',
  'المرحلة الثانية': 'second',
  third: 'third',
  '3': 'third',
  stage3: 'third',
  'المرحلة الثالثة': 'third',
  fourth: 'fourth',
  '4': 'fourth',
  stage4: 'fourth',
  'المرحلة الرابعة': 'fourth',
};

export const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'مستمر',
  studying: 'مستمر بالدراسة',
  registered: 'مسجل',
  enrollment: 'مستمرة في التسجيل',
  enrollment_pending: 'بانتظار التسجيل',
  pending: 'قيد الانتظار',
  applicant: 'متقدم',
  accepted: 'مقبول',
  probation: 'إنذار أكاديمي',
  warning: 'إنذار',
  dismissed: 'مفصول',
  expelled: 'مطرود',
  graduated: 'متخرج',
  finished: 'منجز الدراسة',
  withdrawn: 'منسحب',
  deferred: 'مؤجل',
  suspended: 'موقوف',
  transferred: 'منقول',
  dropout: 'متسرب',
  alumni: 'خريج',
  inactive: 'غير نشط',
  blocked: 'محجوب',
  cancelled: 'ملغى',
  canceled: 'ملغى',
  provisional: 'قبول مشروط',
  waitlisted: 'قائمة انتظار',
  rejected: 'مرفوض',
  unknown: 'غير محدد',
  default: 'غير محدد',
};

function normalizeStageValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return (
    STAGE_CODE_MAP[trimmed] ??
    STAGE_CODE_MAP[lower] ??
    (lower && lower.startsWith('stage') && STAGE_CODE_MAP[lower.replace(/[^0-9]/g, '')] ? STAGE_CODE_MAP[lower.replace(/[^0-9]/g, '')] : lower)
  );
}

export function normalizeStageFilter(value?: string | null): string[] {
  if (!value || value === 'all') {
    return [];
  }
  const normalized = normalizeStageValue(value);
  return normalized ? [normalized] : [];
}

export function resolveStageLabel(value?: string | null): string {
  const normalized = normalizeStageValue(value);
  if (normalized && STAGE_LABELS[normalized]) {
    return STAGE_LABELS[normalized];
  }
  return value?.trim() || 'غير محدد';
}

export function normalizeStatusValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (STATUS_LABELS[lower]) {
    return lower;
  }

  const matchedCode = Object.entries(STATUS_LABELS).find(
    ([code, label]) => label.toLowerCase() === lower
  );

  if (matchedCode) {
    return matchedCode[0];
  }

  return lower;
}

export function normalizeStatusFilter(value?: string | null): string[] {
  if (!value || value === 'all') {
    return [];
  }

  const normalized = normalizeStatusValue(value);
  return normalized ? [normalized] : [];
}

export function resolveStatusLabel(value?: string | null): string {
  const normalized = normalizeStatusValue(value);
  if (normalized && STATUS_LABELS[normalized]) {
    return STATUS_LABELS[normalized];
  }
  return value?.trim() || 'غير محدد';
}

