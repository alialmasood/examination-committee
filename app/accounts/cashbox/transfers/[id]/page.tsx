'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../../sessions/components/ConfirmDialog';
import {
  cashApi,
  CashTransferDetail,
  formatDateOnly,
  formatIqd,
  TRANSFER_STATUS_LABEL,
  transferStatusClass,
} from '../components/types';

export default function CashTransferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');
  const [transfer, setTransfer] = useState<CashTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState({
    amount: '',
    description: '',
    external_reference: '',
    transfer_date: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await cashApi<CashTransferDetail>(
      `/api/accounts/cash-transfers/${id}`
    );
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل التحويل');
      setTransfer(null);
    } else {
      setTransfer(res.data);
      setEdit({
        amount: res.data.amount,
        description: res.data.description,
        external_reference: res.data.external_reference || '',
        transfer_date: res.data.transfer_date,
      });
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const saveEdit = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...edit,
        external_reference: edit.external_reference || null,
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الحفظ');
      return;
    }
    setEditMode(false);
    setSuccess('تم تحديث المسودة');
    await load();
  };

  const doDispatch = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${id}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإرسال');
      return;
    }
    setConfirmDispatch(false);
    setSuccess('تم إرسال التحويل');
    await load();
  };

  const doReceive = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الاستلام');
      return;
    }
    setConfirmReceive(false);
    setSuccess('تم تأكيد استلام التحويل');
    await load();
  };

  const doCancel = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await cashApi(`/api/accounts/cash-transfers/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        reason: cancelReason,
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإلغاء');
      return;
    }
    setConfirmCancel(false);
    setCancelReason('');
    setSuccess('تم إلغاء التحويل');
    await load();
  };

  if (loading && !transfer) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!transfer) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'التحويل غير موجود'}</p>
        <Link href="/accounts/cashbox/transfers" className="underline text-sm">
          العودة
        </Link>
      </div>
    );
  }

  const anyConfirm = confirmDispatch || confirmReceive || confirmCancel;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border p-4 md:p-6 space-y-4 print:shadow-none print:border-0">
        <div className="flex flex-wrap justify-between gap-3 print:hidden">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link
                href="/accounts/cashbox/transfers"
                className="hover:text-red-900"
              >
                التحويلات
              </Link>
              <span> / {transfer.transfer_number}</span>
            </div>
            <h1 className="text-xl font-semibold flex flex-wrap items-center gap-2">
              تحويل — {transfer.transfer_number}
              <span
                className={`text-xs px-2 py-0.5 rounded ${transferStatusClass(transfer.status)}`}
              >
                {TRANSFER_STATUS_LABEL[transfer.status]}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 border rounded-md text-sm"
              onClick={() => router.push('/accounts/cashbox/transfers')}
            >
              العودة
            </button>
            <button
              type="button"
              className="px-3 py-2 border rounded-md text-sm"
              onClick={() => window.print()}
            >
              طباعة
            </button>
            {transfer.status === 'DRAFT' && !editMode && (
              <>
                <button
                  type="button"
                  className="px-3 py-2 border rounded-md text-sm"
                  onClick={() => setEditMode(true)}
                >
                  تعديل
                </button>
                <button
                  type="button"
                  className="px-3 py-2 bg-green-800 text-white rounded-md text-sm"
                  onClick={() => {
                    setActionError(null);
                    setConfirmDispatch(true);
                  }}
                >
                  إرسال
                </button>
              </>
            )}
            {transfer.status === 'DISPATCHED' && (
              <button
                type="button"
                className="px-3 py-2 bg-green-800 text-white rounded-md text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmReceive(true);
                }}
              >
                تأكيد الاستلام
              </button>
            )}
            {(transfer.status === 'DRAFT' || transfer.status === 'DISPATCHED') && (
              <button
                type="button"
                className="px-3 py-2 border border-amber-700 text-amber-950 rounded-md text-sm"
                onClick={() => {
                  setActionError(null);
                  setCancelReason('');
                  setConfirmCancel(true);
                }}
              >
                إلغاء التحويل
              </button>
            )}
          </div>
        </div>

        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 print:hidden">
            {success}
          </div>
        )}
        {actionError && !anyConfirm && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 print:hidden">
            {actionError}
          </div>
        )}

        <div className="hidden print:block text-center space-y-1 mb-4">
          <div className="text-lg font-bold">كلية الشرق</div>
          <div className="text-base font-semibold">
            سند تحويل نقدي بين الصناديق
          </div>
          <div className="font-mono">{transfer.transfer_number}</div>
        </div>

        {editMode ? (
          <div className="space-y-3 print:hidden">
            <label className="block text-sm">
              التاريخ
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.transfer_date}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, transfer_date: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              المبلغ
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.amount}
                onChange={(e) => setEdit((x) => ({ ...x, amount: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              المرجع
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.external_reference}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, external_reference: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              البيان
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2"
                rows={2}
                value={edit.description}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, description: e.target.value }))
                }
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-2 border rounded-md text-sm"
                disabled={busy}
                onClick={() => setEditMode(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy}
                onClick={() => void saveEdit()}
              >
                حفظ
              </button>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
            <Info label="الحالة" value={TRANSFER_STATUS_LABEL[transfer.status]} />
            <Info label="التاريخ" value={formatDateOnly(transfer.transfer_date)} />
            <Info label="المبلغ" value={formatIqd(transfer.amount)} />
            <Info label="العملة" value={transfer.currency_code} />
            <Info
              label="الصندوق المرسل"
              value={`${transfer.source_cash_box_code} — ${transfer.source_cash_box_name_ar}`}
            />
            <Info
              label="الصندوق المستلم"
              value={`${transfer.destination_cash_box_code} — ${transfer.destination_cash_box_name_ar}`}
            />
            <Info
              label="جلسة المرسل"
              value={
                <Link
                  href={`/accounts/cashbox/sessions/${transfer.source_session_id}`}
                  className="text-red-900 underline print:no-underline print:text-black"
                >
                  {transfer.source_session_date ||
                    transfer.source_session_id.slice(0, 8).toUpperCase()}
                </Link>
              }
            />
            <Info
              label="جلسة المستلم"
              value={
                transfer.destination_session_id ? (
                  <Link
                    href={`/accounts/cashbox/sessions/${transfer.destination_session_id}`}
                    className="text-red-900 underline print:no-underline print:text-black"
                  >
                    {transfer.destination_session_date ||
                      transfer.destination_session_id.slice(0, 8).toUpperCase()}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <Info label="البيان" value={transfer.description} />
            <Info label="المرجع" value={transfer.external_reference || '—'} />
            <Info label="السنة المالية" value={transfer.fiscal_year_code || '—'} />
            <Info label="المنشئ" value={transfer.created_by_name || '—'} />
            <Info label="تاريخ الإنشاء" value={formatDateOnly(transfer.created_at)} />
            {transfer.dispatch_journal_entry_number && (
              <Info
                label="قيد الإرسال"
                value={
                  <Link
                    href={`/accounts/entries?q=${encodeURIComponent(transfer.dispatch_journal_entry_number)}`}
                    className="text-red-900 underline print:no-underline print:text-black font-mono"
                  >
                    {transfer.dispatch_journal_entry_number}
                  </Link>
                }
              />
            )}
            {transfer.receipt_journal_entry_number && (
              <Info
                label="قيد الاستلام"
                value={
                  <Link
                    href={`/accounts/entries?q=${encodeURIComponent(transfer.receipt_journal_entry_number)}`}
                    className="text-red-900 underline print:no-underline print:text-black font-mono"
                  >
                    {transfer.receipt_journal_entry_number}
                  </Link>
                }
              />
            )}
            {transfer.reversal_journal_entry_number && (
              <Info
                label="قيد العكس"
                value={
                  <Link
                    href={`/accounts/entries?q=${encodeURIComponent(transfer.reversal_journal_entry_number)}`}
                    className="text-red-900 underline print:no-underline print:text-black font-mono"
                  >
                    {transfer.reversal_journal_entry_number}
                  </Link>
                }
              />
            )}
            {transfer.dispatched_by_name && (
              <Info label="أُرسل بواسطة" value={transfer.dispatched_by_name} />
            )}
            {transfer.dispatched_at && (
              <Info label="تاريخ الإرسال" value={formatDateOnly(transfer.dispatched_at)} />
            )}
            {transfer.received_by_name && (
              <Info label="اُستلم بواسطة" value={transfer.received_by_name} />
            )}
            {transfer.received_at && (
              <Info label="تاريخ الاستلام" value={formatDateOnly(transfer.received_at)} />
            )}
            {transfer.cancellation_reason && (
              <Info label="سبب الإلغاء" value={transfer.cancellation_reason} />
            )}
            {transfer.cancelled_by_name && (
              <Info label="أُلغي بواسطة" value={transfer.cancelled_by_name} />
            )}
            {transfer.cancelled_at && (
              <Info label="تاريخ الإلغاء" value={formatDateOnly(transfer.cancelled_at)} />
            )}
          </div>
        )}

        <div className="hidden print:grid grid-cols-5 gap-4 pt-12 text-sm text-center">
          <div>
            <div className="border-t pt-2">أمين المرسل</div>
          </div>
          <div>
            <div className="border-t pt-2">الناقل</div>
          </div>
          <div>
            <div className="border-t pt-2">أمين المستلم</div>
          </div>
          <div>
            <div className="border-t pt-2">المحاسب</div>
          </div>
          <div>
            <div className="border-t pt-2">التدقيق</div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDispatch}
        title="تأكيد إرسال التحويل"
        message="سيتم خصم المبلغ من الصندوق المرسل وإنشاء قيد «نقد بالطريق». هل تريد المتابعة؟"
        confirmLabel="إرسال"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmDispatch(false)}
        onConfirm={() => void doDispatch()}
      />
      <ConfirmDialog
        open={confirmReceive}
        title="تأكيد استلام التحويل"
        message="سيتم إضافة المبلغ إلى الصندوق المستلم وإفراغ حساب النقد بالطريق. هل تريد المتابعة؟"
        confirmLabel="استلام"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmReceive(false)}
        onConfirm={() => void doReceive()}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="تأكيد إلغاء التحويل"
        message={
          <div className="space-y-2">
            <p>
              {transfer.status === 'DISPATCHED'
                ? 'سيتم إنشاء قيد عكسي لقيد الإرسال ثم إلغاء التحويل.'
                : 'سيتم إلغاء المسودة دون قيد محاسبي.'}
            </p>
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
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void doCancel()}
      />
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-gray-900">{value}</div>
    </div>
  );
}
