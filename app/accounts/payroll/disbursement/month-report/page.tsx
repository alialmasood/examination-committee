'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PayrollNav from '../../PayrollNav';
import { API, errMsg, fetchJson } from '../../_lib';
import { printMonthReport } from '../printMonthReport';

type ReportLine = {
  id: string;
  person_code: string;
  person_name: string;
  academic_title: string | null;
  degree: string | null;
  department_name: string | null;
  base_amount: string;
  assignments_total: string;
  assignments_count: number;
  grand_total: string;
};

type ComparisonChange = {
  payroll_person_id: string;
  person_name: string;
  reason: string;
  previous_total: string;
  current_total: string;
  diff: string;
};

type CategoryComparison = {
  direction: 'higher' | 'lower' | 'equal';
  previous_total: string;
  current_total: string;
  diff: string;
  new_count: number;
  left_count: number;
  increased_count: number;
  decreased_count: number;
  changes: ComparisonChange[];
};

type ReportCategory = {
  person_category: string;
  category_label: string;
  sheet_id: string | null;
  status: string;
  people_count: number;
  entered_count: number;
  base_total: string;
  assignments_total: string;
  grand_total: string;
  lines: ReportLine[];
  comparison: CategoryComparison | null;
};

type MonthReport = {
  header: {
    fiscal_year_id: string;
    fiscal_year_code: string;
    fiscal_year_name: string;
    month_number: number;
    month_label: string;
    year_label: string;
    month_status: string;
  };
  categories: ReportCategory[];
  totals: {
    people_count: number;
    entered_count: number;
    base_total: string;
    assignments_total: string;
    grand_total: string;
  };
  previous_comparison: {
    previous_month_number: number;
    previous_month_label: string;
    previous_total: string;
    current_total: string;
    diff: string;
    direction: 'higher' | 'lower' | 'equal';
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  EMPTY: 'فارغ',
  DRAFT: 'مسودة',
  SAVED: 'محفوظ',
  LOCKED: 'مقفل',
  DISBURSED: 'مصروف',
};

function statusBadgeClass(status: string) {
  switch (status) {
    case 'DISBURSED':
      return 'bg-emerald-100 text-emerald-900';
    case 'LOCKED':
      return 'bg-amber-100 text-amber-900';
    case 'SAVED':
      return 'bg-blue-100 text-blue-900';
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-50 text-gray-500';
  }
}

function formatMoney(v: string | number) {
  return Number(v || 0).toLocaleString('en-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function MonthReportInner() {
  const searchParams = useSearchParams();
  const fiscalYearId = searchParams.get('fiscal_year_id') || '';
  const monthNumber = searchParams.get('month_number') || '';
  const [report, setReport] = useState<MonthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openCategory, setOpenCategory] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!fiscalYearId || !monthNumber) {
      setError('يجب تحديد السنة المالية والشهر');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({
      fiscal_year_id: fiscalYearId,
      month_number: monthNumber,
    });
    const r = await fetchJson(`${API.disbursementMonthReport}?${qs.toString()}`);
    if (!r.__ok) {
      setError(errMsg(r));
      setReport(null);
      setLoading(false);
      return;
    }
    setReport(r.data);
    setOpenCategory(
      Object.fromEntries(
        (r.data?.categories || []).map((c: ReportCategory) => [c.person_category, true])
      )
    );
    setLoading(false);
  }, [fiscalYearId, monthNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  function handlePrint() {
    if (!report) return;
    printMonthReport({
      month_label: report.header.month_label,
      year_label: report.header.year_label || report.header.fiscal_year_code,
      fiscal_year_code: report.header.fiscal_year_code,
      month_status_label:
        STATUS_LABEL[report.header.month_status] || report.header.month_status,
      categories: report.categories.map((c) => ({
        person_category: c.person_category,
        category_label: c.category_label,
        status: c.status,
        status_label: STATUS_LABEL[c.status] || c.status,
        people_count: c.people_count,
        entered_count: c.entered_count,
        base_total: c.base_total,
        assignments_total: c.assignments_total,
        grand_total: c.grand_total,
        lines: c.lines.map((l) => ({
          person_code: l.person_code,
          person_name: l.person_name,
          academic_title: l.academic_title,
          degree: l.degree,
          department_name: l.department_name,
          base_amount: l.base_amount,
          assignments_total: l.assignments_total,
          grand_total: l.grand_total,
        })),
        comparison: c.comparison
          ? {
              direction: c.comparison.direction,
              previous_total: c.comparison.previous_total,
              current_total: c.comparison.current_total,
              diff: c.comparison.diff,
              changes: c.comparison.changes.map((ch) => ({
                person_name: ch.person_name,
                reason: ch.reason,
                previous_total: ch.previous_total,
                current_total: ch.current_total,
                diff: ch.diff,
              })),
            }
          : null,
      })),
      totals: report.totals,
      previous_comparison: report.previous_comparison
        ? {
            previous_month_label: report.previous_comparison.previous_month_label,
            previous_total: report.previous_comparison.previous_total,
            current_total: report.previous_comparison.current_total,
            diff: report.previous_comparison.diff,
            direction: report.previous_comparison.direction,
          }
        : null,
    });
  }

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            تقرير رواتب شهر {report?.header.month_label || ''}
          </h1>
          {report && (
            <p className="text-sm text-gray-600">
              السنة المالية {report.header.fiscal_year_code}
              {report.header.year_label ? ` — ${report.header.year_label}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/payroll/disbursement${
              fiscalYearId ? `?fiscal_year_id=${encodeURIComponent(fiscalYearId)}` : ''
            }`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            ← العودة لصرف الرواتب
          </Link>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report}
            className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
          >
            طباعة PDF
          </button>
        </div>
      </div>
      <PayrollNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-500">جاري تحميل التقرير…</div>
      ) : !report ? null : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs text-gray-500">حالة الشهر</div>
              <div className="mt-1">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                    report.header.month_status
                  )}`}
                >
                  {STATUS_LABEL[report.header.month_status] || report.header.month_status}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs text-gray-500">إجمالي الأسماء</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {report.totals.people_count}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs text-gray-500">الرواتب الأساسية</div>
              <div className="mt-1 text-lg font-bold text-gray-900" dir="ltr">
                {formatMoney(report.totals.base_total)}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs text-gray-500">التكليفات</div>
              <div className="mt-1 text-lg font-bold text-gray-900" dir="ltr">
                {formatMoney(report.totals.assignments_total)}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
              <div className="text-xs text-emerald-800">الإجمالي الكلي</div>
              <div className="mt-1 text-lg font-bold text-emerald-950" dir="ltr">
                {formatMoney(report.totals.grand_total)}
              </div>
            </div>
          </div>

          <div className="mb-6 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-800 text-white">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">الفئة</th>
                  <th className="px-3 py-2 text-right font-semibold">الحالة</th>
                  <th className="px-3 py-2 text-right font-semibold">الأسماء</th>
                  <th className="px-3 py-2 text-right font-semibold">الرواتب الأساسية</th>
                  <th className="px-3 py-2 text-right font-semibold">التكليفات</th>
                  <th className="px-3 py-2 text-right font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {report.categories.map((cat) => (
                  <tr key={cat.person_category} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-semibold text-red-950">
                      {cat.category_label}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${statusBadgeClass(
                          cat.status
                        )}`}
                      >
                        {STATUS_LABEL[cat.status] || cat.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {cat.entered_count}/{cat.people_count || '—'}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {formatMoney(cat.base_total)}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {formatMoney(cat.assignments_total)}
                    </td>
                    <td className="px-3 py-2 font-bold" dir="ltr">
                      {formatMoney(cat.grand_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-red-950 text-white">
                <tr>
                  <td className="px-3 py-2 font-bold" colSpan={2}>
                    المجموع الكلي
                  </td>
                  <td className="px-3 py-2 font-bold">{report.totals.people_count}</td>
                  <td className="px-3 py-2 font-bold" dir="ltr">
                    {formatMoney(report.totals.base_total)}
                  </td>
                  <td className="px-3 py-2 font-bold" dir="ltr">
                    {formatMoney(report.totals.assignments_total)}
                  </td>
                  <td className="px-3 py-2 font-bold" dir="ltr">
                    {formatMoney(report.totals.grand_total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {report.previous_comparison ? (
            <div
              className={`mb-4 rounded-lg border px-4 py-3 text-sm shadow-sm ${
                report.previous_comparison.direction === 'higher'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : report.previous_comparison.direction === 'lower'
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <div className="font-bold">
                {report.previous_comparison.direction === 'equal' ? (
                  <>إجمالي هذا الشهر مطابق لإجمالي شهر {report.previous_comparison.previous_month_label}</>
                ) : (
                  <>
                    إجمالي رواتب هذا الشهر{' '}
                    {report.previous_comparison.direction === 'higher' ? 'أعلى' : 'أقل'} من شهر{' '}
                    {report.previous_comparison.previous_month_label} بمبلغ{' '}
                    <span dir="ltr">
                      {formatMoney(Math.abs(Number(report.previous_comparison.diff)))}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1 text-xs">
                شهر {report.previous_comparison.previous_month_label}:{' '}
                <span dir="ltr" className="font-semibold">
                  {formatMoney(report.previous_comparison.previous_total)}
                </span>
                {' — '}
                شهر {report.header.month_label}:{' '}
                <span dir="ltr" className="font-semibold">
                  {formatMoney(report.previous_comparison.current_total)}
                </span>
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
              لا توجد بيانات للشهر السابق للمقارنة
            </div>
          )}

          {report.previous_comparison && (
            <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="bg-gray-800 px-4 py-2.5 text-sm font-bold text-white">
                أوجه التغير مقارنة بشهر {report.previous_comparison.previous_month_label}
              </div>
              <div className="divide-y divide-gray-100">
                {report.categories.map((cat) => {
                  const cmp = cat.comparison;
                  if (!cmp) return null;
                  return (
                    <div key={cat.person_category} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-bold text-red-950">{cat.category_label}</div>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span>
                            السابق:{' '}
                            <span dir="ltr" className="font-semibold">
                              {formatMoney(cmp.previous_total)}
                            </span>
                          </span>
                          <span>
                            الحالي:{' '}
                            <span dir="ltr" className="font-semibold">
                              {formatMoney(cmp.current_total)}
                            </span>
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 font-bold ${
                              cmp.direction === 'higher'
                                ? 'bg-emerald-100 text-emerald-900'
                                : cmp.direction === 'lower'
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-gray-100 text-gray-700'
                            }`}
                            dir="ltr"
                          >
                            {cmp.direction === 'equal'
                              ? 'بدون تغيير'
                              : `${Number(cmp.diff) > 0 ? '+' : '−'}${formatMoney(
                                  Math.abs(Number(cmp.diff))
                                )}`}
                          </span>
                        </div>
                      </div>
                      {cmp.changes.length > 0 && (
                        <>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600">
                            {cmp.increased_count > 0 && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900">
                                زاد راتبهم: {cmp.increased_count}
                              </span>
                            )}
                            {cmp.decreased_count > 0 && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
                                قل راتبهم: {cmp.decreased_count}
                              </span>
                            )}
                            {cmp.new_count > 0 && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-900">
                                أسماء جديدة: {cmp.new_count}
                              </span>
                            )}
                            {cmp.left_count > 0 && (
                              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-900">
                                غير موجودين هذا الشهر: {cmp.left_count}
                              </span>
                            )}
                          </div>
                          <ul className="mt-2 space-y-1 text-xs text-gray-700">
                            {cmp.changes.map((c) => (
                              <li
                                key={c.payroll_person_id}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <span className="font-semibold text-gray-900">{c.person_name}</span>
                                <span>— {c.reason}</span>
                                <span dir="ltr" className="font-mono">
                                  {formatMoney(c.previous_total)} ← {formatMoney(c.current_total)}
                                </span>
                                <span
                                  dir="ltr"
                                  className={`font-bold ${
                                    Number(c.diff) > 0 ? 'text-emerald-800' : 'text-red-800'
                                  }`}
                                >
                                  {Number(c.diff) > 0 ? '+' : '−'}
                                  {formatMoney(Math.abs(Number(c.diff)))}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {cmp.changes.length === 0 && (
                        <div className="mt-1 text-xs text-gray-500">لا توجد تغييرات عن الشهر السابق</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {report.categories.map((cat) => {
              const open = openCategory[cat.person_category] !== false;
              return (
                <section
                  key={cat.person_category}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenCategory((prev) => ({
                        ...prev,
                        [cat.person_category]: !open,
                      }))
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-2 bg-red-950 px-4 py-2.5 text-right text-white"
                  >
                    <span className="text-sm font-bold">{cat.category_label}</span>
                    <span className="flex flex-wrap items-center gap-3 text-xs">
                      <span>{cat.people_count} اسم</span>
                      <span dir="ltr">{formatMoney(cat.grand_total)}</span>
                      <span className="font-semibold">{open ? 'إخفاء' : 'إظهار'}</span>
                    </span>
                  </button>

                  {open &&
                    (cat.lines.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-500">
                        لا توجد بيانات لهذه الفئة في هذا الشهر
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-100 text-gray-700">
                            <tr>
                              <th className="px-3 py-2 text-right font-semibold">#</th>
                              <th className="px-3 py-2 text-right font-semibold">الاسم</th>
                              <th className="px-3 py-2 text-right font-semibold">اللقب العلمي</th>
                              <th className="px-3 py-2 text-right font-semibold">الشهادة</th>
                              <th className="px-3 py-2 text-right font-semibold">القسم</th>
                              <th className="px-3 py-2 text-right font-semibold">الراتب الأساسي</th>
                              <th className="px-3 py-2 text-right font-semibold">التكليفات</th>
                              <th className="px-3 py-2 text-right font-semibold">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.lines.map((line, idx) => (
                              <tr
                                key={line.id}
                                className="border-t border-gray-100 odd:bg-white even:bg-gray-50/70"
                              >
                                <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                                <td className="px-3 py-2 font-medium text-gray-900">
                                  {line.person_name}
                                </td>
                                <td className="px-3 py-2">{line.academic_title || '—'}</td>
                                <td className="px-3 py-2">{line.degree || '—'}</td>
                                <td className="px-3 py-2">{line.department_name || '—'}</td>
                                <td className="px-3 py-2" dir="ltr">
                                  {formatMoney(line.base_amount)}
                                </td>
                                <td className="px-3 py-2" dir="ltr">
                                  {formatMoney(line.assignments_total)}
                                  {line.assignments_count > 0 && (
                                    <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                                      {line.assignments_count}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 font-semibold" dir="ltr">
                                  {formatMoney(line.grand_total)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-amber-50 font-bold text-amber-950">
                            <tr className="border-t border-amber-200">
                              <td className="px-3 py-2" colSpan={5}>
                                مجموع {cat.category_label}
                              </td>
                              <td className="px-3 py-2" dir="ltr">
                                {formatMoney(cat.base_total)}
                              </td>
                              <td className="px-3 py-2" dir="ltr">
                                {formatMoney(cat.assignments_total)}
                              </td>
                              <td className="px-3 py-2" dir="ltr">
                                {formatMoney(cat.grand_total)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}

export default function MonthReportPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">جاري التحميل…</div>}>
      <MonthReportInner />
    </Suspense>
  );
}
