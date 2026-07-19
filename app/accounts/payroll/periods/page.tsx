'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PayrollNav from '../PayrollNav';
import {
  API,
  CAP,
  PERIOD_STATUS,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  payroll_calendar_id: '',
  name_ar: '',
  name_en: '',
  start_date: today(),
  end_date: today(),
  calculation_date: '',
  payment_due_date: '',
  currency_code: '',
  fiscal_year_id: '',
  fiscal_period_id: '',
});

export default function PeriodsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [options, setOptions] = useState<any>(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = async () => {
    const qs = new URLSearchParams({ page_size: '200' });
    if (statusFilter) qs.set('status', statusFilter);
    const r = await fetchJson(`${API.periods}?${qs.toString()}`);
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOptions(o?.data ?? null);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const manage = can(caps, CAP.MANAGE_PERIODS);
  const calendars = useMemo<any[]>(() => options?.calendars ?? [], [options]);
  const fiscalYears = useMemo<any[]>(() => options?.fiscal_years ?? [], [options]);
  const fiscalPeriods = useMemo<any[]>(() => options?.fiscal_periods ?? [], [options]);
  const calById = useMemo(() => Object.fromEntries(calendars.map((c) => [c.id, c])), [calendars]);
  const fyById = useMemo(() => Object.fromEntries(fiscalYears.map((f) => [f.id, f])), [fiscalYears]);
  const fpForYear = fiscalPeriods.filter((p) => p.fiscal_year_id === form.fiscal_year_id);

  function openNew() { setForm(empty()); setFormErr(''); setOpen(true); }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['name_en', 'calculation_date', 'payment_due_date', 'currency_code', 'fiscal_period_id'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      const r = await fetchJson(API.periods, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setFormErr(errMsg(r));
      setOpen(false); setForm(empty());
      await load();
    } finally { setBusy(false); }
  }

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">فترات الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>فترة جديدة</button>}
      </div>
      <PayrollNav />
      {!manage && <p className="text-amber-700 text-xs mb-2">إنشاء الفترات وإدارتها مقصور على مدير الفترات.</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex gap-2 mb-3 text-sm">
        <select className="border rounded p-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(PERIOD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الاسم</th>
            <th>التقويم</th>
            <th>الفترة الزمنية</th>
            <th>السنة المالية</th>
            <th>العملة</th>
            <th>الحالة</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="p-2 font-mono">{p.period_code}</td>
              <td>{p.name_ar}</td>
              <td>{calById[p.payroll_calendar_id]?.name_ar ?? '—'}</td>
              <td className="whitespace-nowrap">{p.start_date} → {p.end_date}</td>
              <td>{fyById[p.fiscal_year_id]?.name_ar ?? '—'}</td>
              <td>{p.currency_code}</td>
              <td><StatusBadge status={p.status} map={PERIOD_STATUS} /></td>
              <td><Link className="text-blue-600" href={`/accounts/payroll/periods/${p.id}`}>عرض</Link></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="p-3 text-gray-400">لا فترات</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">فترة رواتب جديدة</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">التقويم *</span>
                <select className="border p-2" value={form.payroll_calendar_id} onChange={(e) => set('payroll_calendar_id', e.target.value)}>
                  <option value="">— اختر —</option>
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.name_ar} ({c.currency_code})</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الاسم بالعربية *</span>
                <input className="border p-2" value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الاسم بالإنجليزية</span>
                <input className="border p-2" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العملة (تُطابق التقويم)</span>
                <input className="border p-2" placeholder="افتراضي: عملة التقويم" value={form.currency_code} onChange={(e) => set('currency_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">تاريخ البداية *</span>
                <input className="border p-2" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">تاريخ النهاية *</span>
                <input className="border p-2" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">التاريخ المرجعي للاحتساب</span>
                <input className="border p-2" type="date" value={form.calculation_date} onChange={(e) => set('calculation_date', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">تاريخ الاستحقاق</span>
                <input className="border p-2" type="date" value={form.payment_due_date} onChange={(e) => set('payment_due_date', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">السنة المالية *</span>
                <select className="border p-2" value={form.fiscal_year_id} onChange={(e) => { set('fiscal_year_id', e.target.value); set('fiscal_period_id', ''); }}>
                  <option value="">— اختر —</option>
                  {fiscalYears.map((f) => <option key={f.id} value={f.id}>{f.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الفترة المالية</span>
                <select className="border p-2" value={form.fiscal_period_id} onChange={(e) => set('fiscal_period_id', e.target.value)} disabled={!form.fiscal_year_id}>
                  <option value="">— بدون —</option>
                  {fpForYear.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
                </select>
              </label>
            </div>
            {formErr && <p className="text-red-600 text-sm mt-3">{formErr}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="border rounded px-3 py-2 text-sm" disabled={busy} onClick={() => setOpen(false)}>إلغاء</button>
              <button className="bg-red-800 text-white rounded px-3 py-2 text-sm" disabled={busy} onClick={() => void save()}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
