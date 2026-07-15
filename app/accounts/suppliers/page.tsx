'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import SuppliersNav from './SuppliersNav';

type Dashboard = {
  active_suppliers: number;
  total_payables: string;
  paid_to_suppliers: string;
  remaining_payables: string;
  cash_supplier_payments: string;
  bank_supplier_payments: string;
  cash_direct_expenses: string;
  bank_direct_expenses: string;
  draft_invoices: number;
  posted_invoices: number;
  recent_payments?: Array<{
    id: string;
    payment_number: string;
    amount: string;
    status: string;
    payment_method: string;
    supplier_name_ar: string;
  }>;
  recent_expenses?: Array<{
    id: string;
    expense_number: string;
    amount: string;
    status: string;
    payment_method: string;
    beneficiary_name: string;
  }>;
};

type Data = {
  dashboard?: Dashboard;
  suppliers: Array<{
    id: string;
    supplier_number: string;
    name_ar: string;
    status: string;
    balance?: string;
  }>;
};

export default function SuppliersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts/supplier-options?dashboard=1').then((r) => r.json()),
      fetch('/api/accounts/suppliers?page_size=10').then((r) => r.json()),
    ])
      .then(([o, s]) => {
        if (!o.success || !s.success) throw new Error(o.message || s.message);
        setData({ dashboard: o.data.dashboard, suppliers: s.data });
      })
      .catch((e) => setError(e.message));
  }, []);

  const d = data?.dashboard;
  const cards: Array<[string, string | number]> = [
    ['الموردون النشطون', d?.active_suppliers ?? '—'],
    ['إجمالي الذمم / الرصيد المتبقي', d?.remaining_payables ?? '—'],
    ['المدفوع للموردين', d?.paid_to_suppliers ?? '—'],
    ['دفعات نقدية', d?.cash_supplier_payments ?? '—'],
    ['دفعات مصرفية', d?.bank_supplier_payments ?? '—'],
    ['مصروفات مباشرة نقدية', d?.cash_direct_expenses ?? '—'],
    ['مصروفات مباشرة مصرفية', d?.bank_direct_expenses ?? '—'],
    ['فواتير مسودة / مرحّلة', `${d?.draft_invoices ?? '—'} / ${d?.posted_invoices ?? '—'}`],
  ];

  return (
    <main dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-2xl font-bold text-gray-800">الموردون والذمم الدائنة</h2>
        <div className="flex gap-2">
          <Link href="/accounts/suppliers/payments/new" className="bg-emerald-600 text-white px-4 py-2 rounded-lg">
            دفعة مورد
          </Link>
          <Link href="/accounts/suppliers/expenses/new" className="bg-amber-600 text-white px-4 py-2 rounded-lg">
            مصروف مباشر
          </Link>
          <Link href="/accounts/suppliers/invoices/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg">
            فاتورة مورد
          </Link>
        </div>
      </div>
      <SuppliersNav />
      {error && <p className="text-red-600 mb-4">{error}</p>}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-7">
        {cards.map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl shadow p-5">
            <p className="text-gray-500 text-sm">{label}</p>
            <p className="text-2xl font-bold mt-2">{value}</p>
          </div>
        ))}
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-7">
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 flex justify-between">
            <h3 className="font-bold">أحدث الموردين</h3>
            <Link className="text-blue-600" href="/accounts/suppliers/list">عرض الكل</Link>
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr><th className="p-3">الرقم</th><th>المورد</th><th>الرصيد</th></tr>
            </thead>
            <tbody>
              {data?.suppliers.map((s) => (
                <tr className="border-t" key={s.id}>
                  <td className="p-3">
                    <Link className="text-blue-600" href={`/accounts/suppliers/${s.id}`}>{s.supplier_number}</Link>
                  </td>
                  <td>{s.name_ar}</td>
                  <td>{s.balance ?? '0.000'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 flex justify-between">
            <h3 className="font-bold">آخر الدفعات</h3>
            <Link className="text-blue-600" href="/accounts/suppliers/payments">الكل</Link>
          </div>
          <ul className="divide-y text-sm">
            {(d?.recent_payments ?? []).map((p) => (
              <li key={p.id} className="p-3 flex justify-between gap-2">
                <Link className="text-blue-600" href={`/accounts/suppliers/payments/${p.id}`}>{p.payment_number}</Link>
                <span>{p.supplier_name_ar}</span>
                <span>{p.amount} · {p.payment_method} · {p.status}</span>
              </li>
            ))}
            {!d?.recent_payments?.length && <li className="p-3 text-gray-500">لا دفعات بعد</li>}
          </ul>
        </div>
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="p-4 flex justify-between">
            <h3 className="font-bold">آخر المصروفات المباشرة</h3>
            <Link className="text-blue-600" href="/accounts/suppliers/expenses">الكل</Link>
          </div>
          <ul className="divide-y text-sm">
            {(d?.recent_expenses ?? []).map((e) => (
              <li key={e.id} className="p-3 flex justify-between gap-2">
                <Link className="text-blue-600" href={`/accounts/suppliers/expenses/${e.id}`}>{e.expense_number}</Link>
                <span>{e.beneficiary_name}</span>
                <span>{e.amount} · {e.payment_method} · {e.status}</span>
              </li>
            ))}
            {!d?.recent_expenses?.length && <li className="p-3 text-gray-500">لا مصروفات بعد</li>}
          </ul>
        </div>
      </section>
    </main>
  );
}
