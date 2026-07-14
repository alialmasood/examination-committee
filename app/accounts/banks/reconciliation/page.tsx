'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  bankApi,
  BankStatementListItem,
  BankStatementOptions,
  BankStatementStats,
  formatDateOnly,
  formatMoney,
  STATEMENT_STATUS_LABEL,
  statementStatusClass,
} from './components/types';

export default function BankReconciliationListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BankStatementListItem[]>([]);
  const [stats, setStats] = useState<BankStatementStats | null>(null);
  const [options, setOptions] = useState<BankStatementOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankId, setBankId] = useState('');
  const [currency, setCurrency] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    bank_account_id: '',
    external_statement_reference: '',
    date_from: '',
    date_to: '',
    opening_balance: '0',
    closing_balance: '0',
    notes: '',
  });

  const loadOptions = useCallback(async () => {
    const res = await bankApi<BankStatementOptions>(
      '/api/accounts/bank-statements/options'
    );
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (bankAccountId) params.set('bank_account_id', bankAccountId);
    if (bankId) params.set('bank_id', bankId);
    if (currency) params.set('currency', currency);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    const res = await bankApi<BankStatementListItem[]>(
      `/api/accounts/bank-statements?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل كشوف الحساب المصرفي');
      setRows([]);
    } else {
      setRows(res.data || []);
      setStats((res.stats as BankStatementStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [page, q, status, bankAccountId, bankId, currency, dateFrom, dateTo]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional filter deps
  }, [page, status, bankAccountId, bankId, currency, dateFrom, dateTo]);

  const openForm = () => {
    setFormError(null);
    setForm({
      bank_account_id: '',
      external_statement_reference: '',
      date_from: '',
      date_to: '',
      opening_balance: '0',
      closing_balance: '0',
      notes: '',
    });
    setFormOpen(true);
  };

  const createStatement = async () => {
    setBusy(true);
    setFormError(null);
    const res = await bankApi<{ id: string }>('/api/accounts/bank-statements', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.success || !res.data) {
      setFormError(res.message || 'تعذر إنشاء كشف الحساب');
      return;
    }
    setFormOpen(false);
    await load();
    router.push(`/accounts/banks/reconciliation/${res.data.id}`);
  };

  const selectedAccount = options?.bank_accounts.find(
    (a) => a.id === form.bank_account_id
  );

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link href="/accounts/banks" className="hover:text-red-900">
                الحسابات المصرفية
              </Link>
              <span> / التسوية المصرفية</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              كشوف الحساب والتسوية المصرفية
            </h1>
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
            onClick={openForm}
          >
            كشف حساب جديد
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Stat label="مسودة" value={String(stats.draft)} />
            <Stat label="قيد المعالجة" value={String(stats.in_progress)} />
            <Stat label="مُسوّاة" value={String(stats.reconciled)} />
            <Stat label="مغلقة" value={String(stats.closed)} />
            <Stat label="ملغاة" value={String(stats.cancelled)} />
          </div>
        )}

        <div className="grid md:grid-cols-6 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="بحث: رقم الكشف / مرجع / ملاحظات"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                void load();
              }
            }}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATEMENT_STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={bankAccountId}
            onChange={(e) => {
              setBankAccountId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الحسابات</option>
            {(options?.bank_accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.account_name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={bankId}
            onChange={(e) => {
              setBankId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل المصارف</option>
            {(options?.banks || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name_ar}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="px-3 py-2 rounded-md border text-sm"
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            بحث
          </button>
        </div>
        <div className="grid md:grid-cols-4 gap-2">
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل العملات</option>
            <option value="IQD">IQD</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <input
            type="date"
            className="border rounded-md px-3 py-2 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right px-2 py-2">رقم الكشف</th>
                <th className="text-right px-2 py-2">الحساب المصرفي</th>
                <th className="text-right px-2 py-2">الفترة</th>
                <th className="text-right px-2 py-2">الافتتاحي</th>
                <th className="text-right px-2 py-2">الختامي</th>
                <th className="text-right px-2 py-2">العملة</th>
                <th className="text-right px-2 py-2">السطور</th>
                <th className="text-right px-2 py-2">الحالة</th>
                <th className="text-right px-2 py-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                    جارٍ التحميل…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                    لا توجد كشوف حساب
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2 font-mono text-xs">
                      <Link
                        href={`/accounts/banks/reconciliation/${r.id}`}
                        className="text-red-900 underline"
                      >
                        {r.statement_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.bank_account_code}
                      {r.bank_name_ar ? (
                        <span className="text-gray-500 block">{r.bank_name_ar}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {formatDateOnly(r.date_from)} — {formatDateOnly(r.date_to)}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoney(r.opening_balance, r.currency_code)}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoney(r.closing_balance, r.currency_code)}
                    </td>
                    <td className="px-2 py-2">{r.currency_code}</td>
                    <td className="px-2 py-2 text-xs">
                      {r.matched_lines_count ?? 0} / {r.lines_count ?? 0}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${statementStatusClass(r.status)}`}
                      >
                        {STATEMENT_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link
                        href={`/accounts/banks/reconciliation/${r.id}`}
                        className="text-red-900 underline text-xs"
                      >
                        فتح
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              className="px-2 py-1 border rounded disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              السابق
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="px-2 py-1 border rounded disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              التالي
            </button>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">كشف حساب مصرفي جديد</h3>
            {formError && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}
            <label className="block text-sm">
              الحساب المصرفي
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.bank_account_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bank_account_id: e.target.value }))
                }
              >
                <option value="">اختر الحساب المصرفي</option>
                {(options?.bank_accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.account_name_ar} ({a.currency_code})
                  </option>
                ))}
              </select>
            </label>
            {selectedAccount && (
              <p className="text-xs text-gray-600">
                {selectedAccount.bank_name_ar}
                {selectedAccount.branch_name_ar ? ` · ${selectedAccount.branch_name_ar}` : ''}
                {' · '}حساب GL: {selectedAccount.gl_account_code} —{' '}
                {selectedAccount.gl_account_name_ar}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                من تاريخ
                <input
                  type="date"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.date_from}
                  onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                إلى تاريخ
                <input
                  type="date"
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.date_to}
                  onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                الرصيد الافتتاحي
                <input
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.opening_balance}
                  inputMode="decimal"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, opening_balance: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                الرصيد الختامي
                <input
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.closing_balance}
                  inputMode="decimal"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, closing_balance: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="block text-sm">
              المرجع الخارجي (رقم كشف المصرف)
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.external_statement_reference}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    external_statement_reference: e.target.value,
                  }))
                }
              />
            </label>
            <label className="block text-sm">
              ملاحظات
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-2 border rounded-md text-sm"
                disabled={busy}
                onClick={() => setFormOpen(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy || !form.bank_account_id || !form.date_from || !form.date_to}
                onClick={() => void createStatement()}
              >
                إنشاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold text-red-950">{value}</div>
    </div>
  );
}
