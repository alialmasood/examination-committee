'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BanknotesIcon,
  Bars3Icon,
  BeakerIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type DeptFinance = {
  id: string;
  name: string;
  students: number;
  morning: number;
  evening: number;
  collected_amount: number;
  debt_amount: number;
  expected_annual_total: number;
  total_discount_amount?: number;
  discounts_count?: number;
};

type StageFinance = {
  stage: string;
  label: string;
  students: number;
  collected_amount: number;
  debt_amount: number;
  expected_annual_total: number;
};

type AccountsSummary = {
  generated_at: string;
  total_students: number;
  departments_count: number;
  departments_with_students: number;
  morning: number;
  evening: number;
  collected_amount: number;
  debt_amount: number;
  collection_rate_percent: number;
  fully_paid_count: number;
  partial_paid_count: number;
  unpaid_count: number;
  receipts_count: number;
  settlements_paid_amount: number;
  discounts_count: number;
  channel_discount_amount: number;
  settlement_discount_amount: number;
  total_discount_amount: number;
  discount_impact_percent: number;
  annual_base_total: number;
  expected_annual_total: number;
  expected_four_years_total: number;
  expected_four_years_base_total: number;
  by_stage: StageFinance[];
  top_departments: DeptFinance[];
  least_departments: DeptFinance[];
  top_debt_departments: DeptFinance[];
  top_discount_departments: DeptFinance[];
  departments: DeptFinance[];
};

const MENU_ITEMS = [
  {
    id: 'students',
    label: 'شؤون الطلبة والتسجيل',
    href: '/dean/students',
    icon: UserGroupIcon,
    active: false,
  },
  {
    id: 'accounts',
    label: 'الحسابات',
    href: '/dean/accounts',
    icon: BanknotesIcon,
    active: true,
  },
  {
    id: 'exam',
    label: 'اللجنة الامتحانية',
    href: '/dean?tab=exam',
    icon: ClipboardDocumentCheckIcon,
    active: false,
  },
  {
    id: 'anesthesia',
    label: 'قسم تقنيات التخدير',
    href: '/dean?tab=anesthesia',
    icon: BeakerIcon,
    active: false,
  },
] as const;

const num = (v: number) => Math.round(v || 0).toLocaleString('en-US');
const money = (v: number) => `${num(v)} د.ع`;
const percent = (v: number) => `${Number(v || 0).toFixed(1)}%`;

