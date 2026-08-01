'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from './components/StudentsNav';

type DeptFinance = {
  id: string;
  name: string;
  students: number;
  morning: number;
  evening: number;
  collected_amount: number;
  debt_amount: number;
  annual_base_total: number;
  expected_annual_total: number;
  expected_four_years_total: number;
  channel_discount_amount?: number;
  settlement_discount_amount?: number;
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

type SummaryData = {
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

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function count(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function percent(n: number): string {
  return `${Number(n || 0).toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'accent' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50/60'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/60'
        : tone === 'accent'
          ? 'border-red-200 bg-red-50/40'
          : tone === 'danger'
            ? 'border-rose-200 bg-rose-50/60'
            : 'border-gray-200 bg-white';

  return (
    <div className={`rounded-lg border px-4 py-4 shadow-sm ${toneClass}`}>
      <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
      <p className="text-xl font-bold tracking-tight text-gray-900" dir="ltr">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

function MoneyStatCard({
  label,
  amount,
  hint,
  tone = 'neutral',
}: {
  label: string;
  amount: number;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'accent' | 'danger';
}) {
  return (
    <StatCard
      label={label}
      value={`${money(amount)} IQD`}
      hint={hint}
      tone={tone}
    />
  );
}

function DepartmentRankList({
  title,
  subtitle,
  items,
  emptyText,
  variant,
}: {
  title: string;
  subtitle: string;
  items: DeptFinance[];
  emptyText: string;
  variant: 'top' | 'least' | 'debt';
}) {
  const headerClass =
    variant === 'top'
      ? 'bg-red-950 text-white border-red-950'
      : variant === 'debt'
        ? 'bg-amber-900 text-white border-amber-900'
        : 'bg-slate-800 text-white border-slate-800';

  const badgeClass =
    variant === 'top'
      ? 'bg-red-100 text-red-950'
      : variant === 'debt'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-slate-100 text-slate-700';

  return (
    <section className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className={`px-5 py-3 border-b ${headerClass}`}>
        <p className="text-xs opacity-80">{subtitle}</p>
        <h3 className="text-sm font-semibold mt-0.5">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-500">
          {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((dept, index) => (
            <li
              key={dept.id}
              className="px-5 py-3.5 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badgeClass}`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 leading-snug">
                    {dept.name}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {count(dept.students)} طالب · صباحي {count(dept.morning)} ·
                    مسائي {count(dept.evening)}
                  </p>
                </div>
              </div>
              <div className="text-left text-xs space-y-0.5" dir="ltr">
                {variant === 'debt' ? (
                  <>
                    <p className="font-bold text-amber-800">
                      {money(dept.debt_amount)}{' '}
                      <span className="font-semibold text-gray-500">IQD</span>
                    </p>
                    <p className="text-emerald-700">
                      مدفوع: {money(dept.collected_amount)}
                    </p>
                    <p className="text-gray-600">
                      مستحق: {money(dept.expected_annual_total)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-gray-900">
                      {money(dept.expected_annual_total)}{' '}
                      <span className="font-semibold text-gray-500">IQD</span>
                    </p>
                    <p className="text-emerald-700">
                      مدفوع: {money(dept.collected_amount)}
                    </p>
                    <p className="text-amber-700">
                      دين: {money(dept.debt_amount)}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AccountsStudentsPage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts/students/summary', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success || !body.data) {
        setError(body.error || 'تعذر تحميل ملخص حسابات الطلبة');
        setData(null);
      } else {
        setData(body.data as SummaryData);
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            حسابات الطلبة
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            ملخص إحصائي ومالي رسمي لطلبة الكلية
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          تحديث البيانات
        </button>
      </div>

      <StudentsNav />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="space-y-4">
          <div className="h-28 bg-gray-100 animate-pulse rounded-lg" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-24 bg-gray-100 animate-pulse rounded-lg"
              />
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="space-y-5">
          <header className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
            <div className="bg-red-950 text-white px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-red-100/80 mb-1">لوحة الملخص المالي</p>
                <h2 className="text-lg font-semibold tracking-tight">
                  إحصائيات الطلبة والأقساط
                </h2>
              </div>
              <p className="text-xs text-red-100/90">
                آخر تحديث:{' '}
                {new Date(data.generated_at).toLocaleString('ar-IQ', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
          </header>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              الإحصائيات العامة
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="عدد الطلبة الكلي"
                value={count(data.total_students)}
                hint="جميع الطلبة المسجلين في الكلية"
                tone="accent"
              />
              <StatCard
                label="عدد الأقسام"
                value={count(data.departments_count)}
                hint={`${count(data.departments_with_students)} قسم فيه طلبة`}
              />
              <StatCard
                label="طلبة صباحي"
                value={count(data.morning)}
                hint="نوع الدراسة الصباحية"
              />
              <StatCard
                label="طلبة مسائي"
                value={count(data.evening)}
                hint="نوع الدراسة المسائية"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              أداء التحصيل وحالات الدفع
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="نسبة التحصيل"
                value={percent(data.collection_rate_percent)}
                hint="المدفوع ÷ مستحق العام الدراسي الجاري (حسب المرحلة)"
                tone={
                  data.collection_rate_percent >= 70
                    ? 'success'
                    : data.collection_rate_percent >= 40
                      ? 'warning'
                      : 'danger'
                }
              />
              <StatCard
                label="طلبة مكتملو الدفع"
                value={count(data.fully_paid_count)}
                hint="سدّدوا قسط مرحلتهم/عامهم الدراسي الجاري بالكامل"
                tone="success"
              />
              <StatCard
                label="دفع جزئي"
                value={count(data.partial_paid_count)}
                hint="دفعوا جزءاً من قسط العام الدراسي الجاري"
                tone="warning"
              />
              <StatCard
                label="بدون دفع"
                value={count(data.unpaid_count)}
                hint="لم يُدفع شيء من قسط العام الدراسي الجاري"
                tone="danger"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              الملخص المالي
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <MoneyStatCard
                label="المبلغ المدفوع من كل الطلبة"
                amount={data.collected_amount}
                hint="مجموع مبالغ وصولات التسديد فقط"
                tone="success"
              />
              <MoneyStatCard
                label="المبلغ الديون من كل الطلبة"
                amount={data.debt_amount}
                hint="متبقي السنة الجارية حسب دفتر التسديد"
                tone="warning"
              />
              <StatCard
                label="عدد الوصولات المقطوعة"
                value={count(data.receipts_count)}
                hint={
                  data.settlements_paid_amount > 0
                    ? `إجمالي التسديدات: ${money(data.settlements_paid_amount)} IQD`
                    : 'وصولات تسديد الأقساط'
                }
                tone="accent"
              />
              <StatCard
                label="عدد التخفيضات / الخصومات"
                value={count(data.discounts_count)}
                hint="طلبة لديهم خصم أو تخفيض فعّال"
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              أثر التخفيضات على الاستحصال
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              <MoneyStatCard
                label="إجمالي مبلغ التخفيض"
                amount={data.total_discount_amount}
                hint="خصم التسجيل + خصم إضافي من مودال التسديد"
                tone="warning"
              />
              <MoneyStatCard
                label="تخفيض قنوات القبول"
                amount={data.channel_discount_amount}
                hint="محسوب عند التسجيل / تأكيد الدفع"
              />
              <MoneyStatCard
                label="تخفيض مودال التسديد"
                amount={data.settlement_discount_amount}
                hint="خصم إضافي مسجّل على وصولات التسديد"
                tone="accent"
              />
              <StatCard
                label="نسبة أثر التخفيض"
                value={percent(data.discount_impact_percent)}
                hint="من إجمالي القسط الأساسي السنوي للكلية"
                tone={
                  data.discount_impact_percent >= 20
                    ? 'danger'
                    : data.discount_impact_percent >= 10
                      ? 'warning'
                      : 'neutral'
                }
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
              <div className="bg-amber-900 text-white px-5 py-3">
                <p className="text-xs text-amber-100/80">تحليل حسب القسم</p>
                <h4 className="text-sm font-semibold mt-0.5">
                  التخفيضات وتأثيرها على استحصال كل قسم
                </h4>
              </div>
              {(data.top_discount_departments?.length || 0) === 0 &&
              (data.departments || []).every(
                (d) => (d.total_discount_amount || 0) <= 0
              ) ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500">
                  لا توجد تخفيضات مسجّلة حالياً
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-2.5 text-right font-medium">
                          القسم
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          الطلبة
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          قسط أساسي
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          تخفيض قناة
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          تخفيض تسديد
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          إجمالي التخفيض
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          أثر %
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          المستحصل
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...(data.departments || [])]
                        .sort(
                          (a, b) =>
                            (b.total_discount_amount || 0) -
                            (a.total_discount_amount || 0)
                        )
                        .map((dept) => {
                          const impact =
                            (dept.annual_base_total || 0) > 0
                              ? Math.round(
                                  ((dept.total_discount_amount || 0) /
                                    dept.annual_base_total) *
                                    1000
                                ) / 10
                              : 0;
                          return (
                            <tr key={dept.id} className="hover:bg-amber-50/40">
                              <td className="px-4 py-2.5 font-medium text-gray-900">
                                {dept.name}
                                {(dept.discounts_count || 0) > 0 ? (
                                  <span className="block text-[11px] text-gray-500 font-normal">
                                    {count(dept.discounts_count || 0)} طالب
                                    بتخفيض
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-4 py-2.5 text-gray-700">
                                {count(dept.students)}
                              </td>
                              <td
                                className="px-4 py-2.5 text-gray-700"
                                dir="ltr"
                              >
                                {money(dept.annual_base_total)}
                              </td>
                              <td
                                className="px-4 py-2.5 text-gray-700"
                                dir="ltr"
                              >
                                {money(dept.channel_discount_amount || 0)}
                              </td>
                              <td
                                className="px-4 py-2.5 text-red-800 font-medium"
                                dir="ltr"
                              >
                                {money(dept.settlement_discount_amount || 0)}
                              </td>
                              <td
                                className="px-4 py-2.5 font-semibold text-amber-900"
                                dir="ltr"
                              >
                                {money(dept.total_discount_amount || 0)}
                              </td>
                              <td className="px-4 py-2.5 text-gray-700" dir="ltr">
                                {percent(impact)}
                              </td>
                              <td
                                className="px-4 py-2.5 text-emerald-700 font-medium"
                                dir="ltr"
                              >
                                {money(dept.collected_amount)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50 font-semibold text-amber-950">
                        <td className="px-4 py-2.5">الإجمالي العام</td>
                        <td className="px-4 py-2.5">
                          {count(data.total_students)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {money(data.annual_base_total)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {money(data.channel_discount_amount)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {money(data.settlement_discount_amount)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {money(data.total_discount_amount)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {percent(data.discount_impact_percent)}
                        </td>
                        <td className="px-4 py-2.5" dir="ltr">
                          {money(data.collected_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              الملخص حسب المرحلة
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {data.by_stage
                .filter((s) => s.stage !== 'unknown')
                .map((stage) => (
                  <div
                    key={stage.stage}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      {stage.label}
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {count(stage.students)}{' '}
                      <span className="text-xs font-semibold text-gray-500">
                        طالب
                      </span>
                    </p>
                    <div className="mt-3 space-y-1 text-xs" dir="ltr">
                      <p className="text-emerald-700">
                        مدفوع: {money(stage.collected_amount)} IQD
                      </p>
                      <p className="text-amber-700">
                        دين: {money(stage.debt_amount)} IQD
                      </p>
                      <p className="text-gray-600">
                        مستحق: {money(stage.expected_annual_total)} IQD
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              الأقساط المتوقعة
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">
                  المبلغ الكلي لسنة واحدة
                </p>
                <p className="text-sm font-medium text-gray-700 mb-3">
                  قسط أساسي قبل التخفيض لجميع الطلبة المسجلين
                </p>
                <p
                  className="text-2xl font-bold tracking-tight text-red-950"
                  dir="ltr"
                >
                  {money(data.annual_base_total)}{' '}
                  <span className="text-sm font-semibold text-gray-500">
                    IQD
                  </span>
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  بعد تخفيض القنوات:{' '}
                  <span className="font-semibold text-gray-800" dir="ltr">
                    {money(data.expected_annual_total)} IQD
                  </span>
                  {' · '}
                  إجمالي التخفيض:{' '}
                  <span className="font-semibold text-amber-800" dir="ltr">
                    {money(data.total_discount_amount ?? 0)} IQD
                  </span>
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">
                  المبلغ الإجمالي المتوقع لأربع سنوات
                </p>
                <p className="text-sm font-medium text-gray-700 mb-3">
                  بعد التخفيضات × 4 سنوات لجميع الطلبة
                </p>
                <p
                  className="text-2xl font-bold tracking-tight text-red-950"
                  dir="ltr"
                >
                  {money(data.expected_four_years_total)}{' '}
                  <span className="text-sm font-semibold text-gray-500">
                    IQD
                  </span>
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  قبل التخفيضات (أساسي):{' '}
                  <span className="font-semibold text-gray-800" dir="ltr">
                    {money(data.expected_four_years_base_total)} IQD
                  </span>
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              ترتيب الأقسام مالياً
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <DepartmentRankList
                title="أكثر الأقسام مالياً"
                subtitle="حسب المستحق السنوي بعد التخفيض"
                items={data.top_departments}
                emptyText="لا توجد أقسام للعرض"
                variant="top"
              />
              <DepartmentRankList
                title="أقل الأقسام مالياً"
                subtitle="حسب المستحق السنوي بعد التخفيض"
                items={data.least_departments}
                emptyText="لا توجد أقسام للعرض"
                variant="least"
              />
            </div>
            <DepartmentRankList
              title="أعلى الأقسام مديونية"
              subtitle="حسب مبلغ الدين المتبقي"
              items={data.top_debt_departments}
              emptyText="لا توجد ديون مسجّلة على الأقسام"
              variant="debt"
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
