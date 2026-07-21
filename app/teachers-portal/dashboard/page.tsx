'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
}

interface DashboardStats {
  totalStudents: number;
  totalSubjects: number;
  todayLectures: number;
  upcomingExams: number;
  recentLectures: Array<{
    id: string;
    date: string;
    time: string | null;
    topic: string | null;
    subject: string;
  }>;
}

export default function TeachersDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [teacher, setTeacher] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    checkAuth();
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

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      
      if (data.success) {
        setUser(data.user);
        // جلب بيانات التدريسي المرتبطة بالمستخدم
        await fetchTeacherData(data.user.id);
        // جلب الإحصائيات
        await fetchStats();
      } else {
        router.push('/teachers-portal');
      }
    } catch (error) {
      console.error('خطأ في التحقق من المصادقة:', error);
      router.push('/teachers-portal');
    } finally {
      setLoading(false);
    }
  };

  const fetchTeacherData = async (userId: string) => {
    try {
      const response = await fetch(`/api/hr/teachers?user_id=${userId}`);
      const data = await response.json();
      
      if (data.success && data.data && data.data.length > 0) {
        setTeacher(data.data[0]);
      }
    } catch (error) {
      console.error('خطأ في جلب بيانات التدريسي:', error);
    }
  };

  const fetchStats = async () => {
    try {
      setLoadingStats(true);
      const response = await fetch('/api/teachers-portal/dashboard/stats');
      const data = await response.json();
      
      if (data.success && data.data) {
        setStats(data.data);
      } else {
        // إذا فشل جلب البيانات، نضع قيم افتراضية
        setStats({
          totalStudents: 0,
          totalSubjects: 0,
          todayLectures: 0,
          upcomingExams: 0,
          recentLectures: []
        });
      }
    } catch (error) {
      console.error('خطأ في جلب الإحصائيات:', error);
      // في حالة الخطأ، نضع قيم افتراضية
      setStats({
        totalStudents: 0,
        totalSubjects: 0,
        todayLectures: 0,
        upcomingExams: 0,
        recentLectures: []
      });
    } finally {
      setLoadingStats(false);
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

  // تنسيق تاريخ المحاضرة
  const formatLectureDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      return `${date.getDate()} ${monthNames[date.getMonth()]}`;
    } catch {
      return dateString;
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
                    {user && (
                      <span className="text-white text-xs sm:text-sm font-medium hidden xs:inline truncate max-w-[120px] sm:max-w-none">
                        {user.full_name || teacher?.full_name_ar}
                      </span>
                    )}
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

            {/* Content Container */}
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">

            {/* Statistics Cards Section */}
            <div className="mb-4 sm:mb-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">الإحصائيات</h2>
              {loadingStats ? (
                // Loading State
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                      <div className="h-8 bg-gray-200 rounded w-16"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">عدد الطلاب</p>
                      <p className="text-xl sm:text-2xl md:text-3xl font-bold text-blue-600">{stats?.totalStudents ?? 0}</p>
                    </div>
                    <div className="bg-blue-100 rounded-full p-2 sm:p-3 flex-shrink-0 ml-2">
                      <svg className="w-5 h-5 sm:w-6 sm:h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">عدد المواد</p>
                      <p className="text-xl sm:text-2xl md:text-3xl font-bold text-green-600">{stats?.totalSubjects ?? 0}</p>
                    </div>
                    <div className="bg-green-100 rounded-full p-2 sm:p-3 flex-shrink-0 ml-2">
                      <svg className="w-5 h-5 sm:w-6 sm:h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">محاضرات اليوم</p>
                      <p className="text-xl sm:text-2xl md:text-3xl font-bold text-yellow-600">{stats?.todayLectures ?? 0}</p>
                    </div>
                    <div className="bg-yellow-100 rounded-full p-2 sm:p-3 flex-shrink-0 ml-2">
                      <svg className="w-5 h-5 sm:w-6 sm:h-7 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">امتحانات قادمة</p>
                      <p className="text-xl sm:text-2xl md:text-3xl font-bold text-red-600">{stats?.upcomingExams ?? 0}</p>
                    </div>
                    <div className="bg-red-100 rounded-full p-2 sm:p-3 flex-shrink-0 ml-2">
                      <svg className="w-5 h-5 sm:w-6 sm:h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>

            {/* Recent Lectures & Quick Actions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
              {/* Recent Lectures */}
              {stats && stats.recentLectures && stats.recentLectures.length > 0 && (
                <div className="lg:col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-3 sm:mb-4">
                    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">آخر المحاضرات</h2>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {stats.recentLectures.map((lecture) => (
                      <Link
                        key={lecture.id}
                        href={`/teachers-portal/subjects`}
                        className="block p-2 sm:p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                      >
                        <div className="text-xs sm:text-sm font-medium text-gray-900 truncate">{lecture.subject}</div>
                        {lecture.topic && (
                          <div className="text-xs text-gray-600 truncate mt-1">{lecture.topic}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span>{formatLectureDate(lecture.date)}</span>
                          {lecture.time && (
                            <>
                              <span>•</span>
                              <span>{lecture.time}</span>
                            </>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Actions - Hidden on Mobile, shown on Desktop */}
              <div className={`hidden sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 ${stats && stats.recentLectures && stats.recentLectures.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                <Link
                  href="/teachers-portal/profile"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">ملفي الشخصي</h3>
                      <p className="text-xs sm:text-sm text-gray-600">عرض وتعديل بياناتي</p>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/teachers-portal/my-students"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">طلابي</h3>
                      <p className="text-xs sm:text-sm text-gray-600">عرض وإدارة طلابي</p>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/teachers-portal/grades"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">الدرجات</h3>
                      <p className="text-xs sm:text-sm text-gray-600">إدخال درجات الامتحانات</p>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/teachers-portal/attendance"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">الحضور والغياب</h3>
                      <p className="text-xs sm:text-sm text-gray-600">تسجيل الحضور اليومي</p>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/teachers-portal/subjects"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">موادي التدريسية</h3>
                      <p className="text-xs sm:text-sm text-gray-600">إدارة المحاضرات والحضور</p>
                    </div>
                  </div>
                </Link>

                <Link
                  href="/teachers-portal/calendar"
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md active:shadow-lg transition-all touch-manipulation"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-0.5 sm:mb-1">التقويم الجامعي</h3>
                      <p className="text-xs sm:text-sm text-gray-600">إدارة المحاضرات والامتحانات والأحداث</p>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
            </div>
          </>
        ) : (
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-8 sm:py-12">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 sm:p-12 text-center">
              <p className="text-sm sm:text-base text-gray-600">لا توجد بيانات تدريسي مرتبطة بحسابك</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
