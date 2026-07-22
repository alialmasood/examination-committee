'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  REFUNDS_API,
  REFUND_OPTIONS_API,
  REFUND_STATUS_LABEL,
  formatMoney,
  refundStatusBadge,
  studentApi,
  type RefundOptions,
  type StudentRefund,
} from '../components/types';

export default function StudentRefundsPage() {
  const [rows, setRows] = useState<StudentRefund[]>([]);
  const [opt, setOpt] = useState<RefundOptions | null>(null);
  const [error, setError] = useState('');
  const [creditBalance, setCreditBalance] = useState('');
  const [form, setForm] = useState({
    student_account_id: '',
    amount: '',
    reason: '',
    payment_method: 'BANK',
    cash_box_id: '',
    cash_box_session_id: '',
    bank_account_id: '',
    collection_id: '',
  });

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([
      studentApi<StudentRefund[]>(REFUNDS_API),
      studentApi<RefundOptions>(REFUND_OPTIONS_API),
    ]);
    if (r.success) setRows(r.data || []);
    else setError(r.message || 'تعذر التحميل');
    if (o.success) setOpt(o.data || null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const loadCredit = async (accountId: string) => {
    if (!accountId) {
      setCreditBalance('');
      return;
    }
    const r = await studentApi<{ credit_balance: string }>(
      `/api/accounts/student-accounts/${accountId}/credit-balance`
    );
    if (r.success && r.data) {
      setCreditBalance(String(r.data.credit_balance ?? '0'));
    }
  };

  const create = async () => {
    const payload = {
      student_account_id: form.student_account_id,
      amount: form.amount,
      reason: form.reason,
      payment_method: form.payment_method,
      cash_box_id: form.cash_box_id || undefined,
      cash_box_session_id: form.cash_box_session_id || undefined,
      bank_account_id: form.bank_account_id || undefined,
      allocations: [
        {
          student_collection_id: form.collection_id,
          refunded_amount: form.amount,
        },
      ],
    };
    const r = await studentApi(REFUNDS_API, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!r.success) setError(r.message || 'فشل الإنشاء');
    else void load();
  };

  return (
    <div className="p-6" dir="rtl">
      <StudentsNav />
      <h1 className="text-xl font-bold text-red-900">استردادات أرصدة الطلبة</h1>
      <p className="text-sm text-gray-600 mb-3">
        استرداد الرصيد الدائن يتم فقط عبر التحصيلات القابلة للاسترداد.
      </p>
      {error && <p className="text-red-900 mb-2">{error}</p>}
      <div className="grid gap-2 md:grid-cols-3 border p-3 my-4 rounded">
        <input
          className="border rounded px-2 py-1"
          placeholder="معرّف حساب الطالب"
          value={form.student_account_id}
          onChange={(e) => {
            const student_account_id = e.target.value;
            setForm({ ...form, student_account_id });
            void loadCredit(student_account_id);
          }}
        />
        <div className="border rounded px-2 py-1 bg-gray-50 text-sm">
          الرصيد الدائن: {creditBalance ? formatMoney(creditBalance) : '—'}
        </div>
        <input
          className="border rounded px-2 py-1"
          placeholder="المبلغ"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <select
          className="border rounded px-2 py-1"
          value={form.payment_method}
          onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
        >
          {opt?.payment_methods.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name_ar}
            </option>
          ))}
        </select>
        {form.payment_method === 'CASH' ? (
          <>
            <select
              className="border rounded px-2 py-1"
              value={form.cash_box_id}
              onChange={(e) => setForm({ ...form, cash_box_id: e.target.value })}
            >
              <option value="">الصناديق</option>
              {opt?.cash_boxes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name_ar}
                </option>
              ))}
            </select>
            <input
              className="border rounded px-2 py-1"
              placeholder="معرّف جلسة الصندوق"
              value={form.cash_box_session_id}
              onChange={(e) =>
                setForm({ ...form, cash_box_session_id: e.target.value })
              }
            />
          </>
        ) : (
          <select
            className="border rounded px-2 py-1"
            value={form.bank_account_id}
            onChange={(e) =>
              setForm({ ...form, bank_account_id: e.target.value })
            }
          >
            <option value="">الحساب البنكي</option>
            {opt?.bank_accounts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.account_name_ar}
              </option>
            ))}
          </select>
        )}
        <input
          className="border rounded px-2 py-1"
          placeholder="معرّف التحصيل المرتبط"
          value={form.collection_id}
          onChange={(e) => setForm({ ...form, collection_id: e.target.value })}
        />
        <textarea
          className="border rounded px-2 py-1 md:col-span-2"
          placeholder="السبب"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          type="button"
          className="bg-red-900 text-white rounded px-3 py-1"
          onClick={() => void create()}
        >
          إنشاء استرداد
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right bg-gray-50">
            <th className="p-2">الرقم</th>
            <th className="p-2">الطالب</th>
            <th className="p-2">المبلغ</th>
            <th className="p-2">الطريقة</th>
            <th className="p-2">الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr className="border-t" key={x.id}>
              <td className="p-2">
                <Link className="text-red-900 font-mono" href={`refunds/${x.id}`}>
                  {x.refund_number}
                </Link>
              </td>
              <td className="p-2">{x.student_full_name_ar}</td>
              <td className="p-2">{formatMoney(x.amount)}</td>
              <td className="p-2">{x.payment_method}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded ${refundStatusBadge(x.status)}`}>
                  {REFUND_STATUS_LABEL[x.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
