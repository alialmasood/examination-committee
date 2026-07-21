'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  email?: string;
  phone?: string;
  national_id?: string;
  employee_id?: string;
  department: string;
  academic_degree?: string;
  academic_title?: string;
  specialization?: string;
  status: 'active' | 'inactive' | 'on_leave' | 'retired';
  hire_date?: string;
  employment_type: 'full_time' | 'part_time' | 'contract';
  working_days?: string;
  notes?: string;
  user_id?: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  on_leave: 'إجازة',
  retired: 'متقاعد'
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
  on_leave: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-800'
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  contract: 'عقد'
};

// دالة لتنسيق التاريخ الميلادي
const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch {
    return dateString;
  }
};

export default function TeacherDetailPage() {
  const params = useParams();
  const router = useRouter();
  const teacherId = params?.id as string;

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ username: string; password: string } | null>(null);
  
  // Form data for account creation
  const [accountFormData, setAccountFormData] = useState({
    username: '',
    password: '',
    confirmPassword: ''
  });
  const [formErrors, setFormErrors] = useState<{ username?: string; password?: string; confirmPassword?: string }>({});

  useEffect(() => {
    if (teacherId) {
      fetchTeacher();
    }
  }, [teacherId]);

  const fetchTeacher = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/hr/teachers/${teacherId}`);
      const data = await res.json();
      if (data.success) {
        setTeacher(data.data);
      } else {
        setError(data.error || 'تعذر جلب بيانات التدريسي');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const errors: { username?: string; password?: string; confirmPassword?: string } = {};

    if (!accountFormData.username.trim()) {
      errors.username = 'اسم المستخدم مطلوب';
    }

    if (!accountFormData.password) {
      errors.password = 'كلمة المرور مطلوبة';
    } else if (accountFormData.password.length < 6) {
      errors.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    }

    if (!accountFormData.confirmPassword) {
      errors.confirmPassword = 'تأكيد كلمة المرور مطلوب';
    } else if (accountFormData.password !== accountFormData.confirmPassword) {
      errors.confirmPassword = 'كلمة المرور وتأكيدها غير متطابقين';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!teacher || !validateForm()) {
      return;
    }

    try {
      setIsCreatingAccount(true);
      setError(null);
      setAccountInfo(null);

      const res = await fetch(`/api/hr/teachers/${teacherId}/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: accountFormData.username.trim(),
          password: accountFormData.password
        })
      });

      const data = await res.json();

      if (data.success) {
        setAccountInfo({
          username: data.data.username,
          password: data.data.password
        });
        // تحديث بيانات التدريسي
        await fetchTeacher();
        // إغلاق النافذة بعد 5 ثوانٍ
        setTimeout(() => {
          setShowCreateAccountModal(false);
          setAccountFormData({ username: '', password: '', confirmPassword: '' });
        }, 5000);
      } else {
        setError(data.error || 'حدث خطأ في إنشاء الحساب');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleOpenCreateAccountModal = () => {
    if (!teacher) return;
    
    // ملء الحقول الافتراضية
    setAccountFormData({
      username: teacher.email || teacher.phone || '',
      password: '',
      confirmPassword: ''
    });
    setFormErrors({});
    setError(null);
    setAccountInfo(null);
    setShowCreateAccountModal(true);
  };

  if (loading) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-2">خطأ</h2>
              <p className="text-gray-600 mb-4">{error || 'التدريسي غير موجود'}</p>
              <Link
                href="/hr/teachers"
                className="inline-flex items-center gap-2 text-red-600 hover:text-red-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                العودة إلى قائمة التدريسيين
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 bg-gray-50 min-h-screen safe-area-inset">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <Link
            href="/hr/teachers"
            className="inline-flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-gray-900 active:text-gray-700 transition-colors text-sm sm:text-base touch-manipulation"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden xs:inline">العودة إلى قائمة التدريسيين</span>
            <span className="xs:hidden">رجوع</span>
          </Link>
        </div>

        {/* Teacher Profile Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-4 sm:mb-6">
          <div className="bg-gradient-to-r from-red-600 to-red-700 px-4 sm:px-6 py-4 sm:py-6 md:py-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
              <div className="flex items-center gap-3 sm:gap-4 md:gap-6 w-full sm:w-auto">
                <div className="w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 bg-white rounded-full flex items-center justify-center text-red-600 text-xl sm:text-2xl font-bold shadow-lg flex-shrink-0">
                  {teacher.full_name_ar?.charAt(0) || teacher.full_name?.charAt(0) || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white mb-0.5 sm:mb-1 truncate">
                    {teacher.full_name_ar || teacher.full_name}
                  </h1>
                  <p className="text-red-100 text-sm sm:text-base md:text-lg truncate">{teacher.full_name}</p>
                  {teacher.academic_title && (
                    <p className="text-red-100 text-xs sm:text-sm mt-0.5 sm:mt-1 truncate">{teacher.academic_title}</p>
                  )}
                </div>
              </div>
              <div className="text-left sm:text-right self-end sm:self-auto">
                <span className={`px-3 sm:px-4 py-1.5 sm:py-2 inline-flex text-xs sm:text-sm font-semibold rounded-full ${STATUS_COLORS[teacher.status] || STATUS_COLORS.inactive}`}>
                  {STATUS_LABELS[teacher.status] || teacher.status}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <div className="text-xs sm:text-sm text-gray-500 flex flex-wrap gap-x-2">
              <span>تم الإنشاء: {formatDate(teacher.created_at)}</span>
              <span className="hidden sm:inline">•</span>
              <span>آخر تحديث: {formatDate(teacher.updated_at)}</span>
            </div>
            <Link
              href={`/hr/teachers`}
              onClick={(e) => {
                e.preventDefault();
                router.push(`/hr/teachers`);
              }}
              className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 transition-colors inline-flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base touch-manipulation whitespace-nowrap"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              تعديل البيانات
            </Link>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
          {/* Left Column - Personal Information */}
          <div className="lg:col-span-2 space-y-3 sm:space-y-4 md:space-y-6">
            {/* Personal Information Card */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 md:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">المعلومات الشخصية</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">الاسم بالعربية</dt>
                  <dd className="text-sm sm:text-base text-gray-900 font-medium break-words">{teacher.full_name_ar || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">الاسم بالإنجليزية</dt>
                  <dd className="text-sm sm:text-base text-gray-900 font-medium break-words">{teacher.full_name || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">البريد الإلكتروني</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-all">
                    {teacher.email ? (
                      <a href={`mailto:${teacher.email}`} className="text-red-600 hover:text-red-700 active:text-red-800 touch-manipulation">
                        {teacher.email}
                      </a>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">رقم الهاتف</dt>
                  <dd className="text-sm sm:text-base text-gray-900">
                    {teacher.phone ? (
                      <a href={`tel:${teacher.phone}`} className="text-red-600 hover:text-red-700 active:text-red-800 touch-manipulation">
                        {teacher.phone}
                      </a>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                {teacher.national_id && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 mb-1">الرقم الوطني</dt>
                    <dd className="text-base text-gray-900">{teacher.national_id}</dd>
                  </div>
                )}
              </div>
            </div>

            {/* Professional Information Card */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 md:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">المعلومات الوظيفية</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {teacher.employee_id && (
                  <div>
                    <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">الرقم الوظيفي</dt>
                    <dd className="text-sm sm:text-base text-gray-900 font-medium break-words">{teacher.employee_id}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">القسم</dt>
                  <dd className="text-sm sm:text-base text-gray-900 font-medium break-words">{teacher.department}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">الدرجة العلمية</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{teacher.academic_degree || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">اللقب العلمي</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{teacher.academic_title || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">التخصص</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{teacher.specialization || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">نوع التوظيف</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{EMPLOYMENT_TYPE_LABELS[teacher.employment_type] || teacher.employment_type}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">عدد أيام الدوام</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{teacher.working_days || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-gray-500 mb-1">تاريخ التعيين</dt>
                  <dd className="text-sm sm:text-base text-gray-900 break-words">{formatDate(teacher.hire_date)}</dd>
                </div>
              </div>
            </div>

            {/* Notes Card */}
            {teacher.notes && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 md:p-6">
                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">ملاحظات</h2>
                </div>
                <p className="text-xs sm:text-sm text-gray-700 whitespace-pre-line leading-relaxed break-words">{teacher.notes}</p>
              </div>
            )}
          </div>

          {/* Right Column - Quick Info & Actions */}
          <div className="space-y-3 sm:space-y-4 md:space-y-6">
            {/* Status Card */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 md:p-6">
              <h3 className="text-xs sm:text-sm font-medium text-gray-500 mb-3 sm:mb-4">الحالة الوظيفية</h3>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-xs sm:text-sm text-gray-600">الحالة الحالية</span>
                    <span className={`px-2 sm:px-3 py-1 inline-flex text-xs font-semibold rounded-full flex-shrink-0 ${STATUS_COLORS[teacher.status] || STATUS_COLORS.inactive}`}>
                      {STATUS_LABELS[teacher.status] || teacher.status}
                    </span>
                  </div>
                </div>
                <div className="pt-3 sm:pt-4 border-t border-gray-200">
                  <div className="text-xs sm:text-sm text-gray-600 mb-1">نوع التوظيف</div>
                  <div className="text-sm sm:text-base font-medium text-gray-900">
                    {EMPLOYMENT_TYPE_LABELS[teacher.employment_type] || teacher.employment_type}
                  </div>
                </div>
                {teacher.working_days && (
                  <div className="pt-3 sm:pt-4 border-t border-gray-200">
                    <div className="text-xs sm:text-sm text-gray-600 mb-1">أيام الدوام</div>
                    <div className="text-sm sm:text-base font-medium text-gray-900 break-words">{teacher.working_days}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 md:p-6">
              <h3 className="text-xs sm:text-sm font-medium text-gray-500 mb-3 sm:mb-4">إجراءات سريعة</h3>
              <div className="space-y-2">
                <button
                  onClick={() => router.push(`/hr/teachers`)}
                  className="w-full px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 transition-colors text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 sm:gap-2 touch-manipulation"
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  تعديل البيانات
                </button>
                {!teacher.user_id ? (
                  <button
                    onClick={handleOpenCreateAccountModal}
                    className="w-full px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 sm:gap-2 touch-manipulation"
                  >
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    إنشاء حساب التدريسي
                  </button>
                ) : (
                  <div className="px-3 sm:px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-xs sm:text-sm text-green-700 text-center">
                    ✓ لديه حساب في النظام
                  </div>
                )}
                <Link
                  href="/hr/teachers"
                  className="block w-full px-3 sm:px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 active:bg-gray-300 transition-colors text-xs sm:text-sm font-medium text-center touch-manipulation"
                >
                  العودة للقائمة
                </Link>
              </div>
            </div>

            {/* System Information Card */}
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">معلومات النظام</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-gray-600 mb-1">تاريخ الإنشاء</div>
                  <div className="text-gray-900 font-medium">{formatDate(teacher.created_at)}</div>
                </div>
                <div>
                  <div className="text-gray-600 mb-1">آخر تحديث</div>
                  <div className="text-gray-900 font-medium">{formatDate(teacher.updated_at)}</div>
                </div>
                {teacher.user_id && (
                  <div>
                    <div className="text-gray-600 mb-1">معرف المستخدم</div>
                    <div className="text-gray-900 font-mono text-xs">{teacher.user_id}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Account Modal */}
      {showCreateAccountModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-3 sm:p-4 safe-area-inset">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-auto my-auto max-h-[95vh] overflow-y-auto">
            <div className="p-4 sm:p-5 md:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-lg sm:text-xl font-bold text-gray-900">إنشاء حساب التدريسي</h3>
                <button
                  onClick={() => {
                    setShowCreateAccountModal(false);
                    setAccountFormData({ username: '', password: '', confirmPassword: '' });
                    setFormErrors({});
                    setError(null);
                    setAccountInfo(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 active:text-gray-700 p-1 touch-manipulation"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {accountInfo ? (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <h4 className="text-base sm:text-lg font-semibold text-green-800">تم إنشاء الحساب بنجاح!</h4>
                    </div>
                    <div className="bg-white rounded-lg p-3 sm:p-4 space-y-3">
                      <div>
                        <label className="text-xs sm:text-sm font-medium text-gray-600">اسم المستخدم:</label>
                        <div className="mt-1 p-2 sm:p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs sm:text-sm break-all">
                          {accountInfo.username}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs sm:text-sm font-medium text-gray-600">كلمة المرور:</label>
                        <div className="mt-1 p-2 sm:p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs sm:text-sm break-all">
                          {accountInfo.password}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600">
                      <p className="font-medium text-yellow-800 mb-2">⚠️ مهم: احفظ هذه البيانات!</p>
                      <p className="mb-2">يمكن للتدريسي تسجيل الدخول من:</p>
                      <ul className="list-disc list-inside mt-2 space-y-1 mb-3 sm:mb-4">
                        <li>صفحة تسجيل الدخول الرئيسية</li>
                        <li>
                          <a 
                            href="/teachers-portal" 
                            target="_blank"
                            className="text-blue-600 hover:text-blue-700 active:text-blue-800 underline font-medium touch-manipulation"
                          >
                            بوابة التدريسين (رابط مباشر)
                          </a>
                        </li>
                      </ul>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 sm:p-3">
                        <p className="text-xs text-blue-800 font-medium mb-1">🔗 رابط بوابة التدريسين:</p>
                        <p className="text-xs font-mono text-blue-600 break-all">http://localhost:3000/teachers-portal</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowCreateAccountModal(false);
                      setAccountFormData({ username: '', password: '', confirmPassword: '' });
                      setAccountInfo(null);
                    }}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 transition-colors text-sm sm:text-base font-medium touch-manipulation"
                  >
                    إغلاق
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateAccount} className="space-y-3 sm:space-y-4">
                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 sm:p-3">
                      <p className="text-xs sm:text-sm text-red-800 leading-relaxed">{error}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                      اسم المستخدم <span className="text-red-500">*</span>
                      <span className="text-xs text-gray-500 block mt-1 font-normal">(البريد الإلكتروني أو رقم الهاتف أو اسم)</span>
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={accountFormData.username}
                      onChange={(e) => {
                        setAccountFormData({ ...accountFormData, username: e.target.value });
                        setFormErrors({ ...formErrors, username: undefined });
                      }}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors ${
                        formErrors.username ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="example@email.com"
                      dir="ltr"
                    />
                    {formErrors.username && (
                      <p className="mt-1 text-xs sm:text-sm text-red-600">{formErrors.username}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                      كلمة المرور <span className="text-red-500">*</span>
                      <span className="text-xs text-gray-500 block mt-1 font-normal">(أرقام، حروف، ورموز - 6 أحرف على الأقل)</span>
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={accountFormData.password}
                      onChange={(e) => {
                        setAccountFormData({ ...accountFormData, password: e.target.value });
                        setFormErrors({ ...formErrors, password: undefined });
                      }}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors ${
                        formErrors.password ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="أدخل كلمة المرور"
                      dir="ltr"
                    />
                    {formErrors.password && (
                      <p className="mt-1 text-xs sm:text-sm text-red-600">{formErrors.password}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                      تأكيد كلمة المرور <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={accountFormData.confirmPassword}
                      onChange={(e) => {
                        setAccountFormData({ ...accountFormData, confirmPassword: e.target.value });
                        setFormErrors({ ...formErrors, confirmPassword: undefined });
                      }}
                      className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors ${
                        formErrors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="أعد إدخال كلمة المرور"
                      dir="ltr"
                    />
                    {formErrors.confirmPassword && (
                      <p className="mt-1 text-xs sm:text-sm text-red-600">{formErrors.confirmPassword}</p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2 sm:pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateAccountModal(false);
                        setAccountFormData({ username: '', password: '', confirmPassword: '' });
                        setFormErrors({});
                        setError(null);
                      }}
                      className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors text-sm sm:text-base font-medium touch-manipulation"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isCreatingAccount}
                      className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base font-medium touch-manipulation"
                    >
                      {isCreatingAccount ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span className="text-xs sm:text-sm">جاري الإنشاء...</span>
                        </>
                      ) : (
                        'إنشاء الحساب'
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
