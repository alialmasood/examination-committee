'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BanknotesIcon,
  ChartBarIcon,
  UserGroupIcon,
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
import SupervisionShell, { SUPERVISION_BRAND } from './components/SupervisionShell';

type OverviewData = {
  generated_at: string;
  students: {
    academic_year: string;
    total: number;
    total_all_years: number;
    morning: number;
    evening: number;
    stages: Array<{ key: string; label: string; count: number }>;
    channels: Array<{ key: string; label: string; count: number }>;
  };
  finance: {
    total_students: number;
    collected_amount: number;
    debt_amount: number;
    collection_rate_percent: number;
    fully_paid_count: number;
    partial_paid_count: number;
    unpaid_count: number;
    receipts_count: number;
    total_discount_amount: number;
    discounts_count: number;
    expected_annual_total: number;
    expected_four_years_total: number;
    best_paying_departments: Array<{
      id: string;
      name: string;
      students: number;
      collected_amount: number;
      debt_amount: number;
      collection_rate_percent: number;
    }>;
    top_debt_departments: Array<{
      id: string;
      name: string;
      debt_amount: number;
      collection_rate_percent: number;
    }>;
  };
};

const BRAND = SUPERVISION_BRAND;
const COLORS = {
  paid: '#10b981',
  partial: '#f59e0b',
  unpaid: '#f43f5e',
  morning: '#d97706',
  evening: '#6366f1',
  stage: ['#1EA886', '#14967a', '#0f766e', '#115e59'],
  channel: ['#1EA886', '#2bb897', '#3ec4a5', '#5dceb3', '#7dd8c1', '#9ee2cf'],
};