export default function DeanAccountsPage() {
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<AccountsSummary | null>(null);

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
        if (window.matchMedia('(min-width: 768px)').matches) {
          window.location.replace('/dean');
          return;
        }
        if (!cancelled) setChecking(false);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dean/accounts', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'تعذر تحميل إحصائيات الحسابات');
      }
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات الحسابات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking) loadData();
  }, [checking, loadData]);

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

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      <header className="bg-gradient-to-l from-blue-900 via-indigo-900 to-blue-900 text-white shadow-lg sticky top-0 z-30 md:hidden">
        <div className="px-3 py-2.5 min-h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 border border-white/20 shrink-0"
              aria-label="فتح القائمة"
              aria-expanded={menuOpen}
            >
              <Bars3Icon className="w-6 h-6" />
            </button>

            <div className="w-9 h-9 bg-white rounded-full border border-white/30 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
              <Image
                src="/wasl.png"
                alt="شعار كلية الشرق"
                width={36}
                height={36}
                className="w-full h-full object-contain p-0.5"
                priority
              />
            </div>

            <h1 className="text-[15px] font-bold truncate leading-5">الحسابات</h1>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = '/dean';
            }}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 border border-white/20 shrink-0"
            aria-label="رجوع"
          >
            <ArrowRightIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

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
            {MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    window.location.href = item.href;
                  }}
                  className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3.5 text-sm font-medium transition-colors text-right ${
                    item.active
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      item.active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.active && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 p-4 text-xs text-slate-400">
            كلية الشرق للعلوم التقنية التخصصية
          </div>
        </aside>
      </div>

      <main className="px-3.5 py-4 space-y-4 md:hidden pb-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={loadData} className="underline shrink-0">
              إعادة
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20 text-slate-500 gap-3">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            جاري تحميل إحصائيات الحسابات...
          </div>
        ) : data ? (
          <>
            {/* نظرة عامة */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <UserGroupIcon className="w-4 h-4 text-blue-700" />
                <h2 className="text-sm font-bold text-slate-800">نظرة عامة</h2>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">إجمالي الطلبة</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{num(data.total_students)}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    صباحي {num(data.morning)} · مسائي {num(data.evening)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">الأقسام النشطة</p>
                  <p className="text-2xl font-bold text-indigo-700 tabular-nums">
                    {num(data.departments_with_students)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">من أصل {num(data.departments_count)}</p>
                </div>
              </div>
            </section>

            {/* الملخص المالي */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <BanknotesIcon className="w-4 h-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-800">الملخص المالي</h2>
              </div>
              <div className="space-y-2.5">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">المبالغ المحصلة</p>
                  <p className="text-xl font-bold text-emerald-600 tabular-nums">
                    {money(data.collected_amount)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">الديون المتبقية</p>
                  <p className="text-xl font-bold text-rose-600 tabular-nums">{money(data.debt_amount)}</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">المتوقع السنوي</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">
                    {money(data.expected_annual_total)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">أساس الرسوم السنوي</p>
                  <p className="text-lg font-bold text-slate-800 tabular-nums">
                    {money(data.annual_base_total)}
                  </p>
                </div>
              </div>
            </section>

            {/* أداء التحصيل */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <ChartBarIcon className="w-4 h-4 text-blue-700" />
                <h2 className="text-sm font-bold text-slate-800">أداء التحصيل</h2>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-700">نسبة التحصيل</p>
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      data.collection_rate_percent >= 70
                        ? 'text-emerald-700'
                        : data.collection_rate_percent >= 40
                          ? 'text-amber-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {percent(data.collection_rate_percent)}
                  </p>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-l from-blue-600 to-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, data.collection_rate_percent)}%` }}
                  ></div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3.5 text-center">
                  <div className="bg-emerald-50 rounded-lg py-2.5 border border-emerald-100">
                    <p className="text-base font-bold text-emerald-700 tabular-nums">
                      {num(data.fully_paid_count)}
                    </p>
                    <p className="text-[10px] text-emerald-600 mt-0.5">مسدد بالكامل</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg py-2.5 border border-amber-100">
                    <p className="text-base font-bold text-amber-700 tabular-nums">
                      {num(data.partial_paid_count)}
                    </p>
                    <p className="text-[10px] text-amber-600 mt-0.5">تسديد جزئي</p>
                  </div>
                  <div className="bg-rose-50 rounded-lg py-2.5 border border-rose-100">
                    <p className="text-base font-bold text-rose-700 tabular-nums">
                      {num(data.unpaid_count)}
                    </p>
                    <p className="text-[10px] text-rose-600 mt-0.5">غير مسدد</p>
                  </div>
                </div>
              </div>
            </section>

            {/* الوصولات والتخفيضات */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <ClipboardDocumentCheckIcon className="w-4 h-4 text-violet-700" />
                <h2 className="text-sm font-bold text-slate-800">الوصولات والتخفيضات</h2>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">عدد الوصولات</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{num(data.receipts_count)}</p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">مدفوعات التسوية</p>
                  <p className="text-sm font-bold text-emerald-700 tabular-nums">
                    {money(data.settlements_paid_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">طلبة لديهم تخفيض</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{num(data.discounts_count)}</p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">خصم القنوات</p>
                  <p className="text-sm font-bold text-indigo-700 tabular-nums">
                    {money(data.channel_discount_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">خصم التسوية</p>
                  <p className="text-sm font-bold text-indigo-700 tabular-nums">
                    {money(data.settlement_discount_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-700">إجمالي التخفيضات</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      أثر التخفيض {percent(data.discount_impact_percent)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-violet-700 tabular-nums">
                    {money(data.total_discount_amount)}
                  </p>
                </div>
              </div>
            </section>

            {/* الأقساط المتوقعة */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <AcademicCapIcon className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-bold text-slate-800">الأقساط المتوقعة</h2>
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">متوقع 4 سنوات</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {money(data.expected_four_years_total)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
                  <p className="text-[11px] text-slate-500 mb-1">أساس 4 سنوات</p>
                  <p className="text-lg font-bold text-slate-800 tabular-nums">
                    {money(data.expected_four_years_base_total)}
                  </p>
                </div>
              </div>
            </section>

            {/* حسب المرحلة */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <AcademicCapIcon className="w-4 h-4 text-indigo-700" />
                <h2 className="text-sm font-bold text-slate-800">حسب المرحلة الدراسية</h2>
              </div>
              <div className="space-y-2">
                {data.by_stage.map((stage) => (
                  <article
                    key={stage.stage}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <h3 className="text-sm font-semibold text-slate-800">{stage.label}</h3>
                      <span className="text-xs text-slate-500 tabular-nums">{num(stage.students)} طالب</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-emerald-50 rounded-lg py-2 border border-emerald-100">
                        <p className="text-[10px] text-emerald-600 mb-0.5">محصل</p>
                        <p className="text-xs font-bold text-emerald-700 tabular-nums leading-4">
                          {money(stage.collected_amount)}
                        </p>
                      </div>
                      <div className="bg-rose-50 rounded-lg py-2 border border-rose-100">
                        <p className="text-[10px] text-rose-600 mb-0.5">دين</p>
                        <p className="text-xs font-bold text-rose-700 tabular-nums leading-4">
                          {money(stage.debt_amount)}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-lg py-2 border border-slate-100">
                        <p className="text-[10px] text-slate-500 mb-0.5">متوقع</p>
                        <p className="text-xs font-bold text-slate-800 tabular-nums leading-4">
                          {money(stage.expected_annual_total)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* أعلى الأقسام تحصيلاً */}
            <DeptList
              title="أعلى الأقسام تحصيلاً"
              items={data.top_departments}
              accent="emerald"
              valueKey="collected_amount"
            />

            <DeptList
              title="أعلى الأقسام مديونية"
              items={data.top_debt_departments}
              accent="rose"
              valueKey="debt_amount"
            />

            <DeptList
              title="أقل الأقسام مالياً"
              items={data.least_departments}
              accent="slate"
              valueKey="expected_annual_total"
            />

            {/* كل الأقسام */}
            <section>
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <BanknotesIcon className="w-4 h-4 text-blue-700" />
                <h2 className="text-sm font-bold text-slate-800">الأقسام الأكاديمية</h2>
              </div>
              <div className="space-y-2">
                {data.departments.map((dept) => (
                  <article
                    key={dept.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    <div className="px-3.5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-800 leading-5">{dept.name}</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {num(dept.students)} طالب · صباحي {num(dept.morning)} · مسائي {num(dept.evening)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-100">
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">محصل</p>
                        <p className="text-xs font-bold text-emerald-700 tabular-nums leading-4">
                          {money(dept.collected_amount)}
                        </p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">دين</p>
                        <p className="text-xs font-bold text-rose-700 tabular-nums leading-4">
                          {money(dept.debt_amount)}
                        </p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">متوقع</p>
                        <p className="text-xs font-bold text-slate-800 tabular-nums leading-4">
                          {money(dept.expected_annual_total)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
                {data.departments.length === 0 && (
                  <p className="text-center text-slate-400 text-sm py-8">لا توجد بيانات أقسام</p>
                )}
              </div>
            </section>

            <p className="text-center text-[11px] text-slate-400 pt-1">
              آخر تحديث: {new Date(data.generated_at).toLocaleString('ar-IQ')}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

function DeptList({
  title,
  items,
  accent,
  valueKey,
}: {
  title: string;
  items: DeptFinance[];
  accent: 'emerald' | 'rose' | 'slate';
  valueKey: 'collected_amount' | 'debt_amount' | 'expected_annual_total';
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'rose'
        ? 'text-rose-700'
        : 'text-slate-800';

  if (!items?.length) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <ChartBarIcon className="w-4 h-4 text-slate-700" />
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        {items.map((dept, index) => (
          <div key={`${title}-${dept.id}`} className="px-3.5 py-3 flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">{dept.name}</p>
              <p className="text-[11px] text-slate-400">{num(dept.students)} طالب</p>
            </div>
            <p className={`text-xs font-bold tabular-nums shrink-0 ${valueClass}`}>
              {money(dept[valueKey])}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
