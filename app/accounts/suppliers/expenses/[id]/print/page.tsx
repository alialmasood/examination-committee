'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

export default function Print({ params }: { params: Promise<{ id: string }> }) {
  const [r, setR] = useState<any>();
  useEffect(() => {
    params.then(({ id }) =>
      fetch(`/api/accounts/direct-expenses/${id}`).then((x) => x.json()).then(setR)
    );
  }, [params]);
  const x = r?.data;
  return (
    <main dir="rtl" className="p-10 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-2 rounded mb-4" onClick={() => print()}>طباعة</button>
      {x && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold">كلية الشرق الجامعة</h1>
            <h2 className="text-xl mt-1">سند مصروف مباشر — {x.expense_number}</h2>
          </header>
          <section className="grid grid-cols-2 gap-3 text-sm">
            <p><span className="text-gray-500">النوع:</span> {x.expense_type_name || '—'}</p>
            <p><span className="text-gray-500">التاريخ:</span> {x.expense_date}</p>
            <p><span className="text-gray-500">المستفيد:</span> {x.beneficiary_name}</p>
            <p><span className="text-gray-500">المورد المرجعي:</span> {x.supplier_name_ar || '—'}</p>
            <p><span className="text-gray-500">حساب المصروف:</span> {x.expense_gl_label || x.expense_gl_account_id}</p>
            <p><span className="text-gray-500">مركز الكلفة:</span> {x.cost_center_label || '—'}</p>
            <p><span className="text-gray-500">الطريقة:</span> {x.payment_method === 'CASH' ? 'نقدي' : 'مصرفي'}</p>
            <p><span className="text-gray-500">الصندوق/البنك:</span> {x.channel_label || '—'}</p>
            <p><span className="text-gray-500">رقم سند الصرف:</span> {x.voucher_number || '—'}</p>
            <p><span className="text-gray-500">المبلغ:</span> {x.amount} IQD</p>
          </section>
          <p className="text-sm"><span className="text-gray-500">البيان:</span> {x.description}</p>
          <div className="grid grid-cols-3 gap-8 pt-16 text-sm text-center">
            <div><div className="border-t pt-2">المحاسب</div></div>
            <div><div className="border-t pt-2">المستفيد</div></div>
            <div><div className="border-t pt-2">المعتمد</div></div>
          </div>
        </article>
      )}
    </main>
  );
}
