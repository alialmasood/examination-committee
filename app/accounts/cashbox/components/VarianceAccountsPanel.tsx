'use client';

import { useEffect, useState } from 'react';
import { CashBoxOptions, cashApi } from './types';

type Settings = {
  cash_variance_gain_account_id: string | null;
  cash_variance_loss_account_id: string | null;
};

type Props = {
  options: CashBoxOptions | null;
};

export default function VarianceAccountsPanel({ options }: Props) {
  const [settings, setSettings] = useState<Settings>({
    cash_variance_gain_account_id: null,
    cash_variance_loss_account_id: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    const res = await cashApi<Settings>(
      '/api/accounts/cash-boxes/settings/variance-accounts'
    );
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل إعدادات الفروقات');
    } else {
      setSettings(res.data);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load(false);
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await cashApi<Settings>(
      '/api/accounts/cash-boxes/settings/variance-accounts',
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      }
    );
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'تعذر حفظ الإعدادات');
      return;
    }
    setSettings(res.data || settings);
    setSuccess('تم حفظ إعدادات فروقات الجرد');
  };

  const accounts = options?.posting_accounts || [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">إعدادات الصناديق</h2>
        <p className="text-sm text-gray-600 mt-1">
          حسابات فروقات الجرد ستُستخدم لاحقاً في المرحلة 3.C عند تسوية فرق الجرد
          عبر قيد تسوية. لا تُنشأ قيود من هذه الشاشة.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">جاري التحميل…</div>
      ) : (
        <>
          {error && (
            <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
              {success}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-sm block">
              <span className="text-gray-700">حساب زيادة الجرد</span>
              <select
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                value={settings.cash_variance_gain_account_id || ''}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    cash_variance_gain_account_id: e.target.value || null,
                  }))
                }
                disabled={saving}
              >
                <option value="">— غير محدد —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar} ({a.account_type_code})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm block">
              <span className="text-gray-700">حساب عجز الجرد</span>
              <select
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                value={settings.cash_variance_loss_account_id || ''}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    cash_variance_loss_account_id: e.target.value || null,
                  }))
                }
                disabled={saving}
              >
                <option value="">— غير محدد —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar} ({a.account_type_code})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-60"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'جاري الحفظ…' : 'حفظ إعدادات الفروقات'}
          </button>
        </>
      )}
    </div>
  );
}
