'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

export default function ExaminationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // حساب السنة الأكاديمية والفصل الدراسي
  const getAcademicInfo = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();

    let academicYear, semester;

    // السنة الأكاديمية تبدأ من 1/9 وتنتهي في 1/6
    if (currentMonth >= 9) {
      // من سبتمبر إلى ديسمبر - السنة الحالية + السنة التالية
      academicYear = `${currentYear}-${currentYear + 1}`;
    } else {
      // من يناير إلى أغسطس - السنة السابقة + السنة الحالية
      academicYear = `${currentYear - 1}-${currentYear}`;
    }

    // الفصل الدراسي الأول: 1/9 إلى 31/1
    // الفصل الدراسي الثاني: 15/2 إلى 1/6
    if ((currentMonth >= 9) || (currentMonth === 1)) {
      semester = "الفصل الدراسي الأول";
    } else if (currentMonth >= 2 && currentMonth <= 5) {
      // من فبراير إلى مايو
      if (currentMonth === 2 && currentDay < 15) {
        // قبل 15 فبراير - لا يزال الفصل الأول
        semester = "الفصل الدراسي الأول";
      } else {
        // من 15 فبراير فما بعد - الفصل الثاني
        semester = "الفصل الدراسي الثاني";
      }
    } else {
      // يونيو، يوليو، أغسطس - عطلة صيفية
      semester = "العطلة الصيفية";
    }

    return { academicYear, semester };
  };

  const { academicYear, semester } = getAcademicInfo();

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      
      if (data.success) {
        setUser(data.user);
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('خطأ في التحقق من المصادقة:', error);
      router.push('/');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('خطأ في تسجيل الخروج:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-3 space-x-reverse">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="text-gray-600">جاري التحميل...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Overlay for Mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'block' : 'hidden'} lg:w-64 bg-red-950 shadow-sm border-r border-red-900 min-h-screen fixed top-0 right-0 z-50`}>
        {/* Close Button for Mobile */}
        <div className="lg:hidden flex justify-end p-4">
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-2 rounded-md text-red-100 hover:text-white hover:bg-red-900"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* College Logo and Name */}
        <div className="flex items-center h-18 border border-white rounded-lg mx-1 my-2 px-4">
          <div className="w-18 h-18 ml-1 flex items-center justify-center flex-shrink-0">
            <Image 
              src="/logos/college-logo.png" 
              alt="شعار الكلية" 
              width={64}
              height={64}
              className="w-16 h-16 object-contain filter brightness-0 invert"
              onError={(e) => {
                // Fallback if logo doesn't exist
                e.currentTarget.style.display = 'none';
                const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
                if (nextElement) {
                  nextElement.style.display = 'block';
                }
              }}
            />
            <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center text-white font-bold text-xl" style={{display: 'none'}}>
              ش
            </div>
          </div>
          <div className="text-white text-right text-sm font-bold leading-relaxed">
            <div>كلية الشرق</div>
            <div className="whitespace-nowrap text-xs">للعلوم التقنية التخصصية</div>
          </div>
        </div>

        <nav className="pt-4 px-2">
          <div className="space-y-1">
            {/* Dashboard */}
            <Link
              href="/examinationadministration"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5a2 2 0 012-2h4a2 2 0 012 2v6H8V5z" />
                </svg>
              </div>
              الصفحة الرئيسية
            </Link>

            {/* Exam Management */}
            <Link
              href="/examinationadministration/exams"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration/exams' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration/exams' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              إدارة الامتحانات
            </Link>

            {/* Students */}
            <Link
              href="/examinationadministration/students"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration/students' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration/students' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              الطلبة
            </Link>

            {/* Results */}
            <Link
              href="/examinationadministration/results"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration/results' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration/results' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              النتائج
            </Link>

            {/* Reports */}
            <Link
              href="/examinationadministration/reports"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration/reports' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration/reports' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              التقارير
            </Link>

            {/* Settings */}
            <Link
              href="/examinationadministration/settings"
              className={`group flex items-center px-2 py-2 text-sm font-medium transition-all duration-200 ${
                pathname === '/examinationadministration/settings' 
                  ? 'bg-red-800 text-white border-r-4 border-yellow-400 shadow-lg -mx-2 px-4' 
                  : 'text-red-100 hover:bg-red-900 hover:text-white hover:-mx-2 hover:px-4 rounded-md'
              }`}
            >
              <div className="flex items-center">
                {pathname === '/examinationadministration/settings' && (
                  <div className="w-2 h-2 bg-yellow-400 rounded-full ml-2"></div>
                )}
                <svg className="mr-3 h-6 w-6 text-red-300 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              الإعدادات
            </Link>
          </div>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
         {/* Header */}
         <header className={`shadow-sm border-b border-gray-600 fixed top-0 left-0 z-40 transition-all duration-300 ${sidebarOpen ? 'right-64' : 'right-0'}`} style={{backgroundColor: '#1C4760'}}>
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-20">
              {/* Menu Button and Title */}
              <div className="flex items-center">
                <button
                  onClick={() => {
                    console.log('Sidebar toggle clicked, current state:', sidebarOpen);
                    setSidebarOpen(!sidebarOpen);
                  }}
                  className="p-2 rounded-md text-gray-300 hover:text-white hover:bg-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <div className="mr-4">
                  <div className="flex items-center space-x-4 space-x-reverse">
                    <h1 className="text-2xl font-bold text-white">نظام اللجنة الامتحانية المركزية</h1>
                    <div className="flex items-center space-x-2 space-x-reverse text-gray-300">
                      <div className="w-px h-6 bg-gray-400"></div>
                      <span className="text-sm font-medium">{academicYear}</span>
                      <div className="w-px h-4 bg-gray-400"></div>
                      <span className="text-sm font-medium">{semester}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 font-light mr-4">
                    {new Date().toLocaleDateString('ar-SA', {
                      weekday: 'long'
                    })} - {new Date().toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })} - {new Date().toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    })}
                  </p>
                </div>
              </div>

              {/* User Menu */}
              <div className="flex items-center space-x-4 space-x-reverse">
                {/* Search Bar */}
                <div className="max-w-md">
                  <div className="relative">
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      placeholder="البحث في النظام..."
                      className="block w-full pr-10 pl-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-right"
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{user.full_name}</p>
                  <p className="text-xs text-gray-300">{user.username}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-md text-gray-300 hover:text-white hover:bg-red-600 transition-colors"
                  title="تسجيل الخروج"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </header>

         {/* Main Content */}
         <main className={`flex-1 pt-20 transition-all duration-300 ${sidebarOpen ? 'lg:mr-64' : 'lg:mr-0'}`}>
           {children}
         </main>
      </div>
    </div>
  );
}