'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../sessions/components/ConfirmDialog';
import {
  cashApi,
  formatDateOnly,
  formatIqd,
  VOUCHER_STATUS_LABEL,
  VOUCHER_TYPE_LABEL,
  voucherStatusClass,
  VoucherOptions,
  VoucherStats,
  CashVoucherListItem,
  CashVoucherType,
} from './components/types';

export default function CashVouchersPage() {
  const router = useRouter();
  const [presetBoxId, setPresetBoxId] = useState('');
  const [presetSessionId, setPresetSessionId] = useState('');
  const [rows, setRows] = useState<CashVoucherListItem[]>([]);
  const [stats, setStats] = useState<VoucherStats | null>(null);
  const [options, setOptions] = useState<VoucherOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');
  const [cashBoxId, setCashBoxId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<CashVoucherType>('CASH_RECEIPT');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [form, setForm] = useState({
    cash_box_id: '',
    cash_box_session_id: '',
    counter_account_id: '',
    cost_center_id: '',
    voucher_date: new Date().toISOString().slice(0, 10),
    amount: '',
    party_name: '',
    external_reference: '',
    description: '',
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const box = sp.get('cash_box_id') || '';
    const session = sp.get('session_id') || '';
    setPresetBoxId(box);
    setPresetSessionId(session);
    if (box) setCashBoxId(box);
    setForm((f) => ({
      ...f,
      cash_box_id: box || f.cash_box_id,
      cash_box_session_id: session || f.cash_box_session_id,
    }));
  }, []);

  const loadOptions = useCallback(async () => {
    const res = await cashApi<VoucherOptions>(
      `/api/accounts/cash-vouchers/options${
        form.cash_box_id ? `?cash_box_id=${form.cash_box_id}` : ''
      }`
    );
    if (res.success && res.data) setOptions(res.data);
  }, [form.cash_box_id]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (voucherType) params.set('voucher_type', voucherType);
    if (status) params.set('status', status);
    if (cashBoxId) params.set('cash_box_id', cashBoxId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (presetSessionId) params.set('cash_box_session_id', presetSessionId);

    const res = await cashApi<CashVoucherListItem[]>(
      `/api/accounts/cash-vouchers?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل السندات');
      setRows([]);
    } else {
      setRows(res.data || []);
      setStats((res.stats as VoucherStats) || null);
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
    cashBoxId,
    dateFrom,
    dateTo,
    presetSessionId,
  ]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, voucherType, status, cashBoxId, dateFrom, dateTo, presetSessionId]);

  const openSessions = (options?.open_sessions || []).filter(
    (s) => !form.cash_box_id || s.cash_box_id === form.cash_box_id
  );
  const selectedBox = options?.cash_boxes.find((b) => b.id === form.cash_box_id);

  const openForm = (type: CashVoucherType) => {
    setFormType(type);
    setFormError(null);
    setForm((f) => ({
      ...f,
      cash_box_id: cashBoxId || presetBoxId || f.cash_box_id,
      cash_box_session_id: presetSessionId || f.cash_box_session_id,
      description: type === 'CASH_RECEIPT' ? 'قبض نقدي' : 'صرف نقدي',
    }));
    setFormOpen(true);
  };

  const createVoucher = async (andPost: boolean) => {
    setBusy(true);
    setFormError(null);
    const res = await cashApi<{ id: string; version: number; updated_at: string }>(
      '/api/accounts/cash-vouchers',
      {
        method: 'POST',
        body: JSON.stringify({
          voucher_type: formType,
          ...form,
          cost_center_id: form.cost_center_id || null,
        }),
      }
    );
    if (!res.success || !res.data) {
      setFormError(res.message || 'تعذر إنشاء السند');
      setBusy(false);
      return;
    }
    if (andPost) {
      const post = await cashApi(`/api/accounts/cash-vouchers/${res.data.id}/post`, {
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
    router.push(`/accounts/cashbox/vouchers/${res.data.id}`);
  };

  const doPost = async () => {
    if (!confirmPostId) return;
    const row = rows.find((r) => r.id === confirmPostId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-vouchers/${row.id}/post`, {
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
              <Link href="/accounts/cashbox" className="hover:text-red-900">
                الصناديق
              </Link>
              <span> / سندات القبض والصرف</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              سندات القبض والصرف
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-green-800 text-white text-sm hover:bg-green-700"
              onClick={() => openForm('CASH_RECEIPT')}
            >
              سند قبض جديد
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
              onClick={() => openForm('CASH_PAYMENT')}
            >
              سند صرف جديد
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Stat label="عدد السندات" value={String(stats.total)} />
            <Stat label="إجمالي المقبوضات" value={formatIqd(stats.receipts_total)} />
            <Stat label="إجمالي المصروفات" value={formatIqd(stats.payments_total)} />
            <Stat label="صافي الحركة" value={formatIqd(stats.net_movement)} />
          </div>
        )}

        <div className="grid md:grid-cols-6 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="بحث: رقم / طرف / بيان"
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
            <option value="CASH_RECEIPT">قبض</option>
            <option value="CASH_PAYMENT">صرف</option>
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
            value={cashBoxId}
            onChange={(e) => {
              setCashBoxId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الصناديق</option>
            {(options?.cash_boxes || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
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
        <div className="grid md:grid-cols-2 gap-2">
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
                <th className="text-right px-2 py-2">رقم السند</th>
                <th className="text-right px-2 py-2">النوع</th>
                <th className="text-right px-2 py-2">التاريخ</th>
                <th className="text-right px-2 py-2">الصندوق</th>
                <th className="text-right px-2 py-2">الطرف</th>
                <th className="text-right px-2 py-2">الحساب المقابل</th>
                <th className="text-right px-2 py-2">البيان</th>
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
                        href={`/accounts/cashbox/vouchers/${r.id}`}
                        className="text-red-900 underline"
                      >
                        {r.voucher_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      {VOUCHER_TYPE_LABEL[r.voucher_type]}
                    </td>
                    <td className="px-2 py-2">{formatDateOnly(r.voucher_date)}</td>
                    <td className="px-2 py-2">{r.cash_box_code}</td>
                    <td className="px-2 py-2">{r.party_name || '—'}</td>
                    <td className="px-2 py-2 text-xs">
                      {r.counter_account_code}
                    </td>
                    <td className="px-2 py-2 max-w-[12rem] truncate">
                      {r.description}
                    </td>
                    <td className="px-2 py-2">{formatIqd(r.amount)}</td>
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
                        href={`/accounts/cashbox/vouchers/${r.id}`}
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
              {formType === 'CASH_RECEIPT' ? 'سند قبض جديد' : 'سند صرف جديد'}
            </h3>
            {formError && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}
            <label className="block text-sm">
              الصندوق
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.cash_box_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cash_box_id: e.target.value,
                    cash_box_session_id: '',
                  }))
                }
              >
                <option value="">اختر الصندوق</option>
                {(options?.cash_boxes || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name_ar}
                  </option>
                ))}
              </select>
            </label>
            {selectedBox && (
              <p className="text-xs text-gray-600">
                حساب الصندوق: {selectedBox.account_code} —{' '}
                {selectedBox.account_name_ar}
              </p>
            )}
            <label className="block text-sm">
              الجلسة المفتوحة
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.cash_box_session_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cash_box_session_id: e.target.value }))
                }
              >
                <option value="">اختر الجلسة</option>
                {openSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.session_date} · افتتاحي {formatIqd(s.opening_book_balance)}
                  </option>
                ))}
              </select>
            </label>
            {form.cash_box_id && openSessions.length === 0 && (
              <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                لا توجد جلسة صندوق مفتوحة لهذا الصندوق.
              </div>
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
              الحساب المقابل
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.counter_account_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, counter_account_id: e.target.value }))
                }
              >
                <option value="">اختر الحساب</option>
                {(options?.posting_accounts || [])
                  .filter((a) => a.id !== selectedBox?.account_id)
                  .map((a) => (
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
              المرجع
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
                disabled={busy || !form.cash_box_session_id}
                onClick={() => void createVoucher(false)}
              >
                حفظ مسودة
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy || !form.cash_box_session_id}
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
        message="سيتم إنشاء قيد محاسبي وترحيل السند، ولن يمكن تعديل بياناته المالية بعد ذلك. هل تريد المتابعة؟"
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
