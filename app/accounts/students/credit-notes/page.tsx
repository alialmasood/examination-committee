'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  CREDIT_NOTE_OPTIONS_API,
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTES_API,
  creditNoteStatusBadge,
  formatMoney,
  studentApi,
  type CreditNoteOptions,
  type StudentCreditNote,
} from '../components/types';

export default function StudentCreditNotesPage() {
  const [rows, setRows] = useState<StudentCreditNote[]>([]);
  const [opt, setOpt] = useState<CreditNoteOptions | null>(null);
  const [charges, setCharges] = useState<
    Array<{ id: string; charge_number: string }>
  >([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    student_charge_id: '',
    amount: '',
    reason: '',
    reason_code: 'OTHER',
    application_mode: 'DEBT_REDUCTION',
    revenue_adjustment_gl_account_id: '',
  });

  const load = useCallback(async () => {
    const [r, o, c] = await Promise.all([
      studentApi<StudentCreditNote[]>(CREDIT_NOTES_API),
      studentApi<CreditNoteOptions>(CREDIT_NOTE_OPTIONS_API),
      studentApi<Array<{ id: string; charge_number: string }>>(
        '/api/accounts/student-charges?page_size=100'
      ),
    ]);
    if (r.success) setRows(r.data || []);
    else setError(r.message || 'تعذر التحميل');
    if (o.success) setOpt(o.data || null);
    if (c.success) setCharges(c.data || []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const create = async () => {
    const r = await studentApi(CREDIT_NOTES_API, {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (!r.success) setError(r.message || 'فشل الإنشاء');
    else void load();
  };

  return (
    <div className="p-4 md:p-6" dir="rtl">
      <StudentsNav />
      <h1 className="text-xl font-bold text-red-900 mb-4">الإشعارات الدائنة</h1>
      {error && <p className="text-red-900 mb-2">{error}</p>}
      <div className="grid md:grid-cols-3 gap-2 border rounded p-3 mb-4">
        <select
          value={form.student_charge_id}
          onChange={(e) =>
            setForm({ ...form, student_charge_id: e.target.value })
          }
          className="border rounded px-2 py-1"
        >
          <option value="">اختر مطالبة</option>
          {charges.map((x) => (
            <option key={x.id} value={x.id}>
              {x.charge_number}
            </option>
          ))}
        </select>
        <input
          className="border rounded px-2 py-1"
          placeholder="المبلغ"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <select
          className="border rounded px-2 py-1"
          value={form.application_mode}
          onChange={(e) =>
            setForm({ ...form, application_mode: e.target.value })
          }
        >
          {opt?.application_modes.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name_ar}
            </option>
          ))}
        </select>
        <select
          className="border rounded px-2 py-1"
          value={form.reason_code}
          onChange={(e) => setForm({ ...form, reason_code: e.target.value })}
        >
          {(opt?.reason_codes || ['OTHER']).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select
          className="border rounded px-2 py-1"
          value={form.revenue_adjustment_gl_account_id}
          onChange={(e) =>
            setForm({
              ...form,
              revenue_adjustment_gl_account_id: e.target.value,
            })
          }
        >
          <option value="">حساب التعديل</option>
          {opt?.expense_gl_accounts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code} — {x.name_ar}
            </option>
          ))}
        </select>
        <textarea
          className="border rounded px-2 py-1 md:col-span-2"
          placeholder="سبب الإشعار"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          type="button"
          className="bg-red-900 text-white rounded px-3 py-1"
          onClick={() => void create()}
        >
          إنشاء إشعار
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right bg-gray-50">
            <th className="p-2">الرقم</th>
            <th className="p-2">الطالب</th>
            <th className="p-2">المطالبة</th>
            <th className="p-2">المبلغ</th>
            <th className="p-2">الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id} className="border-t">
              <td className="p-2">
                <Link className="text-red-900 font-mono" href={`credit-notes/${x.id}`}>
                  {x.credit_note_number}
                </Link>
              </td>
              <td className="p-2">{x.student_full_name_ar}</td>
              <td className="p-2 font-mono">{x.charge_number || '—'}</td>
              <td className="p-2">{formatMoney(x.amount)}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded ${creditNoteStatusBadge(x.status)}`}>
                  {CREDIT_NOTE_STATUS_LABEL[x.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
