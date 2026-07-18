'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  API,
  ACQUISITION_TYPE,
  ASSET_STATUS,
  COLLEGE_NAME,
  fetchJson,
  iqd,
  label,
} from '../../../_lib';

export default function AssetCardPrint() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<any>();
  const [opts, setOpts] = useState<any>();

  useEffect(() => {
    (async () => {
      const [o, r] = await Promise.all([fetchJson(API.options), fetchJson(`${API.assets}/${id}`)]);
      setOpts(o?.data);
      setA(r?.data);
    })();
  }, [id]);

  const nameOf = (list: any[], v: string) =>
    (list || []).find((x) => x.id === v)?.name_ar ||
    (list || []).find((x) => x.id === v)?.full_name ||
    (list || []).find((x) => x.id === v)?.username || '—';

  if (!a) return <main dir="rtl" className="p-8"><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-8 print:p-4 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => window.print()}>طباعة</button>
      <article className="border-2 border-gray-800 rounded-lg p-6 space-y-4">
        <header className="text-center border-b pb-3">
          <h1 className="text-2xl font-bold">{COLLEGE_NAME}</h1>
          <h2 className="text-lg mt-1">بطاقة أصل ثابت</h2>
        </header>

        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-500">رقم الأصل</p>
            <p className="text-2xl font-bold font-mono">{a.asset_number}</p>
          </div>
          {/* تمثيل الباركود كنص + خطوط بسيطة (بدون مكتبات خارجية) */}
          <div className="text-center">
            <svg width="180" height="48" role="img" aria-label="barcode">
              {Array.from({ length: 40 }).map((_, i) => (
                <rect key={i} x={i * 4.4} y={0} width={i % 3 === 0 ? 3 : 1.5} height={40}
                  fill={i % 2 === 0 ? '#111' : '#fff'} />
              ))}
            </svg>
            <p className="text-xs font-mono">{a.barcode_value || a.asset_number}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <tbody>
            <tr><td className="py-1 text-gray-500 w-40">الاسم</td><td className="font-medium">{a.name_ar}</td></tr>
            <tr><td className="py-1 text-gray-500">التصنيف</td><td>{nameOf(opts?.categories, a.category_id)}</td></tr>
            <tr><td className="py-1 text-gray-500">الرقم التسلسلي / الموديل</td><td>{a.serial_number || '—'}</td></tr>
            <tr><td className="py-1 text-gray-500">نوع الاقتناء</td><td>{label(ACQUISITION_TYPE, a.acquisition_type)}</td></tr>
            <tr><td className="py-1 text-gray-500">الموقع</td><td>{nameOf(opts?.locations, a.location_id)}</td></tr>
            <tr><td className="py-1 text-gray-500">العهدة</td><td>{nameOf(opts?.custodians ?? opts?.custodian_users, a.custodian_user_id)}</td></tr>
            <tr><td className="py-1 text-gray-500">القسم</td><td>{nameOf(opts?.departments, a.department_id)}</td></tr>
            <tr><td className="py-1 text-gray-500">التكلفة المرسملة</td><td>{iqd(a.capitalized_cost)}</td></tr>
            <tr><td className="py-1 text-gray-500">القيمة الدفترية الصافية</td><td>{iqd(a.net_book_value)}</td></tr>
            <tr><td className="py-1 text-gray-500">تاريخ الاقتناء</td><td>{a.acquisition_date}</td></tr>
            <tr><td className="py-1 text-gray-500">الحالة</td><td>{label(ASSET_STATUS, a.status)}</td></tr>
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center print:pt-16">
          <div><div className="border-t pt-2">أمين المستودع</div></div>
          <div><div className="border-t pt-2">المحاسبة</div></div>
          <div><div className="border-t pt-2">المعتمد</div></div>
        </div>
      </article>
    </main>
  );
}
