'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FiscalYear,
  accountsFetch,
  dateOnly,
  statusBadgeClass,
  statusLabel,
} from './components/types';

const emptyForm = {
  code: '',
  name_ar: '',
  start_date: '',
  end_date: '',
};

function formatDateAr(value?: string | null): string {
  if (!value) return '—';
  const raw = dateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(value);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

export default function AccountsSettingsPage() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadYears = useCallback(async () => {
    setLoading(true);
    const res = await accountsFetch<FiscalYear[]>('/api/accounts/fiscal-years');
    if (res.success && res.data) {
      setYears(res.data);
      setError(null);
    } else {
      setYears([]);
      setError(res.message || 'تعذر تحميل السنوات المالية');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage(null);
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(year: FiscalYear) {
    setEditingId(year.id);
    setForm({
      code: year.code,
      name_ar: year.name_ar,
      start_date: dateOnly(year.start_date),
      end_date: dateOnly(year.end_date),
    });
    setMessage(null);
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setSaving(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const payload = {
      code: form.code.trim(),
      name_ar: form.name_ar.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      create_monthly_periods: !editingId,
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

    setSaving(false);

    if (!res.success) {
      setError(res.message || (editingId ? 'تعذر تعديل السنة المالية' : 'تعذر إنشاء السنة المالية'));
      return;
    }

    setMessage(
      res.message || (editingId ? 'تم تعديل السنة المالية بنجاح' : 'تم إنشاء السنة المالية بنجاح')
    );
    closeForm();
    await loadYears();
  }

  async function runAction(year: FiscalYear, action: 'activate' | 'deactivate' | 'close') {
    const labels = {
      activate: 'تفعيل',
      deactivate: 'تعطيل',
      close: 'إغلاق',
    } as const;
    const ok = confirm(`هل تريد ${labels[action]} السنة المالية «${year.code}»؟`);
    if (!ok) return;

    setActionId(year.id);
    setMessage(null);
    setError(null);
    const res = await accountsFetch(`/api/accounts/fiscal-years/${year.id}/${action}`, {
      method: 'POST',
    });
    setActionId(null);

    if (!res.success) {
      setError(res.message || `تعذر ${labels[action]} السنة المالية`);
      return;
    }
    setMessage(res.message || `تم ${labels[action]} السنة المالية`);
    await loadYears();
  }

  async function removeYear(year: FiscalYear) {
    const ok = confirm(
      `هل تريد حذف السنة المالية «${year.code}»؟\n` +
        `سيتم حذف الفترات والتسلسلات المرتبطة بها.\n` +
        `لا يمكن التراجع عن هذه العملية.`
    );
    if (!ok) return;

    setActionId(year.id);
    setMessage(null);
    setError(null);
    const res = await accountsFetch(`/api/accounts/fiscal-years/${year.id}`, {
      method: 'DELETE',
    });
    setActionId(null);

    if (!res.success) {
      setError(res.message || 'تعذر حذف السنة المالية');
      return;
    }
    setMessage(res.message || 'تم حذف السنة المالية');
    if (editingId === year.id) closeForm();
    await loadYears();
  }

  const editingYear = editingId ? years.find((y) => y.id === editingId) : null;
  const lockDates = Boolean(editingYear && editingYear.status === 'ACTIVE');

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">إعدادات نظام الحسابات</h1>
          <p className="text-sm text-gray-600 mt-1">إدارة السنوات المالية والإعدادات المحاسبية</p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 shadow-sm"
        >
          إضافة سنة مالية
        </button>
      </div>

      {message ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {error && !formOpen ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {formOpen ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="bg-red-950 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs text-red-100/80">
                {editingId ? 'تعديل سنة مالية' : 'سنة مالية جديدة'}
              </p>
              <p className="text-sm font-semibold">
                {editingId ? 'تعديل السنة المالية' : 'إنشاء سنة مالية'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="text-xs text-red-100 hover:text-white underline"
            >
              إغلاق
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">رمز السنة المالية</label>
                <input
                  className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-100"
                  placeholder="مثال: FY-2026"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                  autoFocus
                  disabled={lockDates}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الاسم</label>
                <input
                  className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
                  placeholder="مثال: السنة المالية 2026"
                  value={form.name_ar}
                  onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
                <input
                  type="date"
                  className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-100"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  required
                  disabled={lockDates}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-100"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  required
                  disabled={lockDates}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-60"
              >
                {saving
                  ? 'جارٍ الحفظ…'
                  : editingId
                    ? 'حفظ التعديل'
                    : 'إنشاء السنة'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="bg-red-950 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-red-100/80">سجل السنوات</p>
            <p className="text-sm font-semibold">السنوات المالية</p>
          </div>
          <p className="text-xs text-red-100/90">
            {years.length > 0 ? `${years.length} سنة` : ''}
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">جارٍ تحميل السنوات المالية…</div>
        ) : years.length === 0 ? (
          <div className="py-16 text-center border-t border-dashed border-gray-200">
            <p className="text-gray-700 font-medium">لا توجد سنوات مالية بعد</p>
            <p className="text-sm text-gray-500 mt-1">
              اضغط «إضافة سنة مالية» لإنشاء أول سنة
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-gray-700 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2.5 text-right font-semibold">الرمز</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الاسم</th>
                  <th className="px-3 py-2.5 text-right font-semibold">من تاريخ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">إلى تاريخ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الحالة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الفترات</th>
                  <th className="px-3 py-2.5 text-right font-semibold">افتراضية</th>
                  <th className="px-3 py-2.5 text-right font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {years.map((year) => {
                  const busy = actionId === year.id;
                  return (
                    <tr key={year.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-red-950">
                        {year.code}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{year.name_ar}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
                        {formatDateAr(year.start_date)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
                        {formatDateAr(year.end_date)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(year.status)}`}
                        >
                          {statusLabel(year.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">{year.periods_count ?? 0}</td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {year.is_default ? (
                          <span className="text-emerald-700 font-semibold text-xs">نعم</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 justify-end">
                          {year.status !== 'CLOSED' ? (
                            <button
                              type="button"
                              className="text-blue-700 hover:underline text-xs font-medium"
                              disabled={busy}
                              onClick={() => openEditForm(year)}
                            >
                              تعديل
                            </button>
                          ) : null}

                          {year.status === 'DRAFT' ? (
                            <button
                              type="button"
                              className="text-emerald-700 hover:underline text-xs font-medium"
                              disabled={busy}
                              onClick={() => runAction(year, 'activate')}
                            >
                              تفعيل
                            </button>
                          ) : null}

                          {year.status === 'ACTIVE' ? (
                            <>
                              <button
                                type="button"
                                className="text-amber-700 hover:underline text-xs font-medium"
                                disabled={busy}
                                onClick={() => runAction(year, 'deactivate')}
                              >
                                تعطيل
                              </button>
                              <button
                                type="button"
                                className="text-orange-700 hover:underline text-xs font-medium"
                                disabled={busy}
                                onClick={() => runAction(year, 'close')}
                              >
                                غلق
                              </button>
                            </>
                          ) : null}

                          <button
                            type="button"
                            className="text-red-700 hover:underline text-xs font-semibold"
                            disabled={busy}
                            onClick={() => removeYear(year)}
                          >
                            {busy ? '…' : 'حذف'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
