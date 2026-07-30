'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  MoonIcon,
  SunIcon,
  UserGroupIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SupervisionShell, { SUPERVISION_BRAND } from '../components/SupervisionShell';

type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
};

type DepartmentStats = {
  id: string;
  name: string;
  total: number;
  years: StageCounts;
  studyTypes?: {
    morning: StageCounts;
    evening: StageCounts;
  };
};

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
  { key: 'general', name: 'القناة العامة', short: 'العامة' },
  { key: 'martyrs', name: 'قناة ذوي الشهداء', short: 'الشهداء' },
  { key: 'social_care', name: 'قناة الرعاية الاجتماعية', short: 'الرعاية' },
  { key: 'special_needs', name: 'قناة ذوي الهمم', short: 'الهمم' },
  { key: 'political_prisoners', name: 'قناة السجناء السياسيين', short: 'السجناء' },
  { key: 'top_students', name: 'تخفيض الاوائل', short: 'الأوائل' },
  { key: 'siblings_married', name: 'تخفيض الاخوة والمتزوجين', short: 'الإخوة' },
  { key: 'health_ministry', name: 'تخفيض موظفي وزارة الصحة', short: 'الصحة' },
  { key: 'minister_directive', name: 'تخفيض توجيهات معالي الوزير', short: 'الوزير' },
  { key: 'dean_approval', name: 'تخفيض موافقة السيد العميد', short: 'العميد' },
  { key: 'faculty_children', name: 'تخفيض ابناء الهيئة التدريسية', short: 'التدريسيين' },
];

const BRAND = SUPERVISION_BRAND;
const COLORS = {
  morning: '#d97706',
  evening: '#6366f1',
  stage: ['#1EA886', '#14967a', '#0f766e', '#115e59'],
  channel: ['#1EA886', '#2bb897', '#3ec4a5', '#5dceb3', '#7dd8c1', '#9ee2cf', '#0f766e', '#34d399', '#059669', '#047857', '#065f46'],
  dept: '#1EA886',
};

const num = (v: number) => Math.round(v || 0).toLocaleString('en-US');

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; payload?: { label?: string; name?: string; fullName?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md text-[11px]">
      <p className="font-semibold text-slate-800">
        {row.payload?.fullName || label || row.payload?.label || row.payload?.name || row.name}
      </p>
      <p className="tabular-nums mt-0.5" style={{ color: BRAND }}>
        {num(Number(row.value || 0))}
      </p>
    </div>
  );
}

