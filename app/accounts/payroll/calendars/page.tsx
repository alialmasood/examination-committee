'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import PayrollNav from '../PayrollNav';
import {
  API,
  CALENDAR_TYPE,
  CAP,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  label,
} from '../_lib';

const today = () => new Date().toISOString().slice(0, 10);

const empty = () => ({
  code: '',
  name_ar: '',
  name_en: '',
  calendar_type: 'MONTHLY',
  currency_code: 'IQD',
  effective_from: today(),
  effective_to: '',
});

export default function CalendarsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [confirm, setConfirm] = useState<{ c: any; path: string; title: string } | null>(null);

  const load = async () => {
    const r = await fetchJson(`${API.calendars}?page_size=200`);
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
  }, []);

  const manage = can(caps, CAP.ADMIN);

  function openNew() { setEditing(null); setForm(empty()); setFormErr(''); setOpen(true); }
  function openEdit(c: any) {
    setEditing(c);
    setForm({
      code: c.code,
      name_ar: c.name_ar,
      name_en: c.name_en ?? '',
      calendar_type: c.calendar_type,
      currency_code: c.currency_code ?? 'IQD',
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
      ['name_en', 'effective_to'].forEach((k) => { if (payload[k] === '') payload[k] = null; });
      let r;
      if (editing) {
        delete payload.code;
        r = await fetchJson(`${API.calendars}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.calendars, {
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
      const r = await fetchJson(`${API.calendars}/${confirm.c.id}/${confirm.path}`, {
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

  return (
    <main dir="rtl" className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">تقويمات الرواتب</h1>
        {manage && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>تقويم جديد</button>}
      </div>
      <PayrollNav />
      {!manage && <p className="text-amber-700 text-xs mb-2">إدارة التقويمات مقصورة على مدير الحسابات.</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الاسم</th>
            <th>النوع</th>
            <th>العملة</th>
            <th>الفترة</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2 font-mono">{c.code}</td>
              <td>{c.name_ar}</td>
              <td>{label(CALENDAR_TYPE, c.calendar_type)}</td>
              <td>{c.currency_code}</td>
              <td className="whitespace-nowrap">{c.effective_from} → {c.effective_to ?? '—'}</td>
              <td>
                <span className={`text-xs font-semibold ${c.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                  {c.is_active ? 'فعّال' : 'موقوف'}
                </span>
              </td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  <button className="text-blue-600" onClick={() => openEdit(c)}>تعديل</button>
                  {c.is_active
                    ? <button className="text-amber-700" onClick={() => setConfirm({ c, path: 'deactivate', title: 'إيقاف التقويم' })}>تعطيل</button>
                    : <button className="text-green-700" onClick={() => setConfirm({ c, path: 'activate', title: 'تفعيل التقويم' })}>تفعيل</button>}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={manage ? 7 : 6} className="p-3 text-gray-400">لا تقويمات</td></tr>}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل تقويم' : 'تقويم جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز *</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.code} disabled={!!editing} onChange={(e) => set('code', e.target.value)} />
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
                <select className="border p-2" value={form.calendar_type} onChange={(e) => set('calendar_type', e.target.value)}>
                  {Object.entries(CALENDAR_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
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
        message={`هل أنت متأكد من تنفيذ هذا الإجراء على التقويم «${confirm?.c?.code ?? ''}»؟`}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runAction()}
      />
    </main>
  );
}
