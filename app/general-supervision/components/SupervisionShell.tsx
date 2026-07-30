'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowRightStartOnRectangleIcon,
  BanknotesIcon,
  Bars3Icon,
  HomeIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import '../supervision-motion.css';

/** لون الهوية البصرية للكلية — لاستخدام واجهة الموبايل فقط */
export const SUPERVISION_BRAND = '#1EA886';

type NavItem = {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  match: (path: string) => boolean;
};

const NAV_ITEMS: Array<NavItem & { description: string }> = [
  {
    href: '/general-supervision',
    label: 'لوحة التحكم',
    description: 'نظرة شاملة ورسوم بيانية',
    icon: HomeIcon,
    match: (path) => path === '/general-supervision' || path === '/general-supervision/',
  },
  {
    href: '/general-supervision/students',
    label: 'الطلبة',
    description: 'الأعداد · المراحل · القنوات',
    icon: UserGroupIcon,
    match: (path) => path.startsWith('/general-supervision/students'),
  },
  {
    href: '/general-supervision/accounts',
    label: 'الحسابات',
    description: 'التحصيل · الديون · التخفيضات',
    icon: BanknotesIcon,
    match: (path) => path.startsWith('/general-supervision/accounts'),
  },
];

type Props = {
  title: string;
  children: ReactNode;
};

/**
 * غلاف موبايل للوحة الإشراف العامة.
 * شاشات اللابتوب (lg فما فوق) تبقى برسالة بسيطة دون بناء واجهة ديسكتوب.
 */
