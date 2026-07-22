'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AccountsDashboardStats } from '@/src/lib/accounts/accounts-dashboard';

type ApiOk = { success: true; stats: AccountsDashboardStats };
type ApiErr = { success: false; error?: string; message?: string };

const COLORS = {
  navy: '#16324f',
  crimson: '#a11d2d',
  teal: '#0f766e',
  amber: '#b45309',
  sky: '#0369a1',
  slate: '#475569',
  rose: '#be123c',
};

const PIE_COLORS = [COLORS.teal, COLORS.amber, COLORS.crimson, COLORS.sky, COLORS.slate];

function money(v: string | number | null | undefined) {
  const n = Number(v || 0);
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function num(v: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(v || 0));
}

function shortDept(name: string) {
  if (name.length <= 18) return name;
  return `${name.slice(0, 16)}…`;
}

export default function AccountsDashboard() {
  const [stats, setStats] = useState<AccountsDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounts/dashboard-stats', {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = (await res.json()) as ApiOk | ApiErr;
      if (!json.success) {
        setError(('error' in json && json.error) || json.message || 'تعذر تحميل اللوحة');
        setStats(null);
      } else {
        setStats(json.stats);
        setError(null);
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stageData = useMemo(
    () => (stats?.academic.by_stage || []).map((s) => ({ name: s.label, value: s.count })),
    [stats]
  );

  const deptData = useMemo(
    () =>
      (stats?.academic.by_department || []).map((d) => ({
        name: shortDept(d.name),
        full: d.name,
        value: d.count,
      })),
    [stats]
  );

  const tuitionPie = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'مسدد', value: stats.tuition.paid_count },
      { name: 'قيد الدفع', value: stats.tuition.unpaid_count },
      { name: 'بانتظار التسجيل', value: stats.tuition.registration_pending },
    ].filter((x) => x.value > 0);
  }, [stats]);

  const genderPie = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'ذكور', value: stats.academic.males },
      { name: 'إناث', value: stats.academic.females },
      { name: 'غير محدد', value: stats.academic.unknown_gender },
    ].filter((x) => x.value > 0);
  }, [stats]);

  const cashMonthly = useMemo(() => {
    if (!stats?.cash.monthly?.length) return [];
    return stats.cash.monthly.map((m) => ({
      month: m.month.slice(5),
      قبض: m.receipts,
      صرف: m.payments,
    }));
  }, [stats]);

  const journalPie = useMemo(() => {
    if (!stats) return [];
    const j = stats.overview.journal_entries;
    return [
      { name: 'مسودة', value: j.drafts },
      { name: 'مراجعة', value: j.pending_review },
      { name: 'معتمد', value: j.approved },
      { name: 'مرحّل', value: j.posted },
      { name: 'معكوس', value: j.reversed },
    ].filter((x) => x.value > 0);
  }, [stats]);

  const payrollBars = useMemo(() => {
    if (!stats) return [];
    const r = stats.payroll.runs;
    return [
      { name: 'مسودة', value: r.draft },
      { name: 'محسوب', value: r.calculated },
      { name: 'معتمد', value: r.approved },
      { name: 'مرحّل', value: r.posted },
      { name: 'ملغى', value: r.cancelled },
    ];
  }, [stats]);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-600" dir="rtl">
        جاري تحميل لوحة التحكم…
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="p-8 text-center space-y-3" dir="rtl">
        <p className="text-red-700">{error || 'لا توجد بيانات'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 rounded-lg bg-[#16324f] text-white text-sm"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const updated = new Date(stats.generated_at).toLocaleString('ar-IQ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      dir="rtl"
      className="min-h-full p-4 md:p-6 space-y-4 animate-[fadeIn_0.5s_ease]"
      style={{
        background:
          'radial-gradient(1200px 500px at 100% -10%, rgba(22,50,79,0.12), transparent 55%), radial-gradient(900px 420px at 0% 0%, rgba(161,29,45,0.08), transparent 50%), linear-gradient(165deg, #eef3f7 0%, #f5f1ea 48%, #eef6f4 100%)',
      }}
    >
      <header className="flex flex-wrap justify-between gap-4 rounded-2xl px-5 py-5 text-white shadow-xl bg-gradient-to-l from-[#7f1d1d]/40 via-[#1c4760] to-[#12263d]">
        <div>
          <p className="text-xs opacity-80 m-0">نظام الحسابات — كلية الشرق</p>
          <h1 className="text-xl md:text-2xl font-extrabold mt-1 mb-1">لوحة التحكم المالية</h1>
          <p className="text-sm opacity-85 m-0 max-w-xl">
            نظرة شاملة على الطلبة والأقساط والصناديق والرواتب والقيود المحاسبية
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-start justify-end">
          <span className="text-xs px-3 py-1.5 rounded-full bg-white/15 border border-white/20">
            السنة المالية: {stats.fiscal.default_year_code || '—'}
          </span>
          <span className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/15">
            فترات مفتوحة: {stats.fiscal.open_periods}
          </span>
          <span className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/15">
            آخر تحديث: {updated}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs px-3 py-1.5 rounded-lg bg-white text-[#16324f] font-semibold"
          >
            تحديث
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
        <Kpi
          label="إجمالي الطلبة"
          value={num(stats.academic.total_students)}
          hint={`${stats.academic.departments_count} قسماً`}
          border="#16324f"
          href="/accounts/installments"
        />
        <Kpi
          label="المقبوضات (أقساط)"
          value={`${money(stats.tuition.collected_amount)} IQD`}
          hint={`${num(stats.tuition.paid_count)} مسدد / ${num(stats.tuition.unpaid_count)} متبقي`}
          border="#0f766e"
          href="/accounts/installments"
        />
        <Kpi
          label="صافي حركة الصندوق"
          value={`${money(stats.cash.vouchers.net_movement)} IQD`}
          hint={`${stats.cash.boxes.active} صندوق · ${stats.cash.sessions.open} جلسة مفتوحة`}
          border="#b45309"
          href="/accounts/cashbox"
        />
        <Kpi
          label="ذمم الطلبة"
          value={`${money(stats.students.total_receivable_balance)} IQD`}
          hint={`${num(stats.students.overdue_installments)} قسط متأخر`}
          border="#a11d2d"
          href="/accounts/students/accounts"
        />
        <Kpi
          label="صافي الرواتب (آخر تشغيل)"
          value={
            stats.payroll.latest_calculated
              ? `${money(stats.payroll.latest_calculated.net_total)} IQD`
              : '—'
          }
          hint={`${num(stats.payroll.active_people)} موظفاً · ${num(stats.payroll.active_contracts)} عقداً`}
          border="#0369a1"
          href="/accounts/payroll"
        />
        <Kpi
          label="القيود المحاسبية"
          value={num(stats.overview.journal_entries.total)}
          hint={`${num(stats.overview.journal_entries.posted)} مرحّل · ${num(stats.overview.journal_entries.drafts)} مسودة`}
          border="#475569"
          href="/accounts/entries"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="توزيع الطلبة على المراحل" link="/accounts/installments">
          <div className="h-[260px]">
            {stageData.every((d) => d.value === 0) ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => num(Number(v))} />
                  <Bar dataKey="value" name="الطلبة" radius={[8, 8, 0, 0]} fill={COLORS.navy} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
            <span>صباحي: {num(stats.academic.morning)}</span>
            <span>مسائي: {num(stats.academic.evening)}</span>
            <span>ذكور: {num(stats.academic.males)}</span>
            <span>إناث: {num(stats.academic.females)}</span>
          </div>
        </Panel>

        <Panel title="حالة سداد الأقساط" link="/accounts/installments">
          <div className="grid grid-cols-1 md:grid-cols-[1.3fr_0.9fr] gap-3 items-center">
            <div className="h-[220px]">
              {tuitionPie.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tuitionPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {tuitionPie.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => num(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="space-y-2">
              <SideStat label="محصّل" value={money(stats.tuition.collected_amount)} />
              <SideStat label="تحصيلات مرحّلة" value={money(stats.students.collections_total)} />
              <SideStat label="أقساط معلّقة" value={num(stats.students.pending_installments)} />
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="أعلى الأقسام بعدد الطلبة" link="/accounts/installments">
          <div className="h-[280px]">
            {deptData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptData} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) => num(Number(v))}
                    labelFormatter={(_, payload) =>
                      String((payload?.[0]?.payload as { full?: string })?.full || '')
                    }
                  />
                  <Bar dataKey="value" name="الطلبة" radius={[0, 8, 8, 0]} fill={COLORS.teal} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="توزيع الجنس" link="/accounts/installments">
          <div className="h-[280px]">
            {genderPie.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={genderPie}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={95}
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    <Cell fill={COLORS.sky} />
                    <Cell fill={COLORS.rose} />
                    <Cell fill={COLORS.slate} />
                  </Pie>
                  <Tooltip formatter={(v) => num(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>
      </section>

      <Panel title="حركة الصندوق (آخر 6 أشهر)" link="/accounts/cashbox">
        <div className="h-[280px]">
          {cashMonthly.length === 0 ? (
            <EmptyChart text="لا توجد سندات صندوق مرحّلة بعد" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashMonthly}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.crimson} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLORS.crimson} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => money(v)} />
                <Tooltip formatter={(v) => `${money(Number(v))} IQD`} />
                <Legend />
                <Area type="monotone" dataKey="قبض" stroke={COLORS.teal} fill="url(#gIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="صرف" stroke={COLORS.crimson} fill="url(#gOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-600 mt-2">
          <span>مقبوضات: {money(stats.cash.vouchers.receipts_total)} IQD</span>
          <span>مدفوعات: {money(stats.cash.vouchers.payments_total)} IQD</span>
          <span>صافي: {money(stats.cash.vouchers.net_movement)} IQD</span>
        </div>
      </Panel>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <ModuleCard
          title="الصناديق"
          href="/accounts/cashbox"
          items={[
            ['إجمالي', stats.cash.boxes.total],
            ['فعّالة', stats.cash.boxes.active],
            ['جلسات مفتوحة', stats.cash.sessions.open],
            ['سندات مرحّلة', stats.cash.vouchers.posted],
          ]}
        />
        <ModuleCard
          title="المصارف"
          href="/accounts/banks"
          items={[
            ['مصارف', stats.banks.banks.total],
            ['حسابات فعّالة', stats.banks.accounts.active],
            ['صافي حركة', money(stats.banks.vouchers.net_movement)],
            ['كشوف محلولة', stats.banks.statements.reconciled],
          ]}
        />
        <ModuleCard
          title="الرواتب"
          href="/accounts/payroll"
          items={[
            ['الأشخاص', stats.payroll.active_people],
            ['العقود', stats.payroll.active_contracts],
            ['فترات مفتوحة', stats.payroll.open_periods],
            ['تشغيلات', stats.payroll.runs.total],
          ]}
          extra={
            stats.payroll.latest_calculated ? (
              <p className="text-[11px] text-slate-500 mt-3 m-0 leading-relaxed">
                آخر تشغيل {stats.payroll.latest_calculated.run_number}:{' '}
                {money(stats.payroll.latest_calculated.net_total)} IQD (
                {stats.payroll.latest_calculated.people_count} شخص)
              </p>
            ) : null
          }
        />
        <ModuleCard
          title="الموردون والمشتريات"
          href="/accounts/suppliers"
          items={[
            ['موردون فعّالون', stats.suppliers.active_suppliers],
            ['ذمم متبقية', money(stats.suppliers.remaining_payables)],
            ['أوامر شراء', stats.purchasing.purchase_orders.total],
            ['فواتير متأخرة', stats.suppliers.overdue_invoices],
          ]}
        />
        <ModuleCard
          title="الأصول الثابتة"
          href="/accounts/fixed-assets"
          items={[
            ['الإجمالي', stats.fixed_assets.total],
            ['فعّالة', stats.fixed_assets.active],
            ['معلّقة', stats.fixed_assets.suspended],
            ['مستبعدة', stats.fixed_assets.disposed],
          ]}
        />
        <ModuleCard
          title="الدليل والمراكز"
          href="/accounts/chart-of-accounts"
          items={[
            ['حسابات ترحيل', stats.overview.chart_accounts],
            ['مراكز تكلفة', stats.overview.cost_centers],
            ['حسابات طلاب', stats.students.total_accounts],
            ['سنوات مالية', stats.fiscal.total_years],
          ]}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="حالات القيود اليومية" link="/accounts/entries">
          <div className="h-[260px]">
            {journalPie.length === 0 ? (
              <EmptyChart text="لا توجد قيود بعد" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={journalPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {journalPie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => num(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="تشغيلات الرواتب حسب الحالة" link="/accounts/payroll/runs">
          <div className="h-[260px]">
            {payrollBars.every((d) => d.value === 0) ? (
              <EmptyChart text="لا توجد تشغيلات رواتب بعد" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payrollBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => num(Number(v))} />
                  <Bar dataKey="value" name="العدد" radius={[8, 8, 0, 0]} fill={COLORS.amber} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/85 p-4">
        <h2 className="text-sm font-bold text-[#16324f] m-0 mb-3">اختصارات سريعة</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['أقساط الطلبة', '/accounts/installments'],
            ['حسابات الطلبة', '/accounts/students/accounts'],
            ['القيود اليومية', '/accounts/entries'],
            ['الصناديق', '/accounts/cashbox'],
            ['المصارف', '/accounts/banks'],
            ['الرواتب', '/accounts/payroll'],
            ['دليل الحسابات', '/accounts/chart-of-accounts'],
            ['التقارير', '/accounts/reports'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-center text-sm font-semibold py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 hover:bg-[#16324f] hover:text-white hover:border-[#16324f] transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  border,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  border: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white/90 border border-slate-200 p-4 no-underline shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all"
      style={{ borderTop: `3px solid ${border}` }}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-extrabold text-slate-900 mt-1 leading-snug">{value}</div>
      <div className="text-[11px] text-slate-400 mt-1">{hint}</div>
    </Link>
  );
}

function Panel({
  title,
  link,
  children,
}: {
  title: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="m-0 text-sm font-bold text-[#16324f]">{title}</h3>
        <Link href={link} className="text-xs text-[#a11d2d] no-underline">
          عرض التفاصيل ←
        </Link>
      </div>
      {children}
    </div>
  );
}

function SideStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function ModuleCard({
  title,
  href,
  items,
  extra,
}: {
  title: string;
  href: string;
  items: Array<[string, string | number]>;
  extra?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-slate-200 bg-white/90 p-4 no-underline hover:border-slate-300 transition-colors"
    >
      <h3 className="m-0 mb-3 text-sm font-bold text-[#16324f]">{title}</h3>
      <ul className="m-0 p-0 list-none space-y-2">
        {items.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-3 text-xs text-slate-500">
            <span>{k}</span>
            <strong className="text-slate-900">{typeof v === 'number' ? num(v) : v}</strong>
          </li>
        ))}
      </ul>
      {extra}
    </Link>
  );
}

function EmptyChart({ text = 'لا توجد بيانات للعرض' }: { text?: string }) {
  return (
    <div className="h-full min-h-[220px] grid place-items-center text-slate-400 text-sm">
      {text}
    </div>
  );
}
