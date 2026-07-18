'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API, COLLEGE_NAME, MOVEMENT_TYPE, fetchJson, label } from '../../../_lib';

export default function CustodyHandoverPrint() {
  const { id } = useParams<{ id: string }>();
  const [m, setM] = useState<any>();
  const [opts, setOpts] = useState<any>();
  const [asset, setAsset] = useState<any>();

  useEffect(() => {
    (async () => {
      const [o, r] = await Promise.all([fetchJson(API.options), fetchJson(`${API.movements}/${id}`)]);
      setOpts(o?.data);
      setM(r?.data);
      if (r?.data?.fixed_asset_id) {
        const a = await fetchJson(`${API.assets}/${r.data.fixed_asset_id}`);
        setAsset(a?.data);
      }
    })();
  }, [id]);

  const nameOf = (list: any[], v: string) =>
    (list || []).find((x) => x.id === v)?.name_ar || (list || []).find((x) => x.id === v)?.full_name ||
    (list || []).find((x) => x.id === v)?.username || '—';

  if (!m) return <main dir="rtl" className="p-8"><p className="text-gray-500">جارٍ التحميل…</p></main>;
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];

  return (
    <main dir="rtl" className="p-8 print:p-4 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => window.print()}>طباعة</button>
      <article className="space-y-4">
        <header className="text-center border-b pb-3">
          <h1 className="text-2xl font-bold">{COLLEGE_NAME}</h1>
          <h2 className="text-lg mt-1">محضر تسليم واستلام عهدة — {m.movement_number}</h2>
        </header>
        <section className="grid grid-cols-2 gap-2 text-sm">
          <p>التاريخ: {m.movement_date}</p>
          <p>نوع الحركة: {label(MOVEMENT_TYPE, m.movement_type)}</p>
          <p>الأصل: {asset ? `${asset.asset_number} — ${asset.name_ar}` : m.fixed_asset_id}</p>
          <p>الرقم التسلسلي: {asset?.serial_number || '—'}</p>
        </section>
        <table className="w-full text-sm border">
          <thead><tr className="border-b bg-gray-50"><th className="p-2">البند</th><th className="p-2">من</th><th className="p-2">إلى</th></tr></thead>
          <tbody>
            <tr className="border-t"><td className="p-2">الموقع</td><td className="p-2">{nameOf(locations, m.from_location_id)}</td><td className="p-2">{nameOf(locations, m.to_location_id)}</td></tr>
            <tr className="border-t"><td className="p-2">العهدة</td><td className="p-2">{nameOf(custodians, m.from_custodian_user_id)}</td><td className="p-2">{nameOf(custodians, m.to_custodian_user_id)}</td></tr>
          </tbody>
        </table>
        <p className="text-sm">السبب: {m.reason || '—'}</p>
        <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center print:pt-16">
          <div><div className="border-t pt-2">المُسلِّم</div></div>
          <div><div className="border-t pt-2">المُستلِم</div></div>
          <div><div className="border-t pt-2">المعتمد</div></div>
        </div>
      </article>
    </main>
  );
}
