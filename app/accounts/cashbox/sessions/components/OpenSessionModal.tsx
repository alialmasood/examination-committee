'use client';

import { useMemo, useState } from 'react';
import { cashApi, SessionOptions } from './session-types';

export default function OpenSessionModal({
  open,
  options,
  onClose,
  onOpened,
}: {
  open: boolean;
  options: SessionOptions | null;
  onClose: () => void;
  onOpened: (sessionId: string) => void;
}) {
  if (!open) return null;
  return (
    <OpenSessionForm
      options={options}
      onClose={onClose}
      onOpened={onOpened}
    />
  );
}

function OpenSessionForm({
  options,
  onClose,
  onOpened,
}: {
  options: SessionOptions | null;
  onClose: () => void;
  onOpened: (sessionId: string) => void;
}) {
  const defaultYear =
    options?.fiscal_years.find((y) => y.status === 'ACTIVE') ||
    options?.fiscal_years[0];

  const [cashBoxId, setCashBoxId] = useState('');
  const [yearId, setYearId] = useState(defaultYear?.id || '');
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(() => {
    if (!options || !yearId) return [];
    return options.fiscal_periods.filter((p) => p.fiscal_year_id === yearId);
  }, [options, yearId]);

  const periodId = useMemo(() => {
    if (!periods.length) return '';
    const match = periods.find(
      (p) =>
        sessionDate >= p.start_date.slice(0, 10) &&
        sessionDate <= p.end_date.slice(0, 10)
    );
    return match?.id || periods[0].id;
  }, [periods, sessionDate]);

  const [periodOverride, setPeriodOverride] = useState<string | null>(null);
  const selectedPeriodId = periodOverride && periods.some((p) => p.id === periodOverride)
    ? periodOverride
    : periodId;

  const liveBoxIds = new Set((options?.live_sessions || []).map((s) => s.cash_box_id));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await cashApi<{ id: string }>('/api/accounts/cash-box-sessions', {
      method: 'POST',
      body: JSON.stringify({
        cash_box_id: cashBoxId,
        fiscal_year_id: yearId,
        fiscal_period_id: selectedPeriodId,
        session_date: sessionDate,
        notes: notes || undefined,
      }),
    });
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر فتح الجلسة');
      return;
    }
    onOpened(res.data.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">فتح جلسة صندوق</h3>
        <p className="text-sm text-gray-600">
          يُحسب الرصيد الافتتاحي تلقائياً من القيود المرحلة عند الفتح.
        </p>

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-gray-700">الصندوق</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={cashBoxId}
              onChange={(e) => setCashBoxId(e.target.value)}
            >
              <option value="">اختر صندوقاً نشطاً…</option>
              {(options?.cash_boxes || []).map((b) => (
                <option key={b.id} value={b.id} disabled={liveBoxIds.has(b.id)}>
                  {b.code} — {b.name_ar}
                  {liveBoxIds.has(b.id) ? ' (جلسة حية)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">السنة المالية</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setPeriodOverride(null);
              }}
            >
              {(options?.fiscal_years || []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">الفترة المحاسبية</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={selectedPeriodId}
              onChange={(e) => setPeriodOverride(e.target.value)}
            >
              {periods.length === 0 && <option value="">لا توجد فترة OPEN</option>}
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} ({p.start_date.slice(0, 10)} → {p.end_date.slice(0, 10)})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">تاريخ الجلسة</span>
            <input
              type="date"
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={sessionDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                setPeriodOverride(null);
              }}
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">ملاحظات (اختياري)</span>
            <textarea
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50"
            disabled={busy}
            onClick={onClose}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-40"
            disabled={
              busy || !cashBoxId || !yearId || !selectedPeriodId || !sessionDate
            }
            onClick={() => void submit()}
          >
            {busy ? 'جارٍ الفتح…' : 'فتح الجلسة'}
          </button>
        </div>
      </div>
    </div>
  );
}
