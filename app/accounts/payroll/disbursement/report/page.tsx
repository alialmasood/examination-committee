'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PayrollNav from '../../PayrollNav';
import { API, errMsg, fetchJson } from '../../_lib';

type FiscalYear = {
  id: string;
  code: string;
  name_ar: string;
};

type ReportRow = {
  sheet_id: string;
  month_number: number;
  person_category: string;
  status: string;
  people_count: number;
  entered_count: number;
  base_total: string;
  assignments_total: string;
  grand_total: string;
  updated_at: string | null;
};

type YearSummary = {
  sheets_count: number;
  disbursed_sheets_count: number;
  disbursed_amount: string;
};

const MONTH_LABELS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
];

const CATEGORY_LABEL: Record<string, string> = {
  TEACHING_STAFF: 'التدريسيون',
  EXTERNAL_LECTURER: 'المحاضرون',
  EMPLOYEE: 'الموظفون',
  DAILY_WORKER: 'الأجور اليومية',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'مسودة',
  SAVED: 'محفوظ',
  LOCKED: 'مقفل',
  DISBURSED: 'مصروف',
};

function formatMoney(v: string | number) {
  const n = Number(v || 0);
  return n.toLocaleString('en-IQ', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function DisbursementReportPageInner() {
  const searchParams = useSearchParams();
  const fiscalYearId = searchParams.get('fiscal_year_id') || '';
  const [year, setYear] = useState<FiscalYear | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [summary, setSummary] = useState<YearSummary>({
    sheets_count: 0,
    disbursed_sheets_count: 0,
    disbursed_amount: '0',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ report: '1' });
    if (fiscalYearId) qs.set('fiscal_year_id', fiscalYearId);
    const r = await fetchJson(`${API.disbursement}?${qs.toString()}`);
    if (!r.__ok) {
      setError(errMsg(r));
      setYear(null);
      setRows([]);
      setLoading(false);
      return;
    }
    setYear(r.data?.selected_year || null);
    setRows(Array.isArray(r.data?.report_rows) ? r.data.report_rows : []);
    setSummary({
      sheets_count: Number(r.data?.year_summary?.sheets_count || 0),
      disbursed_sheets_count: Number(r.data?.year_summary?.disbursed_sheets_count || 0),
      disbursed_amount: String(r.data?.year_summary?.disbursed_amount || '0'),
    });
    setLoading(false);
  }, [fiscalYearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAll = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.grand_total || 0), 0),
    [rows]
  );

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-xl font-bold text-gray-800">تقرير كشوفات الرواتب</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/payroll/disbursement${year?.id ? `?fiscal_year_id=${encodeURIComponent(year.id)}` : ''}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            ← العودة لصرف الرواتب
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900"
          >
            طباعة
          </button>
        </div>
      </div>
      <div className="print:hidden">
        <PayrollNav />
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-gray-600">السنة المالية</div>
        <div className="mt-1 text-lg font-bold text-red-950">
          {year ? `${year.code} — ${year.name_ar}` : '—'}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            عدد الكشوفات: <span className="font-bold">{summary.sheets_count}</span>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            كشوف مصروفة: <span className="font-bold">{summary.disbursed_sheets_count}</span>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            مبلغ المصروف:{' '}
            <span className="font-bold" dir="ltr">
              {formatMoney(summary.disbursed_amount)}
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-500">جاري التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">
          لا توجد كشوفات رواتب لهذه السنة بعد.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-red-950 text-white">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">الشهر</th>
                <th className="px-3 py-2 text-right font-semibold">الفئة</th>
                <th className="px-3 py-2 text-right font-semibold">الحالة</th>
                <th className="px-3 py-2 text-right font-semibold">الأشخاص</th>
                <th className="px-3 py-2 text-right font-semibold">الراتب الأساسي</th>
                <th className="px-3 py-2 text-right font-semibold">التكليفات</th>
                <th className="px-3 py-2 text-right font-semibold">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sheet_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    {MONTH_LABELS[row.month_number - 1] || row.month_number}
                  </td>
                  <td className="px-3 py-2">
                    {CATEGORY_LABEL[row.person_category] || row.person_category}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[row.status] || row.status}</td>
                  <td className="px-3 py-2">
                    {row.entered_count}/{row.people_count || '—'}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {formatMoney(row.base_total)}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {formatMoney(row.assignments_total)}
                  </td>
                  <td className="px-3 py-2 font-semibold" dir="ltr">
                    {formatMoney(row.grand_total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2" colSpan={6}>
                  إجمالي جميع الكشوفات
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {formatMoney(totalAll)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}

export default function DisbursementReportPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">جاري التحميل…</div>}>
      <DisbursementReportPageInner />
    </Suspense>
  );
}
