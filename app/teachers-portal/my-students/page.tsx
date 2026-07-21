'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TeacherSubject {
  subject_id: string;
  subject_name: string;
  department: string;
  stage: string;
  study_type: string;
  academic_year: string;
  semester: string;
  units: number | null;
}

interface Student {
  id: string;
  university_id: string;
  full_name_ar: string;
  full_name: string;
  phone?: string;
  email?: string;
  subject_id: string;
  subject_name: string;
}

interface SubjectStudents {
  subject: TeacherSubject;
  students: Student[];
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

export default function MyStudentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [subjectsStudents, setSubjectsStudents] = useState<SubjectStudents[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStudyType, setFilterStudyType] = useState<string>('all');
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');

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

      const response = await fetch('/api/teachers-portal/my-students');
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        const errorMsg = data.error || data.message || 'حدث خطأ في جلب البيانات';
        const details = data.details ? `\n\nالتفاصيل: ${data.details}` : '';
        throw new Error(`${errorMsg}${details}`);
      }

      setTeacher(data.teacher);
      setSubjectsStudents(data.data || []);
      
      // إذا كانت هناك رسالة (مثل عدم وجود مواد دراسية)
      if (data.message) {
        console.log('رسالة من الخادم:', data.message);
      }
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالخادم';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Filtered data
  const filteredSubjectsStudents = useMemo(() => {
    let result = [...subjectsStudents];

    // Filter by subject
    if (filterSubject !== 'all') {
      result = result.filter((item) => item.subject.subject_id === filterSubject);
    }

    // Filter by stage
    if (filterStage !== 'all') {
      result = result.filter((item) => item.subject.stage === filterStage);
    }

    // Filter by study type
    if (filterStudyType !== 'all') {
      result = result.filter((item) => item.subject.study_type === filterStudyType);
    }

    // Filter by academic year
    if (filterAcademicYear !== 'all') {
      result = result.filter((item) => item.subject.academic_year === filterAcademicYear);
    }

    // Search filter (search in student names or university IDs)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.map((item) => ({
        ...item,
        students: item.students.filter(
          (student) =>
            student.full_name_ar.toLowerCase().includes(query) ||
            student.full_name.toLowerCase().includes(query) ||
            student.university_id.toLowerCase().includes(query)
        )
      })).filter((item) => item.students.length > 0);
    }

    return result;
  }, [subjectsStudents, searchQuery, filterSubject, filterStage, filterStudyType, filterAcademicYear]);

  // Get unique values for filters
  const uniqueSubjects = useMemo(() => {
    const subjects = subjectsStudents.map((item) => ({
      id: item.subject.subject_id,
      name: item.subject.subject_name
    }));
    return Array.from(new Map(subjects.map((s) => [s.id, s])).values());
  }, [subjectsStudents]);

  const uniqueStages = useMemo(() => {
    return Array.from(new Set(subjectsStudents.map((item) => item.subject.stage))).sort();
  }, [subjectsStudents]);

  const uniqueStudyTypes = useMemo(() => {
    return Array.from(new Set(subjectsStudents.map((item) => item.subject.study_type))).sort();
  }, [subjectsStudents]);

  const uniqueAcademicYears = useMemo(() => {
    return Array.from(new Set(subjectsStudents.map((item) => item.subject.academic_year))).sort().reverse();
  }, [subjectsStudents]);

  // Statistics
  const stats = useMemo(() => {
    const totalStudents = filteredSubjectsStudents.reduce((sum, item) => sum + item.students.length, 0);
    const totalSubjects = filteredSubjectsStudents.length;
    const studentsByStage = filteredSubjectsStudents.reduce((acc, item) => {
      const stage = item.subject.stage;
      if (!acc[stage]) acc[stage] = 0;
      acc[stage] += item.students.length;
      return acc;
    }, {} as Record<string, number>);

    return { totalStudents, totalSubjects, studentsByStage };
  }, [filteredSubjectsStudents]);

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
      <div className="min-h-screen bg-gray-50 safe-area-inset">
        <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-center">
            <p>{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </main>
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
              {/* Statistics Cards - Students Specific */}
              {stats.totalSubjects > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                  {/* Total Students Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الطلاب</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalStudents}</p>
                      <p className="text-xs text-gray-500 mt-1">طالب مسجل</p>
                    </div>
                  </div>

                  {/* Total Subjects Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">عدد المواد</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalSubjects}</p>
                      <p className="text-xs text-gray-500 mt-1">مادة دراسية</p>
                    </div>
                  </div>

                  {/* Filtered Results Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">المواد المعروضة</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{filteredSubjectsStudents.length}</p>
                      <p className="text-xs text-gray-500 mt-1">بعد التصفية</p>
                    </div>
                  </div>

                  {/* Students by Stage Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">توزيع المراحل</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{Object.keys(stats.studentsByStage).length}</p>
                      <p className="text-xs text-gray-500 mt-1">مرحلة مختلفة</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Filters and Search */}
              {subjectsStudents.length > 0 && (
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
                            placeholder="ابحث باسم الطالب أو الرقم الجامعي..."
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
                          المادة
                        </label>
                        <select
                          value={filterSubject}
                          onChange={(e) => setFilterSubject(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueSubjects.map((subject) => (
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
                          <option value="all">الكل</option>
                          {uniqueStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stageLabelMap[stage] || stage}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Study Type Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          نوع الدراسة
                        </label>
                        <select
                          value={filterStudyType}
                          onChange={(e) => setFilterStudyType(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueStudyTypes.map((type) => (
                            <option key={type} value={type}>
                              {studyTypeLabelMap[type] || type}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Academic Year Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          السنة الأكاديمية
                        </label>
                        <select
                          value={filterAcademicYear}
                          onChange={(e) => setFilterAcademicYear(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueAcademicYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Subjects and Students */}
              {filteredSubjectsStudents.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-12 text-center">
                  <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h3 className="mt-2 text-base sm:text-lg font-semibold text-gray-900">
                    {subjectsStudents.length === 0 ? 'لا توجد مواد دراسية' : 'لا توجد نتائج'}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {subjectsStudents.length === 0 
                      ? 'لا توجد مواد دراسية مرتبطة بك حالياً' 
                      : 'لم يتم العثور على طلاب تطابق معايير البحث'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6">
                  {filteredSubjectsStudents.map((item) => {
                    const { subject, students } = item;
                    
                    return (
                      <div key={subject.subject_id} className="bg-white rounded-none sm:rounded-xl shadow-sm border-x-0 sm:border-x border-t border-b sm:border border-gray-200 overflow-hidden hover:shadow-md transition-shadow -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto">
                        {/* Subject Header */}
                        <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 px-4 sm:px-6 py-4 sm:py-5 text-white">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2">
                                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                    </svg>
                                  </div>
                                  <h3 className="text-base sm:text-lg md:text-xl font-bold truncate">
                                    {subject.subject_name}
                                  </h3>
                                </div>
                                {/* Number of Students and Units - Mobile Only */}
                                <div className="sm:hidden flex items-center gap-1 flex-shrink-0">
                                  <div className="flex items-center gap-1 bg-white/10 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/20">
                                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                    </svg>
                                    <span className="text-xs font-bold text-white">{students.length}</span>
                                  </div>
                                  {subject.units && (
                                    <div className="flex items-center gap-0.5 bg-white/10 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/20">
                                      <span className="text-[10px] text-red-100">وحدة</span>
                                      <span className="text-xs font-bold text-white">{subject.units}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                                  {stageLabelMap[subject.stage] || subject.stage}
                                </span>
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                                  {studyTypeLabelMap[subject.study_type] || subject.study_type}
                                </span>
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                                  {semesterLabelMap[subject.semester] || subject.semester}
                                </span>
                                <span className="text-xs sm:text-sm text-red-100">
                                  {subject.academic_year}
                                </span>
                                {subject.units && (
                                  <span className="hidden sm:inline text-xs sm:text-sm text-red-100">
                                    {subject.units} وحدة
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 sm:gap-3 bg-white/10 backdrop-blur-sm px-3 sm:px-4 py-2 rounded-lg border border-white/20">
                              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                              <div>
                                <div className="text-lg sm:text-xl md:text-2xl font-bold">{students.length}</div>
                                <div className="text-xs text-red-100">{students.length === 1 ? 'طالب' : 'طالب'}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Students Table */}
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gradient-to-r from-red-50 to-red-100">
                              <tr>
                                <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                                  #
                                </th>
                                <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider hidden sm:table-cell border-b border-red-200">
                                  الرقم الجامعي
                                </th>
                                <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                                  اسم الطالب
                                </th>
                                <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                                  الهاتف
                                </th>
                                <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider hidden lg:table-cell border-b border-red-200">
                                  البريد الإلكتروني
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {students.map((student, index) => (
                                <tr key={student.id} className="hover:bg-red-50 transition-colors">
                                  <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                                    <div className="flex items-center justify-end">
                                      <span className="inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 bg-red-100 text-red-700 rounded-full text-xs sm:text-sm font-bold">
                                        {index + 1}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap hidden sm:table-cell">
                                    <span className="text-sm sm:text-base text-gray-900 font-mono font-medium bg-gray-50 px-2 py-1 rounded">
                                      {student.university_id}
                                    </span>
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 sm:py-4">
                                    <div className="flex items-center gap-2">
                                      <div className="hidden sm:flex w-8 h-8 sm:w-10 sm:h-10 bg-red-100 rounded-full items-center justify-center flex-shrink-0">
                                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                      </div>
                                      <span className="text-sm sm:text-base text-gray-900 font-medium">
                                        {student.full_name_ar || student.full_name}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                                    {student.phone ? (
                                      <a href={`tel:${student.phone}`} className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1 touch-manipulation">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                        </svg>
                                        {student.phone}
                                      </a>
                                    ) : (
                                      <span className="text-sm text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap hidden lg:table-cell">
                                    {student.email ? (
                                      <a href={`mailto:${student.email}`} className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1 touch-manipulation truncate max-w-xs">
                                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                        <span className="truncate">{student.email}</span>
                                      </a>
                                    ) : (
                                      <span className="text-sm text-gray-400">-</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
        ) : null}
      </main>
    </div>
  );
}

