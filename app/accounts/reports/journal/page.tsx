'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { accountsApi } from '../../entries/components/types';

type Row = {
  entry_date: string;
  entry_number: string;
  entry_description: string;
  entry_type: string;
  account_code: string;
  account_name_ar: string;
  cost_center_code?: string | null;
  cost_center_name_ar?: string | null;
  line_description?: string | null;
  debit_amount: string;
  credit_amount: string;
};

export default function JournalBookPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<Array<{ id: string; code: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name_ar: string }>>(
    []
  );
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entryNumber, setEntryNumber] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totals, setTotals] = useState<{
    total_debit: string;
    total_credit: string;
    page_debit: string;
    page_credit: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (fiscalYearId) params.set('fiscal_year_id', fiscalYearId);
    if (accountId) params.set('account_id', accountId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (entryNumber.trim()) params.set('entry_number', entryNumber.trim());

    const res = await accountsApi<Row[]>(`/api/accounts/reports/journal?${params}`);
    if (!res.success) {
      setError(res.message || 'تعذر تحميل دفتر اليومية');
      setRows([]);
    } else {
      setRows((res.data as Row[]) || []);
      setTotals((res.totals as typeof totals) || null);
      setTotalPages((res.pagination as { total_pages?: number })?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  };

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
    if (!fiscalYearId && years.length === 0) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fiscalYearId, accountId]);

  return (
    <div className="p-4 md:p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">دفتر اليومية</h1>
            <p className="text-sm text-gray-600 mt-1">عرض سطور القيود المرحلة (POSTED) فقط.</p>
          </div>
          <Link href="/accounts/entries" className="text-sm text-red-900 hover:underline">
            العودة للقيود
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
          <select
            className="border rounded-md px-3 py-2"
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
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <input
            className="border rounded-md px-3 py-2"
            placeholder="رقم القيد"
            value={entryNumber}
            onChange={(e) => setEntryNumber(e.target.value)}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-red-900 text-white"
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            تطبيق
          </button>
        </div>

        <select
          className="border rounded-md px-3 py-2 mb-4 w-full md:w-1/2"
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

        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

        {loading ? (
          <div className="py-12 text-center text-gray-500">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-500 border border-dashed rounded-lg">
            لا توجد قيود مرحلة مطابقة
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full text-sm text-right">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2">التاريخ</th>
                  <th className="px-2 py-2">رقم القيد</th>
                  <th className="px-2 py-2">الوصف</th>
                  <th className="px-2 py-2">الحساب</th>
                  <th className="px-2 py-2">مركز الكلفة</th>
                  <th className="px-2 py-2">مدين</th>
                  <th className="px-2 py-2">دائن</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.entry_number}-${i}`} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{r.entry_date}</td>
                    <td className="px-2 py-1 font-mono">{r.entry_number}</td>
                    <td className="px-2 py-1 max-w-[180px] truncate">{r.entry_description}</td>
                    <td className="px-2 py-1">
                      <span className="font-mono">{r.account_code}</span> {r.account_name_ar}
                    </td>
                    <td className="px-2 py-1">
                      {r.cost_center_code
                        ? `${r.cost_center_code} — ${r.cost_center_name_ar}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1 font-mono">{r.debit_amount}</td>
                    <td className="px-2 py-1 font-mono">{r.credit_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totals && (
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <span>
              مجموع الصفحة مدين: <strong className="font-mono">{totals.page_debit}</strong>
            </span>
            <span>
              مجموع الصفحة دائن: <strong className="font-mono">{totals.page_credit}</strong>
            </span>
            <span>
              الإجمالي مدين: <strong className="font-mono">{totals.total_debit}</strong>
            </span>
            <span>
              الإجمالي دائن: <strong className="font-mono">{totals.total_credit}</strong>
            </span>
          </div>
        )}

        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            className="px-3 py-1 rounded border disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            السابق
          </button>
          <span>
            صفحة {page} من {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border disabled:opacity-40"
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      </div>
    </div>
  );
}
