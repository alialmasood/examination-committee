'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_TYPE,
  assignmentEndUrl,
  assignmentUrl,
  errMsg,
  fetchJson,
} from '../_lib';

type PersonOption = {
  id: string;
  person_code: string;
  full_name_ar: string;
  person_type: string;
};

type AssignmentRow = {
  id: string;
  assignment_code: string;
  payroll_person_id: string;
  person_code?: string;
  person_name_ar?: string;
  person_type?: string;
  assignment_type: string;
  title_ar: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  version: number;
  updated_at: string;
};

type FormState = {
  payroll_person_id: string;
  assignment_type: string;
  effective_from: string;
  duration_days: string;
};

const emptyForm = (): FormState => ({
  payroll_person_id: '',
  assignment_type: '',
  effective_from: new Date().toISOString().slice(0, 10),
  duration_days: '',
});

const PERSON_TYPE_LABEL: Record<string, string> = {
  TEACHING_STAFF: 'تدريسي',
  EXTERNAL_LECTURER: 'محاضر',
  EMPLOYEE: 'موظف',
  DAILY_WORKER: 'أجر يومي',
};

const ALLOWED_PERSON_TYPES = new Set(Object.keys(PERSON_TYPE_LABEL));
const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-900 focus:ring-1 focus:ring-red-900';
const labelClass = 'mb-1 block text-xs font-semibold text-gray-700';
const actionBtn =
  'rounded px-2 py-1 text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function durationDays(from: string, to: string | null): number | null {
  if (!to) return null;
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export default function AssignmentsPage() {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [peopleError, setPeopleError] = useState('');
  const [q, setQ] = useState('');

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [endRow, setEndRow] = useState<AssignmentRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<AssignmentRow | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const selectedPerson = useMemo(
    () => people.find((person) => person.id === form.payroll_person_id) ?? null,
    [people, form.payroll_person_id]
  );

  const loadList = useCallback(async (search = '') => {
    setLoading(true);
    setListError('');
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (search.trim()) params.set('q', search.trim());
    const r = await fetchJson(`${API.assignments}?${params.toString()}`);
    if (!r.__ok) {
      setListError(errMsg(r));
      setRows([]);
    } else {
      setRows(Array.isArray(r.data) ? r.data : []);
    }
    setLoading(false);
  }, []);

  const loadPeople = useCallback(async () => {
    setPeopleError('');
    const r = await fetchJson(API.options);
    if (!r.__ok) {
      setPeopleError(errMsg(r));
      setPeople([]);
      return;
    }
    const options = Array.isArray(r.data?.active_people) ? r.data.active_people : [];
    setPeople(options.filter((person: PersonOption) => ALLOWED_PERSON_TYPES.has(person.person_type)));
  }, []);

  useEffect(() => {
    void loadList('');
    void loadPeople();
  }, [loadList, loadPeople]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setModalMode('create');
    void loadPeople();
  }

  function openEdit(row: AssignmentRow) {
    setEditing(row);
    setForm({
      payroll_person_id: row.payroll_person_id,
      assignment_type: row.assignment_type,
      effective_from: row.effective_from,
      duration_days: String(durationDays(row.effective_from, row.effective_to) ?? ''),
    });
    setFormError('');
    setModalMode('edit');
    void loadPeople();
  }

  function closeFormModal() {
    if (saving) return;
    setModalMode(null);
    setEditing(null);
    setFormError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const duration = Number(form.duration_days);
    if (!form.payroll_person_id) {
      setFormError('يجب اختيار الاسم');
      return;
    }
    if (!form.assignment_type) {
      setFormError('نوع التكليف مطلوب');
      return;
    }
    if (!form.effective_from) {
      setFormError('تاريخ التكليف مطلوب');
      return;
    }
    if (!Number.isInteger(duration) || duration < 1) {
      setFormError('مدة التكليف يجب أن تكون عدداً صحيحاً من الأيام');
      return;
    }

    const assignmentLabel = ASSIGNMENT_TYPE[form.assignment_type] || form.assignment_type;
    const payload = {
      assignment_type: form.assignment_type,
      title_ar: assignmentLabel,
      effective_from: form.effective_from,
      effective_to: addDays(form.effective_from, duration - 1),
      metadata_json: { duration_days: duration },
    };
    setSaving(true);
    setFormError('');
    const r =
      modalMode === 'edit' && editing
        ? await fetchJson(assignmentUrl(editing.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              version: editing.version,
              updated_at: editing.updated_at,
            }),
          })
        : await fetchJson(API.assignments, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payroll_person_id: form.payroll_person_id,
              ...payload,
            }),
          });
    setSaving(false);
    if (!r.__ok) {
      setFormError(errMsg(r));
      return;
    }
    setModalMode(null);
    setEditing(null);
    await loadList(q);
  }

  async function confirmEnd() {
    if (!endRow) return;
    setActionBusyId(endRow.id);
    setActionError('');
    const r = await fetchJson(assignmentEndUrl(endRow.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: endRow.version, updated_at: endRow.updated_at }),
    });
    setActionBusyId(null);
    if (!r.__ok) {
      setActionError(errMsg(r));
      return;
    }
    setEndRow(null);
    await loadList(q);
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    setActionBusyId(deleteRow.id);
    setActionError('');
    const r = await fetchJson(assignmentUrl(deleteRow.id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: deleteRow.version, updated_at: deleteRow.updated_at }),
    });
    setActionBusyId(null);
    if (!r.__ok) {
      setActionError(errMsg(r));
      return;
    }
    setDeleteRow(null);
    await loadList(q);
  }

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">التكليفات</h1>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900"
        >
          إنشاء تكليف
        </button>
      </div>
      <PayrollNav />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={labelClass}>بحث</label>
          <input
            className={inputClass}
            placeholder="اسم الشخص، رمزه، رمز التكليف…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadList(q);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => void loadList(q)}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          بحث
        </button>
      </div>

      {listError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {listError}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-red-950 text-white">
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">#</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">رمز التكليف</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الاسم</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">رمز الشخص</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الفئة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">نوع التكليف</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">تاريخ التكليف</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">المدة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الحالة</th>
              <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-gray-500">
                  جاري التحميل…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-gray-500">
                  لا توجد تكليفات مسجّلة بعد
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const ended = row.status === 'ENDED';
                const busy = actionBusyId === row.id;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 odd:bg-white even:bg-gray-50/70 hover:bg-red-50/40"
                  >
                    <td className="px-3 py-2.5 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap" dir="ltr">
                      {row.assignment_code}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                      {row.person_name_ar || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap" dir="ltr">
                      {row.person_code || '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {PERSON_TYPE_LABEL[row.person_type || ''] || row.person_type || '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {ASSIGNMENT_TYPE[row.assignment_type] || row.assignment_type}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{row.effective_from}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {durationDays(row.effective_from, row.effective_to)
                        ? `${durationDays(row.effective_from, row.effective_to)} يوم`
                        : 'غير محددة'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                        {ASSIGNMENT_STATUS[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy || ended}
                          onClick={() => openEdit(row)}
                          className={`${actionBtn} border-blue-800 text-blue-900 hover:bg-blue-50`}
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          disabled={busy || ended}
                          onClick={() => {
                            setActionError('');
                            setEndRow(row);
                          }}
                          className={`${actionBtn} border-amber-700 text-amber-900 hover:bg-amber-50`}
                        >
                          إنهاء
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setActionError('');
                            setDeleteRow(row);
                          }}
                          className={`${actionBtn} border-red-800 text-red-900 hover:bg-red-50`}
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeFormModal}
        >
          <div
            className="w-full max-w-xl rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-red-950 px-4 py-3 text-white">
              <h2 className="text-base font-bold">
                {modalMode === 'edit' ? 'تعديل التكليف' : 'إنشاء تكليف جديد'}
              </h2>
              <button
                type="button"
                onClick={closeFormModal}
                className="rounded px-2 py-0.5 text-lg leading-none hover:bg-red-900"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-3 p-4">
              <div>
                <label className={labelClass}>
                  الاسم <span className="text-red-700">*</span>
                </label>
                <select
                  className={inputClass}
                  value={form.payroll_person_id}
                  onChange={(e) => setForm({ ...form, payroll_person_id: e.target.value })}
                  disabled={modalMode === 'edit'}
                  required
                >
                  <option value="">— اختر الاسم —</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name_ar} — {PERSON_TYPE_LABEL[person.person_type]}
                    </option>
                  ))}
                </select>
                {peopleError && <p className="mt-1 text-xs text-red-700">{peopleError}</p>}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>رمز الشخص</label>
                  <input
                    className={`${inputClass} bg-gray-100 font-mono text-gray-600`}
                    dir="ltr"
                    value={selectedPerson?.person_code || editing?.person_code || '—'}
                    readOnly
                    tabIndex={-1}
                  />
                </div>
                <div>
                  <label className={labelClass}>الفئة</label>
                  <input
                    className={`${inputClass} bg-gray-100 text-gray-600`}
                    value={
                      PERSON_TYPE_LABEL[selectedPerson?.person_type || editing?.person_type || ''] ||
                      '—'
                    }
                    readOnly
                    tabIndex={-1}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  نوع التكليف <span className="text-red-700">*</span>
                </label>
                <select
                  className={inputClass}
                  value={form.assignment_type}
                  onChange={(e) => setForm({ ...form, assignment_type: e.target.value })}
                  required
                >
                  <option value="">— اختر نوع التكليف —</option>
                  {Object.entries(ASSIGNMENT_TYPE).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    تاريخ التكليف <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.effective_from}
                    onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    مدة التكليف (بالأيام) <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={inputClass}
                    value={form.duration_days}
                    onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
                    placeholder="مثال: 30"
                    required
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={closeFormModal}
                  disabled={saving}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-red-950 px-5 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
                >
                  {saving
                    ? 'جاري الحفظ…'
                    : modalMode === 'edit'
                      ? 'حفظ التعديل'
                      : 'إنشاء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {endRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!actionBusyId) setEndRow(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 bg-amber-800 px-4 py-3 text-white">
              <h2 className="text-base font-bold">إنهاء التكليف</h2>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-gray-700">
                هل تريد إنهاء تكليف{' '}
                <span className="font-semibold">{endRow.person_name_ar}</span>؟
              </p>
              {actionError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {actionError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => setEndRow(null)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => void confirmEnd()}
                  className="rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-50"
                >
                  {actionBusyId ? 'جاري الإنهاء…' : 'تأكيد الإنهاء'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!actionBusyId) setDeleteRow(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 bg-red-950 px-4 py-3 text-white">
              <h2 className="text-base font-bold">حذف التكليف</h2>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-gray-700">
                هل أنت متأكد من حذف تكليف{' '}
                <span className="font-semibold">{deleteRow.person_name_ar}</span>؟ لا يمكن التراجع
                عن هذا الإجراء.
              </p>
              {actionError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {actionError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => setDeleteRow(null)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => void confirmDelete()}
                  className="rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
                >
                  {actionBusyId ? 'جاري الحذف…' : 'تأكيد الحذف'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
