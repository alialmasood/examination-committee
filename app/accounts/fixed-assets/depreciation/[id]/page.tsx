'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import FixedAssetsNav from '../../FixedAssetsNav';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import { API, CAP, DOC_STATUS, StatusBadge, can, errMsg, fetchJson, iqd } from '../../_lib';

export default function DepreciationRunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<any>();
  const [lines, setLines] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'calculate' | 'post' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson(`${API.depreciationRuns}/${id}`);
    if (!r.success) return setError(errMsg(r));
    setRun(r.data?.run ?? r.data);
    setLines(Array.isArray(r.data?.lines) ? r.data.lines : Array.isArray(r.data?.run?.lines) ? r.data.run.lines : []);
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
      const r = await fetchJson(`${API.depreciationRuns}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: run.version, updated_at: run.updated_at, ...body }),
      });
      if (!r.success) { setActErr(errMsg(r)); return; }
      setDialog(null);
      setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main dir="rtl" className="p-6 max-w-5xl mx-auto"><FixedAssetsNav /><p className="text-red-600">{error}</p></main>;
  if (!run) return <main dir="rtl" className="p-6 max-w-5xl mx-auto"><FixedAssetsNav /><p className="text-gray-500">جارٍ التحميل…</p></main>;

  return (
    <main dir="rtl" className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold font-mono">{run.run_number}</h1>
        <Link className="border rounded px-3 py-1.5 text-sm" href={`/accounts/fixed-assets/depreciation/${id}/print`}>
          طباعة تقرير الإهلاك
        </Link>
      </div>
      <FixedAssetsNav />

      <section className="bg-white shadow rounded p-4 text-sm space-y-1 mb-4">
        <p><StatusBadge status={run.status} map={DOC_STATUS} /> · الفترة {run.period_start} → {run.period_end}</p>
        <p>عدد الأصول: {run.asset_count} · إجمالي الإهلاك: <b>{iqd(run.total_depreciation)}</b></p>
        <p>رقم القيد: {run.journal_entry_id ? (
          <Link className="text-blue-600" href={`/accounts/entries/${run.journal_entry_id}`}>عرض القيد</Link>
        ) : '—'}</p>
        {run.reversal_journal_entry_id && (
          <p>قيد العكس: <Link className="text-blue-600" href={`/accounts/entries/${run.reversal_journal_entry_id}`}>عرض</Link></p>
        )}
        {run.notes && <p>ملاحظات: {run.notes}</p>}
        {run.void_reason && <p className="text-red-600">سبب الإلغاء: {run.void_reason}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          {run.status === 'DRAFT' && can(caps, CAP.DEP_PREPARE) && (
            <button className="bg-blue-600 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('calculate'); }}>إعادة الحساب</button>
          )}
          {run.status === 'DRAFT' && can(caps, CAP.DEP_POST) && (
            <button className="bg-green-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('post'); }}>ترحيل</button>
          )}
          {run.status === 'POSTED' && can(caps, CAP.DEP_VOID) && (
            <button className="bg-red-700 text-white px-3 py-1.5 rounded" onClick={() => { setActErr(null); setDialog('void'); }}>إلغاء</button>
          )}
        </div>
      </section>

      <section className="bg-white shadow rounded overflow-hidden">
        <div className="p-3 border-b font-bold text-sm">سطور الإهلاك</div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="p-2">الأصل</th>
              <th>مجمع افتتاحي</th>
              <th>إهلاك الفترة</th>
              <th>مجمع ختامي</th>
              <th>القيمة الدفترية</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.asset_number} — {l.asset_name}</td>
                <td>{iqd(l.opening_accumulated)}</td>
                <td>{iqd(l.depreciation_amount)}</td>
                <td>{iqd(l.closing_accumulated)}</td>
                <td>{iqd(l.net_book_value)}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا سطور</td></tr>}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t bg-gray-50 font-semibold">
                <td className="p-2">الإجمالي</td>
                <td></td>
                <td>{iqd(run.total_depreciation)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <ConfirmDialog
        open={dialog === 'calculate'}
        title="إعادة حساب الدورة"
        message="سيُعاد احتساب سطور الإهلاك للأصول المؤهّلة في الفترة."
        confirmLabel="حساب" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('calculate')}
      />
      <ConfirmDialog
        open={dialog === 'post'}
        title="ترحيل دورة الإهلاك"
        message="سيتم إنشاء قيد الإهلاك وتحديث مجمع الإهلاك للأصول. هل تريد المتابعة؟"
        confirmLabel="ترحيل" busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('post')}
      />
      <ConfirmDialog
        open={dialog === 'void'}
        title="إلغاء دورة الإهلاك"
        message={<><p>سبب الإلغاء:</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>}
        confirmLabel="إلغاء" danger busy={busy} error={actErr}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('void', { reason: reason || undefined })}
      />
    </main>
  );
}
