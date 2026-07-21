'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function TeachersPortalPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success && result.user) {
        // التحقق من أن المستخدم مرتبط بتدريسي في النظام
        try {
          const teacherCheckResponse = await fetch(`/api/hr/teachers?user_id=${result.user.id}`);
          const teacherCheckData = await teacherCheckResponse.json();
          
          if (teacherCheckData.success && teacherCheckData.data && teacherCheckData.data.length > 0) {
            // المستخدم مرتبط بتدريسي - السماح بالدخول
            router.push(`/teachers-portal/dashboard`);
          } else {
            setError('ليس لديك صلاحية للوصول إلى بوابة التدريسين. يرجى التأكد من وجود حساب تدريسي مرتبط بك.');
          }
        } catch (checkError) {
          console.error('خطأ في التحقق من بيانات التدريسي:', checkError);
          setError('حدث خطأ في التحقق من بياناتك. يرجى المحاولة مرة أخرى.');
        }
      } else {
        setError(result.message || 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }
    } catch (error) {
      console.error('خطأ في تسجيل الدخول:', error);
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center p-3 sm:p-4 safe-area-inset">
      <div className="max-w-md w-full">
        {/* Logo and Title */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-red-600 rounded-full mb-3 sm:mb-4 shadow-lg">
            <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">بوابة التدريسين</h1>
          <p className="text-sm sm:text-base text-gray-600 px-2">كلية الشرق للعلوم التقنية التخصصية</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-4 sm:p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-red-800 leading-relaxed">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                اسم المستخدم / البريد الإلكتروني / رقم الهاتف
              </label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                placeholder="أدخل اسم المستخدم"
                dir="ltr"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                placeholder="أدخل كلمة المرور"
                dir="ltr"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
              <Link
                href="/"
                className="text-xs sm:text-sm text-gray-600 hover:text-red-600 transition-colors"
              >
                ← العودة للصفحة الرئيسية
              </Link>
              <Link
                href="#"
                className="text-xs sm:text-sm text-red-600 hover:text-red-700 transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  alert('سيتم إضافة هذه الميزة قريباً');
                }}
              >
                نسيت كلمة المرور؟
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-red-600 text-white py-3 sm:py-3.5 rounded-lg font-medium hover:bg-red-700 active:bg-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base sm:text-lg touch-manipulation"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span className="text-sm sm:text-base">جاري تسجيل الدخول...</span>
                </>
              ) : (
                <span className="text-base sm:text-lg">تسجيل الدخول</span>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-4 sm:mt-6 text-xs sm:text-sm text-gray-500 px-2">
          <p>© 2025 كلية الشرق للعلوم التقنية التخصصية. جميع الحقوق محفوظة.</p>
        </div>
      </div>
    </div>
  );
}

