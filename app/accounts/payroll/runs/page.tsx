'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import PayrollNav from '../PayrollNav';
import {
  API,
  CAP,
  RUN_STATUS,
  RUN_TYPE,
  SCOPE_TYPE,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

export default function RunsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = async () => {
    const qs = new URLSearchParams({ page_size: '200' });
    if (statusFilter) qs.set('status', statusFilter);
    if (typeFilter) qs.set('run_type', typeFilter);
    const r = await fetchJson(`${API.runs}?${qs.toString()}`);
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  const create = can(caps, CAP.CREATE_RUNS);

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">تشغيلات الرواتب</h1>
        {create && <Link href="/accounts/payroll/runs/new" className="bg-red-800 text-white rounded px-3 py-1.5 text-sm">تشغيل جديد</Link>}
      </div>
      <PayrollNav />
      {!create && <p className="text-amber-700 text-xs mb-2">إنشاء التشغيلات مقصور على أصحاب صلاحية إنشاء التشغيلات.</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex gap-2 mb-3 text-sm">
        <select className="border rounded p-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(RUN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="border rounded p-1.5" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(RUN_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرقم</th>
            <th>النوع</th>
            <th>النطاق</th>
            <th>تاريخ الاحتساب</th>
            <th>الإصدار</th>
            <th>العملة</th>
            <th>الحالة</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-mono">{r.run_number}</td>
              <td>{label(RUN_TYPE, r.run_type)}</td>
              <td>{label(SCOPE_TYPE, r.scope_type)}</td>
              <td className="whitespace-nowrap">{r.calculation_date}</td>
              <td>{r.revision_number}</td>
              <td>{r.currency_code}</td>
              <td><StatusBadge status={r.status} map={RUN_STATUS} /></td>
              <td><Link className="text-blue-600" href={`/accounts/payroll/runs/${r.id}`}>عرض</Link></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="p-3 text-gray-400">لا تشغيلات</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
