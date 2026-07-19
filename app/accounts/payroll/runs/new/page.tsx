'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PayrollNav from '../../PayrollNav';
import {
  API,
  CAP,
  RUN_TYPE,
  SCOPE_TYPE,
  can,
  errMsg,
  fetchJson,
} from '../../_lib';

export default function NewRunPage() {
  const router = useRouter();
  const [caps, setCaps] = useState<string[]>([]);
  const [options, setOptions] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({
    payroll_period_id: '',
    run_type: 'REGULAR',
    scope_type: 'ALL',
    scope_ref_id: '',
  });

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOptions(o?.data ?? null);
      const p = await fetchJson(`${API.periods}?status=OPEN&page_size=200`);
      if (p.success) setPeriods(Array.isArray(p.data) ? p.data : []);
    })();
  }, []);

  const create = can(caps, CAP.CREATE_RUNS);
  const departments: any[] = options?.departments ?? [];
  const costCenters: any[] = options?.cost_centers ?? [];
  const needsRef = form.scope_type === 'COLLEGE' || form.scope_type === 'DEPARTMENT' || form.scope_type === 'COST_CENTER';
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload: any = {
        payroll_period_id: form.payroll_period_id,
        run_type: form.run_type,
        scope_type: form.scope_type,
        scope_ref_id: needsRef ? form.scope_ref_id : null,
      };
      const r = await fetchJson(API.runs, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setError(errMsg(r));
      router.push(`/accounts/payroll/runs/${r.data.id}`);
    } finally { setBusy(false); }
  }

  if (!create) {
    return (
      <main dir="rtl" className="p-4 max-w-3xl mx-auto">
        <PayrollNav />
        <p className="text-amber-700 text-sm">ليس لديك صلاحية إنشاء تشغيلات الرواتب.</p>
      </main>
    );
  }

  return (
    <main dir="rtl" className="p-4 max-w-2xl mx-auto">
      <PayrollNav />
      <Link href="/accounts/payroll/runs" className="text-blue-600 text-sm">→ عودة للتشغيلات</Link>
      <h1 className="text-xl font-bold my-3">تشغيل رواتب جديد</h1>
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="bg-white shadow rounded p-4 grid gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الفترة (المفتوحة فقط) *</span>
          <select className="border p-2" value={form.payroll_period_id} onChange={(e) => set('payroll_period_id', e.target.value)}>
            <option value="">— اختر —</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.period_code} — {p.name_ar}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">نوع التشغيل *</span>
          <select className="border p-2" value={form.run_type} onChange={(e) => set('run_type', e.target.value)}>
            {Object.entries(RUN_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">النطاق *</span>
          <select className="border p-2" value={form.scope_type} onChange={(e) => { set('scope_type', e.target.value); set('scope_ref_id', ''); }}>
            {Object.entries(SCOPE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {needsRef && (
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">مرجع النطاق *</span>
            <select className="border p-2" value={form.scope_ref_id} onChange={(e) => set('scope_ref_id', e.target.value)}>
              <option value="">— اختر —</option>
              {(form.scope_type === 'COST_CENTER' ? costCenters : departments).map((x) => (
                <option key={x.id} value={x.id}>{x.name_ar}</option>
              ))}
            </select>
          </label>
        )}
        {form.scope_type === 'PERSON_LIST' && (
          <p className="text-xs text-gray-500">ستتمكن من إضافة الأشخاص إلى النطاق بعد إنشاء التشغيل من صفحة التفاصيل.</p>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <Link href="/accounts/payroll/runs" className="border rounded px-3 py-2 text-sm">إلغاء</Link>
          <button className="bg-red-800 text-white rounded px-3 py-2 text-sm disabled:opacity-50" disabled={busy || !form.payroll_period_id} onClick={() => void save()}>
            {busy ? 'جارٍ الإنشاء…' : 'إنشاء'}
          </button>
        </div>
      </div>
    </main>
  );
}
