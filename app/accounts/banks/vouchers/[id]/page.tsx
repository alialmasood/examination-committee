'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import {
  amountToArabicWords,
  bankApi,
  BankVoucherDetail,
  formatDateOnly,
  formatIbanDisplay,
  formatMoney,
  maskAccountNumber,
  VOUCHER_STATUS_LABEL,
  VOUCHER_TYPE_LABEL,
  voucherStatusClass,
} from '../components/types';

export default function BankVoucherDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');
  const [voucher, setVoucher] = useState<BankVoucherDetail | null>(null);
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
    description: '',
    party_name: '',
    external_reference: '',
    bank_reference: '',
    voucher_date: '',
    value_date: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await bankApi<BankVoucherDetail>(
      `/api/accounts/bank-vouchers/${id}`
    );
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل السند');
      setVoucher(null);
    } else {
      setVoucher(res.data);
      setEdit({
        amount: res.data.amount,
        description: res.data.description,
        party_name: res.data.party_name || '',
        external_reference: res.data.external_reference || '',
        bank_reference: res.data.bank_reference || '',
        voucher_date: res.data.voucher_date,
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
    if (!voucher) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-vouchers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...edit,
        value_date: edit.value_date || null,
        version: voucher.version,
        updated_at: voucher.updated_at,
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
    if (!voucher) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-vouchers/${id}/post`, {
      method: 'POST',
      body: JSON.stringify({
        version: voucher.version,
        updated_at: voucher.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الترحيل');
      return;
    }
    setConfirmPost(false);
    setSuccess('تم ترحيل السند وإنشاء القيد');
    await load();
  };

  const doVoid = async () => {
    if (!voucher) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-vouchers/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({
        reason: voidReason,
        version: voucher.version,
        updated_at: voucher.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإلغاء');
      return;
    }
    setConfirmVoid(false);
    setVoidReason('');
    setSuccess('تم إلغاء السند');
    await load();
  };

  if (loading && !voucher) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!voucher) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'السند غير موجود'}</p>
        <Link href="/accounts/banks/vouchers" className="underline text-sm">
          العودة
        </Link>
      </div>
    );
  }

  const amountWords = amountToArabicWords(voucher.amount, voucher.currency_code);

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border p-4 md:p-6 space-y-4 print:shadow-none print:border-0">
        <div className="flex flex-wrap justify-between gap-3 print:hidden">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link href="/accounts/banks/vouchers" className="hover:text-red-900">
                السندات المصرفية
              </Link>
              <span> / {voucher.voucher_number}</span>
            </div>
            <h1 className="text-xl font-semibold flex flex-wrap items-center gap-2">
              {VOUCHER_TYPE_LABEL[voucher.voucher_type]} — {voucher.voucher_number}
              <span
                className={`text-xs px-2 py-0.5 rounded ${voucherStatusClass(voucher.status)}`}
              >
                {VOUCHER_STATUS_LABEL[voucher.status]}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 border rounded-md text-sm"
              onClick={() => router.push('/accounts/banks/vouchers')}
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
            {voucher.status === 'DRAFT' && !editMode && (
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
            {(voucher.status === 'DRAFT' || voucher.status === 'POSTED') && (
              <button
                type="button"
                className="px-3 py-2 border border-amber-700 text-amber-950 rounded-md text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmVoid(true);
                }}
              >
                إلغاء السند
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
          <div className="text-lg font-bold">كلية الشرق الجامعة</div>
          <div className="text-base font-semibold">
            {voucher.voucher_type === 'BANK_RECEIPT'
              ? 'سند قبض مصرفي'
              : 'سند صرف مصرفي'}
          </div>
          <div className="font-mono">{voucher.voucher_number}</div>
        </div>

        {editMode ? (
          <div className="space-y-3 print:hidden">
            <label className="block text-sm">
              التاريخ
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.voucher_date}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, voucher_date: e.target.value }))
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
              الطرف
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={edit.party_name}
                onChange={(e) =>
                  setEdit((x) => ({ ...x, party_name: e.target.value }))
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
            <Info label="النوع" value={VOUCHER_TYPE_LABEL[voucher.voucher_type]} />
            <Info label="الحالة" value={VOUCHER_STATUS_LABEL[voucher.status]} />
            <Info label="التاريخ" value={formatDateOnly(voucher.voucher_date)} />
            <Info
              label="تاريخ القيمة"
              value={formatDateOnly(voucher.value_date)}
            />
            <Info
              label="الحساب المصرفي"
              value={
                <Link
                  href={`/accounts/banks/${voucher.bank_account_id}`}
                  className="text-red-900 underline print:no-underline print:text-black"
                >
                  {voucher.bank_account_code} — {voucher.bank_account_name_ar}
                </Link>
              }
            />
            <Info
              label="المصرف"
              value={
                voucher.bank_name_ar
                  ? `${voucher.bank_code} — ${voucher.bank_name_ar}`
                  : '—'
              }
            />
            <Info
              label="الفرع"
              value={
                voucher.branch_name_ar
                  ? `${voucher.branch_code || ''} — ${voucher.branch_name_ar}`
                  : '—'
              }
            />
            <Info
              label="رقم الحساب"
              value={maskAccountNumber(voucher.bank_account_number)}
            />
            <Info
              label="IBAN"
              value={formatIbanDisplay(
                voucher.bank_account_iban_normalized || voucher.bank_account_iban
              )}
            />
            <Info
              label="حساب GL"
              value={
                voucher.gl_account_code
                  ? `${voucher.gl_account_code} — ${voucher.gl_account_name_ar}`
                  : '—'
              }
            />
            <Info label="الطرف" value={voucher.party_name || '—'} />
            <Info
              label="الحساب المقابل"
              value={`${voucher.counter_account_code} — ${voucher.counter_account_name_ar}`}
            />
            <Info
              label="مركز الكلفة"
              value={
                voucher.cost_center_code
                  ? `${voucher.cost_center_code} — ${voucher.cost_center_name_ar}`
                  : '—'
              }
            />
            <Info
              label="المبلغ"
              value={formatMoney(voucher.amount, voucher.currency_code)}
            />
            <Info label="المبلغ كتابةً" value={amountWords || '—'} />
            <Info label="العملة" value={voucher.currency_code} />
            <Info label="المرجع البنكي" value={voucher.bank_reference || '—'} />
            <Info
              label="المرجع الخارجي"
              value={voucher.external_reference || '—'}
            />
            <Info label="البيان" value={voucher.description} />
            <Info label="المنشئ" value={voucher.created_by_name || '—'} />
            <Info label="تاريخ الإنشاء" value={formatDateOnly(voucher.created_at)} />
            {voucher.book_balance && (
              <Info
                label="الرصيد الدفتري للحساب"
                value={formatMoney(
                  voucher.book_balance.book_balance,
                  voucher.book_balance.currency_code
                )}
              />
            )}
            {voucher.journal_entry_number && (
              <Info
                label="رقم القيد"
                value={
                  <Link
                    href={`/accounts/entries?q=${encodeURIComponent(voucher.journal_entry_number)}`}
                    className="text-red-900 underline print:no-underline print:text-black font-mono"
                  >
                    {voucher.journal_entry_number}
                  </Link>
                }
              />
            )}
            {voucher.posted_by_name && (
              <Info label="مرحّل بواسطة" value={voucher.posted_by_name} />
            )}
            {voucher.void_reason && (
              <Info label="سبب الإلغاء" value={voucher.void_reason} />
            )}
            {voucher.reversal_journal_entry_number && (
              <Info
                label="قيد العكس"
                value={voucher.reversal_journal_entry_number}
              />
            )}
          </div>
        )}

        <div className="hidden print:grid grid-cols-2 gap-8 pt-10 text-sm text-center">
          <div>
            <div className="border-t pt-2">المستلم / الدافع</div>
          </div>
          <div>
            <div className="border-t pt-2">أمين الحسابات</div>
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
        open={confirmPost}
        title="تأكيد ترحيل السند"
        message="سيتم إنشاء قيد محاسبي وترحيل السند المصرفي، ولن يمكن تعديل بياناته المالية بعد ذلك. هل تريد المتابعة؟"
        confirmLabel="ترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmPost(false)}
        onConfirm={() => void doPost()}
      />
      <ConfirmDialog
        open={confirmVoid}
        title="تأكيد إلغاء السند"
        message={
          <div className="space-y-2">
            <p>
              {voucher.status === 'POSTED'
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
        confirmLabel="إلغاء السند"
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
