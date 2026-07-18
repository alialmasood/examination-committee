'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import PayrollNav from '../PayrollNav';
import {
  API,
  CAP,
  ConfirmDialog,
  PAYMENT_METHOD,
  PERSON_STATUS,
  PERSON_TYPE,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  person_code: '',
  full_name_ar: '',
  full_name_en: '',
  person_type: 'EMPLOYEE',
  department_id: '',
  default_cost_center_id: '',
  default_currency_code: 'IQD',
  payment_method: '',
  bank_account_name: '',
  bank_account_identifier: '',
  effective_from: today(),
  effective_to: '',
});

export default function PeoplePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [opts, setOpts] = useState<any>({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ p: any; target: string; path: string; title: string } | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    const sp = new URLSearchParams({ page_size: '200' });
    if (q) sp.set('q', q);
    if (typeFilter) sp.set('person_type', typeFilter);
    if (statusFilter) sp.set('status', statusFilter);
    const r = await fetchJson(`${API.people}?${sp.toString()}`);
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
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typeFilter, statusFilter]);

  const manage = can(caps, CAP.MANAGE_PEOPLE);

  function openNew() {
    setEditing(null);
    setForm(empty());
    setFormErr('');
    setOpen(true);
  }

  async function openEdit(p: any) {
    // نجلب التفاصيل الكاملة لأن القائمة لا تُرجع البيانات المصرفية
    const r = await fetchJson(`${API.people}/${p.id}`);
    const full = r?.data ?? p;
    setEditing(full);
    setForm({
      person_code: full.person_code,
      full_name_ar: full.full_name_ar,
      full_name_en: full.full_name_en ?? '',
      person_type: full.person_type,
      department_id: full.department_id ?? '',
      default_cost_center_id: full.default_cost_center_id ?? '',
      default_currency_code: full.default_currency_code ?? 'IQD',
      payment_method: full.payment_method ?? '',
      bank_account_name: full.bank_account_name ?? '',
      bank_account_identifier: '',
      effective_from: full.effective_from ?? today(),
      effective_to: full.effective_to ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['full_name_en', 'department_id', 'default_cost_center_id', 'payment_method', 'bank_account_name', 'effective_to'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      if (!payload.bank_account_identifier) delete payload.bank_account_identifier;
      if (!payload.person_code) delete payload.person_code;
      let r;
      if (editing) {
        delete payload.person_code;
        r = await fetchJson(`${API.people}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.people, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!r.success) return setFormErr(errMsg(r));
      setOpen(false);
      setEditing(null);
      setForm(empty());
      await load();
    } finally {
      setBusy(false);
    }
  }

  const needsReason = confirm?.path === 'terminate';

  async function runAction() {
    if (!confirm) return;
    if (needsReason && !reason.trim()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { version: confirm.p.version, updated_at: confirm.p.updated_at };
      if (needsReason) payload.reason = reason.trim();
      const r = await fetchJson(`${API.people}/${confirm.p.id}/${confirm.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) {
        setError(errMsg(r));
      }
      setConfirm(null);
      setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">أشخاص الرواتب</h1>
        {manage && (
          <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>
            شخص جديد
          </button>
        )}
      </div>
      <PayrollNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <input className="border p-2 rounded" placeholder="بحث بالرمز أو الاسم" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="border p-2 rounded" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(PERSON_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="border p-2 rounded" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(PERSON_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الاسم</th>
            <th>النوع</th>
            <th>العملة</th>
            <th>طريقة الدفع</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="p-2 font-mono">
                <Link className="text-blue-600" href={`/accounts/payroll/people/${p.id}`}>{p.person_code}</Link>
              </td>
              <td>{p.full_name_ar}</td>
              <td>{label(PERSON_TYPE, p.person_type)}</td>
              <td>{p.default_currency_code}</td>
              <td>{label(PAYMENT_METHOD, p.payment_method)}</td>
              <td><StatusBadge status={p.status} map={PERSON_STATUS} /></td>
              <td className="space-x-2 space-x-reverse whitespace-nowrap">
                <Link className="text-gray-700" href={`/accounts/payroll/people/${p.id}`}>عرض</Link>
                {manage && p.status !== 'TERMINATED' && (
                  <>
                    <button className="text-blue-600" onClick={() => void openEdit(p)}>تعديل</button>
                    {p.status === 'ACTIVE' && (
                      <button className="text-amber-700" onClick={() => setConfirm({ p, target: 'SUSPENDED', path: 'suspend', title: 'إيقاف الشخص' })}>إيقاف</button>
                    )}
                    {(p.status === 'SUSPENDED' || p.status === 'INACTIVE') && (
                      <button className="text-green-700" onClick={() => setConfirm({ p, target: 'ACTIVE', path: 'activate', title: 'تفعيل الشخص' })}>تفعيل</button>
                    )}
                    <button className="text-red-700" onClick={() => setConfirm({ p, target: 'TERMINATED', path: 'terminate', title: 'إنهاء الشخص' })}>إنهاء</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={7} className="p-3 text-gray-400">لا أشخاص</td></tr>
          )}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل شخص' : 'شخص جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز (يُولّد تلقائياً إن تُرك فارغاً)</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.person_code} disabled={!!editing}
                  onChange={(e) => set('person_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الاسم بالعربية *</span>
                <input className="border p-2" value={form.full_name_ar} onChange={(e) => set('full_name_ar', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الاسم بالإنجليزية</span>
                <input className="border p-2" value={form.full_name_en} onChange={(e) => set('full_name_en', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">النوع *</span>
                <select className="border p-2" value={form.person_type} onChange={(e) => set('person_type', e.target.value)}>
                  {Object.entries(PERSON_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">القسم</span>
                <select className="border p-2" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {(opts.departments ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
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
                <span className="text-xs text-gray-500">العملة *</span>
                <input className="border p-2" value={form.default_currency_code} onChange={(e) => set('default_currency_code', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">طريقة الدفع</span>
                <select className="border p-2" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                  <option value="">— بدون —</option>
                  {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">اسم صاحب الحساب المصرفي</span>
                <input className="border p-2" value={form.bank_account_name} onChange={(e) => set('bank_account_name', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">المعرّف المصرفي (يُخزَّن مقنّعاً)</span>
                <input className="border p-2" value={form.bank_account_identifier}
                  placeholder={editing ? 'اتركه فارغاً للإبقاء على الحالي' : ''}
                  onChange={(e) => set('bank_account_identifier', e.target.value)} />
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
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على «${confirm?.p?.full_name_ar ?? ''}»؟`}
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
