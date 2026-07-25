'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import { API, errMsg, fetchJson, personNextCodeUrl, personTerminateUrl, personUrl } from '../_lib';

const ACADEMIC_TITLES = ['مدرس', 'مدرس مساعد', 'استاذ', 'استاذ مساعد'] as const;
const DEGREES = ['دبلوم', 'دبلوم عالي', 'بكالوريوس', 'ماجستير', 'دكتوراه'] as const;

type Department = { id: string; name_ar: string };

type TeachingStaffRow = {
  id: string;
  person_code: string;
  full_name_ar: string;
  full_name_en: string | null;
  academic_title: string | null;
  degree: string | null;
  phone: string | null;
  department_id: string | null;
  department_name_ar?: string | null;
  job_title: string | null;
  university_id: string | null;
  status: string;
  version: number;
  updated_at: string;
};

type FormState = {
  full_name_ar: string;
  full_name_en: string;
  academic_title: string;
  degree: string;
  phone: string;
  department_id: string;
  job_title: string;
  university_id: string;
};

const emptyForm = (): FormState => ({
  full_name_ar: '',
  full_name_en: '',
  academic_title: '',
  degree: '',
  phone: '',
  department_id: '',
  job_title: '',
  university_id: '',
});

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-900 focus:ring-1 focus:ring-red-900';
const labelClass = 'mb-1 block text-xs font-semibold text-gray-700';

