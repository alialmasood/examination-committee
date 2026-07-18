'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  CALCULATION_METHOD,
  CAP,
  COMPONENT_TYPE,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

// CUSTOM_FORMULA محجوز في هذه المرحلة ولا يُتاح للاختيار
const SELECTABLE_METHODS = Object.entries(CALCULATION_METHOD).filter(([k]) => k !== 'CUSTOM_FORMULA');

const empty = () => ({
  component_code: '',
  name_ar: '',
  name_en: '',
  component_type: 'EARNING',
  calculation_method: 'FIXED_AMOUNT',
  default_amount: '',
  default_rate: '',
  default_percentage: '',
  expense_account_id: '',
  liability_account_id: '',
  default_cost_center_id: '',
  is_taxable: false,
  is_pensionable: false,
  show_on_payslip: true,
  allow_manual_override: false,
  minimum_amount: '',
  maximum_amount: '',
  effective_from: today(),
  effective_to: '',
});

export default function ComponentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [opts, setOpts] = useState<any>({});
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ c: any; path: string; title: string } | null>(null);

  const load = async () => {
    const sp = new URLSearchParams({ page_size: '200' });
    if (typeFilter) sp.set('component_type', typeFilter);
    const r = await fetchJson(`${API.components}?${sp.toString()}`);
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
  }, [typeFilter]);

  const manage = can(caps, CAP.MANAGE_COMPONENTS);

  function openNew() { setEditing(null); setForm(empty()); setFormErr(''); setOpen(true); }
  function openEdit(c: any) {
    setEditing(c);
    setForm({
      component_code: c.component_code,
      name_ar: c.name_ar,
      name_en: c.name_en ?? '',
      component_type: c.component_type,
      calculation_method: c.calculation_method,
      default_amount: c.default_amount ?? '',
      default_rate: c.default_rate ?? '',
      default_percentage: c.default_percentage ?? '',
      expense_account_id: c.expense_account_id ?? '',
      liability_account_id: c.liability_account_id ?? '',
      default_cost_center_id: c.default_cost_center_id ?? '',
      is_taxable: !!c.is_taxable,
      is_pensionable: !!c.is_pensionable,
      show_on_payslip: !!c.show_on_payslip,
      allow_manual_override: !!c.allow_manual_override,
      minimum_amount: c.minimum_amount ?? '',
      maximum_amount: c.maximum_amount ?? '',
      effective_from: c.effective_from ?? today(),
      effective_to: c.effective_to ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['default_amount', 'default_rate', 'default_percentage', 'expense_account_id', 'liability_account_id', 'default_cost_center_id', 'minimum_amount', 'maximum_amount', 'name_en', 'effective_to'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      let r;
      if (editing) {
        delete payload.component_code;
        r = await fetchJson(`${API.components}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.components, {
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
      const r = await fetchJson(`${API.components}/${confirm.c.id}/${confirm.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: confirm.c.version, updated_at: confirm.c.updated_at }),
      });
      if (!r.success) setError(errMsg(r));
      setConfirm(null);
      await load();
    } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const chk = (k: string, lbl: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
      <span className="text-xs text-gray-600">{lbl}</span>
    </label>
  );

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">مكوّنات الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>مكوّن جديد</button>}
      </div>
      <PayrollNav />
      {!manage && <p className="text-amber-700 text-xs mb-2">إدارة المكوّنات مقصورة على مدير الحسابات (إعداد مالي حسّاس).</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <select className="border p-2 rounded" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(COMPONENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الاسم</th>
            <th>النوع</th>
            <th>طريقة الاحتساب</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2 font-mono">{c.component_code}</td>
              <td>{c.name_ar}</td>
              <td>{label(COMPONENT_TYPE, c.component_type)}</td>
              <td>{label(CALCULATION_METHOD, c.calculation_method)}</td>
              <td>
                <span className={`text-xs font-semibold ${c.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                  {c.is_active ? 'فعّال' : 'موقوف'}
                </span>
              </td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  <button className="text-blue-600" onClick={() => openEdit(c)}>تعديل</button>
                  {c.is_active
                    ? <button className="text-amber-700" onClick={() => setConfirm({ c, path: 'deactivate', title: 'إيقاف المكوّن' })}>تعطيل</button>
                    : <button className="text-green-700" onClick={() => setConfirm({ c, path: 'activate', title: 'تفعيل المكوّن' })}>تفعيل</button>}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={manage ? 6 : 5} className="p-3 text-gray-400">لا مكوّنات</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل مكوّن' : 'مكوّن جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز *</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.component_code} disabled={!!editing}
                  onChange={(e) => set('component_code', e.target.value)} />
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
                <span className="text-xs text-gray-500">النوع *</span>
                <select className="border p-2" value={form.component_type} onChange={(e) => set('component_type', e.target.value)}>
                  {Object.entries(COMPONENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">طريقة الاحتساب *</span>
                <select className="border p-2" value={form.calculation_method} onChange={(e) => set('calculation_method', e.target.value)}>
                  {SELECTABLE_METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">المبلغ الافتراضي</span>
                <input className="border p-2" type="number" value={form.default_amount} onChange={(e) => set('default_amount', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">المعدّل الافتراضي</span>
                <input className="border p-2" type="number" value={form.default_rate} onChange={(e) => set('default_rate', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">النسبة الافتراضية (%)</span>
                <input className="border p-2" type="number" value={form.default_percentage} onChange={(e) => set('default_percentage', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حساب المصروف</span>
                <select className="border p-2" value={form.expense_account_id} onChange={(e) => set('expense_account_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.expense_accounts ?? opts.gl_accounts ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حساب الالتزام</span>
                <select className="border p-2" value={form.liability_account_id} onChange={(e) => set('liability_account_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.liability_accounts ?? opts.gl_accounts ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">مركز الكلفة الافتراضي</span>
                <select className="border p-2" value={form.default_cost_center_id} onChange={(e) => set('default_cost_center_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.cost_centers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الحد الأدنى</span>
                <input className="border p-2" type="number" value={form.minimum_amount} onChange={(e) => set('minimum_amount', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الحد الأعلى</span>
                <input className="border p-2" type="number" value={form.maximum_amount} onChange={(e) => set('maximum_amount', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">بداية السريان *</span>
                <input className="border p-2" type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">نهاية السريان</span>
                <input className="border p-2" type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)} />
              </label>
              <div className="md:col-span-2 grid grid-cols-2 gap-2 mt-1">
                {chk('is_taxable', 'خاضع للضريبة')}
                {chk('is_pensionable', 'خاضع للتقاعد')}
                {chk('show_on_payslip', 'يظهر في قسيمة الراتب')}
                {chk('allow_manual_override', 'يسمح بالتعديل اليدوي')}
              </div>
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

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على المكوّن «${confirm?.c?.name_ar ?? ''}»؟`}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
