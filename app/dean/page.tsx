'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  BanknotesIcon,
  Bars3Icon,
  BeakerIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type Overview = {
  generated_at: string;
  students: {
    total: number;
    active: number;
    first_year: number;
    morning: number;
    evening: number;
    new_last_7_days: number;
    new_last_30_days: number;
  };
  finance: {
    collected_amount: number;
    expected_annual_total: number;
    debt_amount: number;
    collection_rate_percent: number;
    fully_paid_count: number;
    partial_paid_count: number;
    unpaid_count: number;
  };
  departments: Array<{
    name: string;
    students: number;
    morning: number;
    evening: number;
    collected: number;
    debt: number;
  }>;
  academic_statuses: Array<{ status: string; count: number }>;
  latest_students: Array<{
    id: string;
    student_name: string;
    major: string;
    study_type: string | null;
    admission_type: string | null;
    created_at: string | null;
  }>;
};

type MobileTab = 'students' | 'accounts' | 'exam' | 'anesthesia';

const MOBILE_TABS: Array<{
  id: MobileTab;
  label: string;
  icon: typeof UserGroupIcon;
}> = [
  { id: 'students', label: 'شؤون الطلبة والتسجيل', icon: UserGroupIcon },
  { id: 'accounts', label: 'الحسابات', icon: BanknotesIcon },
  { id: 'exam', label: 'اللجنة الامتحانية', icon: ClipboardDocumentCheckIcon },
  { id: 'anesthesia', label: 'قسم تقنيات التخدير', icon: BeakerIcon },
];

const num = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number) => `${num(v)} د.ع`;

const ADMISSION_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isAnesthesiaDept(name: string): boolean {
  const n = name.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  return n.includes('تخدير');
}

