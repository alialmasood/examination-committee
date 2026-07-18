'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import FixedAssetsNav from './FixedAssetsNav';
import {
  API,
  DOC_STATUS,
  MOVEMENT_TYPE,
  StatCard,
  StatusBadge,
  fetchJson,
  iqd,
  label,
} from './_lib';

const API_ASSETS_UI = '/accounts/fixed-assets/assets';

type Named = { id: string; name_ar?: string; code?: string; full_name?: string; username?: string };

function nameOf(list: Named[], id: string | null | undefined): string {
  if (!id) return '—';
  const x = list.find((n) => n.id === id);
  return x?.name_ar || x?.full_name || x?.username || x?.code || id;
}

export default function FixedAssetsDashboard() {
  const [opts, setOpts] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
  const [sampleTotal, setSampleTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [disposalsPosted, setDisposalsPosted] = useState(0);
  const [candidates, setCandidates] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) {
        setError(o.message || 'ليس لديك صلاحية الوصول إلى الأصول الثابتة');
        return;
      }
      setOpts(o?.data);

      const statuses = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED', 'DISPOSED', 'CANCELLED'];
      const [all, sample, cats, mv, disp, cand, ...statusRes] = await Promise.all([
        fetchJson(`${API.assets}?page_size=1`),
        fetchJson(`${API.assets}?page_size=100`),
        fetchJson(`${API.categories}?page_size=200`),
        fetchJson(`${API.movements}?page_size=6`),
        fetchJson(`${API.disposals}?status=POSTED&page_size=1`),
        fetchJson(`${API.fromPurchasing}`),
        ...statuses.map((s) => fetchJson(`${API.assets}?status=${s}&page_size=1`)),
      ]);

      const c: Record<string, number> = { TOTAL: all?.pagination?.total ?? 0 };
      statuses.forEach((s, i) => {
        c[s] = statusRes[i]?.pagination?.total ?? 0;
      });
      setCounts(c);
      setAssets(Array.isArray(sample?.data) ? sample.data : []);
      setSampleTotal(sample?.pagination?.total ?? 0);
      setCategories(Array.isArray(cats?.data) ? cats.data : []);
      setMovements(Array.isArray(mv?.data) ? mv.data : []);
      setDisposalsPosted(disp?.pagination?.total ?? 0);
      const candList = Array.isArray(cand?.data) ? cand.data : cand?.data?.candidates ?? [];
      setCandidates(Array.isArray(candList) ? candList.length : 0);
    })();
  }, []);

  const locations: Named[] = opts?.locations ?? [];
  const departments: Named[] = opts?.departments ?? [];
  const custodians: Named[] = opts?.custodians ?? opts?.custodian_users ?? [];

  const agg = useMemo(() => {
    let cost = 0;
    let accum = 0;
    let nbv = 0;
    let noLocation = 0;
    let noCustodian = 0;
    let underThreshold = 0;
    const byCat: Record<string, number> = {};
    const byLoc: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    const byCust: Record<string, number> = {};
    const thr: Record<string, number> = {};
    categories.forEach((x) => (thr[x.id] = Number(x.capitalization_threshold ?? 0)));
    for (const a of assets) {
      if (['DISPOSED', 'CANCELLED'].includes(a.status)) continue;
      cost += Number(a.capitalized_cost ?? 0);
      accum += Number(a.accumulated_depreciation ?? 0);
      nbv += Number(a.net_book_value ?? 0);
      if (!a.location_id) noLocation += 1;
      if (!a.custodian_user_id) noCustodian += 1;
      if (thr[a.category_id] != null && Number(a.capitalized_cost ?? 0) < thr[a.category_id]) {
        underThreshold += 1;
      }
      byCat[a.category_id] = (byCat[a.category_id] ?? 0) + 1;
      if (a.location_id) byLoc[a.location_id] = (byLoc[a.location_id] ?? 0) + 1;
      if (a.department_id) byDept[a.department_id] = (byDept[a.department_id] ?? 0) + 1;
      if (a.custodian_user_id) byCust[a.custodian_user_id] = (byCust[a.custodian_user_id] ?? 0) + 1;
    }
    return { cost, accum, nbv, noLocation, noCustodian, underThreshold, byCat, byLoc, byDept, byCust };
  }, [assets, categories]);

  const partial = sampleTotal > assets.length;

  const groupCard = (
    title: string,
    map: Record<string, number>,
    resolver: (id: string) => string,
    hrefKey?: string
  ) => (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <div className="p-3 border-b font-bold text-sm">{title}</div>
      <ul className="divide-y text-sm">
        {Object.entries(map)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, n]) => (
            <li key={id} className="p-2 flex justify-between">
              {hrefKey ? (
                <Link className="text-blue-600" href={`${API_ASSETS_UI}?${hrefKey}=${id}`}>
                  {resolver(id)}
                </Link>
              ) : (
                <span>{resolver(id)}</span>
              )}
              <span className="font-semibold">{n}</span>
            </li>
          ))}
        {!Object.keys(map).length && <li className="p-2 text-gray-400">لا بيانات</li>}
      </ul>
    </div>
  );

  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold text-gray-800">الأصول الثابتة — لوحة التحكم</h1>
        <div className="flex gap-2">
          <Link className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" href="/accounts/fixed-assets/assets/new">
            أصل جديد
          </Link>
          <Link className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" href="/accounts/fixed-assets/assets">
            سجل الأصول
          </Link>
        </div>
      </div>
      <FixedAssetsNav />

      {error && (
        <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="إجمالي الأصول" value={counts.TOTAL ?? '—'} href="/accounts/fixed-assets/assets" />
        <StatCard label="إجمالي التكلفة المرسملة" value={iqd(agg.cost)} tone="text-gray-900" />
        <StatCard label="مجمع الإهلاك" value={iqd(agg.accum)} tone="text-amber-700" />
        <StatCard label="القيمة الدفترية الصافية" value={iqd(agg.nbv)} tone="text-green-700" />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="نشطة" value={counts.ACTIVE ?? 0} href="/accounts/fixed-assets/assets?status=ACTIVE" tone="text-green-700" />
        <StatCard label="مسودة" value={counts.DRAFT ?? 0} href="/accounts/fixed-assets/assets?status=DRAFT" />
        <StatCard label="موقوفة" value={counts.SUSPENDED ?? 0} href="/accounts/fixed-assets/assets?status=SUSPENDED" tone="text-amber-700" />
        <StatCard label="مستهلكة بالكامل" value={counts.FULLY_DEPRECIATED ?? 0} href="/accounts/fixed-assets/assets?status=FULLY_DEPRECIATED" tone="text-blue-700" />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="بدون موقع" value={agg.noLocation} tone="text-red-700" />
        <StatCard label="بدون عهدة" value={agg.noCustodian} tone="text-red-700" />
        <StatCard label="تحت حد الرسملة" value={agg.underThreshold} tone="text-amber-700" />
        <StatCard label="جاهزة من المشتريات" value={candidates} href="/accounts/fixed-assets/purchasing-candidates" tone="text-indigo-700" />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="استبعادات مرحّلة" value={disposalsPosted} href="/accounts/fixed-assets/disposals" tone="text-purple-700" />
        <StatCard label="مستبعدة" value={counts.DISPOSED ?? 0} href="/accounts/fixed-assets/assets?status=DISPOSED" tone="text-purple-700" />
        <StatCard label="ملغاة" value={counts.CANCELLED ?? 0} href="/accounts/fixed-assets/assets?status=CANCELLED" tone="text-red-700" />
        <StatCard label="التصنيفات" value={categories.length} href="/accounts/fixed-assets/categories" />
      </section>

      {partial && (
        <p className="text-xs text-amber-700 mb-3">
          * التجميعات المالية والتصنيفية محسوبة من أحدث 100 أصل (إجمالي {sampleTotal}). للأرقام الدقيقة راجع
          سجل الأصول.
        </p>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {groupCard('حسب التصنيف', agg.byCat, (id) => nameOf(categories, id), 'category_id')}
        {groupCard('حسب الموقع', agg.byLoc, (id) => nameOf(locations, id), 'location_id')}
        {groupCard('حسب القسم', agg.byDept, (id) => nameOf(departments, id), 'department_id')}
        {groupCard('حسب العهدة', agg.byCust, (id) => nameOf(custodians, id), 'custodian_user_id')}
      </section>

      <section className="bg-white shadow rounded-xl overflow-hidden mb-6">
        <div className="p-3 border-b flex justify-between">
          <h2 className="font-bold text-sm">أحدث الحركات</h2>
          <Link className="text-blue-600 text-sm" href="/accounts/fixed-assets/movements">الكل</Link>
        </div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="p-2">الرقم</th>
              <th>النوع</th>
              <th>التاريخ</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="p-2">
                  <Link className="text-blue-600" href={`/accounts/fixed-assets/movements/${m.id}`}>
                    {m.movement_number}
                  </Link>
                </td>
                <td>{label(MOVEMENT_TYPE, m.movement_type)}</td>
                <td>{m.movement_date}</td>
                <td><StatusBadge status={m.status} map={DOC_STATUS} /></td>
              </tr>
            ))}
            {!movements.length && (
              <tr><td colSpan={4} className="p-3 text-gray-400">لا حركات بعد</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
