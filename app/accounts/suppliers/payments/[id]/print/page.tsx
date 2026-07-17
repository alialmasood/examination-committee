'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

export default function Print({ params }: { params: Promise<{ id: string }> }) {
  const [r, setR] = useState<any>();
  useEffect(() => {
    params.then(({ id }) =>
      fetch(`/api/accounts/supplier-payments/${id}`).then((x) => x.json()).then(setR)
    );
  }, [params]);
  const p = r?.data;
  return (
    <main dir="rtl" className="p-10 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-2 rounded mb-4" onClick={() => print()}>طباعة</button>
      {p && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold">كلية الشرق الجامعة</h1>
            <h2 className="text-xl mt-1">إيصال دفعة مورد — {p.payment_number}</h2>
          </header>
          <section className="grid grid-cols-2 gap-3 text-sm">
            <p><span className="text-gray-500">المورد:</span> {p.supplier_name_ar}</p>
            <p><span className="text-gray-500">التاريخ:</span> {p.payment_date}</p>
            <p><span className="text-gray-500">طريقة الدفع:</span> {p.payment_method === 'CASH' ? 'نقدي' : 'مصرفي'}</p>
            <p><span className="text-gray-500">الصندوق/البنك:</span> {p.channel_label || '—'}</p>
            <p><span className="text-gray-500">رقم سند الصرف:</span> {p.voucher_number || '—'}</p>
            <p><span className="text-gray-500">المبلغ:</span> {p.amount} IQD</p>
            <p><span className="text-gray-500">المستفيد:</span> {p.payee_name || '—'}</p>
            <p><span className="text-gray-500">الحالة:</span> {p.status}</p>
            <p><span className="text-gray-500">الرصيد قبل:</span> {p.balance_before}</p>
            <p><span className="text-gray-500">الرصيد بعد:</span> {p.balance_after}</p>
          </section>
          <p className="text-sm"><span className="text-gray-500">البيان:</span> {p.description}</p>
          <section>
            <h3 className="font-bold mb-2">الفواتير المخصصة</h3>
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-gray-50">
                  <th className="p-2 text-right">رقم الفاتورة</th>
                  <th className="p-2 text-right">المبلغ المخصص</th>
                </tr>
              </thead>
              <tbody>
                {(p.allocations || []).map((a: any) => (
                  <tr key={a.id} className="border-t">
                    <td className="p-2">{a.invoice_number || a.supplier_invoice_number}</td>
                    <td className="p-2">{a.allocated_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="grid grid-cols-3 gap-8 pt-16 text-sm text-center">
            <div><div className="border-t pt-2">المحاسب</div></div>
            <div><div className="border-t pt-2">المستلم</div></div>
            <div><div className="border-t pt-2">المعتمد</div></div>
          </div>
        </article>
      )}
    </main>
  );
}
