'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import { API, CAP, DISPOSAL_TYPE, can, errMsg, fetchJson, iqd } from '../../_lib';

const today = () => new Date().toISOString().slice(0, 10);

function NewDisposal() {
  const sp = useSearchParams();
  const assetIdParam = sp.get('asset_id') ?? '';
  const [opts, setOpts] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [f, setF] = useState<any>({
    fixed_asset_id: assetIdParam,
    disposal_type: 'SALE',
    disposal_date: today(),
    proceeds_amount: '0',
    proceeds_source: '', // "cash:<id>:<gl>" أو "bank:<id>:<gl>"
    buyer_name: '',
    reason: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      setOpts(o?.data);
      setCaps(o?.data?.capabilities ?? []);
      const r = await fetchJson(`${API.assets}?page_size=100`);
      const list = (Array.isArray(r?.data) ? r.data : []).filter((a: any) =>
        ['ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED'].includes(a.status));
      setAssets(list);
    })();
  }, []);

  const prepare = can(caps, CAP.DISPOSAL_PREPARE);
  const asset = useMemo(() => assets.find((a) => a.id === f.fixed_asset_id), [assets, f.fixed_asset_id]);
  const cashSessions = opts?.cash_sessions ?? [];
  const bankAccounts = opts?.bank_accounts ?? [];
  const isSale = f.disposal_type === 'SALE';

  const est = useMemo(() => {
    const cap = Number(asset?.capitalized_cost ?? 0);
    const accum = Number(asset?.accumulated_depreciation ?? 0);
    const nbv = cap - accum;
    const proceeds = isSale ? Number(f.proceeds_amount || 0) : 0;
    return { cap, accum, nbv, gainLoss: proceeds - nbv };
  }, [asset, f.proceeds_amount, isSale]);

  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      if (!f.fixed_asset_id) { setBusy(false); return setMsg('اختر الأصل'); }
      const payload: any = {
        fixed_asset_id: f.fixed_asset_id,
        disposal_type: f.disposal_type,
        disposal_date: f.disposal_date,
        buyer_name: f.buyer_name || null,
        reason: f.reason || null,
      };
      if (isSale) {
        payload.proceeds_amount = f.proceeds_amount;
        if (f.proceeds_source) {
          const [kind, sourceId, gl] = String(f.proceeds_source).split(':');
          if (gl) payload.proceeds_gl_account_id = gl;
          if (kind === 'cash') payload.cash_session_id = sourceId;
          if (kind === 'bank') payload.bank_account_id = sourceId;
        }
      }
      const r = await fetchJson(API.disposals, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setMsg(errMsg(r));
      location.href = `/accounts/fixed-assets/disposals/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-2">استبعاد أصل جديد (مسودة)</h1>
      <FixedAssetsNav />
      {!prepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          ليس لديك صلاحية إنشاء الاستبعاد — سيُرفض الحفظ من الخادم.
        </p>
      )}
      <div className="bg-white shadow rounded p-4 grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الأصل *</span>
          <select className="border p-2" value={f.fixed_asset_id} onChange={(e) => set('fixed_asset_id', e.target.value)}>
            <option value="">— اختر —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_number} — {a.name_ar}</option>)}
          </select>
        </label>

        <div className="grid md:grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">نوع الاستبعاد</span>
            <select className="border p-2" value={f.disposal_type} onChange={(e) => set('disposal_type', e.target.value)}>
              {Object.entries(DISPOSAL_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">تاريخ الاستبعاد</span>
            <input className="border p-2" type="date" value={f.disposal_date} onChange={(e) => set('disposal_date', e.target.value)} />
          </label>
        </div>

        {isSale && (
          <div className="grid md:grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-xs text-gray-500">المتحصلات (د.ع)</span>
              <input className="border p-2" type="number" value={f.proceeds_amount} onChange={(e) => set('proceeds_amount', e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-gray-500">جهة المتحصلات (صندوق/بنك)</span>
              <select className="border p-2" value={f.proceeds_source} onChange={(e) => set('proceeds_source', e.target.value)}>
                <option value="">— اختر —</option>
                {cashSessions.map((c: any) => (
                  <option key={`cash-${c.id}`} value={`cash:${c.id}:${c.gl_account_id ?? c.account_id ?? ''}`}>
                    صندوق: {c.name_ar || c.session_number || c.id}
                  </option>
                ))}
                {bankAccounts.map((b: any) => (
                  <option key={`bank-${b.id}`} value={`bank:${b.id}:${b.gl_account_id ?? b.account_id ?? ''}`}>
                    بنك: {b.name_ar || b.code || b.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <label className="grid gap-1">
          <span className="text-xs text-gray-500">اسم المشتري</span>
          <input className="border p-2" value={f.buyer_name} onChange={(e) => set('buyer_name', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">السبب</span>
          <textarea className="border p-2" value={f.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>

        {asset && (
          <div className="grid grid-cols-4 gap-2 bg-gray-50 rounded p-3 text-center text-xs">
            <div><p className="text-gray-500">التكلفة الأصلية</p><p className="font-bold">{iqd(est.cap)}</p></div>
            <div><p className="text-gray-500">مجمع الإهلاك</p><p className="font-bold">{iqd(est.accum)}</p></div>
            <div><p className="text-gray-500">القيمة الدفترية</p><p className="font-bold">{iqd(est.nbv)}</p></div>
            <div><p className="text-gray-500">ربح/خسارة (تقديري)</p><p className={`font-bold ${est.gainLoss < 0 ? 'text-red-700' : 'text-green-700'}`}>{iqd(est.gainLoss)}</p></div>
            <p className="col-span-4 text-gray-400">القيم النهائية تُحسب في الخادم عند الإنشاء والترحيل.</p>
          </div>
        )}

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
      <NewDisposal />
    </Suspense>
  );
}
