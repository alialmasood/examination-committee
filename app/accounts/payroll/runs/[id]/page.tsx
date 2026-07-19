'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PayrollNav from '../../PayrollNav';
import {
  API,
  CAP,
  RUN_STATUS,
  RUN_TYPE,
  SCOPE_TYPE,
  StatusBadge,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  iqd,
  label,
  runUrl,
  runCancelUrl,
  runScopeUrl,
  runScopeMemberUrl,
} from '../../_lib';

export default function RunDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [run, setRun] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [options, setOptions] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [formErr, setFormErr] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [addPerson, setAddPerson] = useState('');

  const load = async () => {
    const r = await fetchJson(runUrl(id));
    if (!r.success) return setError(errMsg(r));
    setError('');
    setRun(r.data?.run ?? null);
    setMembers(Array.isArray(r.data?.scope_members) ? r.data.scope_members : []);
  };

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) return setError(errMsg(o));
      setCaps(o?.data?.capabilities ?? []);
      setOptions(o?.data ?? null);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const create = can(caps, CAP.CREATE_RUNS);
  const cancelCap = can(caps, CAP.CANCEL_RUNS);
  const departments: any[] = options?.departments ?? [];
  const costCenters: any[] = options?.cost_centers ?? [];
  const activePeople: any[] = options?.active_people ?? [];
  const memberIds = useMemo(() => new Set(members.map((m) => m.payroll_person_id)), [members]);
  const availablePeople = activePeople.filter((p) => !memberIds.has(p.id));

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  function openEdit() {
    if (!run) return;
    setForm({ run_type: run.run_type, scope_type: run.scope_type, scope_ref_id: run.scope_ref_id ?? '' });
    setFormErr('');
    setEditOpen(true);
  }

  const editNeedsRef = form.scope_type === 'COLLEGE' || form.scope_type === 'DEPARTMENT' || form.scope_type === 'COST_CENTER';

  async function saveEdit() {
    setBusy(true);
    setFormErr('');
    try {
      const payload: any = {
        run_type: form.run_type,
        scope_type: form.scope_type,
        scope_ref_id: editNeedsRef ? form.scope_ref_id : null,
        version: run.version,
        updated_at: run.updated_at,
      };
      const r = await fetchJson(runUrl(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) return setFormErr(errMsg(r));
      setEditOpen(false);
      await load();
    } finally { setBusy(false); }
  }

  async function doCancel() {
    setBusy(true);
    try {
      const r = await fetchJson(runCancelUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, version: run.version, updated_at: run.updated_at }),
      });
      if (!r.success) setError(errMsg(r));
      setCancelOpen(false); setReason('');
      await load();
    } finally { setBusy(false); }
  }

  async function addMember() {
    if (!addPerson) return;
    setBusy(true);
    try {
      const r = await fetchJson(runScopeUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payroll_person_id: addPerson, version: run.version, updated_at: run.updated_at }),
      });
      if (!r.success) { setError(errMsg(r)); }
      else { setRun(r.data.run); setMembers(r.data.scope_members); setAddPerson(''); }
    } finally { setBusy(false); }
  }

  async function removeMember(personId: string) {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ version: String(run.version), updated_at: String(run.updated_at) });
      const r = await fetchJson(`${runScopeMemberUrl(id, personId)}?${qs.toString()}`, { method: 'DELETE' });
      if (!r.success) { setError(errMsg(r)); }
      else { setRun(r.data.run); setMembers(r.data.scope_members); }
    } finally { setBusy(false); }
  }

  if (error && !run) return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-red-600 text-sm">{error}</p></main>
  );
  if (!run) return <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-gray-400 text-sm">جارٍ التحميل…</p></main>;

  const isDraft = run.status === 'DRAFT';
  const canEdit = create && isDraft;
  const canScope = create && isDraft && run.scope_type === 'PERSON_LIST';
  const canCancel = cancelCap && (run.status === 'DRAFT' || run.status === 'CALCULATED');
  const scopeRefName = run.scope_ref_id
    ? (run.scope_type === 'COST_CENTER'
        ? (costCenters.find((c) => c.id === run.scope_ref_id)?.name_ar ?? run.scope_ref_id)
        : (departments.find((d) => d.id === run.scope_ref_id)?.name_ar ?? run.scope_ref_id))
    : '—';

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <PayrollNav />
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      <div className="flex justify-between items-center mb-4">
        <div>
          <Link href="/accounts/payroll/runs" className="text-blue-600 text-sm">→ عودة للتشغيلات</Link>
          <h1 className="text-xl font-bold mt-1">تشغيل <span className="font-mono text-gray-600">{run.run_number}</span></h1>
        </div>
        <StatusBadge status={run.status} map={RUN_STATUS} />
      </div>

      <div className="bg-white shadow rounded p-4 grid md:grid-cols-2 gap-3 text-sm mb-4">
        <div><span className="text-gray-500">الفترة:</span> <Link className="text-blue-600" href={`/accounts/payroll/periods/${run.payroll_period_id}`}>عرض الفترة</Link></div>
        <div><span className="text-gray-500">النوع:</span> {label(RUN_TYPE, run.run_type)}</div>
        <div><span className="text-gray-500">النطاق:</span> {label(SCOPE_TYPE, run.scope_type)}{run.scope_ref_id ? ` — ${scopeRefName}` : ''}</div>
        <div><span className="text-gray-500">العملة:</span> {run.currency_code}</div>
        <div><span className="text-gray-500">تاريخ الاحتساب:</span> {run.calculation_date}</div>
        <div><span className="text-gray-500">رقم الإصدار:</span> {run.revision_number}</div>
        <div><span className="text-gray-500">الإصدار (تزامن):</span> {run.version}</div>
        {run.cancellation_reason && <div className="md:col-span-2"><span className="text-gray-500">سبب الإلغاء:</span> {run.cancellation_reason}</div>}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800 mb-4">
        محرك الاحتساب سيُفعّل في المرحلة التالية — الإجماليات أدناه صفرية حالياً.
      </div>

      <div className="bg-white shadow rounded p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-6">
        <div><p className="text-gray-500 text-xs">عدد الأشخاص</p><p className="font-bold">{run.people_count ?? 0}</p></div>
        <div><p className="text-gray-500 text-xs">إجمالي الاستحقاقات</p><p className="font-bold">{iqd(run.gross_total)}</p></div>
        <div><p className="text-gray-500 text-xs">إجمالي الاستقطاعات</p><p className="font-bold">{iqd(run.deduction_total)}</p></div>
        <div><p className="text-gray-500 text-xs">مساهمات جهة العمل</p><p className="font-bold">{iqd(run.employer_contribution_total)}</p></div>
        <div><p className="text-gray-500 text-xs">الصافي</p><p className="font-bold">{iqd(run.net_total)}</p></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {canEdit && <button className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" onClick={openEdit}>تعديل</button>}
        {canCancel && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={() => { setReason(''); setCancelOpen(true); }}>إلغاء التشغيل</button>}
      </div>

      {run.scope_type === 'PERSON_LIST' && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">أعضاء النطاق ({members.length})</h2>
          {canScope && (
            <div className="flex gap-2 mb-3 text-sm">
              <select className="border rounded p-1.5 flex-1" value={addPerson} onChange={(e) => setAddPerson(e.target.value)}>
                <option value="">— اختر شخصاً لإضافته —</option>
                {availablePeople.map((p) => <option key={p.id} value={p.id}>{p.person_code} — {p.full_name_ar}</option>)}
              </select>
              <button className="bg-red-800 text-white rounded px-3 py-1.5 disabled:opacity-50" disabled={busy || !addPerson} onClick={() => void addMember()}>إضافة</button>
            </div>
          )}
          <table className="w-full bg-white shadow rounded text-sm text-right">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="p-2">الرمز</th><th>الاسم</th><th>الحالة</th>{canScope && <th></th>}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-2 font-mono">{m.person_code}</td>
                  <td>{m.full_name_ar}</td>
                  <td>{m.person_status}</td>
                  {canScope && <td><button className="text-red-700" disabled={busy} onClick={() => void removeMember(m.payroll_person_id)}>إزالة</button></td>}
                </tr>
              ))}
              {!members.length && <tr><td colSpan={canScope ? 4 : 3} className="p-3 text-gray-400">لا أعضاء</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5 my-8" dir="rtl">
            <h3 className="text-lg font-semibold mb-3">تعديل التشغيل</h3>
            <div className="grid gap-3 text-sm">
              <label className="grid gap-1"><span className="text-xs text-gray-500">نوع التشغيل</span>
                <select className="border p-2" value={form.run_type} onChange={(e) => set('run_type', e.target.value)}>
                  {Object.entries(RUN_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="grid gap-1"><span className="text-xs text-gray-500">النطاق</span>
                <select className="border p-2" value={form.scope_type} onChange={(e) => { set('scope_type', e.target.value); set('scope_ref_id', ''); }}>
                  {Object.entries(SCOPE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              {editNeedsRef && (
                <label className="grid gap-1"><span className="text-xs text-gray-500">مرجع النطاق</span>
                  <select className="border p-2" value={form.scope_ref_id} onChange={(e) => set('scope_ref_id', e.target.value)}>
                    <option value="">— اختر —</option>
                    {(form.scope_type === 'COST_CENTER' ? costCenters : departments).map((x) => <option key={x.id} value={x.id}>{x.name_ar}</option>)}
                  </select></label>
              )}
            </div>
            {formErr && <p className="text-red-600 text-sm mt-3">{formErr}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="border rounded px-3 py-2 text-sm" disabled={busy} onClick={() => setEditOpen(false)}>إلغاء</button>
              <button className="bg-red-800 text-white rounded px-3 py-2 text-sm" disabled={busy} onClick={() => void saveEdit()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title="إلغاء التشغيل"
        message={`هل أنت متأكد من إلغاء التشغيل «${run.run_number}»؟`}
        busy={busy}
        reasonRequired
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => { setCancelOpen(false); setReason(''); }}
        onConfirm={() => void doCancel()}
      />
    </main>
  );
}
