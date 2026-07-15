'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

function money(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString('en-IQ', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : String(v ?? '—');
}

export default function PrintSupplierStatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [balance, setBalance] = useState('0.000');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/accounts/suppliers/${id}`)
      .then((r) => r.json())
      .then(async (x) => {
        if (!x.success) {
          setError(x.message || 'تعذر التحميل');
          return;
        }
        setSupplier(x.data);
        const accountId = x.data.account?.id;
        if (!accountId) {
          setLedger([]);
          setBalance(x.data.balance ?? '0.000');
          return;
        }
        const led = await fetch(
          `/api/accounts/supplier-accounts/${accountId}/ledger?page_size=200`
        ).then((r) => r.json());
        if (led.success) {
          setLedger(led.data || []);
          setBalance(led.balance ?? x.data.balance ?? '0.000');
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (supplier) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [supplier]);

  const withRunning = useMemo(() => {
    // رصيد دائن تراكمي = credits − debits
    return ledger.reduce<Array<any & { running_balance: number }>>((acc, e) => {
      const prev = acc.length ? acc[acc.length - 1].running_balance : 0;
      const next =
        prev + Number(e.credit_amount || 0) - Number(e.debit_amount || 0);
      acc.push({ ...e, running_balance: next });
      return acc;
    }, []);
  }, [ledger]);

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
  if (!supplier) {
    return (
      <main className="p-6" dir="rtl">
        جاري التحميل...
      </main>
    );
  }

  const printDate = new Date().toLocaleString('ar-IQ');

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

      <div className="print-container bg-white border border-gray-200 rounded-lg p-6 max-w-5xl mx-auto">
        <header className="border-b border-gray-300 pb-4 mb-4 text-center">
          <h1 className="text-xl font-bold">كشف حساب مورد</h1>
          <p className="text-sm text-gray-600 mt-1">
            كلية الشرق للعلوم التقنية التخصصية — نظام الحسابات
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 text-sm mb-6">
          <p>
            <span className="text-gray-500">المورد: </span>
            <strong>{supplier.name_ar}</strong>
          </p>
          <p>
            <span className="text-gray-500">رقم المورد: </span>
            <strong>{supplier.supplier_number}</strong>
          </p>
          <p>
            <span className="text-gray-500">الحساب المالي: </span>
            <strong>{supplier.account?.account_number || '—'}</strong>
          </p>
          <p>
            <span className="text-gray-500">الحالة: </span>
            <strong>{supplier.status}</strong>
          </p>
          <p>
            <span className="text-gray-500">الرصيد النهائي المستحق: </span>
            <strong>{money(balance)} د.ع</strong>
          </p>
          <p>
            <span className="text-gray-500">تاريخ الطباعة: </span>
            <strong>{printDate}</strong>
          </p>
        </section>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">النوع</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-right">مدين</th>
              <th className="py-2 text-right">دائن</th>
              <th className="py-2 text-right">الرصيد التراكمي</th>
            </tr>
          </thead>
          <tbody>
            {withRunning.map((e) => (
              <tr key={e.id} className="border-b border-gray-200">
                <td className="py-2">{e.entry_date}</td>
                <td className="py-2">{e.entry_type}</td>
                <td className="py-2">{e.description}</td>
                <td className="py-2">{money(e.debit_amount)}</td>
                <td className="py-2">{money(e.credit_amount)}</td>
                <td className="py-2 font-medium">{money(e.running_balance)}</td>
              </tr>
            ))}
            {withRunning.length === 0 && (
              <tr>
                <td className="py-4 text-gray-500" colSpan={6}>
                  لا حركات
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="mt-4 text-sm">
          الرصيد النهائي المستحق للمورد:{' '}
          <strong>{money(balance)} د.ع</strong>
        </p>

        <section className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
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
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">التدقيق</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
        </section>
      </div>
    </main>
  );
}
