'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import {
  API,
  ACQUISITION_TYPE,
  ASSET_STATUS,
  CAP,
  DEP_METHOD,
  DISPOSAL_TYPE,
  DOC_STATUS,
  MOVEMENT_TYPE,
  StatusBadge,
  can,
  errMsg,
  fetchJson,
  iqd,
  label,
} from '../../_lib';

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-left">{v ?? '—'}</span>
    </div>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<any>();
  const [opts, setOpts] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [custody, setCustody] = useState<any[]>([]);
  const [disposals, setDisposals] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | 'cancel' | 'activate' | null>(null);
  const [reason, setReason] = useState('');
  const [equityGl, setEquityGl] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson(`${API.assets}/${id}`);
    if (!r.success) return setError(errMsg(r));
    setA(r.data);
  };

  useEffect(() => {
    (async () => {
      const [o, mv, cu, dp] = await Promise.all([
        fetchJson(API.options),
        fetchJson(`${API.movements}?fixed_asset_id=${id}&page_size=50`),
        fetchJson(`${API.custodyHistory}?asset_id=${id}`),
        fetchJson(`${API.disposals}?fixed_asset_id=${id}&page_size=50`),
      ]);
      setOpts(o?.data);
      setCaps(o?.data?.capabilities ?? []);
      setMovements(Array.isArray(mv?.data) ? mv.data : []);
      setCustody(Array.isArray(cu?.data) ? cu.data : Array.isArray(cu?.data?.history) ? cu.data.history : []);
      setDisposals(Array.isArray(dp?.data) ? dp.data : []);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const categories = opts?.categories ?? [];
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];
  const departments = opts?.departments ?? [];
  const equityAccounts = opts?.equity_accounts ?? opts?.gl_accounts ?? [];
  const nameOf = (list: any[], v: string) =>
    list.find((x) => x.id === v)?.name_ar || list.find((x) => x.id === v)?.full_name ||
    list.find((x) => x.id === v)?.username || '—';

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setActErr(null);
    try {
      const r = await fetchJson(`${API.assets}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: a.version, updated_at: a.updated_at, ...body }),
      });
      if (!r.success) { setActErr(errMsg(r)); return; }
      setDialog(null);
      setReason('');
      setOverride(false);
      setOverrideReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main dir="rtl" className="p-6 max-w-5xl mx-auto"><FixedAssetsNav /><p className="text-red-600">{error}</p></main>;
  if (!a) return <main dir="rtl" className="p-6 max-w-5xl mx-auto"><FixedAssetsNav /><p className="text-gray-500">جارٍ التحميل…</p></main>;

  const timeline: Array<[string, any]> = [
    ['أُنشئ', a.created_at],
    ['فُعِّل', a.activated_at],
    ['أُوقف', a.suspended_at],
    ['أُلغي', a.cancelled_at],
    ['استُبعد', a.disposed_at],
  ];
  const needsEquity = a.acquisition_type === 'MANUAL' || a.acquisition_type === 'OPENING';

  return (
    <main dir="rtl" className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-start mb-2 gap-3">
        <div>
          <h1 className="text-xl font-bold font-mono">{a.asset_number}</h1>
          <p className="text-gray-600">{a.name_ar} · <StatusBadge status={a.status} map={ASSET_STATUS} /></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="border rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/assets/${id}/print`}>
            طباعة بطاقة الأصل
          </Link>
          {can(caps, CAP.MOVEMENT_PREPARE) && ['ACTIVE', 'SUSPENDED'].includes(a.status) && (
            <Link className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/movements/new?asset_id=${id}`}>
              حركة جديدة
            </Link>
          )}
          {can(caps, CAP.DISPOSAL_PREPARE) && ['ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED'].includes(a.status) && (
            <Link className="bg-purple-700 text-white rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/disposals/new?asset_id=${id}`}>
              استبعاد
            </Link>
          )}
        </div>
      </div>
      <FixedAssetsNav />

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-white shadow rounded p-4 text-sm">
          <h2 className="font-bold mb-2">بيانات الأصل</h2>
          <Row k="الباركود" v={a.barcode_value} />
          <Row k="الرقم التسلسلي" v={a.serial_number} />
          <Row k="التصنيف" v={nameOf(categories, a.category_id)} />
          <Row k="نوع الاقتناء" v={label(ACQUISITION_TYPE, a.acquisition_type)} />
          <Row k="تاريخ الاقتناء" v={a.acquisition_date} />
          <Row k="الجاهزية للاستخدام" v={a.available_for_use_date} />
          <Row k="الوصف" v={a.description} />
        </section>

        <section className="bg-white shadow rounded p-4 text-sm">
          <h2 className="font-bold mb-2">القيم المالية</h2>
          <Row k="التكلفة المرسملة" v={iqd(a.capitalized_cost)} />
          <Row k="القيمة المتبقية" v={iqd(a.salvage_value)} />
          <Row k="المبلغ القابل للإهلاك" v={iqd(a.depreciable_amount)} />
          <Row k="العمر الإنتاجي (شهر)" v={a.useful_life_months ?? '—'} />
          <Row k="طريقة الإهلاك" v={label(DEP_METHOD, a.depreciation_method)} />
          <Row k="مجمع الإهلاك" v={iqd(a.accumulated_depreciation)} />
          <Row k="القيمة الدفترية الصافية" v={iqd(a.net_book_value)} />
          <Row k="آخر إهلاك" v={a.last_depreciation_date ?? '—'} />
        </section>

        <section className="bg-white shadow rounded p-4 text-sm">
          <h2 className="font-bold mb-2">الموقع والعهدة</h2>
          <Row k="الموقع الحالي" v={nameOf(locations, a.location_id)} />
          <Row k="العهدة" v={nameOf(custodians, a.custodian_user_id)} />
          <Row k="القسم" v={nameOf(departments, a.department_id)} />
        </section>

        <section className="bg-white shadow rounded p-4 text-sm">
          <h2 className="font-bold mb-2">مصدر الاقتناء</h2>
          <Row k="المورد" v={a.supplier_id ? (
            <Link className="text-blue-600" href={`/accounts/suppliers/${a.supplier_id}`}>{a.supplier_name_ar || a.supplier_id}</Link>
          ) : '—'} />
          <Row k="أمر الشراء" v={a.purchase_order_id ? (
            <Link className="text-blue-600" href={`/accounts/purchasing/orders/${a.purchase_order_id}`}>عرض الأمر</Link>
          ) : '—'} />
          <Row k="سطر أمر الشراء" v={a.purchase_order_line_id ?? '—'} />
          <Row k="قيد الاقتناء" v={a.acquisition_journal_entry_id ? (
            <Link className="text-blue-600" href={`/accounts/entries/${a.acquisition_journal_entry_id}`}>عرض القيد</Link>
          ) : '—'} />
          {a.override_capitalization_threshold && (
            <Row k="تجاوز حد الرسملة" v={a.override_threshold_reason || 'نعم'} />
          )}
        </section>
      </div>

      {/* أزرار الإجراءات */}
      <section className="bg-white shadow rounded p-4 mt-4 flex flex-wrap gap-2">
        {a.status === 'DRAFT' && can(caps, CAP.ASSET_ACTIVATE) && (
          <button className="bg-green-700 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setActErr(null); setDialog('activate'); }}>تفعيل</button>
        )}
        {a.status === 'ACTIVE' && can(caps, CAP.ASSET_SUSPEND) && (
          <button className="bg-amber-600 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setActErr(null); setDialog('suspend'); }}>إيقاف</button>
        )}
        {a.status === 'SUSPENDED' && can(caps, CAP.ASSET_SUSPEND) && (
          <button className="bg-green-700 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setActErr(null); setDialog('reactivate'); }}>إعادة تفعيل</button>
        )}
        {a.status === 'DRAFT' && can(caps, CAP.ASSET_CANCEL) && (
          <button className="bg-red-700 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setActErr(null); setDialog('cancel'); }}>إلغاء</button>
        )}
      </section>

      {/* الخط الزمني */}
      <section className="bg-white shadow rounded p-4 mt-4 text-sm">
        <h2 className="font-bold mb-2">الخط الزمني</h2>
        <ul className="space-y-1">
          {timeline.filter(([, v]) => v).map(([k, v]) => (
            <li key={k} className="flex justify-between border-b py-1">
              <span className="text-gray-500">{k}</span>
              <span>{new Date(v).toLocaleString('en-GB')}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* الحركات */}
      <section className="bg-white shadow rounded overflow-hidden mt-4">
        <div className="p-3 border-b font-bold text-sm">سجل الحركات والعهدة</div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-2">الرقم</th><th>النوع</th><th>التاريخ</th><th>إلى موقع</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="p-2"><Link className="text-blue-600" href={`/accounts/fixed-assets/movements/${m.id}`}>{m.movement_number}</Link></td>
                <td>{label(MOVEMENT_TYPE, m.movement_type)}</td>
                <td>{m.movement_date}</td>
                <td>{nameOf(locations, m.to_location_id)}</td>
                <td><StatusBadge status={m.status} map={DOC_STATUS} /></td>
              </tr>
            ))}
            {!movements.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا حركات</td></tr>}
          </tbody>
        </table>
        {custody.length > 0 && (
          <div className="p-3 border-t">
            <p className="text-xs text-gray-500 mb-1">تاريخ العهدة</p>
            <ul className="text-sm space-y-1">
              {custody.map((h: any, i: number) => (
                <li key={i} className="flex justify-between border-b py-1">
                  <span>{h.custodian_name || nameOf(custodians, h.custodian_user_id)}</span>
                  <span className="text-gray-500">{h.location_name || nameOf(locations, h.location_id)}</span>
                  <span className="text-gray-400">{h.from_date} → {h.to_date || 'الآن'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* الاستبعاد */}
      {disposals.length > 0 && (
        <section className="bg-white shadow rounded overflow-hidden mt-4">
          <div className="p-3 border-b font-bold text-sm">سجل الاستبعاد</div>
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr><th className="p-2">الرقم</th><th>النوع</th><th>التاريخ</th><th>القيمة الدفترية</th><th>ربح/خسارة</th><th>الحالة</th></tr>
            </thead>
            <tbody>
              {disposals.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="p-2"><Link className="text-blue-600" href={`/accounts/fixed-assets/disposals/${d.id}`}>{d.disposal_number}</Link></td>
                  <td>{label(DISPOSAL_TYPE, d.disposal_type)}</td>
                  <td>{d.disposal_date}</td>
                  <td>{iqd(d.net_book_value)}</td>
                  <td>{iqd(d.gain_loss_amount)}</td>
                  <td><StatusBadge status={d.status} map={DOC_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-gray-400 mt-4">
        سجل الإهلاك التفصيلي لكل أصل متاح ضمن دورات الإهلاك. مجمع الإهلاك الحالي: {iqd(a.accumulated_depreciation)}.
      </p>

      {/* حوارات */}
      <ConfirmDialog
        open={dialog === 'suspend'}
        title="إيقاف الأصل"
        message={<><p>سبب الإيقاف (اختياري):</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>}
        confirmLabel="إيقاف" danger busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('suspend', { reason: reason || undefined })}
      />
      <ConfirmDialog
        open={dialog === 'reactivate'}
        title="إعادة تفعيل الأصل"
        message="هل تريد إعادة تفعيل هذا الأصل؟"
        confirmLabel="إعادة تفعيل" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('reactivate')}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="إلغاء الأصل"
        message={<><p>سبب الإلغاء (اختياري):</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>}
        confirmLabel="إلغاء الأصل" danger busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('cancel', { reason: reason || undefined })}
      />
      <ConfirmDialog
        open={dialog === 'activate'}
        title="تفعيل الأصل"
        message={
          <div className="space-y-2">
            <p>سيتم تفعيل الأصل وإنشاء قيد الاقتناء عند اللزوم.</p>
            {needsEquity && (
              <label className="grid gap-1">
                <span className="text-xs text-gray-500">حساب حقوق الملكية الافتتاحي *</span>
                <select className="border p-2" value={equityGl} onChange={(e) => setEquityGl(e.target.value)}>
                  <option value="">— اختر —</option>
                  {equityAccounts.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              </label>
            )}
            {can(caps, CAP.ASSET_THRESHOLD_OVERRIDE) && (
              <label className="flex items-start gap-2 border rounded p-2 bg-amber-50">
                <input type="checkbox" className="mt-1" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                <span>
                  <strong>تجاوز حد الرسملة</strong>
                  {override && (
                    <textarea className="border w-full mt-2 p-2 text-sm" placeholder="سبب التجاوز *"
                      value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                  )}
                </span>
              </label>
            )}
          </div>
        }
        confirmLabel="تفعيل" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('activate', {
          opening_equity_gl_account_id: needsEquity ? equityGl || undefined : undefined,
          override_capitalization_threshold: override || undefined,
          override_threshold_reason: override ? overrideReason || undefined : undefined,
        })}
      />
    </main>
  );
}