const actionBtn =
  'rounded px-2 py-1 text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function TeachingStaffPage() {
  const [rows, setRows] = useState<TeachingStaffRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<TeachingStaffRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [terminateRow, setTerminateRow] = useState<TeachingStaffRow | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [terminateError, setTerminateError] = useState('');

  const [deleteRow, setDeleteRow] = useState<TeachingStaffRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const [nextCode, setNextCode] = useState('');
  const [nextCodeLoading, setNextCodeLoading] = useState(false);

  const loadList = useCallback(async (search = '') => {
    setLoading(true);
    setListError('');
    const params = new URLSearchParams({
      person_type: 'TEACHING_STAFF',
      page_size: '100',
      page: '1',
    });
    if (search.trim()) params.set('q', search.trim());
    const r = await fetchJson(`${API.people}?${params.toString()}`);
    if (!r.__ok) {
      setListError(errMsg(r));
      setRows([]);
    } else {
      setRows(Array.isArray(r.data) ? r.data : []);
    }
    setLoading(false);
  }, []);

  const loadDepartments = useCallback(async () => {
    setDepartmentsLoading(true);
    setDepartmentsError('');
    const r = await fetchJson(API.departments);
    if (!r.__ok) {
      setDepartmentsError(errMsg(r));
      setDepartments([]);
    } else {
      setDepartments(Array.isArray(r.data) ? r.data : []);
    }
    setDepartmentsLoading(false);
  }, []);

  useEffect(() => {
    void loadList('');
    void loadDepartments();
  }, [loadList, loadDepartments]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setModalMode('create');
    void loadDepartments();
    setNextCode('');
    setNextCodeLoading(true);
    void (async () => {
      const r = await fetchJson(personNextCodeUrl);
      setNextCode(r.__ok ? r.data?.next_code || '' : '');
      setNextCodeLoading(false);
    })();
  }

  function openEdit(row: TeachingStaffRow) {
    setEditing(row);
    setForm({
      full_name_ar: row.full_name_ar || '',
      full_name_en: row.full_name_en || '',
      academic_title: row.academic_title || '',
      degree: row.degree || '',
      phone: row.phone || '',
      department_id: row.department_id || '',
      job_title: row.job_title || '',
      university_id: row.university_id || '',
    });
    setFormError('');
    setModalMode('edit');
    void loadDepartments();
  }

  function closeFormModal() {
    if (saving) return;
    setModalMode(null);
    setEditing(null);
    setFormError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.full_name_ar.trim()) {
      setFormError('الاسم الكامل مع اللقب مطلوب');
      return;
    }
    setSaving(true);
    setFormError('');

    const payload = {
      full_name_ar: form.full_name_ar.trim(),
      full_name_en: form.full_name_en.trim() || null,
      academic_title: form.academic_title || null,
      degree: form.degree || null,
      phone: form.phone.trim() || null,
      department_id: form.department_id || null,
      job_title: form.job_title.trim() || null,
      university_id: form.university_id.trim() || null,
    };

    const r =
      modalMode === 'edit' && editing
        ? await fetchJson(personUrl(editing.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              version: editing.version,
              updated_at: editing.updated_at,
            }),
          })
        : await fetchJson(API.people, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              person_type: 'TEACHING_STAFF',
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

  async function confirmTerminate() {
    if (!terminateRow) return;
    if (!terminateReason.trim()) {
      setTerminateError('سبب إنهاء الخدمة مطلوب');
      return;
    }
    setActionBusyId(terminateRow.id);
    setTerminateError('');
    const r = await fetchJson(personTerminateUrl(terminateRow.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: terminateReason.trim(),
        version: terminateRow.version,
        updated_at: terminateRow.updated_at,
      }),
    });
    setActionBusyId(null);
    if (!r.__ok) {
      setTerminateError(errMsg(r));
      return;
    }
    setTerminateRow(null);
    setTerminateReason('');
    await loadList(q);
  }

  async function confirmDelete() {
    if (!deleteRow) return;
    setActionBusyId(deleteRow.id);
    setDeleteError('');
    const r = await fetchJson(personUrl(deleteRow.id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: deleteRow.version,
        updated_at: deleteRow.updated_at,
      }),
    });
    setActionBusyId(null);
    if (!r.__ok) {
      setDeleteError(errMsg(r));
      return;
    }
    setDeleteRow(null);
    await loadList(q);
  }

  const isTerminated = (status: string) => status === 'TERMINATED';

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">الكادر التدريسي</h1>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900"
        >
          إضافة تدريسي
        </button>
      </div>
      <PayrollNav />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={labelClass}>بحث</label>
          <input
            className={inputClass}
            placeholder="الاسم، رقم الهوية، الهاتف…"
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
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الاسم الكامل</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الاسم بالإنجليزية</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">اللقب العلمي</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الشهادة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الهاتف</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">القسم</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">المنصب</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الهوية الجامعية</th>
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
                  لا يوجد تدريسيون مسجّلون بعد
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const busy = actionBusyId === row.id;
                const ended = isTerminated(row.status);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 odd:bg-white even:bg-gray-50/70 hover:bg-red-50/40"
                  >
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                      {row.full_name_ar}
                      {ended && (
                        <span className="mr-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                          منتهٍ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                      {row.full_name_en || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">
                      {row.academic_title || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">{row.degree || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-800 whitespace-nowrap" dir="ltr">
                      {row.phone || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">
                      {row.department_name_ar || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">
                      {row.job_title || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-800 whitespace-nowrap">
                      {row.university_id || '—'}
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
                            setTerminateReason('');
                            setTerminateError('');
                            setTerminateRow(row);
                          }}
                          className={`${actionBtn} border-amber-700 text-amber-900 hover:bg-amber-50`}
                        >
                          إنهاء
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDeleteError('');
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
            className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-red-950 px-4 py-3 text-white">
              <h2 className="text-base font-bold">
                {modalMode === 'edit' ? 'تعديل بيانات تدريسي' : 'إضافة تدريسي جديد'}
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
                <label className={labelClass}>الرمز (يولّده النظام تلقائياً)</label>
                <input
                  className={`${inputClass} bg-gray-100 font-mono text-gray-600`}
                  dir="ltr"
                  value={
                    modalMode === 'edit'
                      ? editing?.person_code || ''
                      : nextCodeLoading
                        ? 'جاري التوليد…'
                        : nextCode || '—'
                  }
                  readOnly
                  tabIndex={-1}
                />
              </div>

              <div>
                <label className={labelClass}>
                  الاسم الكامل مع اللقب <span className="text-red-700">*</span>
                </label>
                <input
                  className={inputClass}
                  value={form.full_name_ar}
                  onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className={labelClass}>الاسم باللغة الإنجليزية (اختياري)</label>
                <input
                  className={inputClass}
                  dir="ltr"
                  value={form.full_name_en}
                  onChange={(e) => setForm({ ...form, full_name_en: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>اللقب العلمي</label>
                  <select
                    className={inputClass}
                    value={form.academic_title}
                    onChange={(e) => setForm({ ...form, academic_title: e.target.value })}
                  >
                    <option value="">— اختر —</option>
                    {ACADEMIC_TITLES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>الشهادة</label>
                  <select
                    className={inputClass}
                    value={form.degree}
                    onChange={(e) => setForm({ ...form, degree: e.target.value })}
                  >
                    <option value="">— اختر —</option>
                    {DEGREES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>رقم الهاتف</label>
                  <input
                    className={inputClass}
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>رقم الهوية الجامعية</label>
                  <input
                    className={inputClass}
                    value={form.university_id}
                    onChange={(e) => setForm({ ...form, university_id: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>القسم</label>
                <select
                  className={inputClass}
                  value={form.department_id}
                  onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                  disabled={departmentsLoading}
                >
                  <option value="">
                    {departmentsLoading
                      ? 'جاري تحميل الأقسام…'
                      : departments.length === 0
                        ? 'لا توجد أقسام مسجّلة'
                        : '— اختر القسم —'}
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name_ar}
                    </option>
                  ))}
                </select>
                {departmentsError && (
                  <p className="mt-1 text-xs text-red-700">{departmentsError}</p>
                )}
              </div>

              <div>
                <label className={labelClass}>المنصب إن وجد</label>
                <input
                  className={inputClass}
                  value={form.job_title}
                  onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                  placeholder="مثال: مقرر القسم"
                />
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
                      : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {terminateRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!actionBusyId) setTerminateRow(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 bg-amber-800 px-4 py-3 text-white">
              <h2 className="text-base font-bold">إنهاء خدمة تدريسي</h2>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-gray-700">
                سيتم إنهاء خدمة:{' '}
                <span className="font-semibold">{terminateRow.full_name_ar}</span>
              </p>
              <div>
                <label className={labelClass}>
                  سبب إنهاء الخدمة <span className="text-red-700">*</span>
                </label>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={terminateReason}
                  onChange={(e) => setTerminateReason(e.target.value)}
                  placeholder="اكتب سبب الإنهاء…"
                />
              </div>
              {terminateError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {terminateError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => setTerminateRow(null)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => void confirmTerminate()}
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
              <h2 className="text-base font-bold">حذف تدريسي</h2>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-gray-700">
                هل أنت متأكد من حذف{' '}
                <span className="font-semibold">{deleteRow.full_name_ar}</span>؟ لا يمكن التراجع
                عن هذا الإجراء.
              </p>
              {deleteError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {deleteError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={!!actionBusyId}
                  onClick={() => setDeleteRow(null)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
