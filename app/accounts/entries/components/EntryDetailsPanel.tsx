'use client';

import { useEffect, useState } from 'react';
import {
  STATUS_LABEL,
  TYPE_LABEL,
  accountsApi,
  statusBadgeClass,
} from './types';

type Props = {
  entryId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (id: string) => void;
};

export default function EntryDetailsPanel({ entryId, onClose, onChanged, onEdit }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));

  const load = async (id: string) => {
    const [det, hist] = await Promise.all([
      accountsApi<Record<string, unknown>>(`/api/accounts/journal-entries/${id}`),
      accountsApi<Array<Record<string, unknown>>>(`/api/accounts/journal-entries/${id}/history`),
    ]);
    if (!det.success) {
      setError(det.message || 'تعذر التحميل');
      return;
    }
    setData(det.data || null);
    setHistory((hist.data as Array<Record<string, unknown>>) || []);
    setError(null);
  };

  /* eslint-disable react-hooks/set-state-in-effect -- تحميل تفاصيل القيد من API */
  useEffect(() => {
    if (!entryId) return;
    void load(entryId);
  }, [entryId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!entryId) return null;

  const status = String(data?.status || '');
  const run = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await accountsApi(`/api/accounts/journal-entries/${entryId}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشلت العملية');
      return;
    }
    setReason('');
    onChanged();
    await load(entryId);
  };

  const remove = async () => {
    if (!confirm('حذف هذه المسودة؟ لن يُعاد استخدام رقم القيد.')) return;
    setBusy(true);
    const res = await accountsApi(`/api/accounts/journal-entries/${entryId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'تعذر الحذف');
      return;
    }
    onChanged();
    onClose();
  };

  const lines = (data?.lines as Array<Record<string, unknown>>) || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[94vh] overflow-y-auto p-5 text-right">
        {!data ? (
          <div className="py-10 text-center text-gray-500">جاري التحميل...</div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold font-mono text-red-950">
                  {String(data.entry_number)}
                </h2>
                <p className="text-gray-700 mt-1">{String(data.description)}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-sm">
                  <span className={`px-2 py-0.5 rounded ${statusBadgeClass(status)}`}>
                    {STATUS_LABEL[status] || status}
                  </span>
                  <span className="text-gray-600">
                    {TYPE_LABEL[String(data.entry_type)] || String(data.entry_type)}
                  </span>
                  <span className="text-gray-600">{String(data.entry_date)}</span>
                </div>
              </div>
              <button type="button" className="px-3 py-1 rounded bg-gray-100" onClick={onClose}>
                إغلاق
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-4">
              <div>المنشئ: {String(data.created_by_username || '—')}</div>
              <div>المراجع: {String(data.reviewed_by_username || '—')}</div>
              <div>المعتمد: {String(data.approved_by_username || '—')}</div>
              <div>المرحّل: {String(data.posted_by_username || '—')}</div>
            </div>

            {(Boolean(data.reversal_entry_id) || Boolean(data.reverses_entry_id)) && (
              <div className="mb-3 text-sm text-purple-900 bg-purple-50 rounded p-2">
                {Boolean(data.reversal_entry_id) && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void load(String(data.reversal_entry_id))}
                  >
                    القيد العكسي المرتبط
                  </button>
                )}
                {Boolean(data.reverses_entry_id) && (
                  <button
                    type="button"
                    className="underline mr-3"
                    onClick={() => void load(String(data.reverses_entry_id))}
                  >
                    القيد الأصلي
                  </button>
                )}
              </div>
            )}

            <div className="overflow-x-auto border rounded-lg mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">الحساب</th>
                    <th className="px-2 py-2">مركز الكلفة</th>
                    <th className="px-2 py-2">الوصف</th>
                    <th className="px-2 py-2">مدين</th>
                    <th className="px-2 py-2">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={String(l.id)} className="border-t">
                      <td className="px-2 py-1">{String(l.line_number)}</td>
                      <td className="px-2 py-1 font-mono">
                        {String(l.account_code)} — {String(l.account_name_ar)}
                      </td>
                      <td className="px-2 py-1">
                        {l.cost_center_code
                          ? `${l.cost_center_code} — ${l.cost_center_name_ar}`
                          : '—'}
                      </td>
                      <td className="px-2 py-1">{String(l.description || '—')}</td>
                      <td className="px-2 py-1 font-mono">{String(l.debit_amount)}</td>
                      <td className="px-2 py-1 font-mono">{String(l.credit_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-4 text-sm mb-4">
              <span>
                إجمالي المدين: <strong className="font-mono">{String(data.total_debit)}</strong>
              </span>
              <span>
                إجمالي الدائن: <strong className="font-mono">{String(data.total_credit)}</strong>
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {status === 'DRAFT' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    className="px-3 py-1.5 rounded bg-blue-700 text-white text-sm"
                    onClick={() => onEdit(entryId)}
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="px-3 py-1.5 rounded bg-amber-700 text-white text-sm"
                    onClick={() => void run('submit')}
                  >
                    إرسال للمراجعة
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="px-3 py-1.5 rounded bg-gray-200 text-sm"
                    onClick={() => void remove()}
                  >
                    حذف
                  </button>
                </>
              )}
              {status === 'PENDING_REVIEW' && (
                <button
                  type="button"
                  disabled={busy}
                  className="px-3 py-1.5 rounded bg-sky-700 text-white text-sm"
                  onClick={() => void run('review')}
                >
                  مراجعة
                </button>
              )}
              {status === 'REVIEWED' && (
                <button
                  type="button"
                  disabled={busy}
                  className="px-3 py-1.5 rounded bg-indigo-700 text-white text-sm"
                  onClick={() => void run('approve')}
                >
                  اعتماد
                </button>
              )}
              {status === 'APPROVED' && (
                <button
                  type="button"
                  disabled={busy}
                  className="px-3 py-1.5 rounded bg-green-700 text-white text-sm"
                  onClick={() => void run('post')}
                >
                  ترحيل
                </button>
              )}
            </div>

            {['PENDING_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED'].includes(status) && (
              <div className="border rounded-lg p-3 mb-3 space-y-2">
                <label className="text-sm text-gray-600">سبب (للرفض / الإرجاع / الإلغاء)</label>
                <input
                  className="w-full border rounded-md px-3 py-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {['PENDING_REVIEW', 'REVIEWED', 'APPROVED'].includes(status) && (
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      className="px-3 py-1.5 rounded bg-red-700 text-white text-sm disabled:opacity-50"
                      onClick={() => void run('reject', { reason })}
                    >
                      رفض
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    className="px-3 py-1.5 rounded bg-slate-700 text-white text-sm disabled:opacity-50"
                    onClick={() => void run('return-to-draft', { reason })}
                  >
                    إرجاع لمسودة
                  </button>
                  {['DRAFT', 'REJECTED'].includes(status) && (
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      className="px-3 py-1.5 rounded bg-gray-600 text-white text-sm disabled:opacity-50"
                      onClick={() => void run('cancel', { reason })}
                    >
                      إلغاء
                    </button>
                  )}
                </div>
              </div>
            )}

            {status === 'DRAFT' || status === 'REJECTED' ? (
              <div className="mb-3">
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  className="px-3 py-1.5 rounded bg-gray-600 text-white text-sm disabled:opacity-50"
                  onClick={() => void run('cancel', { reason })}
                >
                  إلغاء القيد
                </button>
                {!reason.trim() && (
                  <span className="text-xs text-gray-500 mr-2">أدخل سبباً أولاً أعلاه أو في الحقل</span>
                )}
              </div>
            ) : null}

            {status === 'POSTED' && !data.is_reversal && (
              <div className="border rounded-lg p-3 mb-3 space-y-2">
                <h3 className="font-medium text-sm">عكس القيد</h3>
                <input
                  type="date"
                  className="border rounded-md px-3 py-2"
                  value={reversalDate}
                  onChange={(e) => setReversalDate(e.target.value)}
                />
                <input
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="سبب العكس *"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  className="px-3 py-1.5 rounded bg-purple-800 text-white text-sm disabled:opacity-50"
                  onClick={() =>
                    void run('reverse', { reason, reversal_date: reversalDate })
                  }
                >
                  إنشاء قيد عكسي وترحيله
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

            <div>
              <h3 className="font-medium mb-2">سجل الأحداث</h3>
              <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                {history.map((h) => (
                  <li key={String(h.id)} className="border-b py-1 text-gray-700">
                    <span className="font-mono text-xs text-gray-500">
                      {String(h.created_at).slice(0, 19)}
                    </span>{' '}
                    — {String(h.action)} — {String(h.username || '')} —{' '}
                    {String(h.description || '')}
                  </li>
                ))}
                {history.length === 0 && (
                  <li className="text-gray-500">لا أحداث مسجّلة</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