const num = (v: number) => Math.round(v || 0).toLocaleString('en-US');
const moneyShort = (v: number) => {
  const n = Math.round(v || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} مليار`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} مليون`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} ألف`;
  return num(n);
};
const money = (v: number) => `${num(v)} د.ع`;
const percent = (v: number) => `${Number(v || 0).toFixed(1)}%`;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; payload?: { label?: string; name?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md text-[11px]">
      <p className="font-semibold text-slate-800">
        {label || row.payload?.label || row.payload?.name || row.name}
      </p>
      <p className="tabular-nums mt-0.5" style={{ color: BRAND }}>
        {num(Number(row.value || 0))}
      </p>
    </div>
  );
}

export default function GeneralSupervisionPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<OverviewData | null>(null);
  const [academicYears, setAcademicYears] = useState<string[]>(['2025-2026']);
  const [academicYear, setAcademicYear] = useState('2025-2026');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/academic-years');
        const json = await res.json();
        if (json.success && json.data?.length) {
          setAcademicYears(json.data);
          setAcademicYear(json.data[0]);
        }
      } catch {
        /* keep default */
      }
    })();
  }, []);

  const loadData = useCallback(async () => {
    if (!academicYear) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/general-supervision/overview?academic_year=${encodeURIComponent(academicYear)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'تعذر تحميل لوحة التحكم');
      }
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل لوحة التحكم');
    } finally {
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const paymentChart = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'مسدد', value: data.finance.fully_paid_count, color: COLORS.paid },
      { name: 'جزئي', value: data.finance.partial_paid_count, color: COLORS.partial },
      { name: 'غير مسدد', value: data.finance.unpaid_count, color: COLORS.unpaid },
    ].filter((x) => x.value > 0);
  }, [data]);

  const studyTypeChart = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'صباحي', value: data.students.morning, color: COLORS.morning },
      { name: 'مسائي', value: data.students.evening, color: COLORS.evening },
    ];
  }, [data]);

  const stagesChart = useMemo(() => {
    if (!data) return [];
    return data.students.stages.map((s) => ({
      label: s.label,
      count: s.count,
    }));
  }, [data]);

  const deptsChart = useMemo(() => {
    if (!data) return [];
    return data.finance.best_paying_departments.map((d) => ({
      name: d.name.length > 14 ? `${d.name.slice(0, 13)}…` : d.name,
      fullName: d.name,
      rate: d.collection_rate_percent,
    }));
  }, [data]);

  const channelsChart = useMemo(() => {
    if (!data) return [];
    return data.students.channels.map((c) => ({
      label: c.label,
      count: c.count,
    }));
  }, [data]);

  return (
    <SupervisionShell title="لوحة التحكم">
      <div className="space-y-4 pb-3">
        {/* ترحيب + عام دراسي */}
        <section
          className="rounded-2xl p-4 text-white shadow-sm relative overflow-hidden sup-enter-scale"
          style={{
            background: `linear-gradient(135deg, ${BRAND} 0%, #0f766e 55%, #115e59 100%)`,
          }}
        >
          <div className="absolute -left-8 -top-10 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -right-6 -bottom-10 w-28 h-28 rounded-full bg-white/5" />
          <div className="relative">
            <p className="text-white/80 text-[11px] mb-1">لوحة إشراف عامة</p>
            <h2 className="text-lg font-bold leading-6">نظرة شاملة على الكلية</h2>
            <p className="text-white/75 text-xs mt-1.5 leading-5">
              ملخص حي لشؤون الطلبة والحسابات في شاشة واحدة
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                disabled={loading}
                className="flex-1 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-semibold px-3 py-2 focus:outline-none disabled:opacity-60"
              >
                {academicYears.map((y) => (
                  <option key={y} value={y} className="text-slate-800">
                    {y}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={loadData}
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
            <button type="button" onClick={loadData} className="underline shrink-0">
              إعادة
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-3 text-sm">
            <span
              className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `${BRAND} transparent ${BRAND} ${BRAND}` }}
            />
            جاري تجهيز لوحة التحكم...
          </div>
        ) : data ? (
          <>
            {/* بطاقات KPI */}
            <section className="grid grid-cols-2 gap-2.5 sup-enter sup-d1">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-slate-500">إجمالي الطلبة · {data.students.academic_year}</p>
                    <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: BRAND }}>
                      {num(data.students.total)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      إجمالي المسجلين · جميع الأعوام: {num(data.students.total_all_years)}
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
                <p className="text-[11px] text-slate-500 mb-1">المحصّل</p>
                <p className="text-base font-bold text-emerald-600 tabular-nums leading-5">
                  {moneyShort(data.finance.collected_amount)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">د.ع</p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500 mb-1">الديون</p>
                <p className="text-base font-bold text-rose-600 tabular-nums leading-5">
                  {moneyShort(data.finance.debt_amount)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">د.ع</p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500 mb-1">نسبة التحصيل</p>
                <p
                  className={`text-xl font-bold tabular-nums ${
                    data.finance.collection_rate_percent >= 70
                      ? 'text-emerald-600'
                      : data.finance.collection_rate_percent >= 40
                        ? 'text-amber-600'
                        : 'text-rose-600'
                  }`}
                >
                  {percent(data.finance.collection_rate_percent)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500 mb-1">المتوقع السنوي</p>
                <p className="text-base font-bold tabular-nums leading-5" style={{ color: BRAND }}>
                  {moneyShort(data.finance.expected_annual_total)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">د.ع</p>
              </div>
            </section>

            {/* شريط التحصيل */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sup-enter-scale sup-d2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ChartBarIcon className="w-4 h-4" style={{ color: BRAND }} />
                  <h3 className="text-sm font-bold text-slate-800">أداء التحصيل</h3>
                </div>
                <span className="text-xs font-bold tabular-nums" style={{ color: BRAND }}>
                  {percent(data.finance.collection_rate_percent)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, data.finance.collection_rate_percent)}%`,
                    background: `linear-gradient(90deg, ${BRAND}, #34d399)`,
                  }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3.5 text-center">
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-2">
                  <p className="text-sm font-bold text-emerald-700 tabular-nums">
                    {num(data.finance.fully_paid_count)}
                  </p>
                  <p className="text-[10px] text-emerald-600">مسدد</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 py-2">
                  <p className="text-sm font-bold text-amber-700 tabular-nums">
                    {num(data.finance.partial_paid_count)}
                  </p>
                  <p className="text-[10px] text-amber-600">جزئي</p>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 py-2">
                  <p className="text-sm font-bold text-rose-700 tabular-nums">
                    {num(data.finance.unpaid_count)}
                  </p>
                  <p className="text-[10px] text-rose-600">غير مسدد</p>
                </div>
              </div>
            </section>

            {/* رسم توزيع السداد + نوع الدراسة */}
            <section className="grid grid-cols-1 gap-2.5 sup-enter sup-d3">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 mb-1">توزيع حالة السداد</h3>
                <p className="text-[11px] text-slate-400 mb-2">نسب الطلبة حسب التسديد</p>
                <div className="h-44 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentChart}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={68}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {paymentChart.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-slate-400">الطلبة</p>
                    <p className="text-lg font-bold text-slate-800 tabular-nums">
                      {num(data.finance.total_students)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-1">
                  {paymentChart.map((item) => (
                    <div key={item.name} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name} ({num(item.value)})
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 mb-1">صباحي / مسائي</h3>
                <p className="text-[11px] text-slate-400 mb-2">توزيع نوع الدراسة للعام المحدد</p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={studyTypeChart}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={62}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {studyTypeChart.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="rounded-xl bg-amber-50 border border-amber-100 py-2 text-center">
                    <p className="text-sm font-bold text-amber-700 tabular-nums">
                      {num(data.students.morning)}
                    </p>
                    <p className="text-[10px] text-amber-600">صباحي</p>
                  </div>
                  <div className="rounded-xl bg-indigo-50 border border-indigo-100 py-2 text-center">
                    <p className="text-sm font-bold text-indigo-700 tabular-nums">
                      {num(data.students.evening)}
                    </p>
                    <p className="text-[10px] text-indigo-600">مسائي</p>
                  </div>
                </div>
              </div>
            </section>

            {/* أعمدة المراحل */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter sup-d4">
              <h3 className="text-sm font-bold text-slate-800 mb-1">الطلبة حسب المرحلة</h3>
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
            </section>

            {/* أفضل الأقسام تحصيلاً */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter">
              <h3 className="text-sm font-bold text-slate-800 mb-1">الأقسام الأفضل تحصيلاً</h3>
              <p className="text-[11px] text-slate-400 mb-2">نسبة التحصيل حسب القسم</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={deptsChart}
                    layout="vertical"
                    margin={{ top: 0, right: 12, left: 4, bottom: 0 }}
                  >
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      unit="%"
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={88}
                      tick={{ fontSize: 10, fill: '#475569' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => [`${Number(value || 0).toFixed(1)}%`, 'التحصيل']}
                      labelFormatter={(_, payload) =>
                        String(payload?.[0]?.payload?.fullName || '')
                      }
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        fontSize: 11,
                      }}
                    />
                    <Bar dataKey="rate" name="التحصيل" radius={[0, 6, 6, 0]} fill={BRAND} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* قنوات القبول */}
            {channelsChart.length > 0 && (
              <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm sup-enter">
                <h3 className="text-sm font-bold text-slate-800 mb-1">أبرز قنوات القبول</h3>
                <p className="text-[11px] text-slate-400 mb-2">أعلى القنوات عدداً هذا العام</p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelsChart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={48}
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
              </section>
            )}

            {/* مؤشرات إضافية */}
            <section className="grid grid-cols-2 gap-2.5 sup-enter">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500">الوصولات</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                  {num(data.finance.receipts_count)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
                <p className="text-[11px] text-slate-500">إجمالي التخفيضات</p>
                <p className="text-sm font-bold text-violet-700 tabular-nums mt-1 leading-5">
                  {moneyShort(data.finance.total_discount_amount)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {num(data.finance.discounts_count)} طالب
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm col-span-2">
                <p className="text-[11px] text-slate-500">المتوقع خلال 4 سنوات</p>
                <p className="text-lg font-bold tabular-nums mt-1" style={{ color: BRAND }}>
                  {money(data.finance.expected_four_years_total)}
                </p>
              </div>
            </section>

            {/* روابط سريعة */}
            <section className="grid grid-cols-2 gap-2.5 sup-enter">
              <Link
                href="/general-supervision/students"
                className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex items-center justify-between gap-2 active:scale-[0.98] transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${BRAND}18`, color: BRAND }}
                  >
                    <UserGroupIcon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">الطلبة</p>
                    <p className="text-[10px] text-slate-400">التفاصيل الكاملة</p>
                  </div>
                </div>
                <ArrowLeftIcon className="w-4 h-4 text-slate-400 shrink-0" />
              </Link>
              <Link
                href="/general-supervision/accounts"
                className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex items-center justify-between gap-2 active:scale-[0.98] transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${BRAND}18`, color: BRAND }}
                  >
                    <BanknotesIcon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">الحسابات</p>
                    <p className="text-[10px] text-slate-400">التفاصيل المالية</p>
                  </div>
                </div>
                <ArrowLeftIcon className="w-4 h-4 text-slate-400 shrink-0" />
              </Link>
            </section>

            {/* أعلى مديونية مختصر */}
            {data.finance.top_debt_departments.length > 0 && (
              <section className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden divide-y divide-slate-100 sup-enter">
                <div className="px-3.5 py-3 flex items-center gap-2">
                  <BanknotesIcon className="w-4 h-4 text-rose-600" />
                  <h3 className="text-sm font-bold text-slate-800">أعلى الأقسام مديونية</h3>
                </div>
                {data.finance.top_debt_departments.map((d, i) => (
                  <div key={d.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-rose-50 text-rose-600 text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <p className="text-sm text-slate-700 truncate">{d.name}</p>
                    </div>
                    <p className="text-xs font-bold text-rose-600 tabular-nums shrink-0">
                      {moneyShort(d.debt_amount)}
                    </p>
                  </div>
                ))}
              </section>
            )}

            <p className="text-center text-[10px] text-slate-400 pt-1">
              آخر تحديث: {new Date(data.generated_at).toLocaleString('ar-IQ')}
            </p>
          </>
        ) : null}
      </div>
    </SupervisionShell>
  );
}
