'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  AcademicCapIcon,
  ArrowRightIcon,
  BanknotesIcon,
  Bars3Icon,
  BeakerIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ClipboardDocumentCheckIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type DepartmentStats = {
  id: string;
  name: string;
  total: number;
  years: { first: number; second: number; third: number; fourth: number };
  studyTypes?: {
    morning: { first: number; second: number; third: number; fourth: number };
    evening: { first: number; second: number; third: number; fourth: number };
  };
};

const MENU_ITEMS = [
  {
    id: 'students',
    label: 'شؤون الطلبة والتسجيل',
    href: '/dean/students',
    icon: UserGroupIcon,
    active: true,
  },
  {
    id: 'accounts',
    label: 'الحسابات',
    href: '/dean/accounts',
    icon: BanknotesIcon,
    active: false,
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

const DEPARTMENTS = [
  { id: 'anesthesia', name: 'تقنيات التخدير' },
  { id: 'radiology', name: 'تقنيات الأشعة' },
  { id: 'dental', name: 'تقنيات صناعة الأسنان' },
  { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات' },
  { id: 'oil-gas', name: 'تقنيات هندسة النفط والغاز' },
  { id: 'health-physics', name: 'تقنيات الفيزياء الصحية' },
  { id: 'optics', name: 'تقنيات البصريات' },
  { id: 'community-health', name: 'تقنيات صحة المجتمع' },
  { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ' },
  { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي' },
  { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية' },
  { id: 'law', name: 'القانون' },
];

const ADMISSION_CHANNELS = [
  { key: 'general', name: 'القناة العامة' },
  { key: 'martyrs', name: 'قناة ذوي الشهداء' },
  { key: 'social_care', name: 'قناة الرعاية الاجتماعية' },
  { key: 'special_needs', name: 'قناة ذوي الهمم' },
  { key: 'political_prisoners', name: 'قناة السجناء السياسيين' },
  { key: 'top_students', name: 'تخفيض الاوائل' },
  { key: 'siblings_married', name: 'تخفيض الاخوة والمتزوجين' },
  { key: 'health_ministry', name: 'تخفيض موظفي وزارة الصحة' },
  { key: 'minister_directive', name: 'تخفيض توجيهات معالي الوزير' },
  { key: 'dean_approval', name: 'تخفيض موافقة السيد العميد' },
  { key: 'faculty_children', name: 'تخفيض ابناء الهيئة التدريسية' },
];

const ACADEMIC_STATUSES = [
  { name: 'مستمر', color: 'emerald' },
  { name: 'مرقن بسبب الغياب', color: 'amber' },
  { name: 'مرقن بسبب عدم تسليم وثيقة الإعدادية', color: 'amber' },
  { name: 'مرقن بسبب الوفاة', color: 'rose' },
  { name: 'مرقن بسبب الرسوب سنتين', color: 'amber' },
  { name: 'مرقن بسبب الرسوب بمواد التحميل', color: 'amber' },
  { name: 'راسب بسبب الغياب', color: 'rose' },
  { name: 'راسب بسبب عقوبة انضباطية', color: 'rose' },
  { name: 'راسب بالمواد الدراسية', color: 'rose' },
  { name: 'محمل من المرحلة السابقة', color: 'yellow' },
  { name: 'مؤجّل', color: 'blue' },
  { name: 'حالات أخرى', color: 'slate' },
] as const;

const STATUS_STYLES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  rose: 'bg-rose-50 text-rose-800 border-rose-100',
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  blue: 'bg-blue-50 text-blue-800 border-blue-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

const num = (v: number) => v.toLocaleString('en-US');

export default function DeanStudentsPage() {
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [academicYears, setAcademicYears] = useState<string[]>(['2025-2026']);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [totalStudents, setTotalStudents] = useState(0);
  const [activeStudents, setActiveStudents] = useState(0);
  const [firstYearStudents, setFirstYearStudents] = useState(0);
  const [departmentsStats, setDepartmentsStats] = useState<DepartmentStats[]>([]);
  const [academicStatusStats, setAcademicStatusStats] = useState<Record<string, number>>({});
  const [admissionChannelStats, setAdmissionChannelStats] = useState<Record<string, number>>({});

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

  useEffect(() => {
    if (checking) return;
    const fetchAcademicYears = async () => {
      try {
        const response = await fetch('/api/academic-years');
        const data = await response.json();
        if (data.success && data.data?.length > 0) {
          setAcademicYears(data.data);
          setAcademicYear(data.data[0]);
        }
      } catch (error) {
        console.error('خطأ في جلب الأعوام الدراسية:', error);
      } finally {
        setYearsLoading(false);
      }
    };
    fetchAcademicYears();
  }, [checking]);

  const fetchStats = useCallback(async () => {
    if (!academicYear) return;
    setLoading(true);
    try {
      const [studentsResponse, departmentsResponse] = await Promise.all([
        fetch(`/api/students/stats?academic_year=${encodeURIComponent(academicYear)}`),
        fetch(`/api/departments/stats?academic_year=${encodeURIComponent(academicYear)}`),
      ]);
      const studentsData = await studentsResponse.json();
      const departmentsData = await departmentsResponse.json();

      if (studentsData.success && studentsData.data) {
        setTotalStudents(studentsData.data.total || 0);
        setActiveStudents(studentsData.data.active || 0);
        setFirstYearStudents(studentsData.data.firstYear || 0);
        setAcademicStatusStats(studentsData.data.academicStatuses || {});
        setAdmissionChannelStats(studentsData.data.admissionChannels || {});
      }
      if (departmentsData.success && departmentsData.data) {
        setDepartmentsStats(departmentsData.data);
      }
    } catch (error) {
      console.error('خطأ في جلب الإحصائيات:', error);
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    if (checking || yearsLoading) return;
    fetchStats();
  }, [checking, yearsLoading, fetchStats]);

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

  const activeRate = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 1000) / 10 : 0;

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

            <h1 className="text-[15px] font-bold truncate leading-5">شؤون الطلبة والتسجيل</h1>
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
        {/* العام الدراسي */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-3.5 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <CalendarDaysIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="dean-academic-year" className="block text-[11px] text-slate-500 mb-0.5">
              العام الدراسي
            </label>
            <select
              id="dean-academic-year"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              disabled={yearsLoading || loading}
              className="w-full text-sm font-semibold text-slate-800 bg-transparent border-0 p-0 focus:ring-0 focus:outline-none disabled:text-slate-400"
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* مؤشرات الطلبة */}
        <section>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <UserGroupIcon className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-800">إحصائيات الطلبة</h2>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <p className="text-[11px] text-slate-500 mb-1">إجمالي الطلبة</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {loading ? '…' : num(totalStudents)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">المسجلون للعام المحدد</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <p className="text-[11px] text-slate-500 mb-1">الطلبة النشطون</p>
              <p className="text-2xl font-bold text-emerald-600 tabular-nums">
                {loading ? '…' : num(activeStudents)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">{activeRate}% من الإجمالي</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <p className="text-[11px] text-slate-500 mb-1">الطلبة الجدد</p>
              <p className="text-2xl font-bold text-blue-600 tabular-nums">
                {loading ? '…' : num(firstYearStudents)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">المرحلة الأولى</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <p className="text-[11px] text-slate-500 mb-1">الطلبة المتخرجون</p>
              <p className="text-2xl font-bold text-violet-600 tabular-nums">0</p>
              <p className="text-[11px] text-slate-400 mt-1">لهذا العام</p>
            </div>
          </div>
        </section>

        {/* المعدلات */}
        <section>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <ChartBarIcon className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm font-bold text-slate-800">المعدلات الأكاديمية</h2>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <UserPlusIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">معدلات القبول</p>
                  <p className="text-[11px] text-slate-500">نسبة القبول للعام الحالي</p>
                </div>
              </div>
              <p className="text-lg font-bold text-blue-700 tabular-nums">69.5%</p>
            </div>
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckBadgeIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">معدلات النجاح</p>
                  <p className="text-[11px] text-slate-500">نسبة النجاح في الامتحانات</p>
                </div>
              </div>
              <p className="text-lg font-bold text-emerald-700 tabular-nums">92.3%</p>
            </div>
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center shrink-0">
                  <AcademicCapIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">معدلات التخرج</p>
                  <p className="text-[11px] text-slate-500">من إجمالي المسجلين</p>
                </div>
              </div>
              <p className="text-lg font-bold text-violet-700 tabular-nums">0%</p>
            </div>
          </div>
        </section>

        {/* الأقسام الأكاديمية */}
        <section>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <AcademicCapIcon className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm font-bold text-slate-800">الأقسام الأكاديمية</h2>
          </div>
          <div className="space-y-2.5">
            {DEPARTMENTS.map((dept) => {
              const stats = departmentsStats.find((s) => s.id === dept.id);
              return (
                <article
                  key={dept.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="px-3.5 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800 leading-5">{dept.name}</h3>
                    <div className="text-left shrink-0">
                      <p className="text-lg font-bold text-slate-900 tabular-nums leading-none">
                        {loading ? '…' : num(stats?.total || 0)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">إجمالي</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-100">
                    <div className="p-3">
                      <p className="text-[11px] font-semibold text-slate-500 mb-2">صباحي</p>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        {(
                          [
                            ['أولى', stats?.studyTypes?.morning?.first],
                            ['ثانية', stats?.studyTypes?.morning?.second],
                            ['ثالثة', stats?.studyTypes?.morning?.third],
                            ['رابعة', stats?.studyTypes?.morning?.fourth],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={`m-${label}`} className="bg-slate-50 rounded-md py-1.5">
                            <p className="text-xs font-bold text-slate-800 tabular-nums">
                              {loading ? '…' : num(value || 0)}
                            </p>
                            <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-[11px] font-semibold text-slate-500 mb-2">مسائي</p>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        {(
                          [
                            ['أولى', stats?.studyTypes?.evening?.first],
                            ['ثانية', stats?.studyTypes?.evening?.second],
                            ['ثالثة', stats?.studyTypes?.evening?.third],
                            ['رابعة', stats?.studyTypes?.evening?.fourth],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={`e-${label}`} className="bg-slate-50 rounded-md py-1.5">
                            <p className="text-xs font-bold text-slate-800 tabular-nums">
                              {loading ? '…' : num(value || 0)}
                            </p>
                            <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* قنوات القبول */}
        <section>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <UserPlusIcon className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-800">قنوات القبول</h2>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
            {ADMISSION_CHANNELS.map((channel) => {
              const count = admissionChannelStats[channel.key] || 0;
              return (
                <div
                  key={channel.key}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <p className="text-sm text-slate-700">{channel.name}</p>
                  <span className="min-w-8 h-7 px-2 rounded-full bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center tabular-nums">
                    {loading ? '…' : num(count)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* حالات الطالب */}
        <section>
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <ClipboardDocumentCheckIcon className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-800">حالات الطالب</h2>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {ACADEMIC_STATUSES.map((status) => {
              const count = academicStatusStats[status.name] || 0;
              const percent = totalStudents > 0 ? Math.round((count / totalStudents) * 1000) / 10 : 0;
              return (
                <div
                  key={status.name}
                  className={`rounded-xl border px-3.5 py-3 flex items-center justify-between gap-3 ${STATUS_STYLES[status.color]}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5">{status.name}</p>
                    <p className="text-[11px] opacity-70 mt-0.5">{percent}% من الإجمالي</p>
                  </div>
                  <p className="text-xl font-bold tabular-nums shrink-0">
                    {loading ? '…' : num(count)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
