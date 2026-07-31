'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';

type FeeRow = {
  id: string;
  department_name: string;
  name_aliases: string[];
  morning_fee: number;
  evening_fee: number;
  updated_at: string | null;
};

const money = (n: number) =>
  new Intl.NumberFormat('en-US').format(Math.round(n || 0));

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-IQ');
  } catch {
    return iso;
  }
}

export default function StudentDepartmentInstallmentsPage() {
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [morning, setMorning] = useState('');
  const [evening, setEvening] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts/department-tuition-fees', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error || 'تعذر تحميل أقساط الأقسام');
        setRows([]);
        return;
      }
      setRows(Array.isArray(body.data) ? body.data : []);
    } catch {
      setError('تعذر الاتصال بالخادم');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: FeeRow) {
    setEditing(row);
    setMorning(String(Math.round(row.morning_fee || 0)));
    setEvening(String(Math.round(row.evening_fee || 0)));
    setFormError('');
  }

  function closeEdit() {
    if (saving) return;
    setEditing(null);
    setFormError('');
  }

  async function saveEdit() {
    if (!editing) return;
    const morningFee = Number(morning);
    const eveningFee = Number(evening);
    if (!Number.isFinite(morningFee) || morningFee < 0) {
      setFormError('أدخل مبلغ القسط الصباحي بشكل صحيح');
      return;
    }
    if (!Number.isFinite(eveningFee) || eveningFee < 0) {
      setFormError('أدخل مبلغ القسط المسائي بشكل صحيح');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const res = await fetch('/api/accounts/department-tuition-fees', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          morning_fee: morningFee,
          evening_fee: eveningFee,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setFormError(body.error || 'تعذر حفظ التعديل');
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setFormError('تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">أقساط الأقسام</h1>
        <p className="text-sm text-gray-600 mt-1">
          مصدر مبلغ القسط السنوي لكل قسم (صباحي / مسائي) — يُعتمد في صفحات الحسابات
          والتسديد
        </p>
      </div>

      <StudentsNav />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-red-950 text-white flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">جدول أقساط الأقسام</p>
            <p className="text-xs text-red-100/80 mt-0.5">
              {rows.length} قسم · التعديل ينعكس على التسديد والحسابات
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 disabled:opacity-50"
          >
            تحديث
          </button>
        </div>

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            جارٍ التحميل…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            لا توجد أقسام مسجّلة
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2.5 text-right font-medium">#</th>
                  <th className="px-4 py-2.5 text-right font-medium">القسم</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    القسط السنوي (صباحي)
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    القسط السنوي (مسائي)
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">آخر تحديث</th>
                  <th className="px-4 py-2.5 text-right font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">
                        {row.department_name}
                      </p>
                      {row.name_aliases?.length ? (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          أسماء بديلة: {row.name_aliases.join(' · ')}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold text-gray-800">
                      {money(row.morning_fee)} IQD
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold text-gray-800">
                      {money(row.evening_fee)} IQD
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {formatUpdatedAt(row.updated_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                      >
                        تعديل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeEdit}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">تعديل قسط القسم</h2>
              <p className="text-sm text-gray-600 mt-1">{editing.department_name}</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  القسط السنوي — صباحي (IQD)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={morning}
                  onChange={(e) => setMorning(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  القسط السنوي — مسائي (IQD)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={evening}
                  onChange={(e) => setEvening(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                  dir="ltr"
                />
              </div>
              {formError ? (
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving}
                className="rounded-md bg-red-900 px-4 py-2 text-sm font-semibold text-white hover:bg-red-950 disabled:opacity-50"
              >
                {saving ? 'جارٍ الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
