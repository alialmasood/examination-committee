'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import { API, CAP, DISPOSAL_TYPE, DOC_STATUS, StatusBadge, can, errMsg, fetchJson, iqd, label } from '../../_lib';

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-left">{v ?? '—'}</span>
    </div>
  );
}

export default function DisposalDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>();
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'post' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson(`${API.disposals}/${id}`);
    if (!r.success) return setError(errMsg(r));
    setD(r.data);
  };

  useEffect(() => {
    fetchJson(API.options).then((o) => setCaps(o?.data?.capabilities ?? []));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setActErr(null);
    try {
      const r = await fetchJson(`${API.disposals}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: d.version, updated_at: d.updated_at, ...body }),
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
  if (!d) return <main dir="rtl" className="p-6 max-w-4xl mx-auto"><FixedAssetsNav /><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-4 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold font-mono">{d.disposal_number}</h1>
        <Link className="border rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/disposals/${id}/print`}>
          طباعة تقرير الاستبعاد
        </Link>
      </div>
      <FixedAssetsNav />

      <section className="bg-white shadow rounded p-4 text-sm">
        <p className="mb-2"><StatusBadge status={d.status} map={DOC_STATUS} /> · {label(DISPOSAL_TYPE, d.disposal_type)} · {d.disposal_date}</p>
        <Row k="التكلفة الأصلية" v={iqd(d.disposal_cost)} />
        <Row k="مجمع الإهلاك" v={iqd(d.accumulated_depreciation)} />
        <Row k="القيمة الدفترية الصافية" v={iqd(d.net_book_value)} />
        <Row k="المتحصلات" v={iqd(d.proceeds_amount)} />
        <Row k="الربح / الخسارة" v={<span className={Number(d.gain_loss_amount) < 0 ? 'text-red-700' : 'text-green-700'}>{iqd(d.gain_loss_amount)}</span>} />
        <Row k="اسم المشتري" v={d.buyer_name} />
        <Row k="السبب" v={d.reason} />
        <Row k="قيد الاستبعاد" v={d.journal_entry_id ? (
          <Link className="text-blue-600" href={`/accounts/entries/${d.journal_entry_id}`}>عرض القيد</Link>
        ) : '—'} />
        {d.reversal_journal_entry_id && (
          <Row k="قيد العكس" v={<Link className="text-blue-600" href={`/accounts/entries/${d.reversal_journal_entry_id}`}>عرض</Link>} />
        )}
        {d.void_reason && <p className="text-red-600 mt-2">سبب الإلغاء: {d.void_reason}</p>}

        <div className="flex flex-wrap gap-2 pt-3">
          {d.status === 'DRAFT' && can(caps, CAP.DISPOSAL_POST) && (
            <button className="bg-green-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('post'); }}>ترحيل</button>
          )}
          {d.status === 'POSTED' && can(caps, CAP.DISPOSAL_VOID) && (
            <button className="bg-red-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('void'); }}>إلغاء</button>
          )}
          <Link className="text-blue-600 px-2 py-1.5" href={`/accounts/fixed-assets/assets/${d.fixed_asset_id}`}>عرض الأصل</Link>
        </div>
      </section>

      <ConfirmDialog
        open={dialog === 'post'}
        title="ترحيل الاستبعاد"
        message="سيتم إنشاء قيد الاستبعاد وتحديث حالة الأصل إلى مستبعد. هل تريد المتابعة؟"
        confirmLabel="ترحيل" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('post')}
      />
      <ConfirmDialog
        open={dialog === 'void'}
        title="إلغاء الاستبعاد"
        message={<><p>سبب الإلغاء:</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>}
        confirmLabel="إلغاء" danger busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('void', { reason: reason || undefined })}
      />
    </main>
  );
}
