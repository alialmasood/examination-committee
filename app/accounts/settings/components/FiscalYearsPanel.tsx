'use client';

import { useEffect, useState } from 'react';
import {
  FiscalYear,
  accountsFetch,
  dateOnly,
  statusBadgeClass,
  statusLabel,
} from './types';

export default function FiscalYearsPanel() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    name_ar: '',
    name_en: '',
    start_date: '',
    end_date: '',
    notes: '',
    create_monthly_periods: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await accountsFetch<FiscalYear[]>('/api/accounts/fiscal-years');
    if (res.success && res.data) setYears(res.data);
    else setError(res.message || 'تعذر جلب السنوات المالية');
    setLoading(false);
  };

  /* eslint-disable react-hooks/set-state-in-effect -- تحميل بيانات أولي من API */
  useEffect(() => {
    void load();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const notify = (ok: boolean, text?: string) => {
    setError(ok ? null : text || 'فشلت العملية');
    setMessage(ok ? text || 'تمت العملية بنجاح' : null);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      code: '',
      name_ar: '',
      name_en: '',
      start_date: '',
      end_date: '',
      notes: '',
      create_monthly_periods: true,
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      name_en: form.name_en || null,
      notes: form.notes || null,
    };

    const res = editingId
      ? await accountsFetch(`/api/accounts/fiscal-years/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await accountsFetch('/api/accounts/fiscal-years', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    notify(Boolean(res.success), res.message);
    if (res.success) {
      resetForm();
      await load();
    }
  };

  const startEdit = (year: FiscalYear) => {
    setEditingId(year.id);
    setForm({
      code: year.code,
      name_ar: year.name_ar,
      name_en: year.name_en || '',
      start_date: dateOnly(year.start_date),
      end_date: dateOnly(year.end_date),
      notes: year.notes || '',
      create_monthly_periods: false,
    });
  };

  const runAction = async (id: string, action: string) => {
    const res = await accountsFetch(`/api/accounts/fiscal-years/${id}/${action}`, {
      method: 'POST',
    });
    notify(Boolean(res.success), res.message);
    if (res.success) await load();
  };

  const remove = async (id: string) => {
    if (!confirm('هل تريد حذف هذه السنة المالية المسودة؟')) return;
    const res = await accountsFetch(`/api/accounts/fiscal-years/${id}`, { method: 'DELETE' });
    notify(Boolean(res.success), res.message);
    if (res.success) await load();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">
          {editingId ? 'تعديل سنة مالية' : 'إضافة سنة مالية'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border rounded-md px-3 py-2 text-right"
            placeholder="الرمز (مثل FY-2026)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
            disabled={Boolean(editingId && years.find((y) => y.id === editingId)?.status === 'ACTIVE')}
          />
          <input
            className="border rounded-md px-3 py-2 text-right"
            placeholder="الاسم بالعربية"
            value={form.name_ar}
            onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            required
          />
          <input
            className="border rounded-md px-3 py-2 text-right"
            placeholder="الاسم بالإنجليزية (اختياري)"
            value={form.name_en}
            onChange={(e) => setForm({ ...form, name_en: e.target.value })}
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2 text-right"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            required
            disabled={Boolean(editingId && years.find((y) => y.id === editingId)?.status === 'ACTIVE')}
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2 text-right"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            required
            disabled={Boolean(editingId && years.find((y) => y.id === editingId)?.status === 'ACTIVE')}
          />
          <input
            className="border rounded-md px-3 py-2 text-right md:col-span-2"
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        {!editingId && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.create_monthly_periods}
              onChange={(e) => setForm({ ...form, create_monthly_periods: e.target.checked })}
            />
            إنشاء 12 فترة شهرية تلقائياً
          </label>
        )}
        <div className="flex gap-2">
          <button type="submit" className="bg-red-900 text-white px-4 py-2 rounded-md hover:bg-red-800">
            {editingId ? 'حفظ التعديل' : 'إضافة'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="bg-gray-200 px-4 py-2 rounded-md">
              إلغاء
            </button>
          )}
        </div>
      </form>

      {message && <p className="text-green-700 text-sm">{message}</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-right">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">الرمز</th>
              <th className="p-2">الاسم</th>
              <th className="p-2">الفترة</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">الفترات</th>
              <th className="p-2">افتراضية</th>
              <th className="p-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : years.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">
                  لا توجد سنوات مالية بعد
                </td>
              </tr>
            ) : (
              years.map((year) => (
                <tr key={year.id} className="border-b">
                  <td className="p-2 font-medium">{year.code}</td>
                  <td className="p-2">{year.name_ar}</td>
                  <td className="p-2">
                    {dateOnly(year.start_date)} → {dateOnly(year.end_date)}
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(year.status)}`}>
                      {statusLabel(year.status)}
                    </span>
                  </td>
                  <td className="p-2">{year.periods_count ?? 0}</td>
                  <td className="p-2">{year.is_default ? 'نعم' : '—'}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {year.status !== 'CLOSED' && (
                        <button
                          className="text-blue-700 hover:underline"
                          onClick={() => startEdit(year)}
                        >
                          تعديل
                        </button>
                      )}
                      {year.status === 'DRAFT' && (
                        <button
                          className="text-green-700 hover:underline"
                          onClick={() => runAction(year.id, 'activate')}
                        >
                          تفعيل
                        </button>
                      )}
                      {year.status === 'ACTIVE' && (
                        <>
                          <button
                            className="text-indigo-700 hover:underline"
                            onClick={() => runAction(year.id, 'set-default')}
                          >
                            افتراضية
                          </button>
                          <button
                            className="text-orange-700 hover:underline"
                            onClick={() => runAction(year.id, 'close')}
                          >
                            إغلاق
                          </button>
                        </>
                      )}
                      {year.status === 'DRAFT' && (
                        <button className="text-red-700 hover:underline" onClick={() => remove(year.id)}>
                          حذف
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
