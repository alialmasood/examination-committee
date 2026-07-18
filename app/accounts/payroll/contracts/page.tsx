'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  CAP,
  COMPENSATION_BASIS,
  CONTRACT_STATUS,
  ConfirmDialog,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
  iqd,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  payroll_person_id: '',
  contract_number: '',
  compensation_basis: 'MONTHLY_FIXED',
  base_amount: '0',
  rate_amount: '',
  currency_code: 'IQD',
  effective_from: today(),
  effective_to: '',
  default_expense_account_id: '',
  payable_account_id: '',
  default_cost_center_id: '',
  notes: '',
});

// الانتقالات المسموح بها لكل حالة (تطابق CONTRACT_TRANSITIONS في الخادم)
const ACTIONS: Record<string, Array<{ path: string; title: string; cls: string }>> = {
  DRAFT: [
    { path: 'activate', title: 'تفعيل', cls: 'text-green-700' },
    { path: 'cancel', title: 'إلغاء', cls: 'text-red-700' },
  ],
  ACTIVE: [
    { path: 'suspend', title: 'إيقاف', cls: 'text-amber-700' },
    { path: 'terminate', title: 'إنهاء', cls: 'text-red-700' },
  ],
  SUSPENDED: [
    { path: 'activate', title: 'تفعيل', cls: 'text-green-700' },
    { path: 'terminate', title: 'إنهاء', cls: 'text-red-700' },
    { path: 'cancel', title: 'إلغاء', cls: 'text-red-700' },
  ],
};

export default function ContractsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [opts, setOpts] = useState<any>({});
  const [people, setPeople] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ c: any; path: string; title: string } | null>(null);
  const [reason, setReason] = useState('');

  const personName = (pid: string) => people.find((p) => p.id === pid)?.full_name_ar ?? pid;

  const load = async () => {
    const sp = new URLSearchParams({ page_size: '200' });
    if (statusFilter) sp.set('status', statusFilter);
    const r = await fetchJson(`${API.contracts}?${sp.toString()}`);
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const [o, ppl] = await Promise.all([fetchJson(API.options), fetchJson(`${API.people}?page_size=200`)]);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOpts(o?.data ?? {});
      setPeople(Array.isArray(ppl?.data) ? ppl.data : []);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const manage = can(caps, CAP.MANAGE_CONTRACTS);

  function openNew() { setEditing(null); setForm(empty()); setFormErr(''); setOpen(true); }
  function openEdit(c: any) {
    setEditing(c);
    setForm({
      payroll_person_id: c.payroll_person_id,
      contract_number: c.contract_number,
      compensation_basis: c.compensation_basis,
      base_amount: c.base_amount ?? '0',
      rate_amount: c.rate_amount ?? '',
      currency_code: c.currency_code ?? 'IQD',
      effective_from: c.effective_from ?? today(),
      effective_to: c.effective_to ?? '',
      default_expense_account_id: c.default_expense_account_id ?? '',
      payable_account_id: c.payable_account_id ?? '',
      default_cost_center_id: c.default_cost_center_id ?? '',
      notes: c.notes ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['rate_amount', 'effective_to', 'default_expense_account_id', 'payable_account_id', 'default_cost_center_id', 'notes'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      if (!payload.contract_number) delete payload.contract_number;
      let r;
      if (editing) {
        delete payload.contract_number;
        delete payload.payroll_person_id;
        r = await fetchJson(`${API.contracts}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.contracts, {
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

  const needsReason = confirm?.path === 'terminate' || confirm?.path === 'cancel';

  async function runAction() {
    if (!confirm) return;
    if (needsReason && !reason.trim()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { version: confirm.c.version, updated_at: confirm.c.updated_at };
      if (needsReason) payload.reason = reason.trim();
      const r = await fetchJson(`${API.contracts}/${confirm.c.id}/${confirm.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) setError(errMsg(r));
      setConfirm(null);
      setReason('');
      await load();
    } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">عقود الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>عقد جديد</button>}
      </div>
      <PayrollNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <select className="border p-2 rounded" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرقم</th>
            <th>الشخص</th>
            <th>الأساس</th>
            <th>المبلغ</th>
            <th>الفترة</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2 font-mono">{c.contract_number}</td>
              <td>{personName(c.payroll_person_id)}</td>
              <td>{label(COMPENSATION_BASIS, c.compensation_basis)}</td>
              <td>{iqd(c.base_amount)}</td>
              <td className="whitespace-nowrap">{c.effective_from} → {c.effective_to ?? '—'}</td>
              <td><StatusBadge status={c.status} map={CONTRACT_STATUS} /></td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  {(c.status === 'DRAFT' || c.status === 'SUSPENDED') && (
                    <button className="text-blue-600" onClick={() => openEdit(c)}>تعديل</button>
                  )}
                  {(ACTIONS[c.status] ?? []).map((a) => (
                    <button key={a.path} className={a.cls} onClick={() => setConfirm({ c, path: a.path, title: `${a.title} العقد` })}>{a.title}</button>
                  ))}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={manage ? 7 : 6} className="p-3 text-gray-400">لا عقود</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل عقد' : 'عقد جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الشخص *</span>
                <select className="border p-2 disabled:bg-gray-100" value={form.payroll_person_id} disabled={!!editing}
                  onChange={(e) => set('payroll_person_id', e.target.value)}>
                  <option value="">— اختر —</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.person_code} — {p.full_name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">رقم العقد (يُولّد تلقائياً)</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.contract_number} disabled={!!editing}
                  onChange={(e) => set('contract_number', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">أساس التعويض *</span>
                <select className="border p-2" value={form.compensation_basis} onChange={(e) => set('compensation_basis', e.target.value)}>
                  {Object.entries(COMPENSATION_BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">المبلغ الأساسي *</span>
                <input className="border p-2" type="number" value={form.base_amount} onChange={(e) => set('base_amount', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">المعدّل</span>
                <input className="border p-2" type="number" value={form.rate_amount} onChange={(e) => set('rate_amount', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العملة *</span>
                <input className="border p-2" value={form.currency_code} onChange={(e) => set('currency_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">بداية السريان *</span>
                <input className="border p-2" type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">نهاية السريان</span>
                <input className="border p-2" type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حساب المصروف</span>
                <select className="border p-2" value={form.default_expense_account_id} onChange={(e) => set('default_expense_account_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.expense_accounts ?? opts.gl_accounts ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حساب الذمم الدائنة</span>
                <select className="border p-2" value={form.payable_account_id} onChange={(e) => set('payable_account_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.liability_accounts ?? opts.gl_accounts ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">مركز الكلفة</span>
                <select className="border p-2" value={form.default_cost_center_id} onChange={(e) => set('default_cost_center_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.cost_centers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs text-gray-500">ملاحظات</span>
                <textarea className="border p-2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
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

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على العقد «${confirm?.c?.contract_number ?? ''}»؟`}
        busy={busy}
        reasonRequired={needsReason}
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => { setConfirm(null); setReason(''); }}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
