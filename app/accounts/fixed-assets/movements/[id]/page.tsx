'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import { API, CAP, DOC_STATUS, MOVEMENT_TYPE, StatusBadge, can, errMsg, fetchJson, label } from '../../_lib';

export default function MovementDetail() {
  const { id } = useParams<{ id: string }>();
  const [m, setM] = useState<any>();
  const [opts, setOpts] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'post' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson(`${API.movements}/${id}`);
    if (!r.success) return setError(errMsg(r));
    setM(r.data);
  };

  useEffect(() => {
    fetchJson(API.options).then((o) => { setOpts(o?.data); setCaps(o?.data?.capabilities ?? []); });
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const nameOf = (list: any[], v: string) =>
    (list || []).find((x) => x.id === v)?.name_ar || (list || []).find((x) => x.id === v)?.full_name ||
    (list || []).find((x) => x.id === v)?.username || '—';
  const locations = opts?.locations ?? [];
  const custodians = opts?.custodians ?? opts?.custodian_users ?? [];
  const departments = opts?.departments ?? [];

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setActErr(null);
    try {
      const r = await fetchJson(`${API.movements}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: m.version, updated_at: m.updated_at, ...body }),
      });
      if (!r.success) { setActErr(errMsg(r)); return; }
      setDialog(null);
      setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main dir="rtl" className="p-6 max-w-4xl mx-auto"><FixedAssetsNav /><p className="text-red-600">{error}</p></main>;
  if (!m) return <main dir="rtl" className="p-6 max-w-4xl mx-auto"><FixedAssetsNav /><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold font-mono">{m.movement_number}</h1>
        <Link className="border rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/movements/${id}/print`}>
          طباعة محضر تسليم العهدة
        </Link>
      </div>
      <FixedAssetsNav />

      <section className="bg-white shadow rounded p-4 text-sm space-y-2">
        <p>
          <StatusBadge status={m.status} map={DOC_STATUS} /> · {label(MOVEMENT_TYPE, m.movement_type)} · {m.movement_date}
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="border rounded p-2">
            <p className="font-semibold mb-1">من</p>
            <p>الموقع: {nameOf(locations, m.from_location_id)}</p>
            <p>القسم: {nameOf(departments, m.from_department_id)}</p>
            <p>العهدة: {nameOf(custodians, m.from_custodian_user_id)}</p>
          </div>
          <div className="border rounded p-2">
            <p className="font-semibold mb-1">إلى</p>
            <p>الموقع: {nameOf(locations, m.to_location_id)}</p>
            <p>القسم: {nameOf(departments, m.to_department_id)}</p>
            <p>العهدة: {nameOf(custodians, m.to_custodian_user_id)}</p>
          </div>
        </div>
        <p>السبب: {m.reason || '—'}</p>
        <p>ملاحظات: {m.notes || '—'}</p>
        {m.void_reason && <p className="text-red-600">سبب الإلغاء: {m.void_reason}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          {m.status === 'DRAFT' && can(caps, CAP.MOVEMENT_POST) && (
            <button className="bg-green-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('post'); }}>ترحيل</button>
          )}
          {m.status === 'POSTED' && can(caps, CAP.MOVEMENT_VOID) && (
            <button className="bg-red-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('void'); }}>إلغاء</button>
          )}
          <Link className="text-blue-600 px-2 py-1.5" href={`/accounts/fixed-assets/assets/${m.fixed_asset_id}`}>عرض الأصل</Link>
        </div>
      </section>

      <ConfirmDialog
        open={dialog === 'post'}
        title="ترحيل الحركة"
        message="سيتم تحديث موقع/عهدة/قسم الأصل وكتابة سجل العهدة. هل تريد المتابعة؟"
        confirmLabel="ترحيل" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('post')}
      />
      <ConfirmDialog
        open={dialog === 'void'}
        title="إلغاء الحركة"
        message={<><p>سبب الإلغاء:</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>}
        confirmLabel="إلغاء" danger busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('void', { reason: reason || undefined })}
      />
    </main>
  );
}
