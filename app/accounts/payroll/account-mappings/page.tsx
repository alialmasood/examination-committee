'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  CAP,
  MAPPING_SCOPE,
  PERSON_TYPE,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  mapping_code: '',
  mapping_scope: 'DEFAULT',
  payroll_component_id: '',
  person_type: '',
  payroll_calendar_id: '',
  expense_account_id: '',
  liability_account_id: '',
  payable_account_id: '',
  rounding_account_id: '',
  cost_center_id: '',
  priority: '100',
  effective_from: today(),
  effective_to: '',
});

export default function AccountMappingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [opts, setOpts] = useState<any>({});
  const [error, setError] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ m: any; path: string; title: string } | null>(null);

  const load = async () => {
    const sp = new URLSearchParams({ page_size: '200' });
    if (scopeFilter) sp.set('mapping_scope', scopeFilter);
    const r = await fetchJson(`${API.accountMappings}?${sp.toString()}`);
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOpts(o?.data ?? {});
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter]);

  const manage = can(caps, CAP.MANAGE_MAPPINGS);
  const gl = opts.gl_accounts ?? [];

  function openNew() { setEditing(null); setForm(empty()); setFormErr(''); setOpen(true); }
  function openEdit(m: any) {
    setEditing(m);
    setForm({
      mapping_code: m.mapping_code,
      mapping_scope: m.mapping_scope,
      payroll_component_id: m.payroll_component_id ?? '',
      person_type: m.person_type ?? '',
      payroll_calendar_id: m.payroll_calendar_id ?? '',
      expense_account_id: m.expense_account_id ?? '',
      liability_account_id: m.liability_account_id ?? '',
      payable_account_id: m.payable_account_id ?? '',
      rounding_account_id: m.rounding_account_id ?? '',
      cost_center_id: m.cost_center_id ?? '',
      priority: String(m.priority ?? '100'),
      effective_from: m.effective_from ?? today(),
      effective_to: m.effective_to ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['payroll_component_id', 'person_type', 'payroll_calendar_id', 'expense_account_id', 'liability_account_id', 'payable_account_id', 'rounding_account_id', 'cost_center_id', 'effective_to'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      payload.priority = Number(payload.priority || 100);
      let r;
      if (editing) {
        delete payload.mapping_code;
        r = await fetchJson(`${API.accountMappings}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.accountMappings, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!r.success) return setFormErr(errMsg(r));
      setOpen(false); setEditing(null); setForm(empty());
      await load();
    } finally { setBusy(false); }
  }

  async function runAction() {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await fetchJson(`${API.accountMappings}/${confirm.m.id}/${confirm.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: confirm.m.version, updated_at: confirm.m.updated_at }),
      });
      if (!r.success) setError(errMsg(r));
      setConfirm(null);
      await load();
    } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const glSelect = (k: string, lbl: string) => (
    <label className="grid gap-1">
      <span className="text-xs text-gray-500">{lbl}</span>
      <select className="border p-2" value={form[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">— بدون —</option>
        {gl.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
      </select>
    </label>
  );

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">خرائط حسابات الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>خريطة جديدة</button>}
      </div>
      <PayrollNav />
      {!manage && <p className="text-amber-700 text-xs mb-2">إدارة خرائط الحسابات مقصورة على مدير الحسابات (إعداد مالي حسّاس).</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <select className="border p-2 rounded" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
          <option value="">كل النطاقات</option>
          {Object.entries(MAPPING_SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>النطاق</th>
            <th>الأولوية</th>
            <th>الفترة</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-t">
              <td className="p-2 font-mono">{m.mapping_code}</td>
              <td>{label(MAPPING_SCOPE, m.mapping_scope)}</td>
              <td>{m.priority}</td>
              <td className="whitespace-nowrap">{m.effective_from} → {m.effective_to ?? '—'}</td>
              <td>
                <span className={`text-xs font-semibold ${m.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                  {m.is_active ? 'فعّال' : 'موقوف'}
                </span>
              </td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  <button className="text-blue-600" onClick={() => openEdit(m)}>تعديل</button>
                  {m.is_active
                    ? <button className="text-amber-700" onClick={() => setConfirm({ m, path: 'deactivate', title: 'إيقاف الخريطة' })}>تعطيل</button>
                    : <button className="text-green-700" onClick={() => setConfirm({ m, path: 'activate', title: 'تفعيل الخريطة' })}>تفعيل</button>}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={manage ? 6 : 5} className="p-3 text-gray-400">لا خرائط</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل خريطة' : 'خريطة جديدة'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز *</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.mapping_code} disabled={!!editing} onChange={(e) => set('mapping_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">النطاق *</span>
                <select className="border p-2" value={form.mapping_scope} onChange={(e) => set('mapping_scope', e.target.value)}>
                  {Object.entries(MAPPING_SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {form.mapping_scope === 'COMPONENT' && (
                <label className="grid gap-1">
                  <span className="text-xs text-gray-500">المكوّن *</span>
                  <select className="border p-2" value={form.payroll_component_id} onChange={(e) => set('payroll_component_id', e.target.value)}>
                    <option value="">— اختر —</option>
                    {(opts.components ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.component_code} — {c.name_ar}</option>)}
                  </select>
                </label>
              )}
              {form.mapping_scope === 'PERSON_TYPE' && (
                <label className="grid gap-1">
                  <span className="text-xs text-gray-500">نوع الشخص *</span>
                  <select className="border p-2" value={form.person_type} onChange={(e) => set('person_type', e.target.value)}>
                    <option value="">— اختر —</option>
                    {Object.entries(PERSON_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              {form.mapping_scope === 'CALENDAR' && (
                <label className="grid gap-1">
                  <span className="text-xs text-gray-500">التقويم *</span>
                  <select className="border p-2" value={form.payroll_calendar_id} onChange={(e) => set('payroll_calendar_id', e.target.value)}>
                    <option value="">— اختر —</option>
                    {(opts.calendars ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
                  </select>
                </label>
              )}
              {glSelect('expense_account_id', 'حساب المصروف')}
              {glSelect('liability_account_id', 'حساب الالتزام')}
              {glSelect('payable_account_id', 'حساب الذمم الدائنة')}
              {glSelect('rounding_account_id', 'حساب فروقات التقريب')}
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">مركز الكلفة</span>
                <select className="border p-2" value={form.cost_center_id} onChange={(e) => set('cost_center_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.cost_centers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الأولوية</span>
                <input className="border p-2" type="number" value={form.priority} onChange={(e) => set('priority', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">بداية السريان *</span>
                <input className="border p-2" type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">نهاية السريان</span>
                <input className="border p-2" type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-2">حدّد حساباً محاسبياً واحداً على الأقل. يُكشف التعارض تلقائياً عند وجود خريطة فعّالة بنفس النطاق والمميّزات والأولوية وفترة متداخلة.</p>
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

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على الخريطة «${confirm?.m?.mapping_code ?? ''}»؟`}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
