'use client';

import { useEffect, useState } from 'react';
import {
  FiscalPeriod,
  FiscalYear,
  accountsFetch,
  dateOnly,
  statusBadgeClass,
  statusLabel,
} from './types';

export default function FiscalPeriodsPanel() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [yearId, setYearId] = useState('');
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    period_number: 1,
    code: '',
    name_ar: '',
    start_date: '',
    end_date: '',
  });

  useEffect(() => {
    (async () => {
      const res = await accountsFetch<FiscalYear[]>('/api/accounts/fiscal-years');
      if (res.success && res.data) {
        setYears(res.data);
        if (res.data.length > 0) setYearId(res.data[0].id);
      }
    })();
  }, []);

  const loadPeriods = async (id: string) => {
    if (!id) return;
    const res = await accountsFetch<FiscalPeriod[]>(
      `/api/accounts/fiscal-periods?fiscal_year_id=${id}`
    );
    if (res.success && res.data) setPeriods(res.data);
    else setError(res.message || 'تعذر جلب الفترات');
  };

  /* eslint-disable react-hooks/set-state-in-effect -- تحميل عند تغيير السنة */
  useEffect(() => {
    if (yearId) void loadPeriods(yearId);
  }, [yearId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const notify = (ok: boolean, text?: string) => {
    setError(ok ? null : text || 'فشلت العملية');
    setMessage(ok ? text || 'تمت العملية بنجاح' : null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await accountsFetch('/api/accounts/fiscal-periods', {
      method: 'POST',
      body: JSON.stringify({ ...form, fiscal_year_id: yearId }),
    });
    notify(Boolean(res.success), res.message);
    if (res.success) {
      setForm({ period_number: form.period_number + 1, code: '', name_ar: '', start_date: '', end_date: '' });
      await loadPeriods(yearId);
    }
  };

  const action = async (id: string, path: string, body?: Record<string, unknown>) => {
    const res = await accountsFetch(`/api/accounts/fiscal-periods/${id}/${path}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    notify(Boolean(res.success), res.message);
    if (res.success) await loadPeriods(yearId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm text-gray-700">السنة المالية</label>
        <select
          className="border rounded-md px-3 py-2"
          value={yearId}
          onChange={(e) => setYearId(e.target.value)}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.code} — {y.name_ar} ({statusLabel(y.status)})
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">إضافة فترة مخصصة</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="number"
            min={1}
            className="border rounded-md px-3 py-2"
            value={form.period_number}
            onChange={(e) => setForm({ ...form, period_number: Number(e.target.value) })}
            required
          />
          <input
            className="border rounded-md px-3 py-2"
            placeholder="الرمز (مثل P01)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <input
            className="border rounded-md px-3 py-2"
            placeholder="الاسم"
            value={form.name_ar}
            onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            required
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            required
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            required
          />
        </div>
        <button type="submit" className="bg-red-900 text-white px-4 py-2 rounded-md hover:bg-red-800">
          إضافة فترة
        </button>
      </form>

      {message && <p className="text-green-700 text-sm">{message}</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-right">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">الرمز</th>
              <th className="p-2">الاسم</th>
              <th className="p-2">من</th>
              <th className="p-2">إلى</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="p-2">{p.period_number}</td>
                <td className="p-2">{p.code}</td>
                <td className="p-2">{p.name_ar}</td>
                <td className="p-2">{dateOnly(p.start_date)}</td>
                <td className="p-2">{dateOnly(p.end_date)}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(p.status)}`}>
                    {statusLabel(p.status)}
                  </span>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {p.status === 'OPEN' && (
                      <button className="text-orange-700 hover:underline" onClick={() => action(p.id, 'close')}>
                        إغلاق
                      </button>
                    )}
                    {p.status === 'CLOSED' && (
                      <button
                        className="text-green-700 hover:underline"
                        onClick={() => {
                          const reason = prompt('سبب إعادة الفتح (إلزامي):');
                          if (reason) action(p.id, 'reopen', { reason });
                        }}
                      >
                        إعادة فتح
                      </button>
                    )}
                    {p.status !== 'LOCKED' && (
                      <button
                        className="text-red-700 hover:underline"
                        onClick={() => {
                          if (p.status === 'OPEN') {
                            if (confirm('قفل مباشر من حالة مفتوحة؟')) {
                              action(p.id, 'lock', { confirm_lock_from_open: true });
                            }
                          } else {
                            action(p.id, 'lock');
                          }
                        }}
                      >
                        قفل
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
