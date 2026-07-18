'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_TYPE,
  CAP,
  ConfirmDialog,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  payroll_person_id: '',
  payroll_contract_id: '',
  assignment_code: '',
  assignment_type: 'GENERAL_ASSIGNMENT',
  title_ar: '',
  title_en: '',
  department_id: '',
  cost_center_id: '',
  effective_from: today(),
  effective_to: '',
});

// activate/deactivate متاحة حسب الحالة (تطابق ASSIGNMENT_TRANSITIONS)
const ACTIONS: Record<string, Array<{ path: string; title: string; cls: string }>> = {
  DRAFT: [
    { path: 'activate', title: 'تفعيل', cls: 'text-green-700' },
    { path: 'deactivate', title: 'إنهاء', cls: 'text-red-700' },
  ],
  ACTIVE: [{ path: 'deactivate', title: 'إيقاف', cls: 'text-amber-700' }],
  SUSPENDED: [
    { path: 'activate', title: 'تفعيل', cls: 'text-green-700' },
    { path: 'deactivate', title: 'إنهاء', cls: 'text-red-700' },
  ],
};

export default function AssignmentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [opts, setOpts] = useState<any>({});
  const [people, setPeople] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ a: any; path: string; title: string } | null>(null);

  const personName = (pid: string) => people.find((p) => p.id === pid)?.full_name_ar ?? pid;

  const load = async () => {
    const sp = new URLSearchParams({ page_size: '200' });
    if (typeFilter) sp.set('assignment_type', typeFilter);
    if (statusFilter) sp.set('status', statusFilter);
    const r = await fetchJson(`${API.assignments}?${sp.toString()}`);
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const [o, ppl, ctr] = await Promise.all([
        fetchJson(API.options),
        fetchJson(`${API.people}?page_size=200`),
        fetchJson(`${API.contracts}?page_size=200`),
      ]);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOpts(o?.data ?? {});
      setPeople(Array.isArray(ppl?.data) ? ppl.data : []);
      setContracts(Array.isArray(ctr?.data) ? ctr.data : []);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter]);

  const manage = can(caps, CAP.MANAGE_ASSIGNMENTS);
  const personContracts = contracts.filter((c) => c.payroll_person_id === form.payroll_person_id);

  function openNew() { setEditing(null); setForm(empty()); setFormErr(''); setOpen(true); }
  function openEdit(a: any) {
    setEditing(a);
    setForm({
      payroll_person_id: a.payroll_person_id,
      payroll_contract_id: a.payroll_contract_id ?? '',
      assignment_code: a.assignment_code,
      assignment_type: a.assignment_type,
      title_ar: a.title_ar,
      title_en: a.title_en ?? '',
      department_id: a.department_id ?? '',
      cost_center_id: a.cost_center_id ?? '',
      effective_from: a.effective_from ?? today(),
      effective_to: a.effective_to ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['payroll_contract_id', 'title_en', 'department_id', 'cost_center_id', 'effective_to'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      if (!payload.assignment_code) delete payload.assignment_code;
      let r;
      if (editing) {
        delete payload.assignment_code;
        delete payload.payroll_person_id;
        r = await fetchJson(`${API.assignments}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.assignments, {
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
      const r = await fetchJson(`${API.assignments}/${confirm.a.id}/${confirm.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: confirm.a.version, updated_at: confirm.a.updated_at }),
      });
      if (!r.success) setError(errMsg(r));
      setConfirm(null);
      await load();
    } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">تكليفات الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>تكليف جديد</button>}
      </div>
      <PayrollNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <select className="border p-2 rounded" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(ASSIGNMENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="border p-2 rounded" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(ASSIGNMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الشخص</th>
            <th>النوع</th>
            <th>العنوان</th>
            <th>الفترة</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="p-2 font-mono">{a.assignment_code}</td>
              <td>{personName(a.payroll_person_id)}</td>
              <td>{label(ASSIGNMENT_TYPE, a.assignment_type)}</td>
              <td>{a.title_ar}</td>
              <td className="whitespace-nowrap">{a.effective_from} → {a.effective_to ?? '—'}</td>
              <td><StatusBadge status={a.status} map={ASSIGNMENT_STATUS} /></td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  {a.status !== 'ENDED' && <button className="text-blue-600" onClick={() => openEdit(a)}>تعديل</button>}
                  {(ACTIONS[a.status] ?? []).map((act) => (
                    <button key={act.path} className={act.cls} onClick={() => setConfirm({ a, path: act.path, title: `${act.title} التكليف` })}>{act.title}</button>
                  ))}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={manage ? 7 : 6} className="p-3 text-gray-400">لا تكليفات</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل تكليف' : 'تكليف جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الشخص *</span>
                <select className="border p-2 disabled:bg-gray-100" value={form.payroll_person_id} disabled={!!editing}
                  onChange={(e) => { set('payroll_person_id', e.target.value); set('payroll_contract_id', ''); }}>
                  <option value="">— اختر —</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.person_code} — {p.full_name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العقد المرتبط</span>
                <select className="border p-2" value={form.payroll_contract_id} onChange={(e) => set('payroll_contract_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {personContracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز (يُولّد تلقائياً)</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.assignment_code} disabled={!!editing}
                  onChange={(e) => set('assignment_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">النوع *</span>
                <select className="border p-2" value={form.assignment_type} onChange={(e) => set('assignment_type', e.target.value)}>
                  {Object.entries(ASSIGNMENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العنوان بالعربية *</span>
                <input className="border p-2" value={form.title_ar} onChange={(e) => set('title_ar', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العنوان بالإنجليزية</span>
                <input className="border p-2" value={form.title_en} onChange={(e) => set('title_en', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">القسم</span>
                <select className="border p-2" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.departments ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">مركز الكلفة</span>
                <select className="border p-2" value={form.cost_center_id} onChange={(e) => set('cost_center_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.cost_centers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
                </select>
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
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على التكليف «${confirm?.a?.title_ar ?? ''}»؟`}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
