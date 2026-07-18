'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, CAP, DOC_STATUS, StatusBadge, can, errMsg, fetchJson, iqd, label } from '../_lib';

function DepreciationList() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const [rows, setRows] = useState<any[]>([]);
  const [opts, setOpts] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [f, setF] = useState<any>({ fiscal_period_id: '', category_id: '', notes: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const q = status ? `?status=${status}&page_size=50` : '?page_size=50';
    const r = await fetchJson(`${API.depreciationRuns}${q}`);
    if (!r.success) return setError(r.__status === 401 || r.__status === 403 ? 'ليس لديك صلاحية عرض الإهلاك' : (r.message || 'تعذّر التحميل'));
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    fetchJson(API.options).then((o) => { setOpts(o?.data); setCaps(o?.data?.capabilities ?? []); });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [status]);

  const prepare = can(caps, CAP.DEP_PREPARE);
  const periods = opts?.fiscal_periods ?? [];
  const categories = opts?.categories ?? [];

  async function create() {
    setMsg('');
    setBusy(true);
    try {
      if (!f.fiscal_period_id) { setBusy(false); return setMsg('اختر الفترة المحاسبية'); }
      const r = await fetchJson(API.depreciationRuns, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fiscal_period_id: f.fiscal_period_id,
          category_id: f.category_id || null,
          notes: f.notes || null,
        }),
      });
      if (!r.success) return setMsg(errMsg(r));
      location.href = `/accounts/fixed-assets/depreciation/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-2">دورات الإهلاك</h1>
      <FixedAssetsNav />

      {prepare && (
        <div className="bg-white shadow rounded p-4 grid md:grid-cols-4 gap-2 text-sm mb-4 items-end">
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">الفترة المحاسبية *</span>
            <select className="border p-2" value={f.fiscal_period_id} onChange={(e) => setF({ ...f, fiscal_period_id: e.target.value })}>
              <option value="">— اختر —</option>
              {periods.map((p: any) => <option key={p.id} value={p.id}>{p.name_ar || p.code || `${p.start_date} → ${p.end_date}`}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">التصنيف (اختياري)</span>
            <select className="border p-2" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">كل التصنيفات</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">ملاحظات</span>
            <input className="border p-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
          <button className="bg-red-800 text-white rounded p-2 disabled:opacity-40" disabled={busy} onClick={() => void create()}>
            {busy ? 'جارٍ الإنشاء…' : 'إنشاء دورة'}
          </button>
          {msg && <p className="text-red-600 md:col-span-4">{msg}</p>}
        </div>
      )}

      <div className="flex gap-2 mb-3 text-sm flex-wrap">
        {['', 'DRAFT', 'POSTED', 'VOIDED'].map((s) => (
          <Link key={s || 'all'} href={s ? `?status=${s}` : '/accounts/fixed-assets/depreciation'}
            className={`px-2 py-1 rounded ${status === s ? 'bg-red-100 text-red-800' : 'bg-gray-100'}`}>
            {s ? label(DOC_STATUS, s) : 'الكل'}
          </Link>
        ))}
      </div>
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr><th className="p-2">الرقم</th><th>الفترة</th><th>عدد الأصول</th><th>إجمالي الإهلاك</th><th>الحالة</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2"><Link className="text-blue-600" href={`/accounts/fixed-assets/depreciation/${r.id}`}>{r.run_number}</Link></td>
              <td>{r.period_start} → {r.period_end}</td>
              <td>{r.asset_count}</td>
              <td>{iqd(r.total_depreciation)}</td>
              <td><StatusBadge status={r.status} map={DOC_STATUS} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا دورات إهلاك</td></tr>}
        </tbody>
      </table>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DepreciationList />
    </Suspense>
  );
}
