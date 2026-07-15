'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

function money(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString('en-IQ', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : String(v ?? '—');
}

export default function PrintSupplierInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [i, setI] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/accounts/supplier-invoices/${id}`)
      .then((r) => r.json())
      .then((x) => {
        if (!x.success) setError(x.message || 'تعذر التحميل');
        else setI(x.data);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (i) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [i]);

  if (error) {
    return (
      <main className="p-6" dir="rtl">
        <p className="text-red-700">{error}</p>
        <button type="button" className="print:hidden mt-3 underline" onClick={() => router.back()}>
          رجوع
        </button>
      </main>
    );
  }
  if (!i) {
    return (
      <main className="p-6" dir="rtl">
        جاري التحميل...
      </main>
    );
  }

  return (
    <main dir="rtl" className="p-6 print:p-0">
      <div className="print:hidden mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-3 py-2 text-sm bg-red-900 text-white rounded-md"
        >
          طباعة
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-3 py-2 text-sm border rounded-md"
        >
          رجوع
        </button>
      </div>

      <div className="print-container bg-white border border-gray-200 rounded-lg p-6 max-w-4xl mx-auto">
        <header className="border-b border-gray-300 pb-4 mb-4 text-center">
          <h1 className="text-xl font-bold">فاتورة مورد</h1>
          <p className="text-sm text-gray-600 mt-1">
            كلية الشرق للعلوم التقنية التخصصية — نظام الحسابات
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 text-sm mb-6">
          <p>
            <span className="text-gray-500">رقم النظام: </span>
            <strong>{i.invoice_number}</strong>
          </p>
          <p>
            <span className="text-gray-500">رقم فاتورة المورد: </span>
            <strong>{i.supplier_invoice_number}</strong>
          </p>
          <p>
            <span className="text-gray-500">المورد: </span>
            <strong>{i.supplier_name_ar}</strong>
          </p>
          <p>
            <span className="text-gray-500">رقم المورد: </span>
            <strong>{i.supplier_number}</strong>
          </p>
          <p>
            <span className="text-gray-500">التاريخ: </span>
            <strong>{i.invoice_date}</strong>
          </p>
          <p>
            <span className="text-gray-500">الاستحقاق: </span>
            <strong>{i.due_date || '—'}</strong>
          </p>
          <p>
            <span className="text-gray-500">الحالة: </span>
            <strong>{i.status}</strong>
          </p>
          <p>
            <span className="text-gray-500">حساب المصروف: </span>
            <strong>
              {i.expense_gl_code} — {i.expense_gl_name_ar}
            </strong>
          </p>
          <p>
            <span className="text-gray-500">مركز الكلفة: </span>
            <strong>
              {i.cost_center_code
                ? `${i.cost_center_code} — ${i.cost_center_name_ar ?? ''}`
                : '—'}
            </strong>
          </p>
          <p>
            <span className="text-gray-500">القيد: </span>
            <strong>{i.journal_entry_number || '—'}</strong>
          </p>
        </section>

        <p className="text-sm mb-4">
          <span className="text-gray-500">البيان: </span>
          {i.description}
        </p>

        <table className="w-full text-sm border-collapse mb-6">
          <tbody>
            <tr className="border-b">
              <td className="py-2">المجموع الفرعي</td>
              <td className="py-2 text-left font-medium">{money(i.subtotal_amount)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">الخصم</td>
              <td className="py-2 text-left">{money(i.discount_amount)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-2">الضريبة (تمهيدي)</td>
              <td className="py-2 text-left">{money(i.tax_amount)}</td>
            </tr>
            <tr>
              <td className="py-2 font-bold">الإجمالي</td>
              <td className="py-2 text-left font-bold">{money(i.total_amount)} د.ع</td>
            </tr>
          </tbody>
        </table>

        <p className="text-xs text-gray-500 mb-8">
          الصيغة: الإجمالي = المجموع الفرعي − الخصم + الضريبة
        </p>

        <section className="mt-10 grid grid-cols-3 gap-6 text-sm">
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">توقيع المحاسب</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">مسؤول المشتريات</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">المدير المالي</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
        </section>
      </div>
    </main>
  );
}