export default function SupervisionShell({ title, children }: Props) {
  const pathname = usePathname() || '/general-supervision';
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullName, setFullName] = useState('لوحة إشراف عامة');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success || !json.is_general_supervision) {
          window.location.href = '/';
          return;
        }
        if (!cancelled) {
          if (json.user?.full_name) setFullName(json.user.full_name);
          setChecking(false);
        }
      } catch {
        window.location.href = '/';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    };
  };

  if (checking) {
    return (
      <>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center lg:hidden">
          <div className="flex items-center gap-2.5 text-sm text-slate-500">
            <span
              className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `${SUPERVISION_BRAND} transparent ${SUPERVISION_BRAND} ${SUPERVISION_BRAND}` }}
            />
            جاري التحقق...
          </div>
        </div>
        <div className="hidden min-h-screen lg:flex items-center justify-center bg-slate-50">
          <p className="text-sm text-slate-500">جاري التحقق...</p>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ——— موبايل فقط ——— */}
      <div
        className="min-h-screen text-slate-900 lg:hidden"
        dir="rtl"
        style={{ backgroundColor: '#f4faf8' }}
      >
        <header
          className="sticky top-0 z-30 bg-white/92 backdrop-blur-md sup-enter-fade"
          style={{
            boxShadow: '0 1px 0 rgba(30, 168, 134, 0.12), 0 4px 16px rgba(15, 118, 110, 0.04)',
          }}
        >
          <div className="flex items-center justify-between gap-2.5 px-3 py-2 min-h-14">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition active:scale-[0.97]"
                style={{ backgroundColor: `${SUPERVISION_BRAND}12` }}
                aria-label="فتح القائمة"
                aria-expanded={menuOpen}
              >
                <Bars3Icon className="w-6 h-6" style={{ color: SUPERVISION_BRAND }} strokeWidth={2.2} />
              </button>

              <div
                className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden"
                style={{ boxShadow: `0 0 0 1.5px ${SUPERVISION_BRAND}28` }}
              >
                <Image
                  src="/wasl.png"
                  alt="شعار كلية الشرق"
                  width={32}
                  height={32}
                  className="w-full h-full object-contain p-0.5"
                  priority
                />
              </div>

              <div className="min-w-0 flex items-center gap-2">
                <span
                  className="w-1 h-4 rounded-full shrink-0"
                  style={{ backgroundColor: SUPERVISION_BRAND }}
                />
                <h1 className="text-[14px] font-bold text-slate-800 truncate leading-none">
                  {title}
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 text-slate-400 transition hover:text-slate-600"
              style={{ backgroundColor: '#f8fafc' }}
              aria-label="تسجيل الخروج"
            >
              <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
            </button>
          </div>
          <div
            className="h-px w-full"
            style={{
              background: `linear-gradient(90deg, ${SUPERVISION_BRAND}55, ${SUPERVISION_BRAND}12 55%, transparent)`,
            }}
          />
        </header>

        {/* القائمة الجانبية القابلة للطي — خلفية الهوية · تبويبات بيضاء */}
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-300 ${
            menuOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
          aria-hidden={!menuOpen}
        >
          <button
            type="button"
            className={`absolute inset-0 bg-slate-950/55 backdrop-blur-[3px] transition-opacity duration-300 ${
              menuOpen ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={() => setMenuOpen(false)}
            aria-label="إغلاق القائمة"
          />
          <aside
            className={`absolute top-0 right-0 h-full w-[min(100%,20.5rem)] flex flex-col overflow-hidden text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              menuOpen ? 'translate-x-0 sup-drawer-open' : 'translate-x-full'
            }`}
            style={{
              background: `linear-gradient(165deg, ${SUPERVISION_BRAND} 0%, #14967a 38%, #0f766e 72%, #0b5c52 100%)`,
              boxShadow: menuOpen ? '-16px 0 48px rgba(15, 118, 110, 0.35)' : undefined,
            }}
          >
            {/* زخارف الخلفية */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div className="absolute -left-16 -top-20 w-56 h-56 rounded-full bg-white/10" />
              <div className="absolute -right-12 top-40 w-40 h-40 rounded-full bg-white/5" />
              <div className="absolute left-10 bottom-24 w-24 h-24 rounded-full border border-white/10" />
              <div className="absolute right-6 bottom-8 w-32 h-32 rounded-full bg-black/5" />
            </div>

            {/* الرأس */}
            <div className="relative px-4 pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-lg shadow-black/15 flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-white/40">
                    <Image
                      src="/wasl.png"
                      alt="شعار كلية الشرق"
                      width={48}
                      height={48}
                      className="w-full h-full object-contain p-1"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-white/70 tracking-wide">كلية الشرق</p>
                    <p className="font-bold text-[15px] truncate leading-5 mt-0.5">
                      لوحة إشراف عامة
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0 active:scale-95 transition"
                  aria-label="إغلاق"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {/* بطاقة المستخدم */}
              <div className="mt-4 rounded-2xl bg-white/12 border border-white/20 backdrop-blur-sm px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white text-sm font-bold flex items-center justify-center shrink-0"
                    style={{ color: SUPERVISION_BRAND }}
                  >
                    {fullName.trim().charAt(0) || 'إ'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{fullName}</p>
                    <p className="text-[11px] text-white/70 mt-0.5">مشرف عام · جلسة نشطة</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.85)] shrink-0" />
                </div>
              </div>
            </div>

            {/* التبويبات البيضاء */}
            <nav className="relative flex-1 overflow-y-auto px-3.5 py-2">
              <p className="px-1.5 mb-2.5 text-[10px] font-semibold tracking-wide text-white/55">
                القائمة الرئيسية
              </p>
              <div className="space-y-2.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={`sup-drawer-item group relative w-full flex items-center gap-3 rounded-2xl px-3 py-3.5 transition-all duration-200 ${
                        active
                          ? 'bg-white shadow-lg shadow-black/15'
                          : 'bg-white/14 border border-white/20 hover:bg-white/22'
                      }`}
                      style={active ? { color: SUPERVISION_BRAND } : undefined}
                    >
                      <span
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition ${
                          active
                            ? 'text-white'
                            : 'bg-white/15 text-white'
                        }`}
                        style={
                          active
                            ? {
                                background: `linear-gradient(135deg, ${SUPERVISION_BRAND}, #0f766e)`,
                              }
                            : undefined
                        }
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="flex-1 min-w-0 text-right">
                        <span
                          className={`block text-sm font-semibold leading-5 ${
                            active ? '' : 'text-white'
                          }`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`block text-[11px] mt-0.5 truncate ${
                            active ? 'text-teal-700/70' : 'text-white/65'
                          }`}
                        >
                          {item.description}
                        </span>
                      </span>
                      <ArrowLeftIcon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'opacity-70' : 'text-white/55'
                        }`}
                      />
                      {active && (
                        <span
                          className="absolute inset-y-2 left-0 w-1 rounded-full"
                          style={{ backgroundColor: SUPERVISION_BRAND }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </nav>

            {/* التذييل */}
            <div className="relative px-3.5 pb-5 pt-3">
              <div className="rounded-2xl bg-white/12 border border-white/20 px-3.5 py-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden">
                    <Image
                      src="/wasl.png"
                      alt=""
                      width={22}
                      height={22}
                      className="object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white leading-4 truncate">
                      كلية الشرق للعلوم التقنية
                    </p>
                    <p className="text-[10px] text-white/60 mt-0.5">التخصصية</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold bg-white active:scale-[0.98] transition"
                  style={{ color: SUPERVISION_BRAND }}
                >
                  <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
                  تسجيل الخروج
                </button>
              </div>
            </div>
          </aside>
        </div>

        <main className="px-4 py-5 space-y-4">
          <div key={pathname} className="sup-enter sup-d1">
            {children}
          </div>
        </main>
      </div>

      {/* ——— شاشة كبيرة: بدون واجهة ديسكتوب ——— */}
      <div className="hidden min-h-screen lg:flex flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
        <h1 className="text-xl font-semibold text-slate-800">لوحة إشراف عامة</h1>
        <p className="max-w-md text-sm text-slate-500">
          هذه اللوحة مُعدّة حالياً لعرض الموبايل. افتحها من الهاتف.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
        >
          تسجيل الخروج
        </button>
      </div>
    </>
  );
}