export default function SupervisionStudentsPage() {
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [academicYears, setAcademicYears] = useState<string[]>(['2025-2026']);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalAllYears, setTotalAllYears] = useState(0);
  const [morning, setMorning] = useState(0);
  const [evening, setEvening] = useState(0);
  const [firstYear, setFirstYear] = useState(0);
  const [secondYear, setSecondYear] = useState(0);
  const [thirdYear, setThirdYear] = useState(0);
  const [fourthYear, setFourthYear] = useState(0);
  const [departmentsStats, setDepartmentsStats] = useState<DepartmentStats[]>([]);
  const [admissionChannelStats, setAdmissionChannelStats] = useState<Record<string, number>>({});
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  useEffect(() => {
    const fetchAcademicYears = async () => {
      try {
        const response = await fetch('/api/academic-years');
        const data = await response.json();
        if (data.success && data.data?.length > 0) {
          setAcademicYears(data.data);
          setAcademicYear(data.data[0]);
        }
      } catch (e) {
        console.error('خطأ في جلب الأعوام الدراسية:', e);
      } finally {
        setYearsLoading(false);
      }
    };
    fetchAcademicYears();
  }, []);

  const fetchStats = useCallback(async () => {
    if (!academicYear) return;
    setLoading(true);
    setError('');
    try {
      const [studentsResponse, departmentsResponse] = await Promise.all([
        fetch(`/api/students/stats?academic_year=${encodeURIComponent(academicYear)}`),
        fetch(`/api/departments/stats?academic_year=${encodeURIComponent(academicYear)}`),
      ]);
      const studentsData = await studentsResponse.json();
      const departmentsData = await departmentsResponse.json();

      if (studentsData.success && studentsData.data) {
        setTotalStudents(studentsData.data.total || 0);
        setTotalAllYears(studentsData.data.totalAllYears || 0);
        setMorning(studentsData.data.morning || 0);
        setEvening(studentsData.data.evening || 0);
        setFirstYear(studentsData.data.firstYear || 0);
        setSecondYear(studentsData.data.secondYear || 0);
        setAdmissionChannelStats(studentsData.data.admissionChannels || {});
      } else {
        throw new Error(studentsData.error || 'تعذر تحميل إحصائيات الطلبة');
      }

      if (departmentsData.success && departmentsData.data) {
        const depts = departmentsData.data as DepartmentStats[];
        setDepartmentsStats(depts);
        const third = depts.reduce((s, d) => s + (d.years?.third || 0), 0);
        const fourth = depts.reduce((s, d) => s + (d.years?.fourth || 0), 0);
        setThirdYear(third);
        setFourthYear(fourth);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات الطلبة');
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    if (yearsLoading) return;
    fetchStats();
  }, [yearsLoading, fetchStats]);

  const studyTypeChart = useMemo(
    () => [
      { name: 'صباحي', value: morning, color: COLORS.morning },
      { name: 'مسائي', value: evening, color: COLORS.evening },
    ].filter((x) => x.value > 0),
    [morning, evening]
  );

  const stagesChart = useMemo(
    () => [
      { label: 'أولى', count: firstYear },
      { label: 'ثانية', count: secondYear },
      { label: 'ثالثة', count: thirdYear },
      { label: 'رابعة', count: fourthYear },
    ],
    [firstYear, secondYear, thirdYear, fourthYear]
  );

  const topDeptsChart = useMemo(() => {
    return [...departmentsStats]
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map((d) => ({
        id: d.id,
        name: d.name,
        total: d.total,
      }));
  }, [departmentsStats]);

  const topDeptsMax = useMemo(
    () => Math.max(1, ...topDeptsChart.map((d) => d.total)),
    [topDeptsChart]
  );

  const channelsChart = useMemo(() => {
    return ADMISSION_CHANNELS.map((c) => ({
      key: c.key,
      label: c.short,
      fullName: c.name,
      count: admissionChannelStats[c.key] || 0,
    }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [admissionChannelStats]);

  const morningShare =
    totalStudents > 0 ? Math.round((morning / totalStudents) * 1000) / 10 : 0;
  const eveningShare =
    totalStudents > 0 ? Math.round((evening / totalStudents) * 1000) / 10 : 0;

  return (
    <SupervisionShell title="الطلبة">
      <div className="space-y-4 pb-3">
        {/* بطل الصفحة */}
        <section
          className="rounded-2xl p-4 text-white shadow-sm relative overflow-hidden sup-enter-scale"
          style={{
            background: `linear-gradient(135deg, ${BRAND} 0%, #0f766e 55%, #115e59 100%)`,
          }}
        >
          <div className="absolute -left-8 -top-10 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -right-6 -bottom-10 w-28 h-28 rounded-full bg-white/5" />
          <div className="relative">
            <p className="text-white/80 text-[11px] mb-1">شؤون الطلبة والتسجيل</p>
            <h2 className="text-lg font-bold leading-6">إحصائيات الطلبة</h2>
            <p className="text-white/75 text-xs mt-1.5 leading-5">
              توزيع المراحل والأقسام وقنوات القبول للعام الدراسي
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                disabled={yearsLoading || loading}
                className="flex-1 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-semibold px-3 py-2 focus:outline-none disabled:opacity-60"
              >
                {academicYears.map((year) => (
                  <option key={year} value={year} className="text-slate-800">
                    {year}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={fetchStats}
                disabled={loading}
                className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center disabled:opacity-50"
                aria-label="تحديث"
              >
                <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={fetchStats} className="underline shrink-0">
              إعادة
            </button>
          </div>
        )}

        {loading && totalStudents === 0 && !error ? (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3 text-sm">
            <span
              className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `${BRAND} transparent ${BRAND} ${BRAND}` }}
            />
            جاري تحميل إحصائيات الطلبة...
          </div>
        ) : (
          <>
            {/* KPI */}
            <section className="grid grid-cols-2 gap-2.5 sup-enter-scale">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-slate-500">العدد الكلي · {academicYear}</p>
                    <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: BRAND }}>
                      {loading ? '…' : num(totalStudents)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      كل السنوات: {loading ? '…' : num(totalAllYears)}
                    </p>
                  </div>
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ backgroundColor: `${BRAND}18`, color: BRAND }}
                  >
                    <UserGroupIcon className="w-6 h-6" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[11px] text-slate-500">صباحي</p>
                  <SunIcon className="w-4 h-4 text-amber-600" />
                </div>
                <p className="text-xl font-bold text-amber-700 tabular-nums">
                  {loading ? '…' : num(morning)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{morningShare}% من الإجمالي</p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[11px] text-slate-500">مسائي</p>
                  <MoonIcon className="w-4 h-4 text-indigo-600" />
                </div>
                <p className="text-xl font-bold text-indigo-700 tabular-nums">
                  {loading ? '…' : num(evening)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{eveningShare}% من الإجمالي</p>
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500 mb-1">المرحلة الأولى</p>
                <p className="text-xl font-bold tabular-nums" style={{ color: BRAND }}>
                  {loading ? '…' : num(firstYear)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500 mb-1">المرحلة الثانية</p>
                <p className="text-xl font-bold text-teal-700 tabular-nums">
                  {loading ? '…' : num(secondYear)}
                </p>
              </div>
            </section>

            {/* توزيع نوع الدراسة */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter-scale sup-d2">
              <div className="flex items-center gap-2 mb-1">
                <UserGroupIcon className="w-4 h-4" style={{ color: BRAND }} />
                <h3 className="text-sm font-bold text-slate-800">توزيع نوع الدراسة</h3>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">صباحي مقابل مسائي</p>
              <div className="h-40 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={studyTypeChart.length ? studyTypeChart : [{ name: 'لا بيانات', value: 1, color: '#e2e8f0' }]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={66}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {(studyTypeChart.length ? studyTypeChart : [{ name: 'لا بيانات', value: 1, color: '#e2e8f0' }]).map(
                        (entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        )
                      )}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] text-slate-400">الإجمالي</p>
                  <p className="text-lg font-bold text-slate-800 tabular-nums">
                    {loading ? '…' : num(totalStudents)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="rounded-xl bg-amber-50 border border-amber-100 py-2 text-center">
                  <p className="text-sm font-bold text-amber-700 tabular-nums">{num(morning)}</p>
                  <p className="text-[10px] text-amber-600">صباحي</p>
                </div>
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 py-2 text-center">
                  <p className="text-sm font-bold text-indigo-700 tabular-nums">{num(evening)}</p>
                  <p className="text-[10px] text-indigo-600">مسائي</p>
                </div>
              </div>
            </section>

            {/* المراحل */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter sup-d3">
              <div className="flex items-center gap-2 mb-1">
                <AcademicCapIcon className="w-4 h-4" style={{ color: BRAND }} />
                <h3 className="text-sm font-bold text-slate-800">الطلبة حسب المرحلة</h3>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">أعداد المسجلين لكل مرحلة</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stagesChart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: `${BRAND}10` }} />
                    <Bar dataKey="count" name="العدد" radius={[8, 8, 4, 4]}>
                      {stagesChart.map((_, i) => (
                        <Cell key={i} fill={COLORS.stage[i % COLORS.stage.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {stagesChart.map((s, i) => (
                  <div
                    key={s.label}
                    className="rounded-lg py-2 text-center"
                    style={{ backgroundColor: `${COLORS.stage[i]}14` }}
                  >
                    <p className="text-sm font-bold tabular-nums" style={{ color: COLORS.stage[i] }}>
                      {num(s.count)}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* أعلى الأقسام عدداً */}
            {topDeptsChart.length > 0 && (
              <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter">
                <div className="flex items-center gap-2 mb-1">
                  <AcademicCapIcon className="w-4 h-4" style={{ color: BRAND }} />
                  <h3 className="text-sm font-bold text-slate-800">أكثر الأقسام عدداً</h3>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">أعلى 6 أقسام بالمسجلين</p>
                <div className="space-y-3">
                  {topDeptsChart.map((dept, index) => {
                    const share = Math.round((dept.total / topDeptsMax) * 100);
                    return (
                      <div key={dept.id}>
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <div className="flex items-start gap-2 min-w-0">
                            <span
                              className="w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                              style={{
                                backgroundColor: `${BRAND}18`,
                                color: BRAND,
                              }}
                            >
                              {index + 1}
                            </span>
                            <p className="text-sm font-medium text-slate-800 leading-5">
                              {dept.name}
                            </p>
                          </div>
                          <span
                            className="text-sm font-bold tabular-nums shrink-0"
                            style={{ color: BRAND }}
                          >
                            {num(dept.total)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mr-7">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(4, share)}%`,
                              background: `linear-gradient(90deg, ${BRAND}, #0f766e)`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* قنوات — رسم + قائمة */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter">
              <div className="flex items-center gap-2 mb-1">
                <UserPlusIcon className="w-4 h-4" style={{ color: BRAND }} />
                <h3 className="text-sm font-bold text-slate-800">قنوات القبول</h3>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">توزيع الطلبة حسب قناة القبول</p>
              {channelsChart.length > 0 && (
                <div className="h-44 mb-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelsChart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        angle={-18}
                        textAnchor="end"
                        height={46}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: `${BRAND}10` }} />
                      <Bar dataKey="count" name="العدد" radius={[6, 6, 2, 2]}>
                        {channelsChart.map((_, i) => (
                          <Cell key={i} fill={COLORS.channel[i % COLORS.channel.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="rounded-xl border border-slate-100 overflow-hidden divide-y divide-slate-100">
                {ADMISSION_CHANNELS.map((channel) => {
                  const count = admissionChannelStats[channel.key] || 0;
                  const share =
                    totalStudents > 0 ? Math.round((count / totalStudents) * 1000) / 10 : 0;
                  return (
                    <div key={channel.key} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <p className="text-sm text-slate-700 font-medium leading-5">{channel.name}</p>
                        <span
                          className="min-w-[2.25rem] text-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums text-white"
                          style={{ backgroundColor: BRAND }}
                        >
                          {loading ? '…' : num(count)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, share)}%`,
                            backgroundColor: BRAND,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 tabular-nums">{share}%</p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* تفصيل الأقسام */}
            <section className="sup-enter">
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <AcademicCapIcon className="w-4 h-4" style={{ color: BRAND }} />
                <h2 className="text-sm font-bold text-slate-800">الأقسام حسب المراحل</h2>
              </div>
              <div className="space-y-2.5">
                {DEPARTMENTS.map((dept) => {
                  const stats = departmentsStats.find((s) => s.id === dept.id);
                  const open = expandedDept === dept.id;
                  const total = stats?.total || 0;
                  return (
                    <article
                      key={dept.id}
                      className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedDept(open ? null : dept.id)}
                        className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-right"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span
                            className="w-1.5 h-8 rounded-full shrink-0"
                            style={{ backgroundColor: BRAND }}
                          />
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-800 leading-5">
                              {dept.name}
                            </h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {open ? 'اضغط للإخفاء' : 'اضغط لعرض التفصيل'}
                            </p>
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <p className="text-lg font-bold tabular-nums leading-none" style={{ color: BRAND }}>
                            {loading ? '…' : num(total)}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">إجمالي</p>
                        </div>
                      </button>

                      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
                        {(
                          [
                            ['أولى', stats?.years?.first],
                            ['ثانية', stats?.years?.second],
                            ['ثالثة', stats?.years?.third],
                            ['رابعة', stats?.years?.fourth],
                          ] as const
                        ).map(([label, value]) => (
                          <div
                            key={`y-${dept.id}-${label}`}
                            className="rounded-lg py-2 text-center"
                            style={{ backgroundColor: `${BRAND}0d` }}
                          >
                            <p className="text-sm font-bold text-slate-800 tabular-nums">
                              {loading ? '…' : num(value || 0)}
                            </p>
                            <p className="text-[9px] text-slate-500 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>

                      {open && (
                        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-100 border-t border-slate-100">
                          <div className="p-3">
                            <p className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1">
                              <SunIcon className="w-3.5 h-3.5 text-amber-600" />
                              صباحي
                            </p>
                            <div className="grid grid-cols-4 gap-1 text-center">
                              {(
                                [
                                  ['1', stats?.studyTypes?.morning?.first],
                                  ['2', stats?.studyTypes?.morning?.second],
                                  ['3', stats?.studyTypes?.morning?.third],
                                  ['4', stats?.studyTypes?.morning?.fourth],
                                ] as const
                              ).map(([label, value]) => (
                                <div key={`m-${dept.id}-${label}`} className="bg-amber-50/70 rounded-md py-1.5">
                                  <p className="text-xs font-bold text-slate-800 tabular-nums">
                                    {loading ? '…' : num(value || 0)}
                                  </p>
                                  <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="p-3">
                            <p className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1">
                              <MoonIcon className="w-3.5 h-3.5 text-indigo-600" />
                              مسائي
                            </p>
                            <div className="grid grid-cols-4 gap-1 text-center">
                              {(
                                [
                                  ['1', stats?.studyTypes?.evening?.first],
                                  ['2', stats?.studyTypes?.evening?.second],
                                  ['3', stats?.studyTypes?.evening?.third],
                                  ['4', stats?.studyTypes?.evening?.fourth],
                                ] as const
                              ).map(([label, value]) => (
                                <div key={`e-${dept.id}-${label}`} className="bg-indigo-50/70 rounded-md py-1.5">
                                  <p className="text-xs font-bold text-slate-800 tabular-nums">
                                    {loading ? '…' : num(value || 0)}
                                  </p>
                                  <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </SupervisionShell>
  );
}
