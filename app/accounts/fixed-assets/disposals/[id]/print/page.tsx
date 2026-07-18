'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API, COLLEGE_NAME, DISPOSAL_TYPE, DOC_STATUS, fetchJson, iqd, label } from '../../../_lib';

export default function DisposalReportPrint() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>();
  const [asset, setAsset] = useState<any>();

  useEffect(() => {
    (async () => {
      const r = await fetchJson(`${API.disposals}/${id}`);
      setD(r?.data);
      if (r?.data?.fixed_asset_id) {
        const a = await fetchJson(`${API.assets}/${r.data.fixed_asset_id}`);
        setAsset(a?.data);
      }
    })();
  }, [id]);

  if (!d) return <main dir="rtl" className="p-8"><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-8 print:p-4 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => window.print()}>طباعة</button>
      <article className="space-y-4">
        <header className="text-center border-b pb-3">
          <h1 className="text-2xl font-bold">{COLLEGE_NAME}</h1>
          <h2 className="text-lg mt-1">تقرير استبعاد أصل — {d.disposal_number}</h2>
        </header>
        <section className="grid grid-cols-2 gap-2 text-sm">
          <p>الأصل: {asset ? `${asset.asset_number} — ${asset.name_ar}` : d.fixed_asset_id}</p>
          <p>نوع الاستبعاد: {label(DISPOSAL_TYPE, d.disposal_type)}</p>
          <p>التاريخ: {d.disposal_date}</p>
          <p>الحالة: {label(DOC_STATUS, d.status)}</p>
        </section>
        <table className="w-full text-sm border">
          <tbody>
            <tr className="border-t"><td className="p-2 text-gray-500 w-56">التكلفة الأصلية</td><td className="p-2">{iqd(d.disposal_cost)}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">مجمع الإهلاك</td><td className="p-2">{iqd(d.accumulated_depreciation)}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">القيمة الدفترية الصافية</td><td className="p-2">{iqd(d.net_book_value)}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">المتحصلات</td><td className="p-2">{iqd(d.proceeds_amount)}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">الربح / الخسارة</td><td className="p-2">{iqd(d.gain_loss_amount)}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">رقم القيد</td><td className="p-2">{d.journal_entry_id || '—'}</td></tr>
            <tr className="border-t"><td className="p-2 text-gray-500">اسم المشتري</td><td className="p-2">{d.buyer_name || '—'}</td></tr>
          </tbody>
        </table>
        <p className="text-sm">السبب: {d.reason || '—'}</p>
        <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center print:pt-16">
          <div><div className="border-t pt-2">لجنة الجرد</div></div>
          <div><div className="border-t pt-2">المحاسبة</div></div>
          <div><div className="border-t pt-2">العميد / المعتمد</div></div>
        </div>
      </article>
    </main>
  );
}
