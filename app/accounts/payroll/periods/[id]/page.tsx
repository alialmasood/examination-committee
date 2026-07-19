'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PayrollNav from '../../PayrollNav';
import {
  API,
  CAP,
  PERIOD_STATUS,
  RUN_STATUS,
  RUN_TYPE,
  SCOPE_TYPE,
  StatusBadge,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  label,
  periodUrl,
  periodActionUrl,
} from '../../_lib';

export default function PeriodDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [row, setRow] = useState<any>(null);
  const [caps, setCaps] = useState<string[]>([]);
  const [options, setOptions] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ action: 'close' | 'reopen' | 'cancel'; title: string; needReason: boolean } | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    const r = await fetchJson(periodUrl(id));
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRow(r.data);
    const rr = await fetchJson(`${API.runs}?payroll_period_id=${id}&page_size=200`);
    if (rr.success) setRuns(Array.isArray(rr.data) ? rr.data : []);
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
  }, [id]);

  const manage = can(caps, CAP.MANAGE_PERIODS);
  const admin = can(caps, CAP.ADMIN);
  const calendars = useMemo<any[]>(() => options?.calendars ?? [], [options]);
  const fiscalYears = useMemo<any[]>(() => options?.fiscal_years ?? [], [options]);
  const fiscalPeriods = useMemo<any[]>(() => options?.fiscal_periods ?? [], [options]);
  const calById = useMemo(() => Object.fromEntries(calendars.map((c) => [c.id, c])), [calendars]);
  const fyById = useMemo(() => Object.fromEntries(fiscalYears.map((f) => [f.id, f])), [fiscalYears]);
  const fpById = useMemo(() => Object.fromEntries(fiscalPeriods.map((p) => [p.id, p])), [fiscalPeriods]);
  const fpForYear = fiscalPeriods.filter((p) => p.fiscal_year_id === (form.fiscal_year_id ?? row?.fiscal_year_id));

  function openEdit() {
    if (!row) return;
    setForm({
      name_ar: row.name_ar,
      name_en: row.name_en ?? '',
      payroll_calendar_id: row.payroll_calendar_id,
      start_date: row.start_date,
      end_date: row.end_date,
      calculation_date: row.calculation_date,
      payment_due_date: row.payment_due_date ?? '',
      currency_code: row.currency_code,
      fiscal_year_id: row.fiscal_year_id,
      fiscal_period_id: row.fiscal_period_id ?? '',
    });
    setFormErr('');
    setEditOpen(true);
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function saveEdit() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form, version: row.version, updated_at: row.updated_at };
      ['name_en', 'payment_due_date', 'fiscal_period_id'].forEach((k) => { if (payload[k] === '') payload[k] = null; });
      const r = await fetchJson(periodUrl(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setFormErr(errMsg(r));
      setEditOpen(false);
      await load();
    } finally { setBusy(false); }
  }

  async function runAction() {
    if (!confirm || !row) return;
    setBusy(true);
    try {
      const body: any = { version: row.version, updated_at: row.updated_at };
      if (confirm.needReason) body.reason = reason;
      const r = await fetchJson(periodActionUrl(id, confirm.action), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.success) { setError(errMsg(r)); }
      setConfirm(null); setReason('');
      await load();
    } finally { setBusy(false); }
  }

  if (error && !row) return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-red-600 text-sm">{error}</p></main>
  );
  if (!row) return <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-gray-400 text-sm">جارٍ التحميل…</p></main>;

  const canEdit = manage && row.status === 'OPEN';
  const canClose = manage && (row.status === 'OPEN' || row.status === 'PROCESSING');
  const canReopen = admin && row.status === 'CLOSED';
  const canCancel = manage && row.status !== 'CANCELLED';

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <PayrollNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      <div className="flex justify-between items-center mb-4">
        <div>
          <Link href="/accounts/payroll/periods" className="text-blue-600 text-sm">→ عودة للفترات</Link>
          <h1 className="text-xl font-bold mt-1">{row.name_ar} <span className="font-mono text-gray-500 text-base">{row.period_code}</span></h1>
        </div>
        <StatusBadge status={row.status} map={PERIOD_STATUS} />
      </div>

      <div className="bg-white shadow rounded p-4 grid md:grid-cols-2 gap-3 text-sm mb-4">
        <div><span className="text-gray-500">التقويم:</span> {calById[row.payroll_calendar_id]?.name_ar ?? '—'}</div>
        <div><span className="text-gray-500">العملة:</span> {row.currency_code}</div>
        <div><span className="text-gray-500">الفترة الزمنية:</span> {row.start_date} → {row.end_date}</div>
        <div><span className="text-gray-500">التاريخ المرجعي للاحتساب:</span> {row.calculation_date}</div>
        <div><span className="text-gray-500">تاريخ الاستحقاق:</span> {row.payment_due_date ?? '—'}</div>
        <div><span className="text-gray-500">السنة المالية:</span> {fyById[row.fiscal_year_id]?.name_ar ?? '—'}</div>
        <div><span className="text-gray-500">الفترة المالية:</span> {row.fiscal_period_id ? (fpById[row.fiscal_period_id]?.name_ar ?? '—') : '—'}</div>
        <div><span className="text-gray-500">الإصدار:</span> {row.version}</div>
        {row.transition_reason && <div className="md:col-span-2"><span className="text-gray-500">سبب آخر انتقال:</span> {row.transition_reason}</div>}
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {canEdit && <button className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" onClick={openEdit}>تعديل</button>}
        {canClose && <button className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm" onClick={() => setConfirm({ action: 'close', title: 'إغلاق الفترة', needReason: false })}>إغلاق</button>}
        {canReopen && <button className="bg-amber-700 text-white rounded px-3 py-1.5 text-sm" onClick={() => { setReason(''); setConfirm({ action: 'reopen', title: 'إعادة فتح الفترة', needReason: true }); }}>إعادة فتح</button>}
        {canCancel && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={() => { setReason(''); setConfirm({ action: 'cancel', title: 'إلغاء الفترة', needReason: true }); }}>إلغاء الفترة</button>}
      </div>

      <h2 className="text-lg font-semibold mb-2">تشغيلات هذه الفترة</h2>
      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr><th className="p-2">الرقم</th><th>النوع</th><th>النطاق</th><th>الحالة</th><th></th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-mono">{r.run_number}</td>
              <td>{label(RUN_TYPE, r.run_type)}</td>
              <td>{label(SCOPE_TYPE, r.scope_type)}</td>
              <td><StatusBadge status={r.status} map={RUN_STATUS} /></td>
              <td><Link className="text-blue-600" href={`/accounts/payroll/runs/${r.id}`}>عرض</Link></td>
            </tr>
          ))}
          {!runs.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا تشغيلات</td></tr>}
        </tbody>
      </table>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">تعديل الفترة</h3>
            <p className="text-xs text-amber-700 mb-3">لا يمكن تعديل الحقول الحساسة (التقويم/التواريخ/العملة/السنة المالية) بوجود تشغيلات غير ملغاة.</p>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1"><span className="text-xs text-gray-500">الاسم بالعربية *</span>
                <input className="border p-2" value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">الاسم بالإنجليزية</span>
                <input className="border p-2" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">التقويم</span>
                <select className="border p-2" value={form.payroll_calendar_id} onChange={(e) => set('payroll_calendar_id', e.target.value)}>
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
                </select></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">العملة</span>
                <input className="border p-2" value={form.currency_code} onChange={(e) => set('currency_code', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">تاريخ البداية</span>
                <input className="border p-2" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">تاريخ النهاية</span>
                <input className="border p-2" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">التاريخ المرجعي للاحتساب</span>
                <input className="border p-2" type="date" value={form.calculation_date} onChange={(e) => set('calculation_date', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">تاريخ الاستحقاق</span>
                <input className="border p-2" type="date" value={form.payment_due_date} onChange={(e) => set('payment_due_date', e.target.value)} /></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">السنة المالية</span>
                <select className="border p-2" value={form.fiscal_year_id} onChange={(e) => { set('fiscal_year_id', e.target.value); set('fiscal_period_id', ''); }}>
                  {fiscalYears.map((f) => <option key={f.id} value={f.id}>{f.name_ar}</option>)}
                </select></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">الفترة المالية</span>
                <select className="border p-2" value={form.fiscal_period_id} onChange={(e) => set('fiscal_period_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {fpForYear.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
                </select></label>
            </div>
            {formErr && <p className="text-red-600 text-sm mt-3">{formErr}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="border rounded px-3 py-2 text-sm" disabled={busy} onClick={() => setEditOpen(false)}>إلغاء</button>
              <button className="bg-red-800 text-white rounded px-3 py-2 text-sm" disabled={busy} onClick={() => void saveEdit()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على الفترة «${row.period_code}»؟`}
        busy={busy}
        reasonRequired={confirm?.needReason}
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => { setConfirm(null); setReason(''); }}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
