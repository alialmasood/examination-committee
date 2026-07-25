'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PayrollNav from '../PayrollNav';
import { API, errMsg, fetchJson } from '../_lib';

type FiscalYear = {
  id: string;
  code: string;
  name_ar: string;
  status: string;
  is_default: boolean;
};

type SheetSummary = {
  person_category: string;
  status: string;
  people_count: number;
  entered_count: number;
  base_total: string;
  assignments_total: string;
  grand_total: string;
};

type MonthCard = {
  month_number: number;
  month_label: string;
  status: string;
  month_id: string | null;
  sheets: SheetSummary[];
};

type YearSummary = {
  sheets_count: number;
  disbursed_sheets_count: number;
  disbursed_amount: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  TEACHING_STAFF: 'رواتب التدريسيين',
  EXTERNAL_LECTURER: 'رواتب المحاضرين',
  EMPLOYEE: 'رواتب الموظفين',
  DAILY_WORKER: 'رواتب الأجور اليومية',
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
  const n = Number(v || 0);
  return n.toLocaleString('en-IQ', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export default function DisbursementPage() {
  const router = useRouter();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState('');
  const [months, setMonths] = useState<MonthCard[]>([]);
  const [yearTotals, setYearTotals] = useState<YearSummary>({
    sheets_count: 0,
    disbursed_sheets_count: 0,
    disbursed_amount: '0',
  });
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (yearId = '') => {
    setLoading(true);
    setError('');
    const qs = yearId ? `?fiscal_year_id=${encodeURIComponent(yearId)}` : '';
    const r = await fetchJson(`${API.disbursement}${qs}`);
    if (!r.__ok) {
      setError(errMsg(r));
      setYears([]);
      setMonths([]);
      setSelectedYearId('');
      setYearTotals({ sheets_count: 0, disbursed_sheets_count: 0, disbursed_amount: '0' });
      setLoading(false);
      return;
    }
    setYears(Array.isArray(r.data?.years) ? r.data.years : []);
    setMonths(Array.isArray(r.data?.months) ? r.data.months : []);
    setSelectedYearId(r.data?.selected_year?.id || '');
    setYearTotals({
      sheets_count: Number(r.data?.year_summary?.sheets_count || 0),
      disbursed_sheets_count: Number(r.data?.year_summary?.disbursed_sheets_count || 0),
      disbursed_amount: String(r.data?.year_summary?.disbursed_amount || '0'),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const monthDetail = useMemo(
    () => months.find((m) => m.month_number === selectedMonth) ?? null,
    [months, selectedMonth]
  );

  const yearSummary = useMemo(() => {
    let saved = 0;
    let locked = 0;
    let disbursed = 0;
    for (const m of months) {
      if (m.status === 'SAVED') saved += 1;
      if (m.status === 'LOCKED') locked += 1;
      if (m.status === 'DISBURSED') disbursed += 1;
    }
    return { saved, locked, disbursed };
  }, [months]);

  async function openSheet(monthNumber: number, category: string) {
    if (!selectedYearId) {
      setError('اختر سنة مالية أولاً');
      return;
    }
    setOpening(true);
    setError('');
    const r = await fetchJson(API.disbursementSheets, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fiscal_year_id: selectedYearId,
        month_number: monthNumber,
        person_category: category,
      }),
    });
    setOpening(false);
    if (!r.__ok) {
      setError(errMsg(r));
      return;
    }
    const sheetId = r.data?.sheet?.id;
    if (!sheetId) {
      setError('تعذر فتح الكشف');
      return;
    }
    router.push(`/accounts/payroll/disbursement/sheet/${sheetId}`);
  }

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">صرف الرواتب</h1>
      </div>
      <PayrollNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
          محفوظ: <span className="font-semibold">{yearSummary.saved}</span>
        </div>
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
          مقفل: <span className="font-semibold">{yearSummary.locked}</span>
        </div>
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
          مصروف: <span className="font-semibold">{yearSummary.disbursed}</span>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-xs font-semibold text-gray-600">السنة المالية</div>
        <div className="flex flex-wrap items-center gap-2">
          {years.map((y) => (
            <button
              key={y.id}
              type="button"
              onClick={() => {
                setSelectedMonth(null);
                void load(y.id);
              }}
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                selectedYearId === y.id
                  ? 'border-red-900 bg-red-950 text-white'
                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
              }`}
            >
              {y.code}
              {y.is_default ? ' (افتراضي)' : ''}
            </button>
          ))}
          {!loading && years.length === 0 && (
            <span className="text-sm text-gray-500">لا توجد سنوات مالية</span>
          )}

          <div className="mx-1 hidden h-8 w-px bg-gray-200 sm:block" />

          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
            عدد كشوفات الرواتب:{' '}
            <span className="font-bold text-red-950">{yearTotals.sheets_count}</span>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            مبلغ الرواتب المصروف:{' '}
            <span className="font-bold" dir="ltr">
              {formatMoney(yearTotals.disbursed_amount)}
            </span>
          </div>

          {selectedYearId ? (
            <Link
              href={`/accounts/payroll/disbursement/report?fiscal_year_id=${encodeURIComponent(selectedYearId)}`}
              className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900"
            >
              تقرير كشوفات الرواتب
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-400"
            >
              تقرير كشوفات الرواتب
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-500">جاري التحميل…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {months.map((m) => (
              <button
                key={m.month_number}
                type="button"
                onClick={() => setSelectedMonth(m.month_number)}
                className={`rounded-lg border p-3 text-right shadow-sm transition ${
                  selectedMonth === m.month_number
                    ? 'border-red-900 bg-red-50'
                    : 'border-gray-200 bg-white hover:border-red-300'
                }`}
              >
                <div className="text-sm font-bold text-gray-900">{m.month_label}</div>
                <div className="mt-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
                      m.status
                    )}`}
                  >
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {monthDetail && (
            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-800">
                  صرف راتب {monthDetail.month_label}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-1 text-xs font-semibold ${statusBadgeClass(
                      monthDetail.status
                    )}`}
                  >
                    {STATUS_LABEL[monthDetail.status] || monthDetail.status}
                  </span>
                  <Link
                    href={`/accounts/payroll/disbursement/month-report?fiscal_year_id=${encodeURIComponent(
                      selectedYearId
                    )}&month_number=${monthDetail.month_number}`}
                    className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900"
                  >
                    تقرير رواتب شهر {monthDetail.month_label}
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {monthDetail.sheets.map((sheet) => (
                  <button
                    key={sheet.person_category}
                    type="button"
                    disabled={opening}
                    onClick={() => void openSheet(monthDetail.month_number, sheet.person_category)}
                    className="rounded-lg border border-gray-200 bg-white p-4 text-right shadow-sm hover:border-red-800 hover:bg-red-50/40 disabled:opacity-60"
                  >
                    <div className="text-sm font-bold text-red-950">
                      {CATEGORY_LABEL[sheet.person_category] || sheet.person_category}
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-gray-600">
                      <div>
                        الأشخاص:{' '}
                        <span className="font-semibold text-gray-900">
                          {sheet.entered_count}/{sheet.people_count || '—'}
                        </span>
                      </div>
                      <div>
                        الإجمالي:{' '}
                        <span className="font-semibold text-gray-900" dir="ltr">
                          {formatMoney(sheet.grand_total)}
                        </span>
                      </div>
                      <div>
                        الحالة:{' '}
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${statusBadgeClass(sheet.status)}`}>
                          {STATUS_LABEL[sheet.status] || sheet.status}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 text-xs font-semibold text-red-900">
                      {opening ? 'جاري الفتح…' : 'فتح الكشف ←'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
