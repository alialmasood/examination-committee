'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API, COLLEGE_NAME, DOC_STATUS, fetchJson, iqd, label } from '../../../_lib';

export default function DepreciationReportPrint() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<any>();
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const r = await fetchJson(`${API.depreciationRuns}/${id}`);
      setRun(r?.data?.run ?? r?.data);
      setLines(Array.isArray(r?.data?.lines) ? r.data.lines : Array.isArray(r?.data?.run?.lines) ? r.data.run.lines : []);
    })();
  }, [id]);

  if (!run) return <main dir="rtl" className="p-8"><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-8 print:p-4 max-w-4xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => window.print()}>طباعة</button>
      <article className="space-y-4">
        <header className="text-center border-b pb-3">
          <h1 className="text-2xl font-bold">{COLLEGE_NAME}</h1>
          <h2 className="text-lg mt-1">تقرير إهلاك دوري — {run.run_number}</h2>
        </header>
        <section className="grid grid-cols-2 gap-2 text-sm">
          <p>الفترة: {run.period_start} → {run.period_end}</p>
          <p>الحالة: {label(DOC_STATUS, run.status)}</p>
          <p>عدد الأصول: {run.asset_count}</p>
          <p>رقم القيد: {run.journal_entry_id || '—'}</p>
        </section>
        <table className="w-full text-sm border">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="p-2">الأصل</th>
              <th className="p-2">مجمع افتتاحي</th>
              <th className="p-2">إهلاك الفترة</th>
              <th className="p-2">مجمع ختامي</th>
              <th className="p-2">القيمة الدفترية</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.asset_number} — {l.asset_name}</td>
                <td className="p-2">{iqd(l.opening_accumulated)}</td>
                <td className="p-2">{iqd(l.depreciation_amount)}</td>
                <td className="p-2">{iqd(l.closing_accumulated)}</td>
                <td className="p-2">{iqd(l.net_book_value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-gray-50 font-semibold">
              <td className="p-2">إجمالي إهلاك الفترة</td>
              <td className="p-2"></td>
              <td className="p-2">{iqd(run.total_depreciation)}</td>
              <td className="p-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
        <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center print:pt-16">
          <div><div className="border-t pt-2">المحاسب</div></div>
          <div><div className="border-t pt-2">المدقق</div></div>
          <div><div className="border-t pt-2">المدير المالي</div></div>
        </div>
      </article>
    </main>
  );
}
