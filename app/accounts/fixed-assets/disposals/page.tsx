'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, CAP, DISPOSAL_TYPE, DOC_STATUS, StatusBadge, can, fetchJson, iqd, label } from '../_lib';

function DisposalsList() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJson(API.options).then((o) => setCaps(o?.data?.capabilities ?? []));
  }, []);

  useEffect(() => {
    const q = status ? `?status=${status}&page_size=50` : '?page_size=50';
    fetchJson(`${API.disposals}${q}`).then((r) => {
      if (!r.success) return setError(r.__status === 401 || r.__status === 403 ? 'ليس لديك صلاحية عرض الاستبعاد' : (r.message || 'تعذّر التحميل'));
      setRows(Array.isArray(r.data) ? r.data : []);
    });
  }, [status]);

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">استبعاد الأصول</h1>
        {can(caps, CAP.DISPOSAL_PREPARE) && (
          <Link className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" href="/accounts/fixed-assets/disposals/new">استبعاد جديد</Link>
        )}
      </div>
      <FixedAssetsNav />
      <div className="flex gap-2 mb-3 text-sm flex-wrap">
        {['', 'DRAFT', 'POSTED', 'VOIDED'].map((s) => (
          <Link key={s || 'all'} href={s ? `?status=${s}` : '/accounts/fixed-assets/disposals'}
            className={`px-2 py-1 rounded ${status === s ? 'bg-red-100 text-red-800' : 'bg-gray-100'}`}>
            {s ? label(DOC_STATUS, s) : 'الكل'}
          </Link>
        ))}
      </div>
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr><th className="p-2">الرقم</th><th>النوع</th><th>التاريخ</th><th>القيمة الدفترية</th><th>المتحصلات</th><th>ربح/خسارة</th><th>الحالة</th></tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="p-2"><Link className="text-blue-600" href={`/accounts/fixed-assets/disposals/${d.id}`}>{d.disposal_number}</Link></td>
              <td>{label(DISPOSAL_TYPE, d.disposal_type)}</td>
              <td>{d.disposal_date}</td>
              <td>{iqd(d.net_book_value)}</td>
              <td>{iqd(d.proceeds_amount)}</td>
              <td className={Number(d.gain_loss_amount) < 0 ? 'text-red-700' : 'text-green-700'}>{iqd(d.gain_loss_amount)}</td>
              <td><StatusBadge status={d.status} map={DOC_STATUS} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="p-3 text-gray-400">لا سجلات استبعاد</td></tr>}
        </tbody>
      </table>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DisposalsList />
    </Suspense>
  );
}
