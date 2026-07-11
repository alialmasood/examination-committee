'use client';

import { useEffect, useState } from 'react';
import {
  AccountType,
  ChartAccount,
  accountsApi,
  balanceLabel,
} from './types';

type Props = {
  open: boolean;
  mode: 'create' | 'edit' | 'child';
  accountTypes: AccountType[];
  flatAccounts: ChartAccount[];
  initial?: Partial<ChartAccount> | null;
  parentHint?: ChartAccount | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function AccountFormModal({
  open,
  mode,
  accountTypes,
  flatAccounts,
  initial,
  parentHint,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState({
    code: '',
    name_ar: '',
    name_en: '',
    account_type_id: '',
    parent_id: '',
    is_group: true,
    normal_balance: 'DEBIT' as 'DEBIT' | 'CREDIT',
    requires_cost_center: false,
    is_active: true,
    description: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');

  const applySuggestedCode = async (parentId: string) => {
    const res = await accountsApi<{ suggested: string | null; reason: string }>(
      `/api/accounts/chart-of-accounts/next-code?parent_id=${encodeURIComponent(parentId || '')}`
    );
    if (res.success && res.data?.suggested) {
      setForm((f) => ({ ...f, code: res.data!.suggested! }));
      setSuggestNote(res.data.reason || '');
    } else if (res.data?.reason) {
      setSuggestNote(res.data.reason);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- تهيئة النموذج عند فتح النافذة */
  useEffect(() => {
    if (!open) return;
    const parentId = mode === 'child' ? parentHint?.id || '' : initial?.parent_id || '';
    const typeId =
      initial?.account_type_id ||
      parentHint?.account_type_id ||
      accountTypes[0]?.id ||
      '';
    const type = accountTypes.find((t) => t.id === typeId);
    setForm({
      code: initial?.code || '',
      name_ar: initial?.name_ar || '',
      name_en: initial?.name_en || '',
      account_type_id: typeId,
      parent_id: parentId || '',
      is_group: initial?.is_group ?? mode !== 'child',
      normal_balance:
        (initial?.normal_balance as 'DEBIT' | 'CREDIT') || type?.normal_balance || 'DEBIT',
      requires_cost_center: initial?.requires_cost_center ?? false,
      is_active: initial?.is_active ?? true,
      description: initial?.description || '',
    });
    setError(null);

    if (mode !== 'edit') {
      void applySuggestedCode(parentId);
    } else {
      setSuggestNote('');
    }
  }, [open, mode, initial, parentHint, accountTypes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;

  const groupParents = flatAccounts.filter(
    (a) =>
      a.is_group &&
      a.is_active &&
      (!form.account_type_id || a.account_type_id === form.account_type_id) &&
      a.id !== initial?.id
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      parent_id: form.parent_id || null,
      name_en: form.name_en || null,
      description: form.description || null,
    };

    const res =
      mode === 'edit' && initial?.id
        ? await accountsApi(`/api/accounts/chart-of-accounts/${initial.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await accountsApi('/api/accounts/chart-of-accounts', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

    setSaving(false);
    if (!res.success) {
      setError(res.message || 'فشلت العملية');
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 text-right">
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'edit' ? 'تعديل حساب' : mode === 'child' ? 'إضافة حساب فرعي' : 'إضافة حساب'}
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-600">الكود</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
              {suggestNote && <p className="text-xs text-gray-500 mt-1">{suggestNote}</p>}
            </div>
            <div>
              <label className="text-sm text-gray-600">الاسم بالعربية</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">الاسم بالإنجليزية</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">نوع الحساب</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.account_type_id}
                onChange={(e) => {
                  const t = accountTypes.find((x) => x.id === e.target.value);
                  setForm({
                    ...form,
                    account_type_id: e.target.value,
                    normal_balance: t?.normal_balance || form.normal_balance,
                    parent_id: '',
                  });
                }}
                required
                disabled={mode === 'child'}
              >
                {accountTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">الحساب الأب</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.parent_id}
                onChange={(e) => {
                  const parentId = e.target.value;
                  setForm({ ...form, parent_id: parentId });
                  if (mode !== 'edit') void applySuggestedCode(parentId);
                }}
                disabled={mode === 'child'}
              >
                <option value="">بدون أب (رئيسي)</option>
                {groupParents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">طبيعة الرصيد</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.normal_balance}
                onChange={(e) =>
                  setForm({ ...form, normal_balance: e.target.value as 'DEBIT' | 'CREDIT' })
                }
              >
                <option value="DEBIT">{balanceLabel('DEBIT')}</option>
                <option value="CREDIT">{balanceLabel('CREDIT')}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_group}
                onChange={(e) => setForm({ ...form, is_group: e.target.checked })}
              />
              حساب تجميعي
            </label>
            <label className="flex items-center gap-2 text-gray-600">
              <input type="checkbox" checked={!form.is_group} disabled readOnly />
              يسمح بالترحيل (تلقائي حسب نوع الحساب)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.requires_cost_center}
                onChange={(e) => setForm({ ...form, requires_cost_center: e.target.checked })}
              />
              يتطلب مركز كلفة
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              فعّال
            </label>
          </div>

          <div>
            <label className="text-sm text-gray-600">الوصف</label>
            <textarea
              className="w-full border rounded-md px-3 py-2"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-gray-100">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md bg-red-900 text-white hover:bg-red-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
