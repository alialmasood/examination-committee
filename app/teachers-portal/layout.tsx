'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { startAutoRefresh } from '@/src/lib/auth-utils';

export default function TeachersPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    // بدء التجديد التلقائي للـ token
    const stopAutoRefresh = startAutoRefresh();

    // تنظيف عند إلغاء التثبيت
    return () => {
      stopAutoRefresh();
    };
  }, []);

  // التحقق من عدم وجود الزر في صفحة البروفايل
  const showFloatingButton = pathname !== '/teachers-portal/profile';

  return (
    <>
      {children}
      
      {/* Floating Action Button - Mobile Only (except profile page) */}
      {showFloatingButton && (
        <Link
          href="/teachers-portal/dashboard"
          className="fixed bottom-6 right-6 sm:hidden z-50"
        >
          <div className="bg-gradient-to-r from-red-600 to-red-700 text-white rounded-full p-4 shadow-lg hover:shadow-xl active:shadow-lg transition-all touch-manipulation">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
        </Link>
      )}
    </>
  );
}