export default function DeanDashboardPage() {
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTab>('exam');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    // الحسابات وشؤون الطلبة لهما صفحتان مستقلتان على الموبايل
    if (tab === 'accounts') {
      window.location.replace('/dean/accounts');
      return;
    }
    if (tab === 'students') {
      window.location.replace('/dean/students');
      return;
    }
    if (tab === 'exam' || tab === 'anesthesia') {
      setActiveTab(tab);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dean/overview', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'تعذر تحميل البيانات');
      }
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success || !json.is_dean) {
          window.location.href = '/';
          return;
        }
        if (!cancelled) {
          setChecking(false);
          loadOverview();
        }
      } catch {
        window.location.href = '/';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

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
    }
  };

  const selectTab = (tab: MobileTab) => {
    // تبويبات لها صفحات مستقلة على الموبايل فقط
    if (tab === 'students') {
      window.location.href = '/dean/students';
      return;
    }
    if (tab === 'accounts') {
      window.location.href = '/dean/accounts';
      return;
    }
    setActiveTab(tab);
    setMenuOpen(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          جاري التحقق من الصلاحية...
        </div>
      </div>
    );
  }

  const s = data?.students;
  const f = data?.finance;
  const activeTabMeta = MOBILE_TABS.find((t) => t.id === activeTab)!;
  const ActiveTabIcon = activeTabMeta.icon;
  const anesthesiaDept = data?.departments.find((d) => isAnesthesiaDept(d.name));
  const anesthesiaStudents =
    data?.latest_students.filter((st) => isAnesthesiaDept(st.major)) || [];

  const studentsSection = s && (
    <section>
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <UserGroupIcon className="w-5 h-5 text-blue-700" />
        <h2 className="text-base sm:text-lg font-bold text-slate-800">شؤون الطلبة والتسجيل</h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">إجمالي الطلبة</p>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900">{num(s.total)}</p>
          <p className="text-xs text-slate-400 mt-1">
            صباحي {num(s.morning)} · مسائي {num(s.evening)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">الطلبة المستمرون</p>
          <p className="text-2xl sm:text-3xl font-bold text-emerald-600">{num(s.active)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {s.total > 0 ? Math.round((s.active / s.total) * 100) : 0}% من الإجمالي
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">طلبة المرحلة الأولى</p>
          <p className="text-2xl sm:text-3xl font-bold text-blue-600">{num(s.first_year)}</p>
          <p className="text-xs text-slate-400 mt-1">القبول الجديد</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">تسجيلات آخر 30 يوماً</p>
          <p className="text-2xl sm:text-3xl font-bold text-indigo-600">{num(s.new_last_30_days)}</p>
          <p className="text-xs text-slate-400 mt-1">آخر 7 أيام: {num(s.new_last_7_days)}</p>
        </div>
      </div>
    </section>
  );

  const accountsSection = f && (
    <section>
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <BanknotesIcon className="w-5 h-5 text-emerald-700" />
        <h2 className="text-base sm:text-lg font-bold text-slate-800">حسابات الطلبة</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">المبالغ المحصلة</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-600">{money(f.collected_amount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">الديون المتبقية</p>
          <p className="text-xl sm:text-2xl font-bold text-red-600">{money(f.debt_amount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <p className="text-slate-500 text-xs sm:text-sm mb-1">المتوقع السنوي</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900">{money(f.expected_annual_total)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 mt-3 sm:mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <ChartBarIcon className="w-4 h-4 text-blue-600" />
            نسبة التحصيل
          </p>
          <p className="text-sm font-bold text-blue-700">{f.collection_rate_percent}%</p>
        </div>
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-l from-blue-600 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, f.collection_rate_percent)}%` }}
          ></div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="bg-emerald-50 rounded-lg py-2">
            <p className="text-base sm:text-lg font-bold text-emerald-700">{num(f.fully_paid_count)}</p>
            <p className="text-[11px] sm:text-xs text-emerald-600">مسدد بالكامل</p>
          </div>
          <div className="bg-amber-50 rounded-lg py-2">
            <p className="text-base sm:text-lg font-bold text-amber-700">{num(f.partial_paid_count)}</p>
            <p className="text-[11px] sm:text-xs text-amber-600">تسديد جزئي</p>
          </div>
          <div className="bg-red-50 rounded-lg py-2">
            <p className="text-base sm:text-lg font-bold text-red-700">{num(f.unpaid_count)}</p>
            <p className="text-[11px] sm:text-xs text-red-600">غير مسدد</p>
          </div>
        </div>
      </div>
    </section>
  );

  const departmentsSection = data && s && (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
      <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <AcademicCapIcon className="w-5 h-5 text-indigo-700" />
          <h3 className="font-bold text-slate-800 text-sm sm:text-base">الأقسام العلمية</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-right font-medium px-4 sm:px-5 py-2.5">القسم</th>
                <th className="text-center font-medium px-3 py-2.5">الطلبة</th>
                <th className="text-center font-medium px-3 py-2.5 hidden sm:table-cell">صباحي</th>
                <th className="text-center font-medium px-3 py-2.5 hidden sm:table-cell">مسائي</th>
                <th className="text-center font-medium px-3 py-2.5">المحصل</th>
                <th className="text-center font-medium px-3 py-2.5">الدين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.departments.map((d) => (
                <tr key={d.name} className="hover:bg-slate-50/70">
                  <td className="px-4 sm:px-5 py-2.5 font-medium text-slate-800">{d.name}</td>
                  <td className="text-center px-3 py-2.5 text-slate-700">{num(d.students)}</td>
                  <td className="text-center px-3 py-2.5 text-slate-500 hidden sm:table-cell">{num(d.morning)}</td>
                  <td className="text-center px-3 py-2.5 text-slate-500 hidden sm:table-cell">{num(d.evening)}</td>
                  <td className="text-center px-3 py-2.5 text-emerald-700 whitespace-nowrap">{money(d.collected)}</td>
                  <td className="text-center px-3 py-2.5 text-red-600 whitespace-nowrap">{money(d.debt)}</td>
                </tr>
              ))}
              {data.departments.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-8">
                    لا توجد بيانات أقسام بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <UserGroupIcon className="w-5 h-5 text-blue-700" />
          <h3 className="font-bold text-slate-800 text-sm sm:text-base">الحالات الأكاديمية</h3>
        </div>
        <div className="p-4 sm:p-5 space-y-3 max-h-[420px] overflow-y-auto">
          {data.academic_statuses.map((item) => {
            const percent = s.total > 0 ? Math.round((item.count / s.total) * 100) : 0;
            return (
              <div key={item.status}>
                <div className="flex items-center justify-between text-xs sm:text-sm mb-1">
                  <span className="text-slate-700">{item.status}</span>
                  <span className="text-slate-500 font-medium">
                    {num(item.count)} ({percent}%)
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.status === 'مستمر' ? 'bg-emerald-500' : 'bg-blue-400'}`}
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
          {data.academic_statuses.length === 0 && (
            <p className="text-center text-slate-400 py-8 text-sm">لا توجد بيانات</p>
          )}
        </div>
      </div>
    </section>
  );

  const latestSection = data && (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <UserPlusIcon className="w-5 h-5 text-emerald-700" />
        <h3 className="font-bold text-slate-800 text-sm sm:text-base">آخر الطلبة المسجلين</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {data.latest_students.map((st) => (
          <div key={st.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-800 text-sm truncate">{st.student_name}</p>
              <p className="text-xs text-slate-500 truncate">
                {st.major}
                {st.admission_type && ADMISSION_LABELS[st.admission_type]
                  ? ` · ${ADMISSION_LABELS[st.admission_type]}`
                  : ''}
              </p>
            </div>
            <span className="text-xs text-slate-400 shrink-0">{formatDate(st.created_at)}</span>
          </div>
        ))}
        {data.latest_students.length === 0 && (
          <p className="text-center text-slate-400 py-8 text-sm">لا توجد تسجيلات حديثة</p>
        )}
      </div>
    </section>
  );

  const examSection = (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardDocumentCheckIcon className="w-5 h-5 text-violet-700" />
        <h2 className="text-base font-bold text-slate-800">اللجنة الامتحانية</h2>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
          <ClipboardDocumentCheckIcon className="w-7 h-7 text-violet-600" />
        </div>
        <p className="font-semibold text-slate-800 mb-1">مراقبة اللجنة الامتحانية</p>
        <p className="text-sm text-slate-500 leading-6">
          سيتم عرض مؤشرات الامتحانات والجداول والنتائج هنا لاحقاً ضمن لوحة مراقبة العميد.
        </p>
      </div>
    </section>
  );

  const anesthesiaSection = (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <BeakerIcon className="w-5 h-5 text-teal-700" />
        <h2 className="text-base font-bold text-slate-800">قسم تقنيات التخدير</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-slate-500 text-xs mb-1">عدد الطلبة</p>
          <p className="text-2xl font-bold text-slate-900">{num(anesthesiaDept?.students || 0)}</p>
          <p className="text-xs text-slate-400 mt-1">
            صباحي {num(anesthesiaDept?.morning || 0)} · مسائي {num(anesthesiaDept?.evening || 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-slate-500 text-xs mb-1">المبالغ المحصلة</p>
          <p className="text-lg font-bold text-emerald-600">{money(anesthesiaDept?.collected || 0)}</p>
          <p className="text-xs text-red-500 mt-1">دين: {money(anesthesiaDept?.debt || 0)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm">آخر طلبة القسم</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {anesthesiaStudents.length > 0 ? (
            anesthesiaStudents.map((st) => (
              <div key={st.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{st.student_name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {st.admission_type && ADMISSION_LABELS[st.admission_type]
                      ? ADMISSION_LABELS[st.admission_type]
                      : st.major}
                  </p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{formatDate(st.created_at)}</span>
              </div>
            ))
          ) : (
            <p className="text-center text-slate-400 py-8 text-sm">لا توجد تسجيلات حديثة لهذا القسم</p>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      {/* الترويسة */}
      <header className="bg-gradient-to-l from-blue-900 via-indigo-900 to-blue-900 text-white shadow-lg relative z-30 max-md:sticky max-md:top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-3 max-md:px-3 max-md:py-2.5 max-md:min-h-14">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {/* زر القائمة — موبايل فقط */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 transition-colors shrink-0"
              aria-label="فتح القائمة"
              aria-expanded={menuOpen}
            >
              <Bars3Icon className="w-6 h-6" />
            </button>

            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-white rounded-full border border-white/30 shadow-sm flex items-center justify-center shrink-0 overflow-hidden max-md:w-9 max-md:h-9">
              <Image
                src="/wasl.png"
                alt="شعار كلية الشرق"
                width={48}
                height={48}
                className="w-full h-full object-contain p-0.5"
                priority
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold truncate max-md:text-[15px] max-md:leading-5">
                لوحة مراقبة السيد العميد
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadOverview}
              disabled={loading}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50 max-md:w-9 max-md:h-9 max-md:p-0 max-md:justify-center"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">تحديث</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 bg-red-600/80 hover:bg-red-600 rounded-lg px-3 py-2 text-sm transition-colors max-md:w-9 max-md:h-9 max-md:p-0 max-md:justify-center"
            >
              <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
              <span className="hidden sm:inline">تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </header>

      {/* قائمة الموبايل القابلة للطي */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!menuOpen}
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/50"
          onClick={() => setMenuOpen(false)}
          aria-label="إغلاق القائمة"
        />
        <aside
          className={`absolute top-0 right-0 h-full w-[min(100%,20rem)] bg-white shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
            menuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="bg-gradient-to-l from-blue-900 via-indigo-900 to-blue-900 text-white px-4 py-4 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">قائمة المراقبة</p>
              <p className="text-blue-200 text-xs mt-0.5">اختر التبويب المطلوب</p>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center"
              aria-label="إغلاق"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {MOBILE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3.5 text-sm font-medium transition-colors text-right ${
                    active
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="flex-1">{tab.label}</span>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 p-4 text-xs text-slate-400">
            كلية الشرق للعلوم التقنية التخصصية
          </div>
        </aside>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={loadOverview} className="text-red-700 underline shrink-0">
              إعادة المحاولة
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            جاري تحميل بيانات المراقبة...
          </div>
        ) : data && s && f ? (
          <>
            {/* عنوان التبويب النشط — موبايل فقط */}
            <div className="md:hidden flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3.5 py-3 shadow-sm">
              <ActiveTabIcon className="w-5 h-5 text-blue-700 shrink-0" />
              <p className="font-bold text-slate-800 text-sm">{activeTabMeta.label}</p>
            </div>

            {/* محتوى الموبايل حسب التبويب */}
            <div className="md:hidden space-y-5">
              {activeTab === 'exam' && examSection}
              {activeTab === 'anesthesia' && anesthesiaSection}
            </div>

            {/* محتوى اللابتوب — كما هو بدون تغيير */}
            <div className="hidden md:block space-y-8">
              {studentsSection}
              {accountsSection}
              {departmentsSection}
              {latestSection}
            </div>

            <p className="text-center text-xs text-slate-400 flex items-center justify-center gap-1.5 pb-2">
              <ClockIcon className="w-3.5 h-3.5" />
              آخر تحديث للبيانات: {new Date(data.generated_at).toLocaleString('ar-IQ')}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
