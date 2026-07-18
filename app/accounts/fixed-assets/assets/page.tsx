'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, ASSET_STATUS, StatusBadge, fetchJson, iqd } from '../_lib';

function AssetsRegister() {
  const sp = useSearchParams();
  const [opts, setOpts] = useState<any>();
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({ page: 1, total_pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [categoryId, setCategoryId] = useState(sp.get('category_id') ?? '');
  const [locationId, setLocationId] = useState(sp.get('location_id') ?? '');
  const [custodianId, setCustodianId] = useState(sp.get('custodian_user_id') ?? '');
  const [departmentId, setDepartmentId] = useState(sp.get('department_id') ?? '');
  const [page, setPage] = useState(Number(sp.get('page') || 1));

  useEffect(() => {
    fetchJson(API.options).then((o) => setOpts(o?.data));
  }, []);

  const load = async (p = page) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (categoryId) params.set('category_id', categoryId);
    if (locationId) params.set('location_id', locationId);
    if (custodianId) params.set('custodian_user_id', custodianId);
    if (departmentId) params.set('department_id', departmentId);
    params.set('page', String(p));
    params.set('page_size', '20');
    const r = await fetchJson(`${API.assets}?${params.toString()}`);
    setLoading(false);
    if (!r.success) return setError(r.__status === 401 || r.__status === 403
      ? 'ليس لديك صلاحية عرض الأصول' : (r.message || 'تعذّر التحميل'));
    setRows(Array.isArray(r.data) ? r.data : []);
    setPagination(r.pagination ?? { page: p, total_pages: 1, total: 0 });
  };

  useEffect(() => {
    void load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function applyFilters() {
    if (page === 1) void load(1);
    else setPage(1);
  }

  const categories = opts?.categories ?? [];
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];
  const departments = opts?.departments ?? [];
  const catName = (id: string) => categories.find((c: any) => c.id === id)?.name_ar ?? '—';

  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">سجل الأصول الثابتة</h1>
        <Link className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" href="/accounts/fixed-assets/assets/new">
          أصل جديد
        </Link>
      </div>
      <FixedAssetsNav />

      <div className="bg-white shadow rounded p-3 grid md:grid-cols-6 gap-2 text-sm mb-3">
        <input className="border p-2 md:col-span-2" placeholder="بحث (رقم/اسم/باركود/تسلسلي)" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
        <select className="border p-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="border p-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <select className="border p-2" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">كل المواقع</option>
          {locations.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <select className="border p-2" value={custodianId} onChange={(e) => setCustodianId(e.target.value)}>
          <option value="">كل العُهد</option>
          {custodians.map((c: any) => <option key={c.id} value={c.id}>{c.full_name || c.username}</option>)}
        </select>
        <select className="border p-2" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">كل الأقسام</option>
          {departments.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <button className="bg-blue-600 text-white rounded px-3 py-2" onClick={applyFilters}>تطبيق</button>
      </div>

      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرقم</th>
            <th>الاسم</th>
            <th>التصنيف</th>
            <th>التكلفة</th>
            <th>القيمة الدفترية</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="p-2">
                <Link className="text-blue-600 font-mono" href={`/accounts/fixed-assets/assets/${a.id}`}>
                  {a.asset_number}
                </Link>
              </td>
              <td>{a.name_ar}</td>
              <td>{catName(a.category_id)}</td>
              <td>{iqd(a.capitalized_cost)}</td>
              <td>{iqd(a.net_book_value)}</td>
              <td><StatusBadge status={a.status} map={ASSET_STATUS} /></td>
            </tr>
          ))}
          {!loading && !rows.length && (
            <tr><td colSpan={6} className="p-3 text-gray-400">لا توجد أصول مطابقة</td></tr>
          )}
          {loading && <tr><td colSpan={6} className="p-3 text-gray-400">جارٍ التحميل…</td></tr>}
        </tbody>
      </table>

      <div className="flex justify-between items-center mt-3 text-sm">
        <span className="text-gray-500">الإجمالي: {pagination.total ?? 0}</span>
        <div className="flex gap-2">
          <button className="border rounded px-3 py-1 disabled:opacity-40" disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</button>
          <span className="px-2 py-1">{pagination.page ?? page} / {pagination.total_pages ?? 1}</span>
          <button className="border rounded px-3 py-1 disabled:opacity-40"
            disabled={page >= (pagination.total_pages ?? 1)}
            onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AssetsRegister />
    </Suspense>
  );
}
