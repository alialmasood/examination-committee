'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';
import {
  amountToArabicWords,
  bankApi,
  BankVoucherListItem,
  BankVoucherOptions,
  BankVoucherStats,
  BankVoucherType,
  formatDateOnly,
  formatMoney,
  VOUCHER_STATUS_LABEL,
  VOUCHER_TYPE_LABEL,
  voucherStatusClass,
} from './components/types';

export default function BankVouchersPage() {
  const router = useRouter();
  const [presetAccountId, setPresetAccountId] = useState('');
  const [rows, setRows] = useState<BankVoucherListItem[]>([]);
  const [stats, setStats] = useState<BankVoucherStats | null>(null);
  const [options, setOptions] = useState<BankVoucherOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankId, setBankId] = useState('');
  const [currency, setCurrency] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<BankVoucherType>('BANK_RECEIPT');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [form, setForm] = useState({
    bank_account_id: '',
    counter_account_id: '',
    cost_center_id: '',
    voucher_date: new Date().toISOString().slice(0, 10),
    value_date: '',
    amount: '',
    party_name: '',
    party_reference: '',
    external_reference: '',
    bank_reference: '',
    description: '',
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const account = sp.get('bank_account_id') || '';
    const type = (sp.get('type') || '').toUpperCase() as BankVoucherType | '';
    setPresetAccountId(account);
    if (account) setBankAccountId(account);
    if (type === 'BANK_RECEIPT' || type === 'BANK_PAYMENT') {
      setVoucherType(type);
      setFormType(type);
    }
    setForm((f) => ({
      ...f,
      bank_account_id: account || f.bank_account_id,
    }));
    if (account && (type === 'BANK_RECEIPT' || type === 'BANK_PAYMENT')) {
      setFormOpen(true);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    const params = new URLSearchParams();
    if (form.bank_account_id) params.set('bank_account_id', form.bank_account_id);
    const res = await bankApi<BankVoucherOptions>(
      `/api/accounts/bank-vouchers/options?${params.toString()}`
    );
    if (res.success && res.data) setOptions(res.data);
  }, [form.bank_account_id]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (voucherType) params.set('voucher_type', voucherType);
    if (status) params.set('status', status);
    if (bankAccountId) params.set('bank_account_id', bankAccountId);
    if (bankId) params.set('bank_id', bankId);
    if (currency) params.set('currency', currency);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bankReference.trim()) params.set('bank_reference', bankReference.trim());

    const res = await bankApi<BankVoucherListItem[]>(
      `/api/accounts/bank-vouchers?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل السندات');
      setRows([]);
    } else {
      setRows(res.data || []);
      setStats((res.stats as BankVoucherStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [
    page,
    q,
    voucherType,
    status,
    bankAccountId,
    bankId,
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
  }, [
    page,
    voucherType,
    status,
    bankAccountId,
    bankId,
    currency,
    dateFrom,
    dateTo,
  ]);

  const selectedAccount = options?.bank_accounts.find(
    (a) => a.id === form.bank_account_id
  );
  const bookBalance = options?.book_balance;

  const openForm = (type: BankVoucherType) => {
    setFormType(type);
    setFormError(null);
    setForm((f) => ({
      ...f,
      bank_account_id: bankAccountId || presetAccountId || f.bank_account_id,
      description: type === 'BANK_RECEIPT' ? 'قبض مصرفي' : 'صرف مصرفي',
    }));
    setFormOpen(true);
  };

  const createVoucher = async (andPost: boolean) => {
    setBusy(true);
    setFormError(null);
    const res = await bankApi<{ id: string; version: number; updated_at: string }>(
      '/api/accounts/bank-vouchers',
      {
        method: 'POST',
        body: JSON.stringify({
          voucher_type: formType,
          ...form,
          cost_center_id: form.cost_center_id || null,
          value_date: form.value_date || null,
        }),
      }
    );
    if (!res.success || !res.data) {
      setFormError(res.message || 'تعذر إنشاء السند');
      setBusy(false);
      return;
    }
    if (andPost) {
      const post = await bankApi(`/api/accounts/bank-vouchers/${res.data.id}/post`, {
        method: 'POST',
        body: JSON.stringify({
          version: res.data.version,
          updated_at: res.data.updated_at,
        }),
      });
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
    router.push(`/accounts/banks/vouchers/${res.data.id}`);
  };

  const doPost = async () => {
    if (!confirmPostId) return;
    const row = rows.find((r) => r.id === confirmPostId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-vouchers/${row.id}/post`, {
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
              <span> / سندات مصرفية</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              سندات القبض والصرف المصرفي
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-green-800 text-white text-sm hover:bg-green-700"
              onClick={() => openForm('BANK_RECEIPT')}
            >
              سند قبض جديد
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
              onClick={() => openForm('BANK_PAYMENT')}
            >
              سند صرف جديد
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Stat label="عدد السندات" value={String(stats.total)} />
            <Stat
              label="إجمالي المقبوضات"
              value={formatMoney(stats.receipts_total)}
            />
            <Stat
              label="إجمالي المصروفات"
              value={formatMoney(stats.payments_total)}
            />
            <Stat label="صافي الحركة" value={formatMoney(stats.net_movement)} />
          </div>
        )}

        <div className="grid md:grid-cols-6 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="بحث: رقم / طرف / بيان / مرجع بنكي"
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
            value={voucherType}
            onChange={(e) => {
              setVoucherType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الأنواع</option>
            <option value="BANK_RECEIPT">قبض</option>
            <option value="BANK_PAYMENT">صرف</option>
          </select>
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
        <input
          className="border rounded-md px-3 py-2 text-sm w-full md:w-1/2"
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

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right px-2 py-2">رقم السند</th>
                <th className="text-right px-2 py-2">النوع</th>
                <th className="text-right px-2 py-2">التاريخ</th>
                <th className="text-right px-2 py-2">الحساب</th>
                <th className="text-right px-2 py-2">المصرف</th>
                <th className="text-right px-2 py-2">الطرف</th>
                <th className="text-right px-2 py-2">الحساب المقابل</th>
                <th className="text-right px-2 py-2">المبلغ</th>
                <th className="text-right px-2 py-2">الحالة</th>
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
                    لا توجد سندات
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2 font-mono text-xs">
                      <Link
                        href={`/accounts/banks/vouchers/${r.id}`}
                        className="text-red-900 underline"
                      >
                        {r.voucher_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      {VOUCHER_TYPE_LABEL[r.voucher_type]}
                    </td>
                    <td className="px-2 py-2">{formatDateOnly(r.voucher_date)}</td>
                    <td className="px-2 py-2">{r.bank_account_code}</td>
                    <td className="px-2 py-2 text-xs">{r.bank_name_ar || '—'}</td>
                    <td className="px-2 py-2">{r.party_name || '—'}</td>
                    <td className="px-2 py-2 text-xs">
                      {r.counter_account_code}
                    </td>
                    <td className="px-2 py-2">
                      {formatMoney(r.amount, r.currency_code)}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${voucherStatusClass(r.status)}`}
                      >
                        {VOUCHER_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {r.journal_entry_number || '—'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap space-x-1 space-x-reverse">
                      <Link
                        href={`/accounts/banks/vouchers/${r.id}`}
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
            <h3 className="text-lg font-semibold">
              {formType === 'BANK_RECEIPT'
                ? 'سند قبض مصرفي جديد'
                : 'سند صرف مصرفي جديد'}
            </h3>
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
                  setForm((f) => ({
                    ...f,
                    bank_account_id: e.target.value,
                  }))
                }
              >
                <option value="">اختر الحساب</option>
                {(options?.bank_accounts || [])
                  .filter((a) =>
                    formType === 'BANK_RECEIPT'
                      ? a.allows_receipts
                      : a.allows_payments
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.account_name_ar} ({a.currency_code})
                    </option>
                  ))}
              </select>
            </label>
            {selectedAccount && (
              <p className="text-xs text-gray-600">
                {selectedAccount.bank_name_ar} · حساب GL:{' '}
                {selectedAccount.gl_account_code} —{' '}
                {selectedAccount.gl_account_name_ar}
              </p>
            )}
            {bookBalance && form.bank_account_id === bookBalance.bank_account_id && (
              <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                الرصيد الدفتري:{' '}
                {formatMoney(bookBalance.book_balance, bookBalance.currency_code)}
              </p>
            )}
            <label className="block text-sm">
              التاريخ
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.voucher_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, voucher_date: e.target.value }))
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
              الحساب المقابل
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.counter_account_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, counter_account_id: e.target.value }))
                }
              >
                <option value="">اختر الحساب</option>
                {(options?.posting_accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
              </select>
            </label>
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
              الطرف
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.party_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, party_name: e.target.value }))
                }
              />
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
            {form.amount && Number(form.amount) > 0 && (
              <p className="text-xs text-gray-600">
                {amountToArabicWords(
                  form.amount,
                  selectedAccount?.currency_code || 'IQD'
                )}
              </p>
            )}
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
                disabled={busy || !form.bank_account_id}
                onClick={() => void createVoucher(false)}
              >
                حفظ مسودة
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy || !form.bank_account_id}
                onClick={() => void createVoucher(true)}
              >
                حفظ وترحيل
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPostId)}
        title="تأكيد ترحيل السند"
        message="سيتم إنشاء قيد محاسبي وترحيل السند المصرفي، ولن يمكن تعديل بياناته المالية بعد ذلك. هل تريد المتابعة؟"
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
