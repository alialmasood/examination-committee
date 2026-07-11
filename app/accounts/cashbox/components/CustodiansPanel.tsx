'use client';

import { useMemo, useState } from 'react';
import {
  CashBoxCustodian,
  CashBoxDetail,
  CashBoxOptions,
  cashApi,
} from './types';

type Props = {
  box: CashBoxDetail;
  options: CashBoxOptions | null;
  onChanged: () => void;
};

export default function CustodiansPanel({ box, options, onChanged }: Props) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('CUSTODIAN');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => (box.custodians || []).filter((c) => !c.valid_to),
    [box.custodians]
  );
  const primary = active.find((c) => c.is_primary) || box.primary_custodian;
  const supervisors = active.filter((c) => !c.is_primary);

  const assign = async () => {
    setError(null);
    setSuccess(null);
    if (!userId) {
      setError('اختر مستخدماً');
      return;
    }
    if (primary && !window.confirm('استبدال الأمين الأساسي الحالي؟')) return;

    setBusy(true);
    try {
      const res = await cashApi(`/api/accounts/cash-boxes/${box.id}/custodians`, {
        method: 'PUT',
        body: JSON.stringify({
          user_id: userId,
          role,
          version: box.version,
          updated_at: box.updated_at,
        }),
      });
      if (!res.success) {
        if (String(res.message || '').includes('مستخدم آخر')) {
          setError(
            'تم تعديل الصندوق من مستخدم آخر، يرجى إعادة تحميل البيانات.'
          );
        } else {
          setError(res.message || 'تعذر تعيين الأمين');
        }
        return;
      }
      setSuccess('تم تعيين الأمين الأساسي بنجاح');
      setUserId('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const endAssignment = async (c: CashBoxCustodian) => {
    if (!window.confirm('إنهاء تعيين هذا الأمين؟')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cashApi(`/api/accounts/cash-boxes/${box.id}/custodians`, {
        method: 'PUT',
        body: JSON.stringify({
          end_custodian_id: c.id,
          version: box.version,
          updated_at: box.updated_at,
        }),
      });
      if (!res.success) {
        setError(res.message || 'تعذر إنهاء التعيين');
        return;
      }
      setSuccess('تم إنهاء التعيين');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="custodians" className="rounded-lg border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">إدارة الأمناء</h3>
        <p className="text-xs text-gray-500 mt-1">
          أمين أساسي واحد ساري لكل صندوق. لا يُنشأ مستخدمون من هنا.
        </p>
      </div>

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

      <div className="bg-gray-50 rounded-md p-3 text-sm">
        <div className="text-gray-500 text-xs mb-1">الأمين الأساسي الحالي</div>
        {primary ? (
          <div>
            <div className="font-medium">
              {primary.full_name || primary.username || primary.user_id}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              منذ{' '}
              {primary.valid_from
                ? new Date(primary.valid_from).toLocaleString('ar-IQ')
                : '—'}{' '}
              · ساري
            </div>
          </div>
        ) : (
          <div className="text-amber-800">لا يوجد أمين أساسي ساري</div>
        )}
      </div>

      {supervisors.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">مراقبون / تعيينات أخرى سارية</div>
          <ul className="space-y-2">
            {supervisors.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between text-sm border rounded px-3 py-2"
              >
                <span>
                  {c.full_name || c.username} ({c.role})
                </span>
                <button
                  type="button"
                  className="text-xs text-red-800"
                  disabled={busy}
                  onClick={() => void endAssignment(c)}
                >
                  إنهاء
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {box.status !== 'CLOSED' && (
        <div className="grid md:grid-cols-3 gap-2 items-end">
          <label className="text-sm md:col-span-2">
            <span className="text-gray-700">مستخدم</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={busy}
            >
              <option value="">— اختر —</option>
              {(options?.users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                  {u.full_name ? ` — ${u.full_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-gray-700">الدور</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={busy}
            >
              {(options?.custodian_roles || []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name_ar}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="md:col-span-3 px-4 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-60"
            disabled={busy}
            onClick={() => void assign()}
          >
            {busy
              ? 'جاري التنفيذ…'
              : primary
                ? 'استبدال الأمين الأساسي'
                : 'تعيين أمين أساسي'}
          </button>
        </div>
      )}
    </div>
  );
}
