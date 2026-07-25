'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountsApi } from '../../entries/components/types';

type JournalRow = {
  entry_date: string;
  entry_number: string;
  entry_description: string;
  entry_type: string;
  source_type: string | null;
  source_id: string | null;
  reference_number: string | null;
  source_student_id: string | null;
  source_student_name: string | null;
  account_code: string;
  account_name_ar: string;
  cost_center_code?: string | null;
  cost_center_name_ar?: string | null;
  line_description?: string | null;
  line_number?: number;
  debit_amount: string;
  credit_amount: string;
  journal_entry_id: string;
  line_id: string;
};

type Totals = {
  total_debit: string;
  total_credit: string;
  page_debit: string;
  page_credit: string;
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  MANUAL: 'قيد يدوي',
  OPENING: 'قيد افتتاحي',
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند صرف',
  TRANSFER: 'تحويل',
  STUDENT_FEE: 'رسوم طلبة',
  SALARY: 'رواتب',
  ADJUSTMENT: 'تسوية',
  CLOSING: 'قيد إقفال',
  REVERSAL: 'قيد عكسي',
};

function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function moneyTotal(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(value);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

type EntryGroup = {
  journal_entry_id: string;
  entry_number: string;
  entry_date: string;
  entry_description: string;
  entry_type: string;
  source_type: string | null;
  reference_number: string | null;
  source_student_id: string | null;
  source_student_name: string | null;
  lines: JournalRow[];
  total_debit: number;
  total_credit: number;
};

export default function JournalBookPage() {
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<Array<{ id: string; code: string }>>([]);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; code: string; name_ar: string }>
  >([]);
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [entryType, setEntryType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entryNumber, setEntryNumber] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLines, setTotalLines] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (fiscalYearId) params.set('fiscal_year_id', fiscalYearId);
    if (accountId) params.set('account_id', accountId);
    if (entryType) params.set('entry_type', entryType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (entryNumber.trim()) params.set('entry_number', entryNumber.trim());

    const res = await accountsApi<JournalRow[]>(
      `/api/accounts/reports/journal?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل دفتر اليومية');
      setRows([]);
      setTotals(null);
    } else {
      setRows((res.data as JournalRow[]) || []);
      setTotals((res.totals as Totals) || null);
      const pg = res.pagination as
        | { total_pages?: number; total?: number }
        | undefined;
      setTotalPages(pg?.total_pages || 1);
      setTotalLines(pg?.total || 0);
      setError(null);
    }
    setLoading(false);
  }, [page, fiscalYearId, accountId, entryType, dateFrom, dateTo, entryNumber]);

  useEffect(() => {
    void (async () => {
      const opt = await accountsApi<{
        fiscal_years: Array<{ id: string; code: string }>;
        default_fiscal_year: { id: string } | null;
        posting_accounts: Array<{ id: string; code: string; name_ar: string }>;
      }>('/api/accounts/journal-entries/options');
      if (opt.success && opt.data) {
        setYears(opt.data.fiscal_years || []);
        setAccounts(opt.data.posting_accounts || []);
        if (opt.data.default_fiscal_year?.id) {
          setFiscalYearId(opt.data.default_fiscal_year.id);
        }
      }
    })();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fiscalYearId, accountId, entryType]);

  const groups = useMemo<EntryGroup[]>(() => {
    const map = new Map<string, EntryGroup>();
    for (const row of rows) {
      let group = map.get(row.journal_entry_id);
      if (!group) {
        group = {
          journal_entry_id: row.journal_entry_id,
          entry_number: row.entry_number,
          entry_date: row.entry_date,
          entry_description: row.entry_description,
          entry_type: row.entry_type,
          source_type: row.source_type,
          reference_number: row.reference_number,
          source_student_id: row.source_student_id,
          source_student_name: row.source_student_name,
          lines: [],
          total_debit: 0,
          total_credit: 0,
        };
        map.set(row.journal_entry_id, group);
      }
      group.lines.push(row);
      group.total_debit += Number(row.debit_amount) || 0;
      group.total_credit += Number(row.credit_amount) || 0;
    }
    return Array.from(map.values());
  }, [rows]);

  function applyFilters() {
    setPage(1);
    void load();
  }

  function resetFilters() {
    setAccountId('');
    setEntryType('');
    setDateFrom('');
    setDateTo('');
    setEntryNumber('');
    setPage(1);
  }

  return (
    <div className="p-6 w-full" dir="rtl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">دفتر اليومية</h1>
          <p className="text-sm text-gray-600 mt-1">
            سجل القيود المرحلة (POSTED) — مدين / دائن
          </p>
        </div>
        <Link
          href="/accounts/entries"
          className="text-sm text-red-900 hover:underline"
        >
          → العودة للقيود
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm mb-4">
        <div className="bg-red-950 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-red-100/80">بحث وفلترة</p>
            <p className="text-sm font-semibold">سجل اليومية العامة</p>
          </div>
          <p className="text-xs text-red-100/90">
            {totalLines > 0 ? `${totalLines} سطر قيد` : ''}
          </p>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              السنة المالية
            </label>
            <select
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              value={fiscalYearId}
              onChange={(e) => {
                setFiscalYearId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل السنوات</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              نوع القيد
            </label>
            <select
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              value={entryType}
              onChange={(e) => {
                setEntryType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الأنواع</option>
              {Object.entries(ENTRY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
            <input
              type="date"
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              إلى تاريخ
            </label>
            <input
              type="date"
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              رقم القيد
            </label>
            <input
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              placeholder="JV-…"
              value={entryNumber}
              onChange={(e) => setEntryNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">الحساب</label>
            <select
              className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الحسابات</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name_ar}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-4 pb-4 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            إعادة تعيين
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-md bg-red-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
          >
            تطبيق الفلاتر
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-gray-500 text-sm">
          جارٍ تحميل دفتر اليومية…
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-gray-300 rounded-lg bg-white">
          <p className="text-gray-700 font-medium">لا توجد قيود مرحلة مطابقة</p>
          <p className="text-sm text-gray-500 mt-1">
            عدّل الفلاتر أو أنشئ قيوداً جديدة (وصولات التسديد تُرحَّل تلقائياً).
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-red-950 text-white">
              <tr>
                <th className="px-3 py-2.5 text-right font-medium w-24">
                  التاريخ
                </th>
                <th className="px-3 py-2.5 text-right font-medium w-36">
                  رقم القيد
                </th>
                <th className="px-3 py-2.5 pe-5 text-right font-medium min-w-[220px] w-[28%]">
                  الحساب
                </th>
                <th className="px-3 py-2.5 ps-5 text-right font-medium min-w-[240px] w-[32%]">
                  البيان
                </th>
                <th className="px-3 py-2.5 text-left font-medium w-32">
                  مدين
                </th>
                <th className="px-3 py-2.5 text-left font-medium w-32">
                  دائن
                </th>
                <th className="px-3 py-2.5 text-right font-medium w-36">
                  المرجع
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody
                key={group.journal_entry_id}
                className="border-b-2 border-gray-200"
              >
                <tr className="bg-slate-100/80">
                  <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">
                    {formatDate(group.entry_date)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-red-950">
                    {group.entry_number}
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-gray-800">
                    <span className="font-medium">
                      {group.entry_description}
                    </span>
                    <span className="mr-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-900">
                      {ENTRY_TYPE_LABELS[group.entry_type] || group.entry_type}
                    </span>
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">
                    {group.source_type === 'STUDENT_SETTLEMENT_RECEIPT' &&
                    group.source_student_id ? (
                      <Link
                        href={`/accounts/students/accounts/student/${group.source_student_id}`}
                        className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-900 hover:bg-red-100"
                        title={
                          group.source_student_name
                            ? `وصل ${group.reference_number} — ${group.source_student_name}`
                            : `وصل ${group.reference_number}`
                        }
                      >
                        عرض الوصل {group.reference_number}
                      </Link>
                    ) : group.reference_number ? (
                      <span
                        className="font-mono text-[11px] text-gray-600"
                        dir="ltr"
                      >
                        {group.reference_number}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
                {group.lines.map((line) => (
                  <tr key={line.line_id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5 pe-5 align-top min-w-[220px]">
                      <span className="font-mono text-xs text-gray-500 ml-1">
                        {line.account_code}
                      </span>
                      <span
                        className={
                          Number(line.debit_amount) > 0
                            ? 'text-gray-900 font-medium'
                            : 'text-gray-700'
                        }
                      >
                        {Number(line.credit_amount) > 0 ? (
                          <span className="text-gray-400 mx-1">إلى</span>
                        ) : null}
                        {line.account_name_ar}
                      </span>
                      {line.cost_center_code ? (
                        <span className="block text-[10px] text-gray-400 mt-0.5">
                          مركز كلفة: {line.cost_center_code} —{' '}
                          {line.cost_center_name_ar}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 ps-5 align-top text-xs text-gray-500 min-w-[240px] border-r border-gray-100">
                      {line.line_description || '—'}
                    </td>
                    <td
                      className="px-3 py-1.5 text-left font-mono text-xs font-semibold text-emerald-800"
                      dir="ltr"
                    >
                      {money(line.debit_amount)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-left font-mono text-xs font-semibold text-red-800"
                      dir="ltr"
                    >
                      {money(line.credit_amount)}
                    </td>
                    <td className="px-3 py-1.5" />
                  </tr>
                ))}
                <tr className="bg-slate-50 text-xs">
                  <td className="px-3 py-1.5" colSpan={4}>
                    <span className="text-gray-500">إجمالي القيد</span>
                  </td>
                  <td
                    className="px-3 py-1.5 text-left font-mono font-bold text-emerald-900"
                    dir="ltr"
                  >
                    {moneyTotal(group.total_debit)}
                  </td>
                  <td
                    className="px-3 py-1.5 text-left font-mono font-bold text-red-900"
                    dir="ltr"
                  >
                    {moneyTotal(group.total_credit)}
                  </td>
                  <td className="px-3 py-1.5" />
                </tr>
              </tbody>
            ))}
            {totals ? (
              <tfoot>
                <tr className="bg-red-950 text-white text-xs">
                  <td className="px-3 py-2.5 font-semibold" colSpan={4}>
                    إجمالي الصفحة ({groups.length} قيد)
                  </td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold" dir="ltr">
                    {moneyTotal(totals.page_debit)}
                  </td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold" dir="ltr">
                    {moneyTotal(totals.page_credit)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
                <tr className="bg-red-900 text-white text-xs">
                  <td className="px-3 py-2.5 font-semibold" colSpan={4}>
                    الإجمالي العام (كل النتائج)
                  </td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold" dir="ltr">
                    {moneyTotal(totals.total_debit)}
                  </td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold" dir="ltr">
                    {moneyTotal(totals.total_credit)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-sm">
        <button
          type="button"
          disabled={page <= 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          السابق
        </button>
        <span className="text-xs text-gray-600">
          صفحة {page} من {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          onClick={() => setPage((p) => p + 1)}
        >
          التالي
        </button>
      </div>
    </div>
  );
}
