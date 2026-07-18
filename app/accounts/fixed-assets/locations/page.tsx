'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, CAP, LOCATION_TYPE, can, errMsg, fetchJson, label } from '../_lib';

type Loc = any;

const empty = () => ({
  code: '',
  name_ar: '',
  name_en: '',
  location_type: 'ROOM',
  parent_location_id: '',
  department_id: '',
  description: '',
});

export default function LocationsPage() {
  const [rows, setRows] = useState<Loc[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Loc | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = async () => {
    const r = await fetchJson(`${API.locations}?page_size=200`);
    if (!r.success) return setError(errMsg(r));
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      setCaps(o?.data?.capabilities ?? []);
      setDepartments(o?.data?.departments ?? []);
      await load();
    })();
  }, []);

  const manage = can(caps, CAP.LOCATION_MANAGE);

  // ترتيب هرمي: الجذور ثم الأبناء مع حساب العمق للإزاحة
  const ordered = useMemo(() => {
    const byParent: Record<string, Loc[]> = {};
    rows.forEach((r) => {
      const p = r.parent_location_id ?? 'ROOT';
      (byParent[p] ||= []).push(r);
    });
    const out: Array<{ row: Loc; depth: number }> = [];
    const walk = (parent: string, depth: number) => {
      (byParent[parent] ?? [])
        .sort((a, b) => String(a.code).localeCompare(String(b.code)))
        .forEach((r) => {
          out.push({ row: r, depth });
          walk(r.id, depth + 1);
        });
    };
    walk('ROOT', 0);
    // أي صفوف بأب غير موجود ضمن القائمة تُعرض كجذور
    const seen = new Set(out.map((o) => o.row.id));
    rows.forEach((r) => {
      if (!seen.has(r.id)) out.push({ row: r, depth: 0 });
    });
    return out;
  }, [rows]);

  function openNew() {
    setEditing(null);
    setForm(empty());
    setFormErr('');
    setOpen(true);
  }
  function openEdit(c: Loc) {
    setEditing(c);
    setForm({
      code: c.code,
      name_ar: c.name_ar,
      name_en: c.name_en ?? '',
      location_type: c.location_type ?? 'ROOM',
      parent_location_id: c.parent_location_id ?? '',
      department_id: c.department_id ?? '',
      description: c.description ?? '',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      ['name_en', 'parent_location_id', 'department_id', 'description'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      let r;
      if (editing) {
        r = await fetchJson(`${API.locations}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.locations, {
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

  async function toggle(c: Loc) {
    const r = await fetchJson(`${API.locations}/${c.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: !c.is_active, version: c.version, updated_at: c.updated_at }),
    });
    if (!r.success) return setError(errMsg(r));
    await load();
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name_ar ?? '—';

  return (
    <main dir="rtl" className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">مواقع الأصول الثابتة</h1>
        {manage && (
          <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>
            موقع جديد
          </button>
        )}
      </div>
      <FixedAssetsNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الموقع</th>
            <th>الرمز</th>
            <th>النوع</th>
            <th>القسم</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {ordered.map(({ row: c, depth }) => (
            <tr key={c.id} className="border-t">
              <td className="p-2">
                <span style={{ paddingRight: `${depth * 18}px` }}>
                  {depth > 0 && <span className="text-gray-400">↳ </span>}
                  {c.name_ar}
                </span>
              </td>
              <td className="font-mono">{c.code}</td>
              <td>{label(LOCATION_TYPE, c.location_type)}</td>
              <td>{deptName(c.department_id)}</td>
              <td>
                <span className={`text-xs font-semibold ${c.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                  {c.is_active ? 'فعّال' : 'موقوف'}
                </span>
              </td>
              {manage && (
                <td className="space-x-2 space-x-reverse whitespace-nowrap">
                  <button className="text-blue-600" onClick={() => openEdit(c)}>تعديل</button>
                  <button className="text-amber-700" onClick={() => void toggle(c)}>
                    {c.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!ordered.length && (
            <tr><td colSpan={manage ? 6 : 5} className="p-3 text-gray-400">لا مواقع</td></tr>
          )}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل موقع' : 'موقع جديد'}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الرمز *</span>
                <input className="border p-2 disabled:bg-gray-100" value={form.code} disabled={!!editing}
                  onChange={(e) => set('code', e.target.value)} />
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
                <span className="text-xs text-gray-500">النوع</span>
                <select className="border p-2" value={form.location_type} onChange={(e) => set('location_type', e.target.value)}>
                  {Object.entries(LOCATION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">الموقع الأب</span>
                <select className="border p-2" value={form.parent_location_id} onChange={(e) => set('parent_location_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {rows.filter((r) => !editing || r.id !== editing.id).map((r) => (
                    <option key={r.id} value={r.id}>{r.code} — {r.name_ar}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">القسم</span>
                <select className="border p-2" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                </select>
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs text-gray-500">الوصف</span>
                <textarea className="border p-2" value={form.description} onChange={(e) => set('description', e.target.value)} />
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
