'use client';

import { useState } from 'react';
import Image from 'next/image';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

/** لون الهوية البصرية — لعرض الموبايل فقط */
const BRAND = '#1EA886';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        if (result.is_platform_admin) {
          window.location.href = '/platform-admin/systems';
          return;
        }

        if (result.is_dean) {
          window.location.href = '/dean';
          return;
        }

        if (result.is_general_supervision) {
          window.location.href = '/general-supervision';
          return;
        }

        if (result.systems && result.systems.length > 0) {
          const firstSystem = result.systems[0];

          switch (firstSystem.code) {
            case 'STUDENT_AFFAIRS':
              window.location.href = '/student-affairs';
              break;
            case 'EXAM_COMMITTEE':
            case 'exam-committee':
              window.location.href = '/examinationadministration';
              break;
            case 'ANESTHESIA':
            case 'anesthesia':
              window.location.href = '/anesthesia';
              break;
            case 'XRAYS':
            case 'xrays':
              window.location.href = '/xrays';
              break;
            case 'DENTAL_INDUSTRY':
            case 'dentalindustry':
              window.location.href = '/dentalindustry';
              break;
            case 'ACCOUNTS':
            case 'accounts':
              window.location.href = '/accounts';
              break;
            case 'CONSTRUCTION':
            case 'construction':
              window.location.href = '/construction';
              break;
            case 'OIL':
            case 'oil':
              window.location.href = '/oil';
              break;
            case 'PHYSICS':
            case 'physics':
              window.location.href = '/physics';
              break;
            case 'OPTICS':
            case 'optics':
              window.location.href = '/optics';
              break;
            case 'HEALTH':
            case 'health':
              window.location.href = '/health';
              break;
            case 'EMERGENCY':
            case 'emergency':
            case 'RGENCY':
            case 'rgency':
              window.location.href = '/emergency';
              break;
            case 'THERAPY':
            case 'therapy':
              window.location.href = '/therapy';
              break;
            case 'CYBER':
            case 'cyber':
              window.location.href = '/cyber';
              break;
            case 'ACCOUNTING':
              window.location.href = '/accounts';
              break;
            case 'GENERAL_SUPERVISION':
              window.location.href = '/general-supervision';
              break;
            default:
              alert(`النظام ${firstSystem.name_ar} غير متاح حالياً`);
          }
        }
      } else {
        alert(result.message || 'فشل في تسجيل الدخول');
      }
    } catch (error) {
      console.error('خطأ في تسجيل الدخول:', error);
      alert('حدث خطأ في الاتصال بالخادم');
    } finally {
      setIsLoading(false);
    }
  };

  const logoBlock = (size: 'desktop' | 'mobile') => (
    <div
      className={
        size === 'mobile'
          ? 'w-20 h-20 mx-auto mb-3 flex items-center justify-center'
          : 'w-20 h-20 mx-auto mb-3 flex items-center justify-center'
      }
    >
      <Image
        src="/logos/college-logo.png"
        alt="شعار كلية الشرق"
        width={80}
        height={80}
        className={
          size === 'mobile'
            ? 'w-full h-full object-contain'
            : 'w-full h-full object-contain hover:scale-105 transition-transform duration-300'
        }
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          (e.currentTarget.nextElementSibling as HTMLElement)?.style.setProperty(
            'display',
            'flex'
          );
        }}
      />
      <div
        className={
          size === 'mobile'
            ? 'w-20 h-20 rounded-full hidden items-center justify-center shadow-lg'
            : 'w-20 h-20 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300 hidden'
        }
        style={size === 'mobile' ? { backgroundColor: 'rgba(255,255,255,0.2)' } : undefined}
      >
        <span className="text-white text-2xl font-bold">ش</span>
      </div>
    </div>
  );

  return (
    <>
      {/* ===================== لابتوب / شاشة كبيرة — بدون تغيير ===================== */}
      <div className="hidden md:flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 items-center justify-center p-4 relative">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute top-20 right-20 w-32 h-32 bg-blue-200/30 rotate-45 rounded-lg transform animate-pulse"></div>
          <div className="absolute top-40 left-32 w-24 h-24 bg-indigo-200/40 rotate-12 rounded-lg transform animate-pulse"></div>
          <div className="absolute bottom-32 right-40 w-28 h-28 bg-purple-200/30 -rotate-12 rounded-lg transform animate-pulse"></div>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"></div>
          <div className="absolute bottom-0 right-0 w-full h-1 bg-gradient-to-l from-transparent via-indigo-300/50 to-transparent"></div>
          <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-blue-400/60 rounded-full animate-ping"></div>
          <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-ping" style={{ animationDelay: '0.5s' }}></div>
          <div className="absolute bottom-1/4 left-1/3 w-2.5 h-2.5 bg-purple-400/60 rounded-full animate-ping" style={{ animationDelay: '1s' }}></div>
          <div className="absolute bottom-1/3 right-1/4 w-1 h-1 bg-blue-500/60 rounded-full animate-ping" style={{ animationDelay: '1.5s' }}></div>
          <div className="absolute top-1/2 left-10 w-16 h-20 bg-gradient-to-b from-blue-200/40 to-indigo-200/40 rounded-sm transform rotate-12 opacity-60"></div>
          <div className="absolute top-1/2 left-16 w-16 h-20 bg-gradient-to-b from-indigo-200/40 to-purple-200/40 rounded-sm transform rotate-6 opacity-60"></div>
          <div className="absolute top-1/2 left-22 w-16 h-20 bg-gradient-to-b from-purple-200/40 to-blue-200/40 rounded-sm transform -rotate-6 opacity-60"></div>
          <div className="absolute top-1/4 right-10 w-40 h-0.5 bg-gradient-to-l from-blue-300/60 to-transparent transform rotate-12"></div>
          <div className="absolute bottom-1/4 left-10 w-32 h-0.5 bg-gradient-to-r from-indigo-300/60 to-transparent transform -rotate-12"></div>
          <div className="absolute top-1/6 right-1/4 w-12 h-12 border-2 border-blue-300/40 rounded-full flex items-center justify-center">
            <div className="w-6 h-6 border border-blue-400/60 rounded-full"></div>
          </div>
          <div className="absolute bottom-1/6 left-1/4 w-10 h-10 border-2 border-indigo-300/40 rounded-full flex items-center justify-center">
            <div className="w-4 h-4 border border-indigo-400/60 rounded-full"></div>
          </div>
          <div className="absolute top-1/2 left-0 w-1 h-20 bg-gradient-to-b from-blue-300/50 via-indigo-300/50 to-purple-300/50"></div>
          <div className="absolute top-1/2 right-0 w-1 h-20 bg-gradient-to-b from-purple-300/50 via-indigo-300/50 to-blue-300/50"></div>
        </div>

        <div className="relative w-full max-w-md">
          <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/30 p-6 hover:shadow-glow transition-all duration-300">
            <div className="text-center mb-6">
              {logoBlock('desktop')}
              <div className="mb-3">
                <h1 className="text-4xl font-black mb-2" style={{ fontFamily: 'Segoe UI Black, system-ui, sans-serif' }}>
                  <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">S</span>
                  <span className="text-gray-800 font-light">HA</span>
                  <span className="bg-gradient-to-r from-purple-600 via-pink-600 to-red-500 bg-clip-text text-transparent">U</span>
                </h1>
                <div className="flex items-center justify-center space-x-1 space-x-reverse mb-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1 h-1 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
              <div className="mb-3">
                <h2 className="text-xl font-semibold text-gray-800 mb-1">كلية الشرق</h2>
                <p className="text-gray-600 text-sm">للعلوم التقنية التخصصية</p>
              </div>
              <div className="w-20 h-1 bg-gradient-to-r from-blue-600 to-purple-600 mx-auto rounded-full"></div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username-desktop" className="block text-sm font-medium text-gray-700 mb-2">
                  اسم المستخدم
                </label>
                <input
                  type="text"
                  id="username-desktop"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  autoComplete="username"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white/80 focus:bg-white"
                  placeholder="أدخل اسم المستخدم"
                  required
                />
              </div>
              <div>
                <label htmlFor="password-desktop" className="block text-sm font-medium text-gray-700 mb-2">
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password-desktop"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white/80 focus:bg-white"
                    placeholder="أدخل كلمة المرور"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input id="remember-me-desktop" name="remember-me" type="checkbox" className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                  <label htmlFor="remember-me-desktop" className="mr-2 block text-sm text-gray-700">
                    تذكرني
                  </label>
                </div>
                <a href="#" className="text-sm text-blue-600 hover:text-blue-500 transition-colors">
                  نسيت كلمة المرور؟
                </a>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    جاري تسجيل الدخول...
                  </div>
                ) : (
                  'تسجيل الدخول'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600 mb-2">
                نظام إدارة شامل لكلية الشرق للعلوم التقنية التخصصية
              </p>
              <div className="flex items-center justify-center space-x-2 space-x-reverse">
                <span className="text-xs text-gray-500">Powered by</span>
                <span className="text-xs font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  SHAU
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== موبايل فقط — هوية بصرية بدون مساحات فارغة ===================== */}
      <div
        className="md:hidden min-h-dvh flex flex-col relative overflow-hidden"
        dir="rtl"
        style={{
          background: `linear-gradient(165deg, ${BRAND} 0%, #14967a 42%, #0f766e 78%, #0b5c52 100%)`,
        }}
      >
        {/* زخارف هادئة */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-16 -top-16 w-52 h-52 rounded-full bg-white/10" />
          <div className="absolute -right-10 top-28 w-36 h-36 rounded-full bg-white/5" />
          <div className="absolute left-8 bottom-[42%] w-20 h-20 rounded-full border border-white/10" />
        </div>

        {/* رأس الهوية */}
        <div className="relative z-10 px-6 pt-[max(1.75rem,env(safe-area-inset-top))] pb-5 text-center text-white shrink-0">
          <div className="w-[4.5rem] h-[4.5rem] mx-auto mb-3 rounded-2xl bg-white shadow-lg shadow-black/15 flex items-center justify-center overflow-hidden ring-2 ring-white/35">
            <Image
              src="/wasl.png"
              alt="شعار كلية الشرق"
              width={72}
              height={72}
              className="w-full h-full object-contain p-1.5"
              priority
              onError={(e) => {
                e.currentTarget.src = '/logos/college-logo.png';
              }}
            />
          </div>
          <p className="text-[11px] text-white/75 tracking-wide mb-1">مرحباً بك</p>
          <h1 className="text-xl font-bold leading-6">كلية الشرق</h1>
          <p className="text-white/80 text-xs mt-1 leading-5">للعلوم التقنية التخصصية</p>
          <div className="mt-3 mx-auto w-12 h-0.5 rounded-full bg-white/45" />
        </div>

        {/* لوحة النموذج تملأ باقي الشاشة */}
        <div className="relative z-10 flex-1 flex flex-col min-h-0 bg-white rounded-t-[1.75rem] px-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-800">تسجيل الدخول</h2>
            <p className="text-xs text-slate-500 mt-1 leading-5">
              أدخل بياناتك للوصول إلى أنظمة الكلية
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
            <div className="space-y-3.5">
              <div>
                <label htmlFor="username-mobile" className="block text-sm font-medium text-slate-700 mb-1.5">
                  اسم المستخدم
                </label>
                <input
                  type="text"
                  id="username-mobile"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  autoComplete="username"
                  inputMode="text"
                  className="w-full px-4 py-3 text-base min-h-12 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1EA886]/40 focus:border-[#1EA886] transition"
                  placeholder="أدخل اسم المستخدم"
                  required
                />
              </div>

              <div>
                <label htmlFor="password-mobile" className="block text-sm font-medium text-slate-700 mb-1.5">
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password-mobile"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pl-12 text-base min-h-12 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1EA886]/40 focus:border-[#1EA886] transition"
                    placeholder="أدخل كلمة المرور"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 min-w-11 min-h-11 flex items-center justify-center text-slate-400"
                  >
                    {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-0.5">
                <div className="flex items-center">
                  <input
                    id="remember-me-mobile"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    style={{ accentColor: BRAND }}
                  />
                  <label htmlFor="remember-me-mobile" className="mr-2 block text-sm text-slate-600 select-none">
                    تذكرني
                  </label>
                </div>
                <a href="#" className="text-sm font-medium whitespace-nowrap py-1" style={{ color: BRAND }}>
                  نسيت كلمة المرور؟
                </a>
              </div>
            </div>

            <div className="mt-auto pt-6 space-y-4">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-12 rounded-xl text-[15px] font-semibold text-white shadow-md active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${BRAND} 0%, #0f766e 100%)`,
                  boxShadow: `0 8px 20px ${BRAND}40`,
                }}
              >
                {isLoading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    جاري تسجيل الدخول...
                  </span>
                ) : (
                  'تسجيل الدخول'
                )}
              </button>

              <p className="text-center text-[11px] text-slate-400 leading-5 px-2">
                نظام إدارة كلية الشرق للعلوم التقنية التخصصية
              </p>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
