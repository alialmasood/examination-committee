'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';

type FeeRow = {
  id: string;
  department_name: string;
  name_aliases: string[];
  morning_fee: number;
  evening_fee: number;
  morning_fee_y1?: number;
  morning_fee_y2?: number;
  morning_fee_y3?: number;
  morning_fee_y4?: number;
  evening_fee_y1?: number;
  evening_fee_y2?: number;
  evening_fee_y3?: number;
  evening_fee_y4?: number;
  updated_at: string | null;
};

const STAGE_LABELS = [
  { year: 1 as const, label: 'المرحلة الأولى' },
  { year: 2 as const, label: 'المرحلة الثانية' },
  { year: 3 as const, label: 'المرحلة الثالثة' },
  { year: 4 as const, label: 'المرحلة الرابعة' },
];

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

function stageFee(
  row: FeeRow,
  study: 'morning' | 'evening',
  year: 1 | 2 | 3 | 4
): number {
  const key = `${study}_fee_y${year}` as keyof FeeRow;
  const staged = row[key];
  if (typeof staged === 'number' && Number.isFinite(staged)) return staged;
  return study === 'morning' ? row.morning_fee : row.evening_fee;
}

/** عرض أقساط المراحل الأربع عمودياً داخل عمود الصباحي/المسائي */
function StageFeesStack({
  row,
  study,
}: {
  row: FeeRow;
  study: 'morning' | 'evening';
}) {
  return (
    <div className="space-y-1 min-w-[9.5rem]">
      {STAGE_LABELS.map((stage) => (
        <div
          key={`${study}-${stage.year}`}
          className="flex items-baseline justify-between gap-2 text-[12px] leading-snug"
        >
          <span className="text-gray-500 font-medium shrink-0">
            {stage.label}
          </span>
          <span className="tabular-nums font-semibold text-gray-800 whitespace-nowrap" dir="ltr">
            {money(stageFee(row, study, stage.year))}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function StudentDepartmentInstallmentsPage() {
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [morningY, setMorningY] = useState(['', '', '', '']);
  const [eveningY, setEveningY] = useState(['', '', '', '']);
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
    setMorningY([
      String(Math.round(stageFee(row, 'morning', 1))),
      String(Math.round(stageFee(row, 'morning', 2))),
      String(Math.round(stageFee(row, 'morning', 3))),
      String(Math.round(stageFee(row, 'morning', 4))),
    ]);
    setEveningY([
      String(Math.round(stageFee(row, 'evening', 1))),
      String(Math.round(stageFee(row, 'evening', 2))),
      String(Math.round(stageFee(row, 'evening', 3))),
      String(Math.round(stageFee(row, 'evening', 4))),
    ]);
    setFormError('');
  }

  function closeEdit() {
    if (saving) return;
    setEditing(null);
    setFormError('');
  }

  async function saveEdit() {
    if (!editing) return;
    const morningFees = morningY.map((v) => Number(v));
    const eveningFees = eveningY.map((v) => Number(v));
    if (morningFees.some((n) => !Number.isFinite(n) || n < 0)) {
      setFormError('أدخل مبالغ القسط الصباحي لكل مرحلة بشكل صحيح');
      return;
    }
    if (eveningFees.some((n) => !Number.isFinite(n) || n < 0)) {
      setFormError('أدخل مبالغ القسط المسائي لكل مرحلة بشكل صحيح');
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
          morning_fee_y1: morningFees[0],
          morning_fee_y2: morningFees[1],
          morning_fee_y3: morningFees[2],
          morning_fee_y4: morningFees[3],
          evening_fee_y1: eveningFees[0],
          evening_fee_y2: eveningFees[1],
          evening_fee_y3: eveningFees[2],
          evening_fee_y4: eveningFees[3],
          morning_fee: morningFees[0],
          evening_fee: eveningFees[0],
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
          مصدر مبلغ القسط السنوي لكل قسم ومرحلة (صباحي / مسائي) — يُعتمد في صفحات
          الحسابات والتسديد
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
                    <td className="px-4 py-2.5 align-top">
                      <StageFeesStack row={row} study="morning" />
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <StageFeesStack row={row} study="evening" />
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
            className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 max-h-[90vh] overflow-y-auto"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">تعديل قسط القسم</h2>
              <p className="text-sm text-gray-600 mt-1">{editing.department_name}</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              {STAGE_LABELS.map((stage, idx) => (
                <div
                  key={stage.year}
                  className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-3 space-y-3"
                >
                  <p className="text-xs font-semibold text-gray-800">
                    {stage.label}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        القسط السنوي — صباحي (IQD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={morningY[idx]}
                        onChange={(e) => {
                          const next = [...morningY];
                          next[idx] = e.target.value;
                          setMorningY(next);
                        }}
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
                        value={eveningY[idx]}
                        onChange={(e) => {
                          const next = [...eveningY];
                          next[idx] = e.target.value;
                          setEveningY(next);
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              ))}
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
