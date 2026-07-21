'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  email?: string;
  phone?: string;
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
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateString;
  }
};

export default function ProfilePage() {
  const router = useRouter();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  // إغلاق القائمة عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        isMenuOpen &&
        menuRef.current &&
        menuButtonRef.current &&
        !menuRef.current.contains(target) &&
        !menuButtonRef.current.contains(target)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/teachers-portal/profile');
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'تعذر جلب بيانات الملف الشخصي');
      }

      setTeacher(data.data);
    } catch (err) {
      console.error('خطأ في جلب الملف الشخصي:', err);
      setError(err instanceof Error ? err.message : 'خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/teachers-portal');
    } catch (error) {
      console.error('خطأ في تسجيل الخروج:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800 text-center max-w-md">
          <p className="font-medium mb-2">حدث خطأ</p>
          <p className="text-sm mb-4">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={fetchProfile}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              إعادة المحاولة
            </button>
            <Link
              href="/teachers-portal/dashboard"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              العودة للوحة التحكم
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center max-w-md">
          <p className="text-gray-600 mb-4">لا توجد بيانات متاحة</p>
          <Link
            href="/teachers-portal/dashboard"
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors inline-block"
          >
            العودة للوحة التحكم
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 safe-area-inset">
      {/* Main Content */}
      <main className="pb-20 sm:pb-8">
        {teacher ? (
          <>
            {/* Welcome Section - Merged Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 shadow-lg sticky top-0 z-40">
              <div className="w-full px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
                <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
                  {/* Left Side - Welcome */}
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                    {/* Mobile Menu Button */}
                    <button
                      ref={menuButtonRef}
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="sm:hidden p-2 text-white hover:bg-white/10 rounded transition-colors touch-manipulation"
                      aria-label="القائمة"
                      aria-expanded={isMenuOpen}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isMenuOpen ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                      </svg>
                    </button>
                    {/* Desktop Welcome */}
                    <div className="hidden sm:block">
                      <h1 className="text-base sm:text-lg md:text-xl font-bold text-white truncate">مرحباً {teacher.full_name_ar}</h1>
                      <p className="text-xs sm:text-sm text-red-100 truncate">القسم: {teacher.department}</p>
                    </div>
                    {/* Mobile Welcome */}
                    <div className="sm:hidden min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">مرحباً {teacher.full_name_ar}</div>
                      <div className="text-[10px] text-red-100 truncate">القسم: {teacher.department}</div>
                    </div>
                  </div>
                  
                  {/* Right Side - User, Logout */}
                  <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                    {/* اسم المستخدم */}
                    <span className="text-white text-xs sm:text-sm font-medium hidden xs:inline truncate max-w-[120px] sm:max-w-none">
                      {teacher.full_name_ar}
                    </span>
                    {/* زر الخروج */}
                    <button
                      onClick={handleLogout}
                      className="text-white hover:text-red-100 active:text-red-200 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium touch-manipulation whitespace-nowrap border border-white/30 hover:border-white/50 rounded transition-colors flex-shrink-0"
                    >
                      خروج
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Menu - Overlay */}
            {isMenuOpen && (
              <div ref={menuRef} className="fixed left-0 right-0 bg-white border-t border-gray-200 shadow-xl z-[50] sm:hidden overflow-y-auto" style={{ top: '73px', maxHeight: 'calc(100vh - 73px)' }}>
                  <div className="px-4 py-3 space-y-2">
                  <Link
                    href="/teachers-portal/dashboard"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الصفحة الرئيسية</h3>
                      <p className="text-xs text-gray-600">لوحة التحكم</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">ملفي الشخصي</h3>
                      <p className="text-xs text-gray-600">عرض وتعديل بياناتي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/my-students"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">طلابي</h3>
                      <p className="text-xs text-gray-600">عرض وإدارة طلابي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/grades"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-green-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الدرجات</h3>
                      <p className="text-xs text-gray-600">إدخال درجات الامتحانات</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/attendance"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-yellow-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الحضور والغياب</h3>
                      <p className="text-xs text-gray-600">تسجيل الحضور اليومي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/subjects"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-purple-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">موادي التدريسية</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والحضور</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/calendar"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">التقويم الجامعي</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والامتحانات والأحداث</p>
                    </div>
                  </Link>
                  </div>
                </div>
            )}

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
              {/* Profile Header Card */}
              <div className="bg-gradient-to-br from-red-600 via-red-700 to-red-800 rounded-none sm:rounded-xl shadow-sm sm:shadow-lg overflow-hidden mb-4 sm:mb-6 -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto">
                <div className="p-4 sm:p-6 md:p-8 text-white">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                    {/* Profile Avatar */}
                    <div className="hidden sm:flex w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 bg-white/20 backdrop-blur-sm rounded-full items-center justify-center flex-shrink-0 border-4 border-white/30 shadow-lg">
                      <svg className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    
                    {/* Profile Info */}
                    <div className="flex-1 min-w-0">
                      {/* Status - Mobile: separate line at end (right), Desktop: inline */}
                      {teacher.status === 'active' && (
                        <div className="sm:hidden mb-2 flex justify-end">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            <span className="text-xs font-semibold text-white">نشط</span>
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold truncate flex-1">
                          {teacher.full_name_ar || teacher.full_name}
                        </h1>
                        {teacher.status === 'active' ? (
                          <span className="hidden sm:inline-flex items-center gap-1.5 sm:gap-2 flex-shrink-0 sm:ml-auto">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[teacher.status]}`}>
                              <span className="w-1.5 h-1.5 bg-green-600 rounded-full"></span>
                              {STATUS_LABELS[teacher.status]}
                            </span>
                          </span>
                        ) : (
                          <span className={`px-2.5 sm:px-3 py-1 inline-flex text-xs font-semibold rounded-full flex-shrink-0 sm:ml-auto ${STATUS_COLORS[teacher.status] || STATUS_COLORS.inactive}`}>
                            {STATUS_LABELS[teacher.status] || teacher.status}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                        <p className="text-sm sm:text-base text-red-100 truncate">
                          {teacher.department}
                        </p>
                        {teacher.academic_title && (
                          <>
                            <span className="hidden sm:inline text-red-100">•</span>
                            <span className="sm:hidden text-red-100 text-sm">||</span>
                            <span className="text-sm sm:text-base text-red-100 sm:inline-flex sm:items-center sm:px-2.5 sm:py-1 sm:rounded-full sm:font-medium sm:bg-white/20 sm:backdrop-blur-sm sm:text-white sm:border sm:border-white/30">
                              {teacher.academic_title}
                            </span>
                          </>
                        )}
                      </div>
                      
                      {/* Contact Info */}
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        {teacher.email && (
                          <a 
                            href={`mailto:${teacher.email}`} 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg transition-all touch-manipulation border border-white/20 hover:border-white/40"
                          >
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <span className="text-xs sm:text-sm truncate max-w-[200px] sm:max-w-none">{teacher.email}</span>
                          </a>
                        )}
                        {teacher.phone && (
                          <a 
                            href={`tel:${teacher.phone}`} 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg transition-all touch-manipulation border border-white/20 hover:border-white/40"
                          >
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            <span className="text-xs sm:text-sm">{teacher.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                {/* Left Column - Personal & Professional Information */}
                <div className="lg:col-span-2 space-y-3 sm:space-y-4 md:space-y-6">
                  {/* Personal Information Card */}
                  <div className="hidden sm:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                        <h2 className="text-base sm:text-lg font-bold text-gray-900">المعلومات الشخصية</h2>
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 md:p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                        <div className="space-y-1">
                          <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            الاسم بالعربية
                          </dt>
                          <dd className="text-sm sm:text-base text-gray-900 font-semibold break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            {teacher.full_name_ar || '-'}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            الاسم بالإنجليزية
                          </dt>
                          <dd className="text-sm sm:text-base text-gray-900 font-semibold break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            {teacher.full_name || '-'}
                          </dd>
                        </div>
                        {teacher.email && (
                          <div className="space-y-1 sm:col-span-2">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              البريد الإلكتروني
                            </dt>
                            <dd className="text-sm sm:text-base break-all">
                              <a 
                                href={`mailto:${teacher.email}`} 
                                className="inline-flex items-center gap-2 text-red-600 hover:text-red-700 active:text-red-800 font-medium bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg border border-red-200 hover:border-red-300 transition-all touch-manipulation w-full sm:w-auto"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                <span className="truncate">{teacher.email}</span>
                              </a>
                            </dd>
                          </div>
                        )}
                        {teacher.phone && (
                          <div className="space-y-1 sm:col-span-2">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              رقم الهاتف
                            </dt>
                            <dd className="text-sm sm:text-base">
                              <a 
                                href={`tel:${teacher.phone}`} 
                                className="inline-flex items-center gap-2 text-red-600 hover:text-red-700 active:text-red-800 font-medium bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg border border-red-200 hover:border-red-300 transition-all touch-manipulation w-full sm:w-auto"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                <span>{teacher.phone}</span>
                              </a>
                            </dd>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Professional Information Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <h2 className="text-base sm:text-lg font-bold text-gray-900">المعلومات الوظيفية</h2>
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 md:p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                        <div className="space-y-1">
                          <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            القسم
                          </dt>
                          <dd className="text-sm sm:text-base text-gray-900 font-semibold break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            {teacher.department}
                          </dd>
                        </div>
                        {teacher.academic_degree && (
                          <div className="space-y-1">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14v9" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v5" />
                              </svg>
                              الدرجة العلمية
                            </dt>
                            <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                              {teacher.academic_degree}
                            </dd>
                          </div>
                        )}
                        {teacher.academic_title && (
                          <div className="space-y-1">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                              </svg>
                              اللقب العلمي
                            </dt>
                            <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                              {teacher.academic_title}
                            </dd>
                          </div>
                        )}
                        {teacher.specialization && (
                          <div className="space-y-1">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                              التخصص
                            </dt>
                            <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                              {teacher.specialization}
                            </dd>
                          </div>
                        )}
                        <div className="space-y-1">
                          <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            نوع التوظيف
                          </dt>
                          <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            {EMPLOYMENT_TYPE_LABELS[teacher.employment_type] || teacher.employment_type}
                          </dd>
                        </div>
                        {teacher.working_days && (
                          <div className="space-y-1">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              عدد أيام الدوام
                            </dt>
                            <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                              {teacher.working_days}
                            </dd>
                          </div>
                        )}
                        {teacher.hire_date && (
                          <div className="space-y-1">
                            <dt className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              تاريخ التعيين
                            </dt>
                            <dd className="text-sm sm:text-base text-gray-900 break-words bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                              {formatDate(teacher.hire_date)}
                            </dd>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Notes Card */}
                  {teacher.notes && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                      <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </div>
                          <h2 className="text-base sm:text-lg font-bold text-gray-900">ملاحظات</h2>
                        </div>
                      </div>
                      <div className="p-4 sm:p-5 md:p-6">
                        <p className="text-xs sm:text-sm text-gray-700 whitespace-pre-line leading-relaxed break-words bg-gray-50 px-3 py-3 rounded-lg border border-gray-200">
                          {teacher.notes}
                        </p>
                      </div>
                    </div>
                  )}
          </div>

                {/* Right Column - Status & Actions */}
                <div className="space-y-3 sm:space-y-4 md:space-y-6">
                  {/* Status Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <h3 className="text-base sm:text-lg font-bold text-gray-900">الحالة الوظيفية</h3>
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 md:p-6">
                      <div className="space-y-4 sm:space-y-5">
                        <div className="bg-gray-50 rounded-lg p-3 sm:p-4 border border-gray-200">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <span className="text-xs sm:text-sm font-medium text-gray-600 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              الحالة الحالية
                            </span>
                            {teacher.status === 'active' ? (
                              <span className="inline-flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                <span className="text-xs sm:text-sm font-semibold text-green-600 sm:hidden">نشط</span>
                                <span className={`hidden sm:inline-flex px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-full ${STATUS_COLORS[teacher.status]}`}>
                                  {STATUS_LABELS[teacher.status]}
                                </span>
                              </span>
                            ) : (
                              <span className={`px-2.5 sm:px-3 py-1.5 inline-flex text-xs font-semibold rounded-full flex-shrink-0 ${STATUS_COLORS[teacher.status] || STATUS_COLORS.inactive}`}>
                                {STATUS_LABELS[teacher.status] || teacher.status}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="pt-3 sm:pt-4 border-t border-gray-200 space-y-1">
                          <div className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5 mb-2">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            نوع التوظيف
                          </div>
                          <div className="text-sm sm:text-base font-semibold text-gray-900 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            {EMPLOYMENT_TYPE_LABELS[teacher.employment_type] || teacher.employment_type}
                          </div>
                        </div>
                        {teacher.working_days && (
                          <div className="pt-3 sm:pt-4 border-t border-gray-200 space-y-1">
                            <div className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5 mb-2">
                              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              أيام الدوام
                            </div>
                            <div className="text-sm sm:text-base font-semibold text-gray-900 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 break-words">
                              {teacher.working_days}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

            {/* Account Info Card */}
            {teacher.user_id && (
              <div className="bg-green-50 rounded-lg border border-green-200 p-4 sm:p-5 md:p-6">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xs sm:text-sm font-medium text-green-800">حساب النظام</h3>
                </div>
                <p className="text-xs sm:text-sm text-green-700">
                  لديك حساب نشط في النظام ويمكنك الوصول إلى جميع خدمات البوابة
                </p>
              </div>
            )}
          </div>
        </div>
            </div>
            </>
        ) : null}
      </main>
    </div>
  );
}

