'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import { API, CAP, MOVEMENT_TYPE, can, errMsg, fetchJson } from '../../_lib';

const today = () => new Date().toISOString().slice(0, 10);

function NewMovement() {
  const sp = useSearchParams();
  const assetIdParam = sp.get('asset_id') ?? '';
  const [opts, setOpts] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [f, setF] = useState<any>({
    fixed_asset_id: assetIdParam,
    movement_type: 'LOCATION',
    movement_date: today(),
    to_location_id: '',
    to_department_id: '',
    to_custodian_user_id: '',
    reason: '',
    notes: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      setOpts(o?.data);
      setCaps(o?.data?.capabilities ?? []);
      const r = await fetchJson(`${API.assets}?page_size=100`);
      const list = (Array.isArray(r?.data) ? r.data : []).filter((a: any) => ['ACTIVE', 'SUSPENDED'].includes(a.status));
      setAssets(list);
    })();
  }, []);

  const prepare = can(caps, CAP.MOVEMENT_PREPARE);
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];
  const departments = opts?.departments ?? [];
  const asset = useMemo(() => assets.find((a) => a.id === f.fixed_asset_id), [assets, f.fixed_asset_id]);
  const nameOf = (list: any[], v: string) =>
    list.find((x) => x.id === v)?.name_ar || list.find((x) => x.id === v)?.full_name ||
    list.find((x) => x.id === v)?.username || '—';

  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      if (!f.fixed_asset_id) { setBusy(false); return setMsg('اختر الأصل'); }
      const payload: any = {
        fixed_asset_id: f.fixed_asset_id,
        movement_type: f.movement_type,
        movement_date: f.movement_date,
        reason: f.reason || null,
        notes: f.notes || null,
      };
      if (f.to_location_id) payload.to_location_id = f.to_location_id;
      if (f.to_department_id) payload.to_department_id = f.to_department_id;
      if (f.to_custodian_user_id) payload.to_custodian_user_id = f.to_custodian_user_id;
      if (!payload.to_location_id && !payload.to_department_id && !payload.to_custodian_user_id) {
        setBusy(false);
        return setMsg('حدّد وجهة واحدة على الأقل (موقع/قسم/عهدة)');
      }
      const r = await fetchJson(API.movements, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setMsg(errMsg(r));
      location.href = `/accounts/fixed-assets/movements/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-2">حركة أصل جديدة (مسودة)</h1>
      <FixedAssetsNav />
      {!prepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          ليس لديك صلاحية إنشاء الحركات — سيُرفض الحفظ من الخادم.
        </p>
      )}
      <div className="bg-white shadow rounded p-4 grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الأصل *</span>
          <select className="border p-2" value={f.fixed_asset_id} onChange={(e) => set('fixed_asset_id', e.target.value)}>
            <option value="">— اختر أصلاً نشطاً/موقوفاً —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_number} — {a.name_ar}</option>)}
          </select>
        </label>

        {asset && (
          <div className="bg-gray-50 rounded p-2 text-xs text-gray-600 grid grid-cols-3 gap-2">
            <span>الموقع الحالي: {nameOf(locations, asset.location_id)}</span>
            <span>العهدة الحالية: {nameOf(custodians, asset.custodian_user_id)}</span>
            <span>القسم الحالي: {nameOf(departments, asset.department_id)}</span>
          </div>
        )}

        <label className="grid gap-1">
          <span className="text-xs text-gray-500">نوع الحركة</span>
          <select className="border p-2" value={f.movement_type} onChange={(e) => set('movement_type', e.target.value)}>
            {Object.entries(MOVEMENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">تاريخ الحركة</span>
          <input className="border p-2" type="date" value={f.movement_date} onChange={(e) => set('movement_date', e.target.value)} />
        </label>

        <div className="grid md:grid-cols-3 gap-2">
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">إلى موقع</span>
            <select className="border p-2" value={f.to_location_id} onChange={(e) => set('to_location_id', e.target.value)}>
              <option value="">— بدون تغيير —</option>
              {locations.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">إلى قسم</span>
            <select className="border p-2" value={f.to_department_id} onChange={(e) => set('to_department_id', e.target.value)}>
              <option value="">— بدون تغيير —</option>
              {departments.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">إلى عهدة</span>
            <select className="border p-2" value={f.to_custodian_user_id} onChange={(e) => set('to_custodian_user_id', e.target.value)}>
              <option value="">— بدون تغيير —</option>
              {custodians.map((c: any) => <option key={c.id} value={c.id}>{c.full_name || c.username}</option>)}
            </select>
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-xs text-gray-500">السبب</span>
          <input className="border p-2" value={f.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">ملاحظات</span>
          <textarea className="border p-2" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>

        {msg && <p className="text-red-600">{msg}</p>}
        <button className="bg-red-800 text-white rounded p-2 disabled:opacity-40" disabled={busy} onClick={() => void save()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ مسودة'}
        </button>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewMovement />
    </Suspense>
  );
}
