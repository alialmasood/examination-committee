// خريطة ربط الأقسام بالأنظمة
// هذا الملف يربط بين أسماء الأقسام في قاعدة البيانات (major) والأنظمة (paths)

export const DEPARTMENT_SYSTEM_MAP: Record<string, string> = {
  // قسم تقنيات صناعة الأسنان
  'تقنيات صناعة الأسنان': 'dentalindustry',
  'صناعة الأسنان': 'dentalindustry',
  'Dental Industry': 'dentalindustry',
  
  // قسم تقنيات التخدير
  'تقنيات التخدير': 'anesthesia',
  'التخدير': 'anesthesia',
  'Anesthesia': 'anesthesia',
  
  // قسم تقنيات الأشعة
  'تقنيات الأشعة': 'xrays',
  'الأشعة': 'xrays',
  'X-Rays': 'xrays',
  'Xrays': 'xrays',
  
  // قسم هندسة تقنيات البناء والانشاءات
  'هندسة تقنيات البناء والانشاءات': 'construction',
  'تقنيات البناء والاستشارات': 'construction', // للتوافق مع البيانات القديمة
  'البناء والاستشارات': 'construction',
  'Construction': 'construction',
  
  // قسم تقنيات هندسة النفط والغاز
  'تقنيات هندسة النفط والغاز': 'oil',
  'هندسة النفط والغاز': 'oil',
  'Oil & Gas': 'oil',
  
  // قسم تقنيات الفيزياء الصحية
  'تقنيات الفيزياء الصحية': 'physics',
  'الفيزياء الصحية': 'physics',
  'Physics': 'physics',
  
  // قسم تقنيات البصريات
  'تقنيات البصريات': 'optics',
  'البصريات': 'optics',
  'Optics': 'optics',
  
  // قسم تقنيات صحة المجتمع
  'تقنيات صحة المجتمع': 'health',
  'صحة المجتمع': 'health',
  'Health': 'health',
  
  // قسم تقنيات طب الطوارئ
  'تقنيات طب الطوارئ': 'emergency',
  'طب الطوارئ': 'emergency',
  'Emergency': 'emergency',
  
  // قسم تقنيات العلاج الطبيعي
  'تقنيات العلاج الطبيعي': 'therapy',
  'العلاج الطبيعي': 'therapy',
  'Therapy': 'therapy',
  'Physical Therapy': 'therapy',
  
  // قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية
  'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 'cyber',
  'تقنيات الأمن السيبراني': 'cyber', // للتوافق مع البيانات القديمة
  'تقنيات الامن السيبراني': 'cyber', // للتوافق مع البيانات القديمة
  'الأمن السيبراني': 'cyber',
  'Cyber Security': 'cyber',
  'Cyber': 'cyber',
};

/**
 * الحصول على مسار النظام بناءً على اسم القسم
 */
export function getSystemPathByDepartment(department: string | null | undefined): string | null {
  if (!department) return null;
  
  // البحث المباشر
  if (DEPARTMENT_SYSTEM_MAP[department]) {
    return DEPARTMENT_SYSTEM_MAP[department];
  }
  
  // البحث غير الحساس لحالة الأحرف
  const lowerDepartment = department.toLowerCase().trim();
  for (const [key, path] of Object.entries(DEPARTMENT_SYSTEM_MAP)) {
    if (key.toLowerCase() === lowerDepartment) {
      return path;
    }
  }
  
  // البحث الجزئي
  for (const [key, path] of Object.entries(DEPARTMENT_SYSTEM_MAP)) {
    if (lowerDepartment.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerDepartment)) {
      return path;
    }
  }
  
  return null;
}

