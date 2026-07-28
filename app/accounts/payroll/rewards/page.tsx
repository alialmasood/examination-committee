'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import { API, errMsg, fetchJson } from '../_lib';

type PersonOption = {
  id: string;
  person_code: string;
  full_name_ar: string;
  person_type: string;
};

type RewardRow = {
  id: string;
  reward_code: string;
  payroll_person_id: string;
  person_code?: string;
  person_name_ar?: string;
  person_type?: string;
  details: string;
  paid_on: string;
  amount: string;
};

type FormState = {
  payroll_person_id: string;
  details: string;
  paid_on: string;
  amount: string;
};

const PERSON_TYPE_LABEL: Record<string, string> = {
  TEACHING_STAFF: 'تدريسي',
  EXTERNAL_LECTURER: 'محاضر',
  EMPLOYEE: 'موظف',
  DAILY_WORKER: 'أجر يومي',
};

const ALLOWED_PERSON_TYPES = new Set(Object.keys(PERSON_TYPE_LABEL));

const emptyForm = (): FormState => ({
  payroll_person_id: '',
  details: '',
  paid_on: new Date().toISOString().slice(0, 10),
  amount: '',
});

const inputClass =
  'box-border h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm leading-none text-gray-900 outline-none focus:border-red-900 focus:ring-1 focus:ring-red-900';
const labelClass = 'mb-0.5 block text-xs font-semibold text-gray-700';

function dateOnlyGuard(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Tab' || e.key === 'Escape') return;
  e.preventDefault();
}

function formatMoney(v: string | number) {
  return Number(v || 0).toLocaleString('en-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export default function RewardsPage() {
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [peopleError, setPeopleError] = useState('');
  const [q, setQ] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async (search = '') => {
    setLoading(true);
    setListError('');
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (search.trim()) params.set('q', search.trim());
    const r = await fetchJson(`${API.rewards}?${params.toString()}`);
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
    setPeople(
      options.filter((person: PersonOption) => ALLOWED_PERSON_TYPES.has(person.person_type))
    );
  }, []);

  useEffect(() => {
    void loadList('');
    void loadPeople();
  }, [loadList, loadPeople]);

  function openCreate() {
    setForm(emptyForm());
    setFormError('');
    setModalOpen(true);
    void loadPeople();
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setFormError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.payroll_person_id) {
      setFormError('يجب اختيار الاسم');
      return;
    }
    if (!form.details.trim()) {
      setFormError('تفاصيل المكافئة مطلوبة');
      return;
    }
    if (!form.paid_on) {
      setFormError('تاريخ صرف المكافئة مطلوب');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('مبلغ المكافئة يجب أن يكون أكبر من صفر');
      return;
    }

    setSaving(true);
    setFormError('');
    const r = await fetchJson(API.rewards, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payroll_person_id: form.payroll_person_id,
        details: form.details.trim(),
        paid_on: form.paid_on,
        amount: form.amount,
      }),
    });
    setSaving(false);
    if (!r.__ok) {
      setFormError(errMsg(r));
      return;
    }
    setModalOpen(false);
    await loadList(q);
  }

  return (
    <main dir="rtl" className="p-4 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">المكافئات</h1>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900"
        >
          إضافة مكافئة
        </button>
      </div>
      <PayrollNav />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className={labelClass}>بحث</label>
          <input
            className={inputClass}
            placeholder="الاسم، الرمز، التفاصيل…"
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
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">رمز المكافئة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الاسم</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">الفئة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">تفاصيل المكافئة</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">تاريخ الصرف</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                  جاري التحميل…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                  لا توجد مكافئات مسجّلة بعد
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 odd:bg-white even:bg-gray-50/70 hover:bg-red-50/40"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap" dir="ltr">
                    {row.reward_code}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {row.person_name_ar || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">
                    {PERSON_TYPE_LABEL[row.person_type || ''] || row.person_type || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-800 max-w-[280px]">
                    <span className="line-clamp-2">{row.details}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-800 whitespace-nowrap" dir="ltr">
                    {(row.paid_on || '').slice(0, 10) || '—'}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap" dir="ltr">
                    {formatMoney(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-red-950 px-4 py-2 text-white">
              <h2 className="text-base font-bold">إضافة مكافئة جديدة</h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded px-2 py-0.5 text-lg leading-none hover:bg-red-900"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-2 p-3 sm:p-4">
              <div>
                <label className={labelClass}>
                  الاسم <span className="text-red-700">*</span>
                </label>
                <select
                  className={inputClass}
                  value={form.payroll_person_id}
                  onChange={(e) => setForm({ ...form, payroll_person_id: e.target.value })}
                  required
                  autoFocus
                >
                  <option value="">— اختر الاسم —</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name_ar} — {PERSON_TYPE_LABEL[person.person_type]} (
                      {person.person_code})
                    </option>
                  ))}
                </select>
                {peopleError && <p className="mt-0.5 text-xs text-red-700">{peopleError}</p>}
              </div>

              <div>
                <label className={labelClass}>
                  تفاصيل المكافئة <span className="text-red-700">*</span>
                </label>
                <textarea
                  className={`${inputClass} h-auto min-h-[72px] py-2 leading-normal`}
                  value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                  placeholder="اكتب تفاصيل المكافئة…"
                  maxLength={2000}
                  required
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    تاريخ صرف المكافئة <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="date"
                    className={`${inputClass} cursor-pointer`}
                    dir="ltr"
                    value={form.paid_on}
                    onChange={(e) => setForm({ ...form, paid_on: e.target.value })}
                    onKeyDown={dateOnlyGuard}
                    onPaste={(e) => e.preventDefault()}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      if (typeof el.showPicker === 'function') {
                        try {
                          el.showPicker();
                        } catch {
                          /* التقويم يفتح بالنقر العادي */
                        }
                      }
                    }}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    مبلغ المكافئة <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    className={inputClass}
                    dir="ltr"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0"
                    required
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-900">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-red-950 px-5 py-1.5 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ…' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
