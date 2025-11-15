/**
 * دوال مساعدة لتنسيق سجل العمليات (للاستخدام في Client Components)
 */

/**
 * تنسيق نوع العملية بالعربية
 */
export function formatActionType(actionType: string): string {
  const actionTypes: Record<string, string> = {
    'create': 'إضافة',
    'update': 'تعديل',
    'delete': 'حذف',
    'complete_registration': 'إتمام التسجيل',
    'mark_paid': 'تأكيد الدفع',
    'print_receipt': 'طباعة الوصل',
    'export': 'تصدير',
    'import': 'استيراد',
  };

  return actionTypes[actionType] || actionType;
}

/**
 * تنسيق نوع الكيان بالعربية
 */
export function formatEntityType(entityType: string): string {
  const entityTypes: Record<string, string> = {
    'student': 'طالب',
    'payment': 'دفعة',
    'grade': 'درجة',
    'attendance': 'حضور',
    'document': 'وثيقة',
    'request': 'طلب',
  };

  return entityTypes[entityType] || entityType;
}

/**
 * تنسيق القيم القديمة/الجديدة للعرض
 */
export function formatAuditValues(values?: Record<string, unknown>): string {
  if (!values || Object.keys(values).length === 0) {
    return '';
  }

  return Object.entries(values)
    .map(([key, value]) => {
      const formattedValue = value === null || value === undefined 
        ? 'غير محدد' 
        : String(value);
      return `${key}: ${formattedValue}`;
    })
    .join(', ');
}

