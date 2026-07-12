'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../sessions/components/ConfirmDialog';
import {
  cashApi,
  CashTransferListItem,
  formatDateOnly,
  formatIqd,
  TRANSFER_STATUS_LABEL,
  TransferOptions,
  TransferStats,
  transferStatusClass,
} from './components/types';

export default function CashTransfersPage() {
  const router = useRouter();
  const [presetBoxId, setPresetBoxId] = useState('');
  const [presetSessionId, setPresetSessionId] = useState('');
  const [rows, setRows] = useState<CashTransferListItem[]>([]);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [options, setOptions] = useState<TransferOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cashBoxId, setCashBoxId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDispatchId, setConfirmDispatchId] = useState<string | null>(null);
  const [confirmReceiveId, setConfirmReceiveId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const [form, setForm] = useState({
    source_cash_box_id: '',
    source_session_id: '',
    destination_cash_box_id: '',
    transfer_date: new Date().toISOString().slice(0, 10),
    amount: '',
    description: 'تحويل نقدي بين صناديق',
    external_reference: '',
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
      source_cash_box_id: box || f.source_cash_box_id,
      source_session_id: session || f.source_session_id,
    }));
    if (box || session) setFormOpen(true);
  }, []);

  const loadOptions = useCallback(async () => {
    const params = new URLSearchParams();
    if (form.source_cash_box_id) {
      params.set('source_cash_box_id', form.source_cash_box_id);
    }
    const res = await cashApi<TransferOptions>(
      `/api/accounts/cash-transfers/options${params.toString() ? `?${params}` : ''}`
    );
    if (res.success && res.data) setOptions(res.data);
  }, [form.source_cash_box_id]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (cashBoxId) params.set('cash_box_id', cashBoxId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (presetSessionId) params.set('source_session_id', presetSessionId);

    const res = await cashApi<CashTransferListItem[]>(
      `/api/accounts/cash-transfers?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل التحويلات');
      setRows([]);
    } else {
      setRows(res.data || []);
      setStats((res.stats as TransferStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [page, q, status, cashBoxId, dateFrom, dateTo, presetSessionId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, cashBoxId, dateFrom, dateTo, presetSessionId]);

  const sourceSessions = (options?.open_sessions || []).filter(
    (s) => !form.source_cash_box_id || s.cash_box_id === form.source_cash_box_id
  );
  const selectedSourceSession = sourceSessions.find(
    (s) => s.id === form.source_session_id
  );
  const destHasOpenSession = (options?.open_sessions || []).some(
    (s) => s.cash_box_id === form.destination_cash_box_id
  );

  const openForm = () => {
    setFormError(null);
    setForm((f) => ({
      ...f,
      source_cash_box_id: cashBoxId || presetBoxId || f.source_cash_box_id,
      source_session_id: presetSessionId || f.source_session_id,
    }));
    setFormOpen(true);
  };

  const createTransfer = async (andDispatch: boolean) => {
    setBusy(true);
    setFormError(null);
    const res = await cashApi<{ id: string; version: number; updated_at: string }>(
      '/api/accounts/cash-transfers',
      {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          external_reference: form.external_reference || null,
        }),
      }
    );
    if (!res.success || !res.data) {
      setFormError(res.message || 'تعذر إنشاء التحويل');
      setBusy(false);
      return;
    }
    if (andDispatch) {
      const dispatch = await cashApi(
        `/api/accounts/cash-transfers/${res.data.id}/dispatch`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: res.data.version,
            updated_at: res.data.updated_at,
          }),
        }
      );
      setBusy(false);
      if (!dispatch.success) {
        setFormError(dispatch.message || 'تم الحفظ كمسودة لكن فشل الإرسال');
        await load();
        return;
      }
    } else {
      setBusy(false);
    }
    setFormOpen(false);
    await load();
    router.push(`/accounts/cashbox/transfers/${res.data.id}`);
  };

  const rowById = (id: string | null) =>
    id ? rows.find((r) => r.id === id) : undefined;

  const doDispatch = async () => {
    const row = rowById(confirmDispatchId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${row.id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({ version: row.version, updated_at: row.updated_at }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإرسال');
      return;
    }
    setConfirmDispatchId(null);
    await load();
  };

  const doReceive = async () => {
    const row = rowById(confirmReceiveId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${row.id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ version: row.version, updated_at: row.updated_at }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الاستلام');
      return;
    }
    setConfirmReceiveId(null);
    await load();
  };

  const doCancel = async () => {
    const row = rowById(confirmCancelId);
    if (!row) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${row.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        reason: cancelReason,
        version: row.version,
        updated_at: row.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإلغاء');
      return;
    }
    setConfirmCancelId(null);
    setCancelReason('');
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
              <span> / التحويلات بين الصناديق</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              التحويلات بين الصناديق
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
            <Stat label="مسودة" value={String(stats.draft)} />
            <Stat label="قيد النقل" value={String(stats.dispatched)} />
            <Stat label="مُستلم" value={String(stats.received)} />
            <Stat label="ملغى" value={String(stats.cancelled)} />
            <Stat label="إجمالي الصادر" value={formatIqd(stats.outbound_total)} />
            <Stat label="إجمالي الوارد" value={formatIqd(stats.inbound_total)} />
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
            <option value="DISPATCHED">قيد النقل</option>
            <option value="RECEIVED">مُستلم</option>
            <option value="CANCELLED">ملغى</option>
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
                <th className="text-right px-2 py-2">الرقم</th>
                <th className="text-right px-2 py-2">التاريخ</th>
                <th className="text-right px-2 py-2">المرسل</th>
                <th className="text-right px-2 py-2">المستلم</th>
                <th className="text-right px-2 py-2">المبلغ</th>
                <th className="text-right px-2 py-2">الحالة</th>
                <th className="text-right px-2 py-2">الجلسات</th>
                <th className="text-right px-2 py-2">القيود</th>
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
                    لا توجد تحويلات
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2 font-mono text-xs">
                      <Link
                        href={`/accounts/cashbox/transfers/${r.id}`}
                        className="text-red-900 underline"
                      >
                        {r.transfer_number}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{formatDateOnly(r.transfer_date)}</td>
                    <td className="px-2 py-2">{r.source_cash_box_code}</td>
                    <td className="px-2 py-2">{r.destination_cash_box_code}</td>
                    <td className="px-2 py-2">{formatIqd(r.amount)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${transferStatusClass(r.status)}`}
                      >
                        {TRANSFER_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/accounts/cashbox/sessions/${r.source_session_id}`}
                        className="text-red-900 underline"
                      >
                        مرسل
                      </Link>
                      {r.destination_session_id ? (
                        <>
                          {' / '}
                          <Link
                            href={`/accounts/cashbox/sessions/${r.destination_session_id}`}
                            className="text-red-900 underline"
                          >
                            مستلم
                          </Link>
                        </>
                      ) : (
                        ' / —'
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {[r.dispatch_journal_entry_number, r.receipt_journal_entry_number]
                        .filter(Boolean)
                        .join(' / ') || '—'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap space-x-1 space-x-reverse">
                      <Link
                        href={`/accounts/cashbox/transfers/${r.id}`}
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
                            setConfirmDispatchId(r.id);
                          }}
                        >
                          إرسال
                        </button>
                      )}
                      {r.status === 'DISPATCHED' && (
                        <button
                          type="button"
                          className="text-green-800 underline text-xs"
                          onClick={() => {
                            setActionError(null);
                            setConfirmReceiveId(r.id);
                          }}
                        >
                          استلام
                        </button>
                      )}
                      {(r.status === 'DRAFT' || r.status === 'DISPATCHED') && (
                        <button
                          type="button"
                          className="text-amber-900 underline text-xs"
                          onClick={() => {
                            setActionError(null);
                            setCancelReason('');
                            setConfirmCancelId(r.id);
                          }}
                        >
                          إلغاء
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
            <h3 className="text-lg font-semibold">تحويل نقدي جديد</h3>
            {formError && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}
            <label className="block text-sm">
              الصندوق المرسل
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.source_cash_box_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    source_cash_box_id: e.target.value,
                    source_session_id: '',
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
            <label className="block text-sm">
              جلسة المرسل المفتوحة
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.source_session_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source_session_id: e.target.value }))
                }
              >
                <option value="">اختر الجلسة</option>
                {sourceSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.session_date} · متاح{' '}
                    {formatIqd(s.expected_balance?.expected_balance ?? s.opening_book_balance)}
                  </option>
                ))}
              </select>
            </label>
            {selectedSourceSession?.expected_balance && (
              <p className="text-xs text-gray-600">
                الرصيد المتاح للجلسة:{' '}
                {formatIqd(selectedSourceSession.expected_balance.expected_balance)}
              </p>
            )}
            <label className="block text-sm">
              الصندوق المستلم
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.destination_cash_box_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    destination_cash_box_id: e.target.value,
                  }))
                }
              >
                <option value="">اختر الصندوق</option>
                {(options?.cash_boxes || [])
                  .filter((b) => b.id !== form.source_cash_box_id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name_ar}
                    </option>
                  ))}
              </select>
            </label>
            {form.destination_cash_box_id && !destHasOpenSession && (
              <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                يمكن حفظ التحويل وإرساله، لكن يجب فتح جلسة للصندوق المستلم قبل تأكيد
                الاستلام.
              </div>
            )}
            {form.destination_cash_box_id && destHasOpenSession && (
              <p className="text-xs text-green-800">
                يوجد جلسة مفتوحة للصندوق المستلم — يمكن تأكيد الاستلام لاحقاً مباشرة.
              </p>
            )}
            <label className="block text-sm">
              التاريخ
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
              المبلغ
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={form.amount}
                inputMode="decimal"
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
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
                  !form.source_session_id ||
                  !form.destination_cash_box_id
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
                  !form.source_session_id ||
                  !form.destination_cash_box_id
                }
                onClick={() => void createTransfer(true)}
              >
                حفظ وإرسال
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDispatchId)}
        title="تأكيد إرسال التحويل"
        message="سيتم خصم المبلغ من الصندوق المرسل وإنشاء قيد «نقد بالطريق». هل تريد المتابعة؟"
        confirmLabel="إرسال"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmDispatchId(null)}
        onConfirm={() => void doDispatch()}
      />
      <ConfirmDialog
        open={Boolean(confirmReceiveId)}
        title="تأكيد استلام التحويل"
        message="سيتم إضافة المبلغ إلى الصندوق المستلم وإفراغ حساب النقد بالطريق. هل تريد المتابعة؟"
        confirmLabel="استلام"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmReceiveId(null)}
        onConfirm={() => void doReceive()}
      />
      <ConfirmDialog
        open={Boolean(confirmCancelId)}
        title="تأكيد إلغاء التحويل"
        message={
          <div className="space-y-2">
            <p>سيتم إلغاء التحويل. التحويلات المُرسلة تُعكس بقيد عكسي.</p>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm"
              rows={2}
              placeholder="سبب الإلغاء"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="إلغاء التحويل"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setConfirmCancelId(null)}
        onConfirm={() => void doCancel()}
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
