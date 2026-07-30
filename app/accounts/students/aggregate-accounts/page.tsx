'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import { printAggregateAccounts } from '../components/printAggregateAccounts';
import type { StudentsAggregateData } from '@/src/lib/accounts/students-aggregate';

const money = (n: number) =>
  new Intl.NumberFormat('en-US').format(Math.round(n || 0));

const percent = (n: number) => `${Number(n || 0).toFixed(1)}%`;

function EqCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'red' | 'indigo';
}) {
  const valueClass =
    tone === 'green'
      ? 'text-emerald-800'
      : tone === 'red'
        ? 'text-rose-800'
        : tone === 'indigo'
          ? 'text-indigo-800'
          : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

export default function StudentAggregateAccountsPage() {
  const [data, setData] = useState<StudentsAggregateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts/students/aggregate', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error || 'تعذر تحميل الحسابات الإجمالية');
        setData(null);
        return;
      }
      setData(body.data as StudentsAggregateData);
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

  async function handleExportExcel() {
    setExporting('excel');
    try {
      const res = await fetch('/api/accounts/students/aggregate/excel', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'تعذر تصدير Excel');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `حسابات-اجمالية-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('تعذر الاتصال بالخادم للتصدير');
    } finally {
      setExporting(null);
    }
  }

  function handlePrint() {
    if (!data) return;
    setExporting('pdf');
    try {
      printAggregateAccounts(data);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">حسابات إجمالية</h1>
          <p className="text-sm text-gray-600 mt-1">
            دفتر إجمالي رسمي لمستحقات الطلبة — أساس − تخفيض = مطلوب · محصل · دين
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={!data || exporting !== null}
            className="rounded-md bg-red-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900 disabled:opacity-50"
          >
            {exporting === 'excel' ? 'جارٍ التصدير…' : 'تصدير Excel'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!data || exporting !== null}
            className="rounded-md border border-red-900 bg-white px-3 py-1.5 text-xs font-semibold text-red-950 hover:bg-red-50 disabled:opacity-50"
          >
            {exporting === 'pdf' ? 'جارٍ التجهيز…' : 'طباعة التقرير'}
          </button>
        </div>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="underline shrink-0">
            إعادة
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center text-gray-500 text-sm">
          جارٍ تحميل الحسابات الإجمالية…
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* المعادلة */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              أولاً: معادلة الحساب الإجمالي
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <EqCard
                label="أساس الرسوم (قبل التخفيض)"
                value={`${money(data.equation.annual_base_total)} IQD`}
              />
              <EqCard
                label="− التخفيضات"
                value={`${money(data.equation.total_discount_amount)} IQD`}
                tone="indigo"
              />
              <EqCard
                label="= المطلوب بعد التخفيض"
                value={`${money(data.equation.expected_annual_total)} IQD`}
              />
              <EqCard
                label="المحصّل (وصولات التسديد)"
                value={`${money(data.equation.collected_amount)} IQD`}
                tone="green"
              />
              <EqCard
                label="الدين المتبقي"
                value={`${money(data.equation.debt_amount)} IQD`}
                tone="red"
              />
              <EqCard
                label="نسبة التحصيل"
                value={percent(data.equation.collection_rate_percent)}
              />
              <EqCard
                label="متوقع 4 سنوات"
                value={`${money(data.equation.expected_four_years_total)} IQD`}
              />
              <EqCard
                label="أساس 4 سنوات"
                value={`${money(data.equation.expected_four_years_base_total)} IQD`}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-md border border-gray-200 bg-slate-50 px-3 py-2">
                طلبة: <b>{data.counts.total_students}</b>
                <span className="text-gray-500 mr-1">
                  (صباحي {data.counts.morning} · مسائي {data.counts.evening})
                </span>
              </div>
              <div className="rounded-md border border-gray-200 bg-slate-50 px-3 py-2">
                وصولات: <b>{data.counts.receipts_count}</b>
              </div>
              <div className="rounded-md border border-gray-200 bg-slate-50 px-3 py-2">
                مسدد / جزئي / غير مسدد:{' '}
                <b>
                  {data.counts.fully_paid_count} / {data.counts.partial_paid_count} /{' '}
                  {data.counts.unpaid_count}
                </b>
              </div>
              <div className="rounded-md border border-gray-200 bg-slate-50 px-3 py-2">
                أثر التخفيض:{' '}
                <b className="text-indigo-800">
                  {percent(data.equation.discount_impact_percent)}
                </b>
              </div>
            </div>
          </section>

          {/* حسب الأقسام */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              ثانياً: التجميع حسب الأقسام
            </h2>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-red-950 text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-medium">#</th>
                      <th className="px-3 py-2.5 text-right font-medium">القسم</th>
                      <th className="px-3 py-2.5 text-right font-medium">طلبة</th>
                      <th className="px-3 py-2.5 text-right font-medium">أساس</th>
                      <th className="px-3 py-2.5 text-right font-medium">تخفيض</th>
                      <th className="px-3 py-2.5 text-right font-medium">مطلوب</th>
                      <th className="px-3 py-2.5 text-right font-medium">محصل</th>
                      <th className="px-3 py-2.5 text-right font-medium">دين</th>
                      <th className="px-3 py-2.5 text-right font-medium">وصولات</th>
                      <th className="px-3 py-2.5 text-right font-medium">تحصيل</th>
                      <th className="px-3 py-2.5 text-right font-medium">4 سنوات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.by_department.map((d, i) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{d.name}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {d.students}
                          <span className="text-[11px] text-gray-400 mr-1">
                            (ص {d.morning}/م {d.evening})
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{money(d.annual_base_total)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-indigo-800">
                          {money(d.discount_amount)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{money(d.expected_annual_total)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-emerald-800 font-medium">
                          {money(d.collected_amount)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-rose-800 font-medium">
                          {money(d.debt_amount)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-center">{d.receipts_count}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {percent(d.collection_rate_percent)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {money(d.expected_four_years_total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-3 py-2.5" colSpan={2}>
                        الإجمالي
                      </td>
                      <td className="px-3 py-2.5">{data.totals.students}</td>
                      <td className="px-3 py-2.5">{money(data.totals.annual_base_total)}</td>
                      <td className="px-3 py-2.5">{money(data.totals.discount_amount)}</td>
                      <td className="px-3 py-2.5">{money(data.totals.expected_annual_total)}</td>
                      <td className="px-3 py-2.5">{money(data.totals.collected_amount)}</td>
                      <td className="px-3 py-2.5">{money(data.totals.debt_amount)}</td>
                      <td className="px-3 py-2.5 text-center">{data.totals.receipts_count}</td>
                      <td className="px-3 py-2.5">
                        {percent(data.equation.collection_rate_percent)}
                      </td>
                      <td className="px-3 py-2.5">
                        {money(data.totals.expected_four_years_total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* مراحل + نوع دراسة */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
                ثالثاً: حسب المراحل
              </h2>
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">المرحلة</th>
                      <th className="px-3 py-2 text-right font-medium">طلبة</th>
                      <th className="px-3 py-2 text-right font-medium">مطلوب</th>
                      <th className="px-3 py-2 text-right font-medium">محصل</th>
                      <th className="px-3 py-2 text-right font-medium">دين</th>
                      <th className="px-3 py-2 text-right font-medium">وصولات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.by_stage.map((s) => (
                      <tr key={s.stage}>
                        <td className="px-3 py-2 font-medium">{s.label}</td>
                        <td className="px-3 py-2 tabular-nums">{s.students}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {money(s.expected_annual_total)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-emerald-800">
                          {money(s.collected_amount)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-rose-800">
                          {money(s.debt_amount)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{s.receipts_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
                رابعاً: حسب نوع الدراسة
              </h2>
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">النوع</th>
                      <th className="px-3 py-2 text-right font-medium">طلبة</th>
                      <th className="px-3 py-2 text-right font-medium">مطلوب</th>
                      <th className="px-3 py-2 text-right font-medium">محصل</th>
                      <th className="px-3 py-2 text-right font-medium">دين</th>
                      <th className="px-3 py-2 text-right font-medium">وصولات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.by_study_type.map((s) => (
                      <tr key={s.study_type}>
                        <td className="px-3 py-2 font-medium">{s.label}</td>
                        <td className="px-3 py-2 tabular-nums">{s.students}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {money(s.expected_annual_total)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-emerald-800">
                          {money(s.collected_amount)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-rose-800">
                          {money(s.debt_amount)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{s.receipts_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* سنة القسط */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              خامساً: حسب سنة القسط
            </h2>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-red-950 text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-right font-medium">السنة</th>
                    <th className="px-3 py-2.5 text-right font-medium">المستهدف</th>
                    <th className="px-3 py-2.5 text-right font-medium">المحصّل</th>
                    <th className="px-3 py-2.5 text-right font-medium">المتبقي</th>
                    <th className="px-3 py-2.5 text-right font-medium">وصولات</th>
                    <th className="px-3 py-2.5 text-right font-medium">طلبة بنشاط تسديد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.by_fee_year.map((y) => (
                    <tr key={y.fee_year} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium">{y.label}</td>
                      <td className="px-3 py-2.5 tabular-nums">{money(y.target_amount)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-emerald-800 font-medium">
                        {money(y.collected_amount)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-rose-800 font-medium">
                        {money(y.remaining_amount)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{y.receipts_count}</td>
                      <td className="px-3 py-2.5 tabular-nums">{y.students_with_activity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* التخفيضات + حركة الوصولات */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
                سادساً: أثر التخفيضات
              </h2>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <EqCard
                  label="إجمالي التخفيضات"
                  value={`${money(data.equation.total_discount_amount)} IQD`}
                  tone="indigo"
                />
                <EqCard
                  label="طلبة لديهم تخفيض"
                  value={String(data.counts.students_with_discount)}
                  tone="indigo"
                />
                <EqCard
                  label="خصم القنوات"
                  value={`${money(data.equation.channel_discount_amount)} IQD`}
                />
                <EqCard
                  label="خصم التسديد"
                  value={`${money(data.equation.settlement_discount_amount)} IQD`}
                />
              </div>
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {data.discount_types.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-500">
                    لا توجد تخفيضات مسجّلة
                  </p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium">النوع</th>
                        <th className="px-3 py-2 text-right font-medium">طلبة</th>
                        <th className="px-3 py-2 text-right font-medium">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.discount_types.map((d) => (
                        <tr key={d.key}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{d.label}</div>
                            <div className="text-[11px] text-gray-400">
                              {d.kind === 'channel' ? 'قناة قبول' : 'خصم تسديد'}
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{d.students_count}</td>
                          <td className="px-3 py-2 tabular-nums text-indigo-800 font-medium">
                            {money(d.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
                سابعاً: حركة الوصولات الإجمالية
              </h2>
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-sm text-gray-600">عدد الوصولات المقطوعة</span>
                  <span className="text-xl font-bold tabular-nums text-gray-900">
                    {data.counts.receipts_count}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-sm text-gray-600">مجموع مبالغ التسديد</span>
                  <span className="text-xl font-bold tabular-nums text-emerald-800">
                    {money(data.equation.collected_amount)} IQD
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">أقسام لديها طلبة</span>
                  <span className="text-lg font-bold tabular-nums">
                    {data.counts.departments_with_students}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 pt-2">
                  المصدر الوحيد للمقبوضات: جدول وصولات التسديد (
                  <code className="text-[10px]">pay_amount</code>)
                </p>
              </div>
            </div>
          </section>

          <p className="text-center text-xs text-gray-400 pb-2">
            آخر تحديث: {new Date(data.generated_at).toLocaleString('ar-IQ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
