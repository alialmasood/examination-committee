'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Lecture {
  id: string;
  subject_id: string;
  subject_name: string;
  department: string;
  stage: string;
  study_type: string;
  academic_year: string;
  semester: string;
  lecture_date: string;
  lecture_time: string | null;
  duration_minutes: number | null;
  topic: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  attendance_stats: {
    total: number;
    present: number;
    absent: number;
    excused: number;
  };
}

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  department: string;
}

const stageLabelMap: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة'
};

const studyTypeLabelMap: Record<string, string> = {
  morning: 'صباحي',
  evening: 'مسائي'
};

const semesterLabelMap: Record<string, string> = {
  first: 'الفصل الأول',
  second: 'الفصل الثاني'
};

export default function AttendancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [expandedLectures, setExpandedLectures] = useState<Record<string, boolean>>({});
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('all');

  // Export Report State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<'day' | 'range' | 'month' | 'semester'>('day');
  const [exportStartDate, setExportStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [exportEndDate, setExportEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [exportMonth, setExportMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [exportSemester, setExportSemester] = useState<string>('first');
  const [exportAcademicYear, setExportAcademicYear] = useState<string>(new Date().getFullYear().toString());
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    fetchData();
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

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/teachers-portal/lectures');
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        const errorMsg = data.error || data.message || 'حدث خطأ في جلب البيانات';
        throw new Error(errorMsg);
      }

      // جلب بيانات التدريسي
      const teacherResponse = await fetch('/api/auth/me');
      const teacherData = await teacherResponse.json();
      
      if (teacherData.success) {
        const teacherInfoResponse = await fetch(`/api/hr/teachers?user_id=${teacherData.user.id}`);
        const teacherInfoData = await teacherInfoResponse.json();
        
        if (teacherInfoData.success && teacherInfoData.data && teacherInfoData.data.length > 0) {
          setTeacher(teacherInfoData.data[0]);
        }
      }

      // تصفية المحاضرات التي لديها سجلات حضور فقط
      const lecturesWithAttendance = (data.data || []).filter(
        (lecture: Lecture) => lecture.attendance_stats && lecture.attendance_stats.total > 0
      );

      setLectures(lecturesWithAttendance);
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
      setError(err instanceof Error ? err.message : 'حدث خطأ في جلب البيانات');
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

  const toggleLecture = (lectureId: string) => {
    setExpandedLectures(prev => ({
      ...prev,
      [lectureId]: !prev[lectureId]
    }));
  };

  const handleExportReport = async () => {
    try {
      setIsExporting(true);

      // بناء query parameters
      const params = new URLSearchParams();
      params.append('type', exportType);

      if (exportType === 'day') {
        params.append('startDate', exportStartDate);
      } else if (exportType === 'range') {
        params.append('startDate', exportStartDate);
        params.append('endDate', exportEndDate);
      } else if (exportType === 'month') {
        params.append('month', exportMonth);
      } else if (exportType === 'semester') {
        params.append('semester', exportSemester);
        params.append('academicYear', exportAcademicYear);
      }

      // جلب التقرير
      const response = await fetch(`/api/teachers-portal/attendance/export?${params.toString()}`);

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'حدث خطأ في تصدير التقرير');
      }

      // تحميل الملف
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // تحديد اسم الملف
      let fileName = 'attendance-report';
      if (exportType === 'day') {
        fileName = `attendance-report-${exportStartDate}.xlsx`;
      } else if (exportType === 'range') {
        fileName = `attendance-report-${exportStartDate}-${exportEndDate}.xlsx`;
      } else if (exportType === 'month') {
        fileName = `attendance-report-${exportMonth}.xlsx`;
      } else if (exportType === 'semester') {
        fileName = `attendance-report-${exportAcademicYear}-${exportSemester}.xlsx`;
      }
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // إغلاق Modal
      setShowExportModal(false);
      alert('تم تصدير التقرير بنجاح!');
    } catch (err) {
      console.error('خطأ في تصدير التقرير:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في تصدير التقرير');
    } finally {
      setIsExporting(false);
    }
  };

  // تصفية المحاضرات
  const filteredLectures = useMemo(() => {
    let filtered = lectures;

    // البحث النصي
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(lecture =>
        lecture.subject_name?.toLowerCase().includes(query) ||
        lecture.topic?.toLowerCase().includes(query) ||
        lecture.location?.toLowerCase().includes(query)
      );
    }

    // فلتر المادة
    if (filterSubject !== 'all') {
      filtered = filtered.filter(lecture => lecture.subject_id === filterSubject);
    }

    // فلتر المرحلة
    if (filterStage !== 'all') {
      filtered = filtered.filter(lecture => lecture.stage === filterStage);
    }

    // فلتر الفصل
    if (filterSemester !== 'all') {
      filtered = filtered.filter(lecture => lecture.semester === filterSemester);
    }

    // فلتر التاريخ
    if (filterDate !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const date = new Date(filterDate);
      date.setHours(0, 0, 0, 0);

      filtered = filtered.filter(lecture => {
        const lectureDate = new Date(lecture.lecture_date);
        lectureDate.setHours(0, 0, 0, 0);
        return lectureDate.getTime() === date.getTime();
      });
    }

    // ترتيب حسب التاريخ (الأحدث أولاً)
    return filtered.sort((a, b) => {
      const dateA = new Date(a.lecture_date).getTime();
      const dateB = new Date(b.lecture_date).getTime();
      return dateB - dateA;
    });
  }, [lectures, searchQuery, filterSubject, filterStage, filterSemester, filterDate]);

  // قائمة المواد الدراسية الفريدة
  const uniqueSubjects = useMemo(() => {
    const subjectsMap = new Map<string, { id: string; name: string }>();
    lectures.forEach(lecture => {
      if (!subjectsMap.has(lecture.subject_id)) {
        subjectsMap.set(lecture.subject_id, {
          id: lecture.subject_id,
          name: lecture.subject_name
        });
      }
    });
    return Array.from(subjectsMap.values());
  }, [lectures]);

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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 max-w-md w-full text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            <p className="font-medium mb-2">حدث خطأ</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
            >
              إعادة المحاولة
            </button>
          </div>
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
              {/* Export Report Button */}
              <div className="mb-4 sm:mb-6 flex justify-end">
                <button
                  onClick={() => setShowExportModal(true)}
                  className="px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:from-green-700 hover:to-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all font-medium text-sm sm:text-base flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  تصدير تقرير
                </button>
              </div>

              {/* Statistics Cards - Attendance Specific */}
              {lectures.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6 auto-rows-fr">
                  {/* Total Lectures Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي المحاضرات</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{lectures.length}</p>
                      <p className="text-xs text-gray-500 mt-1">محاضرة مسجلة</p>
                    </div>
                  </div>

                  {/* Total Present Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-green-50 to-green-100 px-4 py-3 border-b border-green-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الحضور</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-green-700">
                        {lectures.reduce((sum, l) => sum + (l.attendance_stats?.present || 0), 0)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">طالب حاضر</p>
                    </div>
                  </div>

                  {/* Total Absent Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الغياب</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">
                        {lectures.reduce((sum, l) => sum + (l.attendance_stats?.absent || 0), 0)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">طالب غائب</p>
                    </div>
                  </div>

                  {/* Total Excused Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-yellow-50 to-orange-100 px-4 py-3 border-b border-yellow-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي المجاز</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-yellow-700">
                        {lectures.reduce((sum, l) => sum + (l.attendance_stats?.excused || 0), 0)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">طالب مجاز</p>
                    </div>
                  </div>

                  {/* Attendance Rate Card */}
                  {(() => {
                    const totalPresent = lectures.reduce((sum, l) => sum + (l.attendance_stats?.present || 0), 0);
                    const totalAbsent = lectures.reduce((sum, l) => sum + (l.attendance_stats?.absent || 0), 0);
                    const totalExcused = lectures.reduce((sum, l) => sum + (l.attendance_stats?.excused || 0), 0);
                    const totalRecords = totalPresent + totalAbsent + totalExcused;
                    const attendanceRate = totalRecords > 0 ? ((totalPresent / totalRecords) * 100).toFixed(1) : '0';
                    
                    return (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow col-span-2 sm:col-span-1">
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-3 border-b border-blue-200">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                            </div>
                            <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">نسبة الحضور</p>
                          </div>
                        </div>
                        <div className="p-4">
                          <p className="text-2xl sm:text-3xl font-bold text-blue-700">{attendanceRate}%</p>
                          <p className="text-xs text-gray-500 mt-1">من إجمالي السجلات</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Filters and Search */}
              {lectures.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4 sm:mb-6 hover:shadow-md transition-shadow">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">البحث والتصفية</h2>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 md:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {/* Search */}
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          بحث
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="بحث في المادة، العنوان، المكان..."
                            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          />
                          <svg className="absolute right-3 top-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      </div>

                      {/* Subject Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          المادة الدراسية
                        </label>
                        <select
                          value={filterSubject}
                          onChange={(e) => setFilterSubject(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">جميع المواد</option>
                          {uniqueSubjects.map(subject => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name.length > 30 ? `${subject.name.substring(0, 30)}...` : subject.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Stage Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          المرحلة
                        </label>
                        <select
                          value={filterStage}
                          onChange={(e) => setFilterStage(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">جميع المراحل</option>
                          <option value="first">المرحلة الأولى</option>
                          <option value="second">المرحلة الثانية</option>
                          <option value="third">المرحلة الثالثة</option>
                          <option value="fourth">المرحلة الرابعة</option>
                        </select>
                      </div>

                      {/* Date Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          التاريخ
                        </label>
                        <input
                          type="date"
                          value={filterDate}
                          onChange={(e) => setFilterDate(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Lectures List */}
              {filteredLectures.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-12 text-center">
                  <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <h3 className="mt-2 text-base sm:text-lg font-semibold text-gray-900">
                    {lectures.length === 0 ? 'لا توجد سجلات حضور' : 'لا توجد نتائج'}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {lectures.length === 0 
                      ? 'لم يتم تسجيل أي محاضرة حتى الآن' 
                      : 'لم يتم العثور على محاضرات تطابق معايير البحث'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6">
                  {filteredLectures.map((lecture) => (
                    <div
                      key={lecture.id}
                      className="bg-white rounded-none sm:rounded-xl shadow-sm border-x-0 sm:border-x border-t border-b sm:border border-gray-200 overflow-hidden hover:shadow-md transition-shadow -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto"
                    >
                      {/* Lecture Header */}
                      <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 px-4 sm:px-6 py-4 sm:py-5 text-white">
                        <div
                          className="cursor-pointer"
                          onClick={() => toggleLecture(lecture.id)}
                        >
                          {/* Title and Icon - Mobile Optimized */}
                          <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-base sm:text-lg md:text-xl font-bold mb-1.5 leading-tight">
                                {lecture.subject_name}
                              </h3>
                              {lecture.topic && (
                                <p className="text-xs sm:text-sm text-red-100 line-clamp-2">
                                  {lecture.topic}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Badges Row - Organized */}
                          <div className="flex flex-wrap items-center gap-2 mb-4">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                              {stageLabelMap[lecture.stage] || lecture.stage}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                              {studyTypeLabelMap[lecture.study_type] || lecture.study_type}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                              {semesterLabelMap[lecture.semester] || lecture.semester}
                            </span>
                          </div>

                          {/* Date, Time, Location - Organized Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
                            <div className="bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/20">
                              <p className="text-[10px] sm:text-xs text-red-100 mb-1">التاريخ</p>
                              <p className="text-xs sm:text-sm font-bold text-white leading-tight">
                                {new Date(lecture.lecture_date).toLocaleDateString('en-US')}
                              </p>
                            </div>
                            {lecture.lecture_time && (
                              <div className="bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/20">
                                <p className="text-[10px] sm:text-xs text-red-100 mb-1">الوقت</p>
                                <p className="text-xs sm:text-sm font-bold text-white">{lecture.lecture_time}</p>
                              </div>
                            )}
                            {lecture.location && (
                              <div className="bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/20 col-span-2 sm:col-span-1">
                                <p className="text-[10px] sm:text-xs text-red-100 mb-1">المكان</p>
                                <p className="text-xs sm:text-sm font-bold text-white truncate">{lecture.location}</p>
                              </div>
                            )}
                          </div>

                          {/* Attendance Stats and Expand Icon - Row */}
                          <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/20">
                            {/* Attendance Stats - Horizontal Layout on Mobile */}
                            <div className="flex items-center gap-3 sm:gap-4 flex-1">
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0"></div>
                                <span className="text-xs text-red-100">حاضر:</span>
                                <span className="text-sm sm:text-base font-bold text-white">
                                  {lecture.attendance_stats.present}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="w-2 h-2 bg-red-400 rounded-full flex-shrink-0"></div>
                                <span className="text-xs text-red-100">غائب:</span>
                                <span className="text-sm sm:text-base font-bold text-white">
                                  {lecture.attendance_stats.absent}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="w-2 h-2 bg-yellow-400 rounded-full flex-shrink-0"></div>
                                <span className="text-xs text-red-100">مجاز:</span>
                                <span className="text-sm sm:text-base font-bold text-white">
                                  {lecture.attendance_stats.excused}
                                </span>
                              </div>
                            </div>

                            {/* Expand Icon */}
                            <svg
                              className={`w-5 h-5 sm:w-6 sm:h-6 text-white transform transition-transform flex-shrink-0 ${
                                expandedLectures[lecture.id] ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content - Link to view full attendance */}
                      {expandedLectures[lecture.id] && (
                        <div className="border-t border-gray-200 p-4 sm:p-6 bg-gradient-to-r from-gray-50 to-red-50">
                          <div className="flex flex-col sm:flex-row gap-3">
                            <Link
                              href={`/teachers-portal/subjects`}
                              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 transition-all text-center text-sm font-medium shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                              الذهاب إلى المواد التدريسية
                            </Link>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLecture(lecture.id);
                              }}
                              className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                            >
                              إغلاق
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
        ) : null}
      </main>

      {/* Export Report Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                تصدير تقرير الحضور والغياب
              </h2>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
                disabled={isExporting}
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Report Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  نوع التقرير <span className="text-red-600">*</span>
                </label>
                <select
                  value={exportType}
                  onChange={(e) => setExportType(e.target.value as 'day' | 'range' | 'month' | 'semester')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  disabled={isExporting}
                >
                  <option value="day">يوم واحد</option>
                  <option value="range">عدة أيام (نطاق)</option>
                  <option value="month">شهر</option>
                  <option value="semester">فصل دراسي</option>
                </select>
              </div>

              {/* Day Selection */}
              {exportType === 'day' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    التاريخ <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    disabled={isExporting}
                    required
                  />
                </div>
              )}

              {/* Date Range Selection */}
              {exportType === 'range' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      من تاريخ <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      disabled={isExporting}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      إلى تاريخ <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="date"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      min={exportStartDate}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      disabled={isExporting}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Month Selection */}
              {exportType === 'month' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    الشهر <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="month"
                    value={exportMonth}
                    onChange={(e) => setExportMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    disabled={isExporting}
                    required
                  />
                </div>
              )}

              {/* Semester Selection */}
              {exportType === 'semester' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      السنة الأكاديمية <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      value={exportAcademicYear}
                      onChange={(e) => setExportAcademicYear(e.target.value)}
                      min="2020"
                      max="2100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      disabled={isExporting}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      الفصل الدراسي <span className="text-red-600">*</span>
                    </label>
                    <select
                      value={exportSemester}
                      onChange={(e) => setExportSemester(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      disabled={isExporting}
                    >
                      <option value="first">الفصل الأول</option>
                      <option value="second">الفصل الثاني</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={handleExportReport}
                  disabled={isExporting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExporting ? 'جاري التصدير...' : 'تصدير التقرير'}
                </button>
                <button
                  onClick={() => setShowExportModal(false)}
                  disabled={isExporting}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

