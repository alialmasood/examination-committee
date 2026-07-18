'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, CAP, DEP_METHOD, can, errMsg, fetchJson, iqd, label } from '../_lib';

type Cat = any;

const empty = () => ({
  code: '',
  name_ar: '',
  name_en: '',
  description: '',
  asset_gl_account_id: '',
  accumulated_depreciation_gl_account_id: '',
  depreciation_expense_gl_account_id: '',
  gain_gl_account_id: '',
  loss_gl_account_id: '',
  depreciation_method: 'STRAIGHT_LINE',
  useful_life_months: '',
  salvage_value_percent: '0',
  capitalization_threshold: '0',
});

export default function CategoriesPage() {
  const [rows, setRows] = useState<Cat[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [gl, setGl] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [form, setForm] = useState<any>(empty());
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = async () => {
    const r = await fetchJson(`${API.categories}?page_size=200`);
    if (!r.success) return setError(errMsg(r));
    setRows(Array.isArray(r.data) ? r.data : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      setCaps(o?.data?.capabilities ?? []);
      setGl(o?.data?.gl_accounts ?? []);
      await load();
    })();
  }, []);

  const manage = can(caps, CAP.CATEGORY_MANAGE);

  function openNew() {
    setEditing(null);
    setForm(empty());
    setFormErr('');
    setOpen(true);
  }
  function openEdit(c: Cat) {
    setEditing(c);
    setForm({
      code: c.code,
      name_ar: c.name_ar,
      name_en: c.name_en ?? '',
      description: c.description ?? '',
      asset_gl_account_id: c.asset_gl_account_id ?? '',
      accumulated_depreciation_gl_account_id: c.accumulated_depreciation_gl_account_id ?? '',
      depreciation_expense_gl_account_id: c.depreciation_expense_gl_account_id ?? '',
      gain_gl_account_id: c.gain_gl_account_id ?? '',
      loss_gl_account_id: c.loss_gl_account_id ?? '',
      depreciation_method: c.depreciation_method ?? 'STRAIGHT_LINE',
      useful_life_months: c.useful_life_months ?? '',
      salvage_value_percent: c.salvage_value_percent ?? '0',
      capitalization_threshold: c.capitalization_threshold ?? '0',
    });
    setFormErr('');
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = { ...form };
      payload.useful_life_months = form.useful_life_months === '' ? null : Number(form.useful_life_months);
      ['name_en', 'description', 'gain_gl_account_id', 'loss_gl_account_id'].forEach((k) => {
        if (payload[k] === '') payload[k] = null;
      });
      let r;
      if (editing) {
        r = await fetchJson(`${API.categories}/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version, updated_at: editing.updated_at }),
        });
      } else {
        r = await fetchJson(API.categories, {
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

  async function toggle(c: Cat) {
    const r = await fetchJson(`${API.categories}/${c.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: !c.is_active, version: c.version, updated_at: c.updated_at }),
    });
    if (!r.success) return setError(errMsg(r));
    await load();
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const glSelect = (k: string, lbl: string, required?: boolean) => (
    <label className="grid gap-1">
      <span className="text-xs text-gray-500">{lbl}{required ? ' *' : ''}</span>
      <select className="border p-2" value={form[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">— اختر —</option>
        {gl.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
      </select>
    </label>
  );

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">تصنيفات الأصول الثابتة</h1>
        {manage && (
          <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={openNew}>
            تصنيف جديد
          </button>
        )}
      </div>
      <FixedAssetsNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الرمز</th>
            <th>الاسم</th>
            <th>طريقة الإهلاك</th>
            <th>العمر (شهر)</th>
            <th>حد الرسملة</th>
            <th>الحالة</th>
            {manage && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2 font-mono">{c.code}</td>
              <td>{c.name_ar}</td>
              <td>{label(DEP_METHOD, c.depreciation_method)}</td>
              <td>{c.useful_life_months ?? '—'}</td>
              <td>{iqd(c.capitalization_threshold)}</td>
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
          {!rows.length && (
            <tr><td colSpan={manage ? 7 : 6} className="p-3 text-gray-400">لا تصنيفات</td></tr>
          )}
        </tbody>
      </table>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">{editing ? 'تعديل تصنيف' : 'تصنيف جديد'}</h3>
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
                <span className="text-xs text-gray-500">طريقة الإهلاك</span>
                <select className="border p-2" value={form.depreciation_method} onChange={(e) => set('depreciation_method', e.target.value)}>
                  <option value="STRAIGHT_LINE">القسط الثابت</option>
                  <option value="NONE">بدون إهلاك</option>
                </select>
              </label>
              {glSelect('asset_gl_account_id', 'حساب الأصل', true)}
              {glSelect('accumulated_depreciation_gl_account_id', 'حساب مجمع الإهلاك', true)}
              {glSelect('depreciation_expense_gl_account_id', 'حساب مصروف الإهلاك', true)}
              {glSelect('gain_gl_account_id', 'حساب أرباح البيع')}
              {glSelect('loss_gl_account_id', 'حساب خسائر الاستبعاد')}
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">العمر الإنتاجي (بالأشهر)</span>
                <input className="border p-2" type="number" value={form.useful_life_months}
                  onChange={(e) => set('useful_life_months', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">نسبة القيمة المتبقية (%)</span>
                <input className="border p-2" type="number" value={form.salvage_value_percent}
                  onChange={(e) => set('salvage_value_percent', e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حد الرسملة (د.ع)</span>
                <input className="border p-2" type="number" value={form.capitalization_threshold}
                  onChange={(e) => set('capitalization_threshold', e.target.value)} />
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
