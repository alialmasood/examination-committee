'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';
import {
  ACCOUNT_TYPE_LABEL,
  BankAccountDetail,
  BankAccountUser,
  BankOptions,
  OPENING_BALANCE_NOTE,
  STATUS_LABEL,
  bankApi,
  formatMoney,
  statusBadgeClass,
} from '../components/types';

export default function BankAccountDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [account, setAccount] = useState<BankAccountDetail | null>(null);
  const [options, setOptions] = useState<BankOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<
    'suspend' | 'activate' | 'close' | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [assignUserId, setAssignUserId] = useState('');
  const [assignFlags, setAssignFlags] = useState({
    can_view: true,
    can_prepare: false,
    can_post: false,
    can_approve: false,
    can_reconcile: false,
  });
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [removeUser, setRemoveUser] = useState<BankAccountUser | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!id) return;
      if (showSpinner) setLoading(true);
      const [detail, opt] = await Promise.all([
        bankApi<BankAccountDetail>(`/api/accounts/bank-accounts/${id}`),
        bankApi<BankOptions>(
          `/api/accounts/bank-accounts/options?exclude_bank_account_id=${id}`
        ),
      ]);
      if (opt.success && opt.data) setOptions(opt.data);
      if (!detail.success || !detail.data) {
        setError(detail.message || 'تعذر تحميل الحساب');
        setAccount(null);
      } else {
        setAccount(detail.data);
        setError(null);
      }
      setLoading(false);
    },
    [id]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load(false);
  }, [load]);

  const runStatusAction = async () => {
    if (!account || !confirmAction) return;
    setActionBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-accounts/${account.id}/${confirmAction}`,
      {
        method: 'POST',
        body: JSON.stringify({
          version: account.version,
          updated_at: account.updated_at,
        }),
      }
    );
    setActionBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر تنفيذ العملية');
      return;
    }
    const labels = {
      suspend: 'تم تعليق الحساب',
      activate: 'تم تفعيل الحساب',
      close: 'تم إغلاق الحساب',
    };
    setConfirmAction(null);
    setSuccess(labels[confirmAction]);
    void load(true);
  };

  const assignUser = async () => {
    if (!account || !assignUserId) {
      setAssignError('اختر مستخدماً');
      return;
    }
    setAssignBusy(true);
    setAssignError(null);
    const res = await bankApi(`/api/accounts/bank-accounts/${account.id}/users`, {
      method: 'POST',
      body: JSON.stringify({ user_id: assignUserId, ...assignFlags }),
    });
    setAssignBusy(false);
    if (!res.success) {
      setAssignError(res.message || 'تعذر التعيين');
      return;
    }
    setAssignUserId('');
    setSuccess('تم تعيين المستخدم');
    void load(true);
  };

  const doRemoveUser = async () => {
    if (!account || !removeUser) return;
    setActionBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-accounts/${account.id}/users/${removeUser.user_id}`,
      { method: 'DELETE' }
    );
    setActionBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإزالة');
      return;
    }
    setRemoveUser(null);
    setSuccess('تم إزالة المستخدم');
    void load(true);
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500">جاري تحميل تفاصيل الحساب…</div>
    );
  }

  if (!account) {
    return (
      <div className="p-6">
        <div className="text-red-800 bg-red-50 border border-red-200 rounded px-4 py-3 text-sm">
          {error || 'الحساب غير موجود'}
        </div>
        <Link href="/accounts/banks" className="text-sm text-red-900 mt-3 inline-block">
          العودة للقائمة
        </Link>
      </div>
    );
  }

  const confirmTitles = {
    suspend: 'تعليق الحساب',
    activate: 'تفعيل الحساب',
    close: 'إغلاق الحساب',
  };
  const confirmMessages = {
    suspend: `هل تريد تعليق الحساب «${account.account_name_ar}»؟ لن يُستخدم في العمليات الجديدة.`,
    activate: `هل تريد إعادة تفعيل الحساب «${account.account_name_ar}»؟`,
    close: `هل تريد إغلاق الحساب «${account.account_name_ar}» نهائياً؟ يتطلب رصيد GL صفرياً.`,
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/accounts/banks" className="text-xs text-gray-500 hover:underline">
              ← الحسابات المصرفية
            </Link>
            <h1 className="text-xl font-semibold text-gray-900 mt-1">
              {account.account_name_ar}{' '}
              <span className="text-sm font-mono text-gray-500">({account.code})</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClass(account.status)}`}
              >
                {STATUS_LABEL[account.status]}
              </span>
              {account.is_primary && (
                <span className="inline-block px-2 py-0.5 rounded text-xs bg-red-50 text-red-900 border border-red-200">
                  أساسي ({account.currency_code})
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              className="px-3 py-2 rounded-md border text-sm"
              onClick={() => window.print()}
            >
              طباعة البطاقة
            </button>
            {account.status === 'ACTIVE' && (
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-orange-700 text-orange-800 text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmAction('suspend');
                }}
              >
                تعليق
              </button>
            )}
            {account.status === 'SUSPENDED' && (
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-red-900 text-white text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmAction('activate');
                }}
              >
                تفعيل
              </button>
            )}
            {account.status !== 'CLOSED' && (
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-red-800 text-red-800 text-sm"
                onClick={() => {
                  setActionError(null);
                  setConfirmAction('close');
                }}
              >
                إغلاق
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 print:hidden">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 print:hidden">
            {success}
          </div>
        )}

        {/* Print card */}
        <div className="print-container border border-gray-300 rounded-md p-4 space-y-3 print:border-black">
          <div className="text-center border-b pb-3">
            <div className="text-lg font-bold text-gray-900">كلية الشرق</div>
            <div className="text-xs text-gray-600">للعلوم التقنية التخصصية — الحسابات المصرفية</div>
            <div className="text-xs text-gray-500 mt-1">
              تاريخ الطباعة:{' '}
              {new Date().toLocaleDateString('ar-IQ', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <Info label="الكود" value={account.code} />
            <Info label="اسم الحساب" value={account.account_name_ar} />
            <Info
              label="المصرف"
              value={
                account.bank_name_ar
                  ? `${account.bank_code} — ${account.bank_name_ar}`
                  : '—'
              }
            />
            <Info
              label="الفرع"
              value={
                account.branch_name_ar
                  ? `${account.branch_code || ''} — ${account.branch_name_ar}`
                  : '—'
              }
            />
            <Info label="رقم الحساب" value={account.account_number} />
            <Info label="IBAN" value={account.iban_display || account.iban || '—'} />
            <Info label="العملة" value={account.currency_code} />
            <Info
              label="النوع"
              value={ACCOUNT_TYPE_LABEL[account.account_type] || account.account_type}
            />
            <Info
              label="حساب GL"
              value={
                account.gl_account_code
                  ? `${account.gl_account_code} — ${account.gl_account_name_ar}`
                  : '—'
              }
            />
            <Info label="الحالة" value={STATUS_LABEL[account.status] || account.status} />
            <Info
              label="الرصيد الافتتاحي المرجعي"
              value={formatMoney(
                account.opening_balance_reference,
                account.currency_code
              )}
            />
            <Info
              label="تاريخ الرصيد المرجعي"
              value={account.opening_balance_date || '—'}
            />
            <Info
              label="الصلاحيات التشغيلية"
              value={[
                account.allows_receipts && 'قبض',
                account.allows_payments && 'صرف',
                account.allows_transfers && 'تحويل',
                account.allows_cheques && 'شيكات',
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            />
          </div>
          <p className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {OPENING_BALANCE_NOTE}
          </p>
          <div className="hidden print:grid grid-cols-2 gap-10 pt-10 text-sm text-center">
            <div>
              <div className="border-t border-gray-800 pt-2">اعتماد المحاسب</div>
            </div>
            <div>
              <div className="border-t border-gray-800 pt-2">اعتماد المدير المالي</div>
            </div>
          </div>
        </div>
      </div>

      {/* Users management */}
      {account.status !== 'CLOSED' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4 print:hidden">
          <div>
            <h2 className="text-base font-semibold text-gray-900">مستخدمو الحساب</h2>
            <p className="text-xs text-amber-900 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              الصلاحيات التشغيلية (عرض/إعداد/ترحيل/اعتماد/مطابقة) تمهيدية للمراحل القادمة.
              الحماية الحالية تعتمد على صلاحية نظام الحسابات (requireAccountsAccess)، ولا تُستبدل بجدول المخولين وحده.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3 items-end">
            <label className="block space-y-1">
              <span className="text-xs text-gray-600">المستخدم</span>
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
              >
                <option value="">اختر…</option>
                {(options?.users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username} ({u.username})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-3 text-xs">
              {(
                [
                  ['can_view', 'عرض'],
                  ['can_prepare', 'إعداد'],
                  ['can_post', 'ترحيل'],
                  ['can_approve', 'اعتماد'],
                  ['can_reconcile', 'مطابقة'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={assignFlags[key]}
                    onChange={(e) =>
                      setAssignFlags({ ...assignFlags, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {assignError && (
            <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {assignError}
            </div>
          )}
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-40"
            disabled={assignBusy}
            onClick={() => void assignUser()}
          >
            {assignBusy ? 'جارٍ التعيين…' : 'تعيين مستخدم'}
          </button>

          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right px-3 py-2 font-medium">المستخدم</th>
                  <th className="text-right px-3 py-2 font-medium">الصلاحيات</th>
                  <th className="text-right px-3 py-2 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {(account.users || []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-500">
                      لا يوجد مستخدمون معيّنون
                    </td>
                  </tr>
                ) : (
                  (account.users || []).map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="px-3 py-2">
                        {u.full_name || u.username || u.user_id}
                        {u.username && (
                          <span className="text-xs text-gray-500 mr-1">
                            ({u.username})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {[
                          u.can_view && 'عرض',
                          u.can_prepare && 'إعداد',
                          u.can_post && 'ترحيل',
                          u.can_approve && 'اعتماد',
                          u.can_reconcile && 'مطابقة',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-red-800 hover:underline"
                          onClick={() => {
                            setActionError(null);
                            setRemoveUser(u);
                          }}
                        >
                          إزالة
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction ? confirmTitles[confirmAction] : ''}
        message={confirmAction ? confirmMessages[confirmAction] : ''}
        confirmLabel="تأكيد"
        danger={confirmAction === 'close' || confirmAction === 'suspend'}
        busy={actionBusy}
        error={actionError}
        onConfirm={() => void runStatusAction()}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={Boolean(removeUser)}
        title="إزالة مستخدم"
        message={`هل تريد إزالة «${removeUser?.full_name || removeUser?.username}» من الحساب؟`}
        confirmLabel="إزالة"
        danger
        busy={actionBusy}
        error={actionError}
        onConfirm={() => void doRemoveUser()}
        onClose={() => setRemoveUser(null)}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-gray-900 font-medium break-all">{value}</div>
    </div>
  );
}
