'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';
import {
  bankApi,
  BankTransferListItem,
  BankTransferOptions,
  BankTransferStats,
  formatDateOnly,
  formatMoney,
  TRANSFER_STATUS_LABEL,
  transferStatusClass,
} from './components/types';

export default function BankTransfersPage() {
  const router = useRouter();
  const [presetSourceId, setPresetSourceId] = useState('');
  const [rows, setRows] = useState<BankTransferListItem[]>([]);
  const [stats, setStats] = useState<BankTransferStats | null>(null);
  const [options, setOptions] = useState<BankTransferOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [currency, setCurrency] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [form, setForm] = useState({
    source_bank_account_id: '',
    destination_bank_account_id: '',
    transfer_date: new Date().toISOString().slice(0, 10),
    value_date: '',
    amount: '',
    fee_amount: '0',
    fee_expense_account_id: '',
    cost_center_id: '',
    bank_reference: '',
    external_reference: '',
    description: 'تحويل بين حسابين مصرفيين',
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const source = sp.get('source_bank_account_id') || '';
    const account = sp.get('bank_account_id') || '';
    setPresetSourceId(source);
    if (source) {
      setSourceId(source);
      setForm((f) => ({ ...f, source_bank_account_id: source }));
      setFormOpen(true);
    }
    if (account) setBankAccountId(account);
  }, []);

  const loadOptions = useCallback(async () => {
    const params = new URLSearchParams();
    if (form.source_bank_account_id) {
      params.set('source_bank_account_id', form.source_bank_account_id);
    }
    const res = await bankApi<BankTransferOptions>(
      `/api/accounts/bank-transfers/options?${params.toString()}`
    );
    if (res.success && res.data) setOptions(res.data);
  }, [form.source_bank_account_id]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (sourceId) params.set('source_bank_account_id', sourceId);
    if (destId) params.set('destination_bank_account_id', destId);
    if (bankAccountId) params.set('bank_account_id', bankAccountId);
    if (currency) params.set('currency', currency);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bankReference.trim()) params.set('bank_reference', bankReference.trim());

    const res = await bankApi<BankTransferListItem[]>(
      `/api/accounts/bank-transfers?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل التحويلات');
      setRows([]);
    } else {
      setRows(res.data || []);
      setStats((res.stats as BankTransferStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [
    page,
    q,
    status,
    sourceId,
    destId,
    bankAccountId,
    currency,
    dateFrom,
    dateTo,
    bankReference,
  ]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional filter deps
  }, [page, status, sourceId, destId, bankAccountId, currency, dateFrom, dateTo]);

  const selectedSource = options?.bank_accounts.find(
    (a) => a.id === form.source_bank_account_id
  );
  const bookBalance = options?.book_balance;

  const destinationOptions = (() => {
    const accounts = options?.bank_accounts || [];
    if (!selectedSource) {
      return accounts.filter((a) => a.id !== form.source_bank_account_id);
    }
    return accounts.filter(
      (a) =>
        a.id !== form.source_bank_account_id &&
        a.currency_code === selectedSource.currency_code
    );
  })();

  const amountNum = Number(form.amount) || 0;
  const feeNum = Number(form.fee_amount) || 0;
  const totalDebit = amountNum + feeNum;
  const balanceNum =
    bookBalance && form.source_bank_account_id === bookBalance.bank_account_id
      ? Number(bookBalance.book_balance)
      : null;
  const exceedsBalance =
    balanceNum != null && Number.isFinite(balanceNum) && totalDebit > balanceNum;

  const openForm = () => {
    setFormError(null);
    setForm((f) => ({
      ...f,
      source_bank_account_id:
        sourceId || presetSourceId || f.source_bank_account_id,
      description: f.description || 'تحويل بين حسابين مصرفيين',
    }));
    setFormOpen(true);
  };

  const createTransfer = async (andPost: boolean) => {
    setBusy(true);
    setFormError(null);
    const fee = Number(form.fee_amount) || 0;
    const res = await bankApi<{ id: string; version: number; updated_at: string }>(
      '/api/accounts/bank-transfers',
      {
        method: 'POST',
        body: JSON.stringify({
          source_bank_account_id: form.source_bank_account_id,
          destination_bank_account_id: form.destination_bank_account_id,
          transfer_date: form.transfer_date,
          value_date: form.value_date || null,
          amount: form.amount,
          fee_amount: form.fee_amount || '0',
          fee_expense_account_id:
            fee > 0 ? form.fee_expense_account_id || null : null,
          cost_center_id: form.cost_center_id || null,
          bank_reference: form.bank_reference || null,
          external_reference: form.external_reference || null,
          description: form.description,
        }),
      }
    );
    if (!res.success || !res.data) {
      setFormError(res.message || 'تعذر إنشاء التحويل');
      setBusy(false);
      return;
    }
    if (andPost) {
      const post = await bankApi(
        `/api/accounts/bank-transfers/${res.data.id}/post`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: res.data.version,
            updated_at: res.data.updated_at,
          }),
        }
      );
      setBusy(false);
      if (!post.success) {
        setFormError(post.message || 'تم الحفظ كمسودة لكن فشل الترحيل');
        await load();
        return;
      }
    } else {
      setBusy(false);
    }
    setFormOpen(false);
    await load();
    router.push(`/accounts/banks/transfers/${res.data.id}`);
  };

  const doPost = async () => {
    if (!confirmPostId) return;
    const row = rows.find((r) => r.id === confirmPostId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-transfers/${row.id}/post`, {
      method: 'POST',
      body: JSON.stringify({ version: row.version, updated_at: row.updated_at }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الترحيل');
      return;
    }
    setConfirmPostId(null);
    await load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link href="/accounts/banks" className="hover:text-red-900">
                الحسابات المصرفية
              </Link>
              <span> / تحويلات مصرفية</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              التحويلات بين الحسابات المصرفية
            </h1>
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
            onClick={openForm}
          >
            تحويل جديد
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Stat label="مسودة" value={String(stats.draft)} />
            <Stat label="مرحّل" value={String(stats.posted)} />
            <Stat label="ملغى" value={String(stats.voided)} />
            <Stat
              label="إجمالي التحويلات"
              value={formatMoney(stats.transfers_total)}
            />
            <Stat label="إجمالي الرسوم" value={formatMoney(stats.fees_total)} />
          </div>
        )}

        <div className="grid md:grid-cols-6 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="بحث: رقم / بيان / مرجع"
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
            <option value="DRAFT">مسودة</option>
            <option value="POSTED">مرحّل</option>
            <option value="VOID">ملغى</option>
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">الحساب المصدر</option>
            {(options?.bank_accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.account_name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={destId}
            onChange={(e) => {
              setDestId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">الحساب الوجهة</option>
            {(options?.bank_accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.account_name_ar}
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
          <input
            className="border rounded-md px-3 py-2 text-sm"
            placeholder="مرجع بنكي"
            value={bankReference}
            onChange={(e) => setBankReference(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                void load();
              }
            }}
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
                <th className="text-right px-2 py-2">الرقم</th>
                <th className="text-right px-2 py-2">التاريخ</th>
                <th className="text-right px-2 py-2">المصدر</th>
                <th className="text-right px-2 py-2">الوجهة</th>
                <th className="text-right px-2 py-2">المبلغ</th>
                <th className="text-right px-2 py-2">الرسوم</th>
                <th className="text-right px-2 py-2">العملة</th>
                <th className="text-right px-2 py-2">الحالة</th>
                <th className="text-right px-2 py-2">مرجع بنكي</th>
                <th className="text-right px-2 py-2">القيد</th>
                <th className="text-right px-2 py-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                    جارٍ التحميل…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                    لا توجد تحويلات
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2 font-mono text-xs">
                      <Link
                        href={`/accounts/banks/transfers/${r.id}`}
                        className="text-red-900 underline"
                      >
                        {r.transfer_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{formatDateOnly(r.transfer_date)}</td>
                    <td className="px-2 py-2 text-xs">
                      {r.source_code}
                      {r.source_bank_name_ar ? (
                        <span className="text-gray-500 block">
                          {r.source_bank_name_ar}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.destination_code}
                      {r.destination_bank_name_ar ? (
                        <span className="text-gray-500 block">
                          {r.destination_bank_name_ar}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoney(r.amount, r.currency_code)}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoney(r.fee_amount, r.currency_code)}
                    </td>
                    <td className="px-2 py-2">{r.currency_code}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${transferStatusClass(r.status)}`}
                      >
                        {TRANSFER_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">{r.bank_reference || '—'}</td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {r.journal_entry_number || '—'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap space-x-1 space-x-reverse">
                      <Link
                        href={`/accounts/banks/transfers/${r.id}`}
                        className="text-red-900 underline text-xs"
                      >
                        عرض
                      </Link>
                      {r.status === 'DRAFT' && (
                        <button
                          type="button"
                          className="text-green-800 underline text-xs"
                          onClick={() => {
                            setActionError(null);
                            setConfirmPostId(r.id);
                          }}
                        >
                          ترحيل
                        </button>
                      )}
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
            <h3 className="text-lg font-semibold">تحويل مصرفي جديد</h3>
            {formError && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}
            <label className="block text-sm">
              الحساب المصدر
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.source_bank_account_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    source_bank_account_id: e.target.value,
                    destination_bank_account_id:
                      f.destination_bank_account_id === e.target.value
                        ? ''
                        : f.destination_bank_account_id,
                  }))
                }
              >
                <option value="">اختر الحساب المصدر</option>
                {(options?.bank_accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.account_name_ar} ({a.currency_code})
                  </option>
                ))}
              </select>
            </label>
            {selectedSource && (
              <p className="text-xs text-gray-600">
                {selectedSource.bank_name_ar}
                {selectedSource.branch_name_ar
                  ? ` · ${selectedSource.branch_name_ar}`
                  : ''}{' '}
                · حساب GL: {selectedSource.gl_account_code} —{' '}
                {selectedSource.gl_account_name_ar}
              </p>
            )}
            {bookBalance &&
              form.source_bank_account_id === bookBalance.bank_account_id && (
                <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                  الرصيد الدفتري للمصدر:{' '}
                  {formatMoney(
                    bookBalance.book_balance,
                    bookBalance.currency_code
                  )}
                </p>
              )}
            <label className="block text-sm">
              الحساب الوجهة
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.destination_bank_account_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    destination_bank_account_id: e.target.value,
                  }))
                }
              >
                <option value="">اختر الحساب الوجهة</option>
                {destinationOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.account_name_ar} ({a.currency_code})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              تاريخ التحويل
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.transfer_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, transfer_date: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              تاريخ القيمة (اختياري)
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.value_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, value_date: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              المبلغ
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.amount}
                inputMode="decimal"
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              رسوم التحويل
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.fee_amount}
                inputMode="decimal"
                onChange={(e) =>
                  setForm((f) => ({ ...f, fee_amount: e.target.value }))
                }
              />
            </label>
            {feeNum > 0 && (
              <label className="block text-sm">
                حساب مصروف الرسوم
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={form.fee_expense_account_id}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fee_expense_account_id: e.target.value,
                    }))
                  }
                >
                  <option value="">اختر الحساب</option>
                  {(options?.fee_accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name_ar}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              مركز الكلفة
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.cost_center_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cost_center_id: e.target.value }))
                }
              >
                <option value="">—</option>
                {(options?.cost_centers || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              المرجع البنكي
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.bank_reference}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bank_reference: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              المرجع الخارجي
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.external_reference}
                onChange={(e) =>
                  setForm((f) => ({ ...f, external_reference: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              البيان
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </label>
            {amountNum > 0 && (
              <div
                className={`text-xs rounded px-2 py-1.5 border ${
                  exceedsBalance
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              >
                إجمالي المدين (المبلغ + الرسوم):{' '}
                {formatMoney(
                  totalDebit,
                  selectedSource?.currency_code || bookBalance?.currency_code || 'IQD'
                )}
                {exceedsBalance && (
                  <span className="block mt-1 font-medium">
                    تحذير: الإجمالي أكبر من الرصيد الدفتري للمصدر.
                  </span>
                )}
              </div>
            )}
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
                className="px-3 py-2 border rounded-md text-sm"
                disabled={
                  busy ||
                  !form.source_bank_account_id ||
                  !form.destination_bank_account_id
                }
                onClick={() => void createTransfer(false)}
              >
                حفظ مسودة
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={
                  busy ||
                  !form.source_bank_account_id ||
                  !form.destination_bank_account_id
                }
                onClick={() => void createTransfer(true)}
              >
                حفظ وترحيل
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPostId)}
        title="تأكيد ترحيل التحويل"
        message="سيتم إنشاء قيد محاسبي وتحويل المبلغ بين الحسابين المصرفيين. لن يمكن تعديل البيانات المالية بعد الترحيل. هل تريد المتابعة؟"
        confirmLabel="ترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmPostId(null)}
        onConfirm={() => void doPost()}
      />
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
