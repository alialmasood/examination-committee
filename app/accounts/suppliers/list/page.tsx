'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SuppliersNav from '../SuppliersNav';

type SupplierRow = {
  id: string;
  supplier_number: string;
  code: string | null;
  name_ar: string;
  supplier_type: string;
  phone: string | null;
  currency_code: string;
  status: string;
  balance?: string;
  last_entry_date?: string | null;
};

export default function SupplierListPage() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [supplierType, setSupplierType] = useState('');
  const [hasBalance, setHasBalance] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const sp = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) sp.set('q', q.trim());
    if (status) sp.set('status', status);
    if (supplierType) sp.set('supplier_type', supplierType);
    if (hasBalance) sp.set('has_balance', hasBalance);

    fetch(`/api/accounts/suppliers?${sp}`)
      .then((r) => r.json())
      .then((x) => {
        if (!x.success) throw new Error(x.message || 'فشل التحميل');
        setRows(x.data || []);
        setTotal(x.pagination?.total ?? 0);
        setTotalPages(x.pagination?.total_pages ?? 1);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, q, status, supplierType, hasBalance]);

  return (
    <main dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-2xl font-bold text-gray-800">قائمة الموردين</h2>
        <Link
          href="/accounts/suppliers/invoices/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
        >
          فاتورة جديدة
        </Link>
      </div>
      <SuppliersNav />

      <section className="bg-white shadow rounded-xl p-4 mb-4 grid md:grid-cols-4 gap-3">
        <input
          className="border rounded-lg px-3 py-2"
          placeholder="بحث بالاسم أو الرقم"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <select
          className="border rounded-lg px-3 py-2"
          value={supplierType}
          onChange={(e) => {
            setPage(1);
            setSupplierType(e.target.value);
          }}
        >
          <option value="">كل الأنواع</option>
          <option value="LOCAL">محلي</option>
          <option value="INTERNATIONAL">دولي</option>
          <option value="GOVERNMENT">حكومي</option>
          <option value="INDIVIDUAL">فرد</option>
          <option value="SERVICE_PROVIDER">مقدّم خدمة</option>
          <option value="OTHER">أخرى</option>
        </select>
        <select
          className="border rounded-lg px-3 py-2"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">كل الحالات</option>
          <option value="ACTIVE">فعّال</option>
          <option value="SUSPENDED">معلّق</option>
          <option value="CLOSED">مغلق</option>
        </select>
        <select
          className="border rounded-lg px-3 py-2"
          value={hasBalance}
          onChange={(e) => {
            setPage(1);
            setHasBalance(e.target.value);
          }}
        >
          <option value="">كل الأرصدة</option>
          <option value="true">له رصيد</option>
          <option value="false">رصيد صفر</option>
        </select>
      </section>

      {error && <p className="text-red-600 mb-3">{error}</p>}

      <section className="bg-white shadow rounded-xl overflow-hidden">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-3">رقم المورد</th>
              <th>الكود</th>
              <th>الاسم</th>
              <th>النوع</th>
              <th>الهاتف</th>
              <th>العملة</th>
              <th>الرصيد المستحق</th>
              <th>الحالة</th>
              <th>آخر حركة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={10}>
                  جاري التحميل...
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((x) => (
                <tr className="border-t" key={x.id}>
                  <td className="p-3">
                    <Link
                      className="text-blue-600"
                      href={`/accounts/suppliers/${x.id}`}
                    >
                      {x.supplier_number}
                    </Link>
                  </td>
                  <td>{x.code || '—'}</td>
                  <td>{x.name_ar}</td>
                  <td>{x.supplier_type}</td>
                  <td>{x.phone || '—'}</td>
                  <td>{x.currency_code}</td>
                  <td className="font-semibold">{x.balance ?? '0.000'}</td>
                  <td>{x.status}</td>
                  <td>{x.last_entry_date || '—'}</td>
                  <td className="p-3 space-x-2 space-x-reverse">
                    <Link
                      className="text-blue-600"
                      href={`/accounts/suppliers/${x.id}`}
                    >
                      عرض
                    </Link>
                    <Link
                      className="text-blue-600"
                      href={`/accounts/suppliers/${x.id}/print`}
                    >
                      كشف
                    </Link>
                  </td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={10}>
                  لا توجد نتائج
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <button
          className="border px-3 py-1 rounded disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          السابق
        </button>
        <span>
          صفحة {page} من {totalPages} · الإجمالي {total}
        </span>
        <button
          className="border px-3 py-1 rounded disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          التالي
        </button>
      </div>
    </main>
  );
}
