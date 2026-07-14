'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import {
  bankApi,
  BankTransferDetail,
  formatDateOnly,
  formatMoney,
  maskIban,
  TRANSFER_STATUS_LABEL,
  transferStatusClass,
} from '../components/types';

export default function BankTransferDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');
  const [transfer, setTransfer] = useState<BankTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState({
    amount: '',
    fee_amount: '',
    description: '',
    bank_reference: '',
    external_reference: '',
    transfer_date: '',
    value_date: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await bankApi<BankTransferDetail>(
      `/api/accounts/bank-transfers/${id}`
    );
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل التحويل');
      setTransfer(null);
    } else {
      setTransfer(res.data);
      setEdit({
        amount: res.data.amount,
        fee_amount: res.data.fee_amount || '0',
        description: res.data.description,
        bank_reference: res.data.bank_reference || '',
        external_reference: res.data.external_reference || '',
        transfer_date: res.data.transfer_date,
        value_date: res.data.value_date || '',
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
    const res = await bankApi(`/api/accounts/bank-transfers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...edit,
        value_date: edit.value_date || null,
        bank_reference: edit.bank_reference || null,
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

  const doPost = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-transfers/${id}/post`, {
      method: 'POST',
      body: JSON.stringify({
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الترحيل');
      return;
    }
    setConfirmPost(false);
    setSuccess('تم ترحيل التحويل وإنشاء القيد');
    await load();
  };

  const doVoid = async () => {
    if (!transfer) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-transfers/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({
        reason: voidReason,
        version: transfer.version,
        updated_at: transfer.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإلغاء');
      return;
    }
    setConfirmVoid(false);
    setVoidReason('');
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
        <Link href="/accounts/banks/transfers" className="underline text-sm">
          العودة
        </Link>
      </div>
    );
  }

  const sourceIban =
    transfer.source_iban_normalized || transfer.source_iban || null;
  const destIban =
    transfer.destination_iban_normalized || transfer.destination_iban || null;
  const debitTotal =
    transfer.impact?.source_debit_total ??
    String(Number(transfer.amount) + Number(transfer.fee_amount || 0));

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border p-4 md:p-6 space-y-4 print:shadow-none print:border-0">
        <div className="flex flex-wrap justify-between gap-3 print:hidden">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link
                href="/accounts/banks/transfers"
                className="hover:text-red-900"
              >
                التحويلات المصرفية
              </Link>
              <span> / {transfer.transfer_number}</span>
            </div>
            <h1 className="text-xl font-semibold flex flex-wrap items-center gap-2">
              تحويل مصرفي — {transfer.transfer_number}
              <span
                className={`text-xs px-2 py-0.5 rounded ${transferStatusClass(transfer.status)}`}
              >
                {TRANSFER_STATUS_LABEL[transfer.status]}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              className="px-3 py-2 border rounded-md text-sm"
              onClick={() => router.push('/accounts/banks/transfers')}
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
                    setConfirmPost(true);
                  }}
                >
                  ترحيل
                </button>
              </>
            )}
            {(transfer.status === 'DRAFT' || transfer.status === 'POSTED') && (
              <button
                type="button"
                className="px-3 py-2 border border-amber-700 text-amber-950 rounded-md text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmVoid(true);
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
        {actionError && !confirmPost && !confirmVoid && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 print:hidden">
            {actionError}
          </div>
        )}

        <div className="print-container hidden print:block text-center space-y-1 mb-4">
          <div className="text-lg font-bold">كلية الشرق</div>
          <div className="text-base font-semibold">سند تحويل مصرفي</div>
          <div className="font-mono">{transfer.transfer_number}</div>
        </div>

        {editMode ? (
          <div className="space-y-3 print:hidden">
            <label className="block text-sm">
              تاريخ التحويل
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
              تاريخ القيمة
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.value_date}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, value_date: e.target.value }))
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
              الرسوم
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.fee_amount}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, fee_amount: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              المرجع البنكي
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.bank_reference}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, bank_reference: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              المرجع الخارجي
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
          <div className="print-container grid md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
            <Info label="الحالة" value={TRANSFER_STATUS_LABEL[transfer.status]} />
            <Info
              label="تاريخ التحويل"
              value={formatDateOnly(transfer.transfer_date)}
            />
            <Info
              label="تاريخ القيمة"
              value={formatDateOnly(transfer.value_date)}
            />
            <Info
              label="الحساب المصدر"
              value={
                <Link
                  href={`/accounts/banks/${transfer.source_bank_account_id}`}
                  className="text-red-900 underline print:no-underline print:text-black"
                >
                  {transfer.source_code} — {transfer.source_name_ar}
                </Link>
              }
            />
            <Info
              label="مصرف المصدر"
              value={
                transfer.source_bank_name_ar
                  ? `${transfer.source_bank_code} — ${transfer.source_bank_name_ar}`
                  : '—'
              }
            />
            <Info
              label="فرع المصدر"
              value={
                transfer.source_branch_name_ar
                  ? `${transfer.source_branch_code || ''} — ${transfer.source_branch_name_ar}`
                  : '—'
              }
            />
            <Info label="IBAN المصدر" value={maskIban(sourceIban)} />
            <Info
              label="الحساب الوجهة"
              value={
                <Link
                  href={`/accounts/banks/${transfer.destination_bank_account_id}`}
                  className="text-red-900 underline print:no-underline print:text-black"
                >
                  {transfer.destination_code} — {transfer.destination_name_ar}
                </Link>
              }
            />
            <Info
              label="مصرف الوجهة"
              value={
                transfer.destination_bank_name_ar
                  ? `${transfer.destination_bank_code} — ${transfer.destination_bank_name_ar}`
                  : '—'
              }
            />
            <Info
              label="فرع الوجهة"
              value={
                transfer.destination_branch_name_ar
                  ? `${transfer.destination_branch_code || ''} — ${transfer.destination_branch_name_ar}`
                  : '—'
              }
            />
            <Info label="IBAN الوجهة" value={maskIban(destIban)} />
            <Info
              label="المبلغ"
              value={formatMoney(transfer.amount, transfer.currency_code)}
            />
            <Info
              label="الرسوم"
              value={formatMoney(transfer.fee_amount, transfer.currency_code)}
            />
            <Info
              label="إجمالي المدين من المصدر"
              value={formatMoney(debitTotal, transfer.currency_code)}
            />
            <Info label="العملة" value={transfer.currency_code} />
            <Info
              label="حساب مصروف الرسوم"
              value={
                transfer.fee_account_code
                  ? `${transfer.fee_account_code} — ${transfer.fee_account_name_ar}`
                  : '—'
              }
            />
            <Info
              label="مركز الكلفة"
              value={
                transfer.cost_center_code
                  ? `${transfer.cost_center_code} — ${transfer.cost_center_name_ar}`
                  : '—'
              }
            />
            <Info label="المرجع البنكي" value={transfer.bank_reference || '—'} />
            <Info
              label="المرجع الخارجي"
              value={transfer.external_reference || '—'}
            />
            <Info label="البيان" value={transfer.description} />
            <Info label="المنشئ" value={transfer.created_by_name || '—'} />
            <Info
              label="تاريخ الإنشاء"
              value={formatDateOnly(transfer.created_at)}
            />
            {transfer.source_book_balance && (
              <Info
                label="رصيد المصدر الدفتري"
                value={formatMoney(
                  transfer.source_book_balance.book_balance,
                  transfer.source_book_balance.currency_code
                )}
              />
            )}
            {transfer.destination_book_balance && (
              <Info
                label="رصيد الوجهة الدفتري"
                value={formatMoney(
                  transfer.destination_book_balance.book_balance,
                  transfer.destination_book_balance.currency_code
                )}
              />
            )}
            {transfer.journal_entry_number && (
              <Info
                label="رقم القيد"
                value={
                  <Link
                    href={`/accounts/entries?q=${encodeURIComponent(transfer.journal_entry_number)}`}
                    className="text-red-900 underline print:no-underline print:text-black font-mono"
                  >
                    {transfer.journal_entry_number}
                  </Link>
                }
              />
            )}
            {transfer.posted_by_name && (
              <Info label="مرحّل بواسطة" value={transfer.posted_by_name} />
            )}
            {transfer.void_reason && (
              <Info label="سبب الإلغاء" value={transfer.void_reason} />
            )}
            {transfer.reversal_journal_entry_number && (
              <Info
                label="قيد العكس"
                value={transfer.reversal_journal_entry_number}
              />
            )}
          </div>
        )}

        <div className="hidden print:grid grid-cols-5 gap-4 pt-10 text-sm text-center">
          <div>
            <div className="border-t border-gray-800 pt-2">المحاسب</div>
          </div>
          <div>
            <div className="border-t border-gray-800 pt-2">
              مسؤول الحساب المصدر
            </div>
          </div>
          <div>
            <div className="border-t border-gray-800 pt-2">
              مسؤول الحساب الوجهة
            </div>
          </div>
          <div>
            <div className="border-t border-gray-800 pt-2">المدير المالي</div>
          </div>
          <div>
            <div className="border-t border-gray-800 pt-2">التدقيق</div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPost}
        title="تأكيد ترحيل التحويل"
        message="سيتم إنشاء قيد محاسبي وتحويل المبلغ بين الحسابين المصرفيين. لن يمكن تعديل البيانات المالية بعد الترحيل. هل تريد المتابعة؟"
        confirmLabel="ترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmPost(false)}
        onConfirm={() => void doPost()}
      />
      <ConfirmDialog
        open={confirmVoid}
        title="تأكيد إلغاء التحويل"
        message={
          <div className="space-y-2">
            <p>
              {transfer.status === 'POSTED'
                ? 'سيتم إنشاء قيد عكسي ولن يُحذف القيد الأصلي.'
                : 'سيتم إلغاء المسودة دون قيد محاسبي.'}
            </p>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm"
              rows={2}
              placeholder="سبب الإلغاء"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="إلغاء التحويل"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setConfirmVoid(false)}
        onConfirm={() => void doVoid()}
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
