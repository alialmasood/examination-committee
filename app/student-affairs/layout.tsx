'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import SearchModal from '@/app/components/SearchModal';

interface User {
  id: string;
  username: string;
  full_name?: string;
  email?: string;
}


export default function StudentAffairsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentDateTime, setCurrentDateTime] = useState('');
  const [currentSemester, setCurrentSemester] = useState('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me');
        const result = await response.json();

        if (result.success) {
          setUser(result.user);
        } else {
          router.push('/');
        }
      } catch (error) {
        console.error('خطأ في التحقق من المصادقة:', error);
        router.push('/');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  // تحديد الفصل الدراسي بناءً على التاريخ
  const getCurrentSemester = (date: Date): string => {
    const month = date.getMonth() + 1; // 1-12
    const day = date.getDate();
    
    // الفصل الدراسي الأول: من 1 سبتمبر إلى 31 يناير
    if ((month === 9 && day >= 1) || month === 10 || month === 11 || month === 12 || (month === 1 && day <= 31)) {
      return 'الفصل الدراسي الأول';
    }
    // الفصل الدراسي الثاني: من 15 فبراير إلى 1 مايو
    else if ((month === 2 && day >= 15) || month === 3 || month === 4 || (month === 5 && day <= 1)) {
      return 'الفصل الدراسي الثاني';
    }
    // فترة العطلة الصيفية: من 2 مايو إلى 31 أغسطس
    else {
      return 'العطلة الصيفية';
    }
  };

  // تحديث التاريخ والوقت والفصل الدراسي
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      
      const arabicOptions: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      };

      // تحويل الأسماء إلى العربية مع التاريخ الميلادي
      const dateTimeString = now.toLocaleDateString('ar-EG', arabicOptions)
        .replace('Monday', 'الاثنين')
        .replace('Tuesday', 'الثلاثاء')
        .replace('Wednesday', 'الأربعاء')
        .replace('Thursday', 'الخميس')
        .replace('Friday', 'الجمعة')
        .replace('Saturday', 'السبت')
        .replace('Sunday', 'الأحد')
        .replace('January', 'يناير')
        .replace('February', 'فبراير')
        .replace('March', 'مارس')
        .replace('April', 'أبريل')
        .replace('May', 'مايو')
        .replace('June', 'يونيو')
        .replace('July', 'يوليو')
        .replace('August', 'أغسطس')
        .replace('September', 'سبتمبر')
        .replace('October', 'أكتوبر')
        .replace('November', 'نوفمبر')
        .replace('December', 'ديسمبر')
        .replace('AM', 'ص')
        .replace('PM', 'م');

      setCurrentDateTime(dateTimeString);
      setCurrentSemester(getCurrentSemester(now));
    };

    // تحديث فوري
    updateDateTime();

    // تحديث كل دقيقة
    const interval = setInterval(updateDateTime, 60000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('خطأ في تسجيل الخروج:', error);
    }
  };

  const navigationItems = [
    {
      name: 'الصفحة الرئيسية',
      href: '/student-affairs',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      name: 'إدارة الطلبة',
      href: '/student-affairs/students',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      name: 'النتائج والدرجات',
      href: '/student-affairs/grades',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
    },
    {
      name: 'الحضور والغيابات',
      href: '/student-affairs/attendance',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: 'طلبات الطلبة',
      href: '/student-affairs/requests',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      name: 'الإنذارات والعقوبات',
      href: '/student-affairs/warnings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      ),
    },
    {
      name: 'الوثائق والشهادات',
      href: '/student-affairs/documents',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      name: 'المراسلات والإشعارات',
      href: '/student-affairs/communications',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      name: 'الإعدادات العامة',
      href: '/student-affairs/settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      name: 'المساعدة والدعم الفني',
      href: '/student-affairs/support',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5z" />
        </svg>
      ),
    },
    {
      name: 'الإحصائيات والتقارير',
      href: '/student-affairs/reports',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      name: 'سجل العمليات',
      href: '/student-affairs/audit-log',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex">
      {/* Sidebar */}
      <aside className={`bg-gradient-to-b from-gray-900 via-black to-gray-800 backdrop-blur-xl shadow-2xl border-l border-gray-700/50 transition-all duration-300 fixed top-0 right-0 z-40 flex flex-col ${
        sidebarOpen ? 'w-64' : 'w-0'
      } overflow-hidden overflow-x-hidden h-screen`}>
          {/* Header Section in Sidebar */}
          <div className="p-4 flex-shrink-0">
            <div className="flex items-center space-x-3 space-x-reverse mb-3">
              <div className="w-12 h-12 flex items-center justify-center bg-white rounded-full border border-blue-400/40 shadow-lg">
                <Image 
                  src="/logos/college-logo.png" 
                  alt="شعار كلية الشرق" 
                  width={48}
                  height={48}
                  className="w-full h-full object-contain hover:scale-110 transition-transform duration-300"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    (e.currentTarget.nextElementSibling as HTMLElement)?.style.setProperty('display', 'flex');
                  }}
                />
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform duration-300 hidden">
                  <span className="text-blue-600 text-lg font-bold">ش</span>
                </div>
              </div>
              <div className="text-white">
                <h2 className="text-lg font-bold text-white mb-1">
                  كلية الشرق
                </h2>
                <p className="text-base text-gray-300">للعلوم التقنية التخصصية</p>
              </div>
            </div>
          </div>

          <nav className="p-5 pt-2 flex-1 overflow-y-auto overflow-x-hidden">
            <ul className="space-y-0 -mt-4 w-full">
              {navigationItems.map((item) => (
                <li key={item.name} className="w-full overflow-hidden">
                  <Link
                    href={item.href}
                    className={`group flex items-center space-x-4 space-x-reverse px-5 py-2.5 mx-0 rounded-none transition-all duration-300 w-full ${
                      pathname === item.href
                        ? 'bg-gradient-to-r from-blue-600/50 to-blue-500/50 text-white border-r-16 border-blue-400 shadow-lg backdrop-blur-sm -mr-4 -ml-6'
                        : 'text-gray-300 hover:bg-gradient-to-r hover:from-gray-800/50 hover:to-gray-700/50 hover:text-white border border-transparent hover:border-gray-600/50 hover:-mr-4 hover:-ml-6 hover:shadow-lg hover:backdrop-blur-sm'
                    }`}
                  >
                     <div className={`transition-all duration-300 ${
                       pathname === item.href 
                         ? 'text-blue-200' 
                         : 'text-gray-400 group-hover:text-blue-200'
                     }`}>
                       {item.icon}
                     </div>
                    <div className="flex-1 min-w-0">
                      <span className={`font-semibold truncate ${item.name === 'المساعدة والدعم الفني' ? 'text-xs' : 'text-sm'}`}>
                        {item.name}
                      </span>
                    </div>
                    {pathname === item.href && (
                      <div className="w-2 h-2 bg-blue-400 rounded-full shadow-sm"></div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Footer Section in Sidebar - مدير الشعبة */}
          <div className="p-4 border-t border-gray-700/50 bg-gray-900/80 backdrop-blur-sm flex-shrink-0">
            <div className="text-center">
              <p className="text-sm font-semibold text-white">
                {user?.full_name === 'المدير العام' ? 'مدير الشعبة' : (user?.full_name || user?.username)}
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? 'mr-64' : 'mr-0'}`}>
          {/* Header */}
          <header className="bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400 backdrop-blur-xl shadow-2xl border-b border-blue-400/30 sticky top-0 z-50">
            <div className="flex items-center justify-between px-6 py-5">
              <div className="flex items-center space-x-2 space-x-reverse">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-3 transition-all duration-300 group"
                >
                  <svg className="w-6 h-6 text-white group-hover:text-blue-100 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <div className="text-blue-50 flex-1">
                  <div className="flex items-center justify-between">
                    <h1 className="text-xl lg:text-2xl font-bold text-white">
                      نظام شؤون الطلبة والتسجيل
                    </h1>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <div className="w-6 lg:w-8 h-px bg-white/40"></div>
                      <span className="text-xs lg:text-sm font-medium text-white/90">
                        2025-2026 - {currentSemester}
                      </span>
                    </div>
                  </div>
                  {/* التاريخ والوقت بكتابة ناعمة */}
                  <div className="text-xs text-blue-200/80 font-light mt-1">
                    {currentDateTime || 'جاري التحميل...'}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-4 space-x-reverse">
                {/* Search Bar - Desktop */}
                <div className="relative hidden lg:block">
                  <button
                    onClick={() => setSearchModalOpen(true)}
                    className="w-80 px-4 py-2 pr-10 pl-4 text-sm bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white placeholder-blue-200 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition-all duration-300 text-right"
                  >
                    <span className="text-blue-200">البحث في النظام...</span>
                  </button>
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>

                {/* Search Bar - Mobile */}
                <div className="relative lg:hidden">
                  <button 
                    onClick={() => setSearchModalOpen(true)}
                    className="p-2 transition-all duration-300 group"
                  >
                    <svg className="w-5 h-5 text-white group-hover:text-blue-200 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                </div>

                {/* Notifications Button */}
                <button className="p-3 transition-all duration-300 group relative">
                  <svg className="w-6 h-6 text-white group-hover:text-blue-200 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                  {/* Notification Badge */}
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                    3
                  </span>
                </button>

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  className="p-3 transition-all duration-300 group"
                >
                  <svg className="w-6 h-6 text-white group-hover:text-red-200 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-8">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>

          {/* الزر العائم لإضافة طالب جديد */}
          <div className="fixed bottom-6 left-6 z-50">
            <button
              onClick={() => {
                // إذا كنا في صفحة الطلاب، افتح الفورم مباشرة
                if (pathname === '/student-affairs/students') {
                  const event = new CustomEvent('openAddStudentModal');
                  window.dispatchEvent(event);
                } else {
                  // إذا كنا في صفحة أخرى، انتقل إلى صفحة الطلاب مع معامل لفتح الفورم
                  router.push('/student-affairs/students?openForm=true');
                }
              }}
              className="group flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-110"
              title="إضافة طالب جديد"
            >
              <svg className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          </div>

        </div>

        <SearchModal 
          isOpen={searchModalOpen} 
          onClose={() => setSearchModalOpen(false)} 
        />
    </div>
  );
}
