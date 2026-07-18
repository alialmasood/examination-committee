'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import FixedAssetsNav from '../../FixedAssetsNav';
import { API, CAP, DEP_METHOD, can, errMsg, fetchJson, iqd, label } from '../../_lib';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewAssetPage() {
  const [opts, setOpts] = useState<any>();
  const [categories, setCategories] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({
    category_id: '',
    name_ar: '',
    name_en: '',
    description: '',
    serial_number: '',
    barcode_value: '',
    acquisition_type: 'MANUAL',
    acquisition_date: today(),
    available_for_use_date: today(),
    acquisition_cost: '0',
    additional_costs: '0',
    useful_life_months: '',
    location_id: '',
    custodian_user_id: '',
    department_id: '',
    opening_accumulated_depreciation: '0',
    donation_contra_gl_account_id: '',
    fiscal_period_id: '',
  });

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      setOpts(o?.data);
      setCaps(o?.data?.capabilities ?? []);
      const c = await fetchJson(`${API.categories}?active_only=true&page_size=200`);
      setCategories(Array.isArray(c?.data) ? c.data : []);
    })();
  }, []);

  const prepare = can(caps, CAP.ASSET_PREPARE);
  const cat = categories.find((c) => c.id === f.category_id);
  const periods = opts?.fiscal_periods ?? [];
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];
  const departments = opts?.departments ?? [];
  const donationAccounts = opts?.donation_revenue_accounts ?? opts?.gl_accounts ?? [];

  const estimate = useMemo(() => {
    const capitalized = Number(f.acquisition_cost || 0) + Number(f.additional_costs || 0);
    const pct = Number(cat?.salvage_value_percent ?? 0);
    const salvage = Math.round(capitalized * (pct / 100) * 1000) / 1000;
    const depreciable = Math.max(0, capitalized - salvage);
    return { capitalized, salvage, depreciable };
  }, [f.acquisition_cost, f.additional_costs, cat]);

  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      const period = periods.find((p: any) => p.id === f.fiscal_period_id);
      if (!period) { setBusy(false); return setMsg('اختر الفترة المحاسبية'); }
      const payload: any = {
        category_id: f.category_id,
        name_ar: f.name_ar,
        name_en: f.name_en || null,
        description: f.description || null,
        serial_number: f.serial_number || null,
        barcode_value: f.barcode_value || null,
        acquisition_type: f.acquisition_type,
        acquisition_date: f.acquisition_date,
        available_for_use_date: f.available_for_use_date || f.acquisition_date,
        acquisition_cost: f.acquisition_cost,
        additional_costs: f.additional_costs,
        useful_life_months: f.useful_life_months === '' ? null : Number(f.useful_life_months),
        location_id: f.location_id || null,
        custodian_user_id: f.custodian_user_id || null,
        department_id: f.department_id || null,
        opening_accumulated_depreciation: f.acquisition_type === 'OPENING' ? f.opening_accumulated_depreciation : '0',
        fiscal_period_id: period.id,
        fiscal_year_id: period.fiscal_year_id,
      };
      if (f.acquisition_type === 'DONATION' && f.donation_contra_gl_account_id) {
        payload.donation_contra_gl_account_id = f.donation_contra_gl_account_id;
      }
      const r = await fetchJson(API.assets, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setMsg(errMsg(r));
      location.href = `/accounts/fixed-assets/assets/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">أصل ثابت جديد (مسودة)</h1>
      <FixedAssetsNav />

      {!prepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          ليس لديك صلاحية إنشاء الأصول — يمكنك تعبئة النموذج ولكن الحفظ سيُرفض من الخادم.
        </p>
      )}

      <div className="bg-white shadow rounded p-4 grid md:grid-cols-2 gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">التصنيف *</span>
          <select className="border p-2" value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">— اختر —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name_ar}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">نوع الاقتناء</span>
          <select className="border p-2" value={f.acquisition_type} onChange={(e) => set('acquisition_type', e.target.value)}>
            <option value="MANUAL">يدوي</option>
            <option value="DONATION">تبرّع</option>
            <option value="OPENING">رصيد افتتاحي</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الاسم بالعربية *</span>
          <input className="border p-2" value={f.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الاسم بالإنجليزية</span>
          <input className="border p-2" value={f.name_en} onChange={(e) => set('name_en', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الرقم التسلسلي</span>
          <input className="border p-2" value={f.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الباركود</span>
          <input className="border p-2" value={f.barcode_value} onChange={(e) => set('barcode_value', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">تاريخ الاقتناء *</span>
          <input className="border p-2" type="date" value={f.acquisition_date} onChange={(e) => set('acquisition_date', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">تاريخ الجاهزية للاستخدام</span>
          <input className="border p-2" type="date" value={f.available_for_use_date} onChange={(e) => set('available_for_use_date', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">تكلفة الاقتناء (د.ع) *</span>
          <input className="border p-2" type="number" value={f.acquisition_cost} onChange={(e) => set('acquisition_cost', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">التكاليف الإضافية (د.ع)</span>
          <input className="border p-2" type="number" value={f.additional_costs} onChange={(e) => set('additional_costs', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">
            العمر الإنتاجي (شهر){cat ? ` — افتراضي التصنيف: ${cat.useful_life_months ?? '—'}` : ''}
          </span>
          <input className="border p-2" type="number" value={f.useful_life_months}
            placeholder={cat?.useful_life_months ? String(cat.useful_life_months) : ''}
            onChange={(e) => set('useful_life_months', e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">طريقة الإهلاك (من التصنيف)</span>
          <input className="border p-2 bg-gray-100" readOnly value={cat ? label(DEP_METHOD, cat.depreciation_method) : '—'} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الموقع</span>
          <select className="border p-2" value={f.location_id} onChange={(e) => set('location_id', e.target.value)}>
            <option value="">— بدون —</option>
            {locations.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">العهدة (المستخدم)</span>
          <select className="border p-2" value={f.custodian_user_id} onChange={(e) => set('custodian_user_id', e.target.value)}>
            <option value="">— بدون —</option>
            {custodians.map((c: any) => <option key={c.id} value={c.id}>{c.full_name || c.username}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">القسم</span>
          <select className="border p-2" value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">— بدون —</option>
            {departments.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-500">الفترة المحاسبية *</span>
          <select className="border p-2" value={f.fiscal_period_id} onChange={(e) => set('fiscal_period_id', e.target.value)}>
            <option value="">— اختر —</option>
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name_ar || p.code || `${p.start_date} → ${p.end_date}`}
              </option>
            ))}
          </select>
        </label>

        {f.acquisition_type === 'OPENING' && (
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">مجمع الإهلاك الافتتاحي (د.ع)</span>
            <input className="border p-2" type="number" value={f.opening_accumulated_depreciation}
              onChange={(e) => set('opening_accumulated_depreciation', e.target.value)} />
          </label>
        )}
        {f.acquisition_type === 'DONATION' && (
          <label className="grid gap-1">
            <span className="text-xs text-gray-500">حساب مقابل التبرّع (إيراد)</span>
            <select className="border p-2" value={f.donation_contra_gl_account_id}
              onChange={(e) => set('donation_contra_gl_account_id', e.target.value)}>
              <option value="">— بدون قيد اقتناء —</option>
              {donationAccounts.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
            </select>
          </label>
        )}

        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs text-gray-500">الوصف</span>
          <textarea className="border p-2" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        <div className="md:col-span-2 grid grid-cols-3 gap-2 bg-gray-50 rounded p-3 text-center">
          <div><p className="text-xs text-gray-500">التكلفة المرسملة (تقديري)</p><p className="font-bold">{iqd(estimate.capitalized)}</p></div>
          <div><p className="text-xs text-gray-500">القيمة المتبقية (تقديري)</p><p className="font-bold">{iqd(estimate.salvage)}</p></div>
          <div><p className="text-xs text-gray-500">المبلغ القابل للإهلاك (تقديري)</p><p className="font-bold">{iqd(estimate.depreciable)}</p></div>
          <p className="col-span-3 text-xs text-gray-400">القيم النهائية تُحسب في الخادم. تجاوز حد الرسملة يُطبَّق عند تفعيل الأصل.</p>
        </div>
      </div>

      {msg && <p className="text-red-600 text-sm mt-3">{msg}</p>}
      <div className="mt-3">
        <button className="bg-red-800 text-white rounded px-4 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={() => void save()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ مسودة'}
        </button>
      </div>
    </main>
  );
}
