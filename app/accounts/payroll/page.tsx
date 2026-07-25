'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import PayrollNav from './PayrollNav';
import { API, errMsg, fetchJson } from './_lib';
import type { PayrollDashboardStats } from '@/src/lib/accounts/payroll-dashboard';

function formatMoney(v: string | number) {
  return Number(v || 0).toLocaleString('en-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatNum(v: number) {
  return Number(v || 0).toLocaleString('en-IQ');
}

function MetricCard({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: 'default' | 'accent' | 'success' | 'warn';
}) {
  const toneCls =
    tone === 'accent'
      ? 'border-red-900/30 bg-red-950 text-white'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : tone === 'warn'
          ? 'border-amber-200 bg-amber-50 text-amber-950'
          : 'border-gray-200 bg-white text-gray-900';
  const labelCls = tone === 'accent' ? 'text-red-100' : 'text-gray-500';
  const hintCls = tone === 'accent' ? 'text-red-200' : 'text-gray-500';
  const inner = (
    <>
      <div className={`text-xs font-semibold ${labelCls}`}>{label}</div>
      <div className="mt-1.5 text-xl font-bold tracking-tight" dir="ltr">
        {value}
      </div>
      {hint && <div className={`mt-1 text-[11px] ${hintCls}`}>{hint}</div>}
    </>
  );
  const cls = `rounded-lg border p-3.5 shadow-sm ${toneCls}`;
  return href ? (
    <Link href={href} className={`${cls} transition hover:ring-2 hover:ring-red-300`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function PayrollDashboard() {
  const [stats, setStats] = useState<PayrollDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const r = await fetchJson(API.dashboard);
    if (!r.__ok) {
      setError(errMsg(r));
      setStats(null);
      setLoading(false);
      return;
    }
    setStats(r.data as PayrollDashboardStats);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!stats) return [];
    return stats.monthly_trend.map((m) => ({
      name: m.month_label,
      إجمالي: Number(m.total || 0),
      مصروف: Number(m.disbursed_total || 0),
    }));
  }, [stats]);

  return (
    <main dir="rtl" className="w-full p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">الرواتب — لوحة التحكم</h1>
          {stats?.fiscal_year && (
            <p className="text-sm text-gray-600">
              السنة المالية: {stats.fiscal_year.code} — {stats.fiscal_year.name_ar}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        >
          تحديث
        </button>
      </div>
      <PayrollNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-gray-500">جاري تحميل الإحصائيات…</div>
      ) : !stats ? null : (
        <div className="space-y-5">
          {/* أعداد الكادر */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-red-950">أعداد الكادر والتكليفات</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <MetricCard
                label="التدريسيون"
                value={formatNum(stats.people_counts.TEACHING_STAFF)}
                hint="نشط"
                href="/accounts/payroll/teaching-staff"
              />
              <MetricCard
                label="المحاضرون"
                value={formatNum(stats.people_counts.EXTERNAL_LECTURER)}
                hint="نشط"
                href="/accounts/payroll/lecturers"
              />
              <MetricCard
                label="الموظفون"
                value={formatNum(stats.people_counts.EMPLOYEE)}
                hint="نشط"
                href="/accounts/payroll/admin-staff"
              />
              <MetricCard
                label="الأجور اليومية"
                value={formatNum(stats.people_counts.DAILY_WORKER)}
                hint="نشط"
                href="/accounts/payroll/daily-wages"
              />
              <MetricCard
                label="التكليفات النشطة"
                value={formatNum(stats.active_assignments)}
                href="/accounts/payroll/assignments"
                tone="accent"
              />
            </div>
          </section>

          {/* مؤشرات الصرف */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-red-950">مؤشرات الصرف</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                label="أشهر تم صرف رواتبها"
                value={formatNum(stats.disbursed_months_count)}
                hint="كشوف بحالة مصروف"
              />
              <MetricCard
                label="إجمالي المصروف حتى الآن"
                value={formatMoney(stats.lifetime_disbursed_total)}
                tone="success"
              />
              <MetricCard
                label="مبلغ رواتب السنة الحالية"
                value={formatMoney(stats.year_disbursed_total)}
                hint={stats.fiscal_year?.code || '—'}
              />
              <MetricCard
                label="متوسط راتب آخر شهر"
                value={stats.last_month ? formatMoney(stats.last_month.avg_salary) : '—'}
                hint={
                  stats.last_month
                    ? `${stats.last_month.people_with_salary} شخصاً في ${stats.last_month.month_label}`
                    : 'لا توجد بيانات'
                }
              />
            </div>
          </section>

          {/* حالات الكشوف */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-red-950">حالة كشوف السنة الحالية</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="مسودة" value={formatNum(stats.sheet_status_counts.DRAFT)} />
              <MetricCard label="محفوظ" value={formatNum(stats.sheet_status_counts.SAVED)} />
              <MetricCard
                label="مقفل"
                value={formatNum(stats.sheet_status_counts.LOCKED)}
                tone="warn"
              />
              <MetricCard
                label="مصروف"
                value={formatNum(stats.sheet_status_counts.DISBURSED)}
                tone="success"
              />
            </div>
          </section>

          {/* آخر شهر */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-red-950">
                رواتب آخر شهر
                {stats.last_month ? ` — ${stats.last_month.month_label}` : ''}
              </h2>
              {stats.last_month && stats.fiscal_year && (
                <Link
                  href={`/accounts/payroll/disbursement/month-report?fiscal_year_id=${encodeURIComponent(
                    stats.fiscal_year.id
                  )}&month_number=${stats.last_month.month_number}`}
                  className="rounded-md border border-red-900 bg-red-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900"
                >
                  تقرير الشهر ←
                </Link>
              )}
            </div>

            {!stats.last_month ? (
              <p className="text-sm text-gray-500">لا توجد كشوف رواتب بعد لهذه السنة.</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-end gap-4">
                  <div>
                    <div className="text-xs text-gray-500">إجمالي الشهر</div>
                    <div className="text-2xl font-bold text-gray-900" dir="ltr">
                      {formatMoney(stats.last_month.grand_total)}
                    </div>
                  </div>
                  {stats.last_month.vs_previous.direction !== 'no_previous' && (
                    <div
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        stats.last_month.vs_previous.direction === 'higher'
                          ? 'bg-emerald-100 text-emerald-900'
                          : stats.last_month.vs_previous.direction === 'lower'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {stats.last_month.vs_previous.direction === 'equal'
                        ? `مطابق لشهر ${stats.last_month.vs_previous.previous_month_label}`
                        : `${
                            stats.last_month.vs_previous.direction === 'higher' ? 'أعلى' : 'أقل'
                          } من ${stats.last_month.vs_previous.previous_month_label} بمبلغ ${formatMoney(
                            Math.abs(Number(stats.last_month.vs_previous.diff))
                          )}`}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {stats.last_month.by_category.map((cat) => (
                    <div
                      key={cat.person_category}
                      className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5"
                    >
                      <div className="text-xs font-semibold text-red-950">{cat.category_label}</div>
                      <div className="mt-1 text-lg font-bold text-gray-900" dir="ltr">
                        {formatMoney(cat.total)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">{cat.people_count} اسماً</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* أعلى وأقل راتب */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-red-950">
              أعلى وأقل راتب
              {stats.last_month ? ` — ${stats.last_month.month_label}` : ''}
            </h2>
            {!stats.salary_extremes ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
                لا توجد رواتب مدخلة لحساب الأعلى والأقل
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-emerald-800">أعلى راتب</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-950" dir="ltr">
                    {formatMoney(stats.salary_extremes.max)}
                  </div>
                  <div className="mt-2 text-sm text-emerald-900">
                    عدد الحاصلين على أعلى راتب:{' '}
                    <span className="font-bold">{formatNum(stats.salary_extremes.max_count)}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <div className="text-xs font-semibold text-amber-800">أقل راتب</div>
                  <div className="mt-1 text-2xl font-bold text-amber-950" dir="ltr">
                    {formatMoney(stats.salary_extremes.min)}
                  </div>
                  <div className="mt-2 text-sm text-amber-900">
                    عدد الحاصلين على أقل راتب:{' '}
                    <span className="font-bold">{formatNum(stats.salary_extremes.min_count)}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* الرسم البياني */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-bold text-red-950">مسار الرواتب عبر أشهر السنة</h2>
            <p className="mb-3 text-xs text-gray-500">
              الإجمالي = كل الكشوف المدخلة — المصروف = الكشوف بحالة مصروف فقط
            </p>
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="payrollTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#450a0a" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#450a0a" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="payrollDisbursed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#047857" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#047857" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      Number(v).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
                    }
                  />
                  <Tooltip
                    formatter={(value) => formatMoney(Number(value ?? 0))}
                    contentStyle={{ fontSize: 12, direction: 'rtl' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="إجمالي"
                    stroke="#450a0a"
                    fill="url(#payrollTotal)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="مصروف"
                    stroke="#047857"
                    fill="url(#payrollDisbursed)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* روابط سريعة */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-red-950">روابط سريعة</h2>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/accounts/payroll/disbursement"
                className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900"
              >
                صرف الرواتب
              </Link>
              {stats.fiscal_year && (
                <Link
                  href={`/accounts/payroll/disbursement/report?fiscal_year_id=${encodeURIComponent(
                    stats.fiscal_year.id
                  )}`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  تقرير كشوفات السنة
                </Link>
              )}
              <Link
                href="/accounts/payroll/assignments"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                التكليفات
              </Link>
              <Link
                href="/accounts/payroll/teaching-staff"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                الكادر التدريسي
              </Link>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
