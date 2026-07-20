'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PayrollNav from '../../PayrollNav';
import {
  API,
  CAP,
  COMPONENT_TYPE,
  RUN_STATUS,
  RUN_TYPE,
  SCOPE_TYPE,
  PERSON_CALC_STATUS,
  StatusBadge,
  ConfirmDialog,
  can,
  errMsg,
  fetchJson,
  iqdWhole,
  label,
  runUrl,
  runCancelUrl,
  runCalculateUrl,
  runRecalculateUrl,
  runRecalculationsUrl,
  runPeopleUrl,
  runPersonDetailUrl,
  runScopeUrl,
  runScopeMemberUrl,
} from '../../_lib';

type PeopleFilter = 'ALL' | 'CALCULATED' | 'ERROR' | 'EXCLUDED';

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `calc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function calcErrorMsg(r: any): string {
  if (r?.__status === 409) {
    return 'تم تعديل تشغيل الرواتب أو احتسابه بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 422) {
    return 'تعذر بدء الاحتساب بسبب إعدادات تشغيل الرواتب.';
  }
  if (r?.__status === 403) {
    return 'ليس لديك صلاحية احتساب الرواتب.';
  }
  if (r?.__status === 500) {
    return 'حدث خطأ تقني أثناء احتساب الرواتب. لم يتم حفظ نتائج جزئية.';
  }
  return errMsg(r);
}

function recalcErrorMsg(r: any): string {
  const code = r?.error?.code;
  if (r?.__status === 400 || code === 'INVALID_REASON') {
    return 'يرجى كتابة سبب واضح لإعادة الاحتساب لا يقل عن 10 أحرف.';
  }
  if (r?.__status === 403 || code === 'FORBIDDEN') {
    return 'ليس لديك صلاحية إعادة احتساب الرواتب.';
  }
  if (r?.__status === 404 || code === 'PAYROLL_RUN_NOT_FOUND') {
    return 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.';
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return 'تعذر تأكيد العملية لأن بيانات الطلب تغيرت. أعد المحاولة من جديد.';
  }
  if (code === 'RECALCULATION_INTEGRITY_CONFLICT') {
    return 'تعذر التحقق من سجل عملية سابقة. لم يتم تعديل النتائج الحالية.';
  }
  if (r?.__status === 409) {
    return 'تم تعديل تشغيل الرواتب أو إعادة احتسابه بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 422) {
    return 'تعذر إعادة احتساب الرواتب بسبب إعدادات التشغيل الحالية. بقيت النتائج السابقة محفوظة.';
  }
  if (r?.__status === 500) {
    return 'حدث خطأ تقني أثناء إعادة احتساب الرواتب. بقيت النتائج السابقة محفوظة دون تغيير.';
  }
  return errMsg(r);
}

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

  const [calcOpen, setCalcOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calcMsg, setCalcMsg] = useState('');
  const [toast, setToast] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('ALL');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [calcSummary, setCalcSummary] = useState<any>(null);

  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcReason, setRecalcReason] = useState('');
  const [recalcMsg, setRecalcMsg] = useState('');
  const [recalcMeta, setRecalcMeta] = useState<any>(null);
  const [recalcHistory, setRecalcHistory] = useState<any[]>([]);
  const [recalcIdempotencyKey, setRecalcIdempotencyKey] = useState<string | null>(null);
  const [recalcAttemptReason, setRecalcAttemptReason] = useState<string | null>(null);

  const loadPeople = async (status: PeopleFilter = peopleFilter, search: string = peopleSearch) => {
    const qs = new URLSearchParams({ page: '1', page_size: '100' });
    if (status !== 'ALL') qs.set('status', status);
    if (search.trim()) qs.set('search', search.trim());
    const r = await fetchJson(`${runPeopleUrl(id)}?${qs.toString()}`);
    if (!r.success) {
      setError(errMsg(r));
      return;
    }
    setPeople(Array.isArray(r.data?.items) ? r.data.items : []);
  };

  const loadRecalcHistory = async () => {
    const r = await fetchJson(`${runRecalculationsUrl(id)}?page=1&page_size=20`);
    if (!r.success) return;
    setRecalcHistory(Array.isArray(r.data?.items) ? r.data.items : []);
  };

  const load = async () => {
    const r = await fetchJson(runUrl(id));
    if (!r.success) return setError(errMsg(r));
    setError('');
    const nextRun = r.data?.run ?? null;
    setRun(nextRun);
    setMembers(Array.isArray(r.data?.scope_members) ? r.data.scope_members : []);
    setCalcSummary(r.data?.calculation_summary ?? null);
    setRecalcMeta(r.data?.recalculation ?? null);
    if (nextRun?.status === 'CALCULATED') {
      await loadPeople();
      await loadRecalcHistory();
    } else {
      setPeople([]);
      setRecalcHistory([]);
    }
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (run?.status !== 'CALCULATED') return;
    void loadPeople(peopleFilter, peopleSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleFilter]);

  const create = can(caps, CAP.CREATE_RUNS);
  const cancelCap = can(caps, CAP.CANCEL_RUNS);
  const canCalculate = can(caps, CAP.CALCULATE);
  const canRecalculateCap = can(caps, CAP.RECALCULATE);
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

  async function doCalculate() {
    setCalculating(true);
    setCalcMsg('');
    try {
      const r = await fetchJson(runCalculateUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: run.version,
          updated_at: run.updated_at,
          idempotency_key: newIdempotencyKey(),
          confirmation: true,
        }),
      });
      if (!r.success) {
        setCalcMsg(calcErrorMsg(r));
        setError(calcErrorMsg(r));
        setCalcOpen(false);
        return;
      }
      setCalcOpen(false);
      setCalcMsg('');
      setError('');
      setToast(
        r.idempotent_replay
          ? 'تم استرجاع نتيجة الاحتساب السابقة'
          : 'تم احتساب الرواتب بنجاح'
      );
      await load();
    } finally {
      setCalculating(false);
    }
  }

  function openRecalcDialog() {
    setRecalcMsg('');
    setRecalcReason('');
    setRecalcIdempotencyKey(newIdempotencyKey());
    setRecalcAttemptReason(null);
    setRecalcOpen(true);
  }

  async function doRecalculate() {
    const trimmed = recalcReason.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      setRecalcMsg('يرجى كتابة سبب واضح لإعادة الاحتساب لا يقل عن 10 أحرف.');
      return;
    }
    if (recalculating) return;

    let key = recalcIdempotencyKey;
    if (!key || (recalcAttemptReason != null && recalcAttemptReason !== trimmed)) {
      key = newIdempotencyKey();
      setRecalcIdempotencyKey(key);
    }
    setRecalcAttemptReason(trimmed);
    setRecalculating(true);
    setRecalcMsg('');
    try {
      const r = await fetchJson(runRecalculateUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: run.version,
          updated_at: run.updated_at,
          idempotency_key: key,
          reason: trimmed,
          confirmation: true,
        }),
      });
      if (!r.success) {
        const msg = recalcErrorMsg(r);
        setRecalcMsg(msg);
        setError(msg);
        return;
      }
      setRecalcOpen(false);
      setRecalcReason('');
      setRecalcMsg('');
      setError('');
      setRecalcIdempotencyKey(null);
      setRecalcAttemptReason(null);
      const noChange = r.recalculation?.no_change === true;
      setToast(
        r.idempotent_replay
          ? 'تم تأكيد نتيجة إعادة الاحتساب السابقة دون إنشاء عملية جديدة.'
          : noChange
            ? 'تمت إعادة الاحتساب ولم تتغير نتائج الرواتب.'
            : 'تمت إعادة احتساب الرواتب بنجاح.'
      );
      await load();
    } finally {
      setRecalculating(false);
    }
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

  async function openPersonDetail(runPersonId: string) {
    setDetailBusy(true);
    setDetail(null);
    setDetailOpen(true);
    try {
      const r = await fetchJson(runPersonDetailUrl(id, runPersonId));
      if (!r.success) {
        setError(errMsg(r));
        setDetailOpen(false);
        return;
      }
      setDetail(r.data ?? null);
    } finally {
      setDetailBusy(false);
    }
  }

  function applyPeopleSearch() {
    void loadPeople(peopleFilter, peopleSearch);
  }

  if (error && !run) return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-red-600 text-sm">{error}</p></main>
  );
  if (!run) return <main dir="rtl" className="p-4 max-w-4xl mx-auto"><PayrollNav /><p className="text-gray-400 text-sm">جارٍ التحميل…</p></main>;

  const isDraft = run.status === 'DRAFT';
  const isCalculated = run.status === 'CALCULATED';
  const canEdit = create && isDraft;
  const canScope = create && isDraft && run.scope_type === 'PERSON_LIST';
  const canCancel = cancelCap && (run.status === 'DRAFT' || run.status === 'CALCULATED');
  const showCalculate = isDraft && canCalculate;
  const showRecalculate =
    isCalculated &&
    canRecalculateCap &&
    run.currency_code === 'IQD' &&
    recalcMeta?.can_recalculate !== false &&
    !recalculating;
  const scopeRefName = run.scope_ref_id
    ? (run.scope_type === 'COST_CENTER'
        ? (costCenters.find((c) => c.id === run.scope_ref_id)?.name_ar ?? run.scope_ref_id)
        : (departments.find((d) => d.id === run.scope_ref_id)?.name_ar ?? run.scope_ref_id))
    : '—';

  const summary = calcSummary ?? {};
  const totalPeople = summary.total_people ?? run.people_count ?? 0;
  const calculatedPeople = summary.calculated_people ?? 0;
  const errorPeople = summary.error_people ?? run.error_count ?? 0;
  const excludedPeople = summary.excluded_people ?? 0;
  const hasCalcErrors = Number(run.error_count ?? errorPeople ?? 0) > 0;

  const detailPerson = detail?.person;
  const detailLines: any[] = Array.isArray(detail?.lines) ? detail.lines : [];
  const detailIssues: any[] = Array.isArray(detail?.issues) ? detail.issues : [];
  const linesByType = (t: string) => detailLines.filter((l) => l.component_type === t);

  return (
    <main dir="rtl" className="p-4 max-w-5xl mx-auto">
      <PayrollNav />
      {toast && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded px-3 py-2 text-sm mb-3">
          {toast}
        </div>
      )}
      {(error || calcMsg || recalcMsg) && (
        <p className="text-red-600 mb-3 text-sm">{error || calcMsg || recalcMsg}</p>
      )}
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

      {isDraft && run.scope_type === 'PERSON_LIST' && members.length > 0 && (
        <p className="text-sm text-gray-600 mb-4">
          عدد الأشخاص المتوقع عند الاحتساب وفق قائمة النطاق: <span className="font-semibold">{members.length}</span>
        </p>
      )}

      {isCalculated && hasCalcErrors && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-3 text-sm mb-4">
          اكتمل احتساب الرواتب مع وجود أخطاء تحتاج إلى معالجة. لن يسمح بالترحيل أو الدفع قبل معالجة جميع الأخطاء.
        </div>
      )}

      {isCalculated ? (
        <div className="bg-white shadow rounded p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
          <div><p className="text-gray-500 text-xs">عدد الأشخاص</p><p className="font-bold">{totalPeople}</p></div>
          <div><p className="text-gray-500 text-xs">المحتسبون</p><p className="font-bold">{calculatedPeople}</p></div>
          <div><p className="text-gray-500 text-xs">الأخطاء</p><p className="font-bold text-red-700">{errorPeople}</p></div>
          <div><p className="text-gray-500 text-xs">المستبعدون</p><p className="font-bold">{excludedPeople}</p></div>
          <div><p className="text-gray-500 text-xs">إجمالي الاستحقاقات</p><p className="font-bold">{iqdWhole(run.gross_total)}</p></div>
          <div><p className="text-gray-500 text-xs">الاستقطاعات</p><p className="font-bold">{iqdWhole(run.deduction_total)}</p></div>
          <div><p className="text-gray-500 text-xs">مساهمات جهة العمل</p><p className="font-bold">{iqdWhole(run.employer_contribution_total)}</p></div>
          <div><p className="text-gray-500 text-xs">الصافي</p><p className="font-bold">{iqdWhole(run.net_total)}</p></div>
          <div className="md:col-span-2">
            <p className="text-gray-500 text-xs">وقت الاحتساب</p>
            <p className="font-bold">{run.calculated_at ? new Date(run.calculated_at).toLocaleString('ar-IQ') : '—'}</p>
          </div>
          {run.snapshot_hash && (
            <div className="md:col-span-2">
              <p className="text-gray-500 text-xs">بصمة اللقطة</p>
              <p className="font-mono text-xs">{String(run.snapshot_hash).slice(0, 12)}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white shadow rounded p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-6">
          <div><p className="text-gray-500 text-xs">عدد الأشخاص</p><p className="font-bold">{run.people_count ?? 0}</p></div>
          <div><p className="text-gray-500 text-xs">إجمالي الاستحقاقات</p><p className="font-bold">{iqdWhole(run.gross_total)}</p></div>
          <div><p className="text-gray-500 text-xs">إجمالي الاستقطاعات</p><p className="font-bold">{iqdWhole(run.deduction_total)}</p></div>
          <div><p className="text-gray-500 text-xs">مساهمات جهة العمل</p><p className="font-bold">{iqdWhole(run.employer_contribution_total)}</p></div>
          <div><p className="text-gray-500 text-xs">الصافي</p><p className="font-bold">{iqdWhole(run.net_total)}</p></div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {showCalculate && (
          <button
            className="bg-red-800 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={calculating}
            onClick={() => { setCalcMsg(''); setCalcOpen(true); }}
          >
            احتساب الرواتب
          </button>
        )}
        {showRecalculate && (
          <button
            className="bg-amber-800 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={recalculating}
            onClick={openRecalcDialog}
          >
            إعادة احتساب الرواتب
          </button>
        )}
        {canEdit && <button className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" onClick={openEdit}>تعديل</button>}
        {canCancel && <button className="bg-red-800 text-white rounded px-3 py-1.5 text-sm" onClick={() => { setReason(''); setCancelOpen(true); }}>إلغاء التشغيل</button>}
      </div>

      {isCalculated && (recalcHistory.length > 0 || recalcMeta?.has_recalculation_history) && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">سجل إعادة الاحتساب</h2>
          <div className="bg-white shadow rounded overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th>المستخدم</th>
                  <th>السبب</th>
                  <th>الأشخاص</th>
                  <th>الأخطاء</th>
                  <th>الاستحقاقات</th>
                  <th>الاستقطاعات</th>
                  <th>الصافي</th>
                  <th>التغيّر</th>
                </tr>
              </thead>
              <tbody>
                {recalcHistory.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">
                      {h.created_at ? new Date(h.created_at).toLocaleString('ar-IQ') : '—'}
                    </td>
                    <td>{h.actor_display_name || '—'}</td>
                    <td className="max-w-[14rem] truncate" title={h.reason}>{h.reason}</td>
                    <td>{h.previous_people_count} → {h.new_people_count}</td>
                    <td>{h.previous_error_count} → {h.new_error_count}</td>
                    <td>{iqdWhole(h.previous_gross_total)} → {iqdWhole(h.new_gross_total)}</td>
                    <td>{iqdWhole(h.previous_deduction_total)} → {iqdWhole(h.new_deduction_total)}</td>
                    <td>{iqdWhole(h.previous_net_total)} → {iqdWhole(h.new_net_total)}</td>
                    <td>{h.no_change ? 'بدون تغيّر' : 'تغيّرت'}</td>
                  </tr>
                ))}
                {!recalcHistory.length && (
                  <tr><td colSpan={9} className="p-3 text-gray-400">لا سجلات بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isCalculated && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">نتائج الأشخاص</h2>
          <div className="flex flex-wrap gap-2 mb-3 text-sm items-center">
            {([
              ['ALL', 'الكل'],
              ['CALCULATED', 'المحتسبون'],
              ['ERROR', 'الأخطاء'],
              ['EXCLUDED', 'المستبعدون'],
            ] as [PeopleFilter, string][]).map(([k, v]) => (
              <button
                key={k}
                type="button"
                className={`rounded px-2.5 py-1 border text-sm ${peopleFilter === k ? 'bg-red-800 text-white border-red-800' : 'bg-white text-gray-700'}`}
                onClick={() => setPeopleFilter(k)}
              >
                {v}
              </button>
            ))}
            <input
              className="border rounded p-1.5 flex-1 min-w-[10rem]"
              placeholder="بحث بالرمز أو الاسم…"
              value={peopleSearch}
              onChange={(e) => setPeopleSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyPeopleSearch(); }}
            />
            <button className="border rounded px-3 py-1.5" type="button" onClick={applyPeopleSearch}>بحث</button>
          </div>
          <table className="w-full bg-white shadow rounded text-sm text-right">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="p-2">الرمز</th>
                <th>الاسم</th>
                <th>الحالة</th>
                <th>الأساسي</th>
                <th>الإجمالي</th>
                <th>الاستقطاعات</th>
                <th>جهة العمل</th>
                <th>الصافي</th>
                <th>أخطاء/تحذيرات</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 font-mono">{p.person_code}</td>
                  <td>{p.full_name}</td>
                  <td><StatusBadge status={p.calculation_status} map={PERSON_CALC_STATUS} /></td>
                  <td>{iqdWhole(p.basic_amount)}</td>
                  <td>{iqdWhole(p.gross_amount)}</td>
                  <td>{iqdWhole(p.deductions_amount)}</td>
                  <td>{iqdWhole(p.employer_contributions_amount)}</td>
                  <td className="font-semibold">{iqdWhole(p.net_amount)}</td>
                  <td>{p.error_count ?? 0} / {p.warning_count ?? 0}</td>
                  <td>
                    <button className="text-blue-700" type="button" onClick={() => void openPersonDetail(p.id)}>
                      تفاصيل
                    </button>
                  </td>
                </tr>
              ))}
              {!people.length && (
                <tr><td colSpan={10} className="p-3 text-gray-400">لا نتائج</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

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

      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 my-8" dir="rtl">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-semibold">تفاصيل نتيجة الشخص</h3>
              <button className="border rounded px-2 py-1 text-sm" type="button" onClick={() => { setDetailOpen(false); setDetail(null); }}>إغلاق</button>
            </div>
            {detailBusy && <p className="text-sm text-gray-400">جارٍ التحميل…</p>}
            {!detailBusy && detailPerson && (
              <div className="space-y-4 text-sm">
                <div className="grid md:grid-cols-2 gap-2 bg-gray-50 rounded p-3">
                  <div><span className="text-gray-500">الشخص:</span> {detailPerson.person_code} — {detailPerson.full_name}</div>
                  <div><span className="text-gray-500">العقد:</span> {detailPerson.payroll_contract_ref ?? '—'}</div>
                  <div><span className="text-gray-500">الحالة:</span> <StatusBadge status={detailPerson.calculation_status} map={PERSON_CALC_STATUS} /></div>
                  <div><span className="text-gray-500">الأساسي:</span> {iqdWhole(detailPerson.basic_amount)}</div>
                  <div><span className="text-gray-500">الإجمالي:</span> {iqdWhole(detailPerson.gross_amount)}</div>
                  <div><span className="text-gray-500">الاستقطاعات:</span> {iqdWhole(detailPerson.deductions_amount)}</div>
                  <div><span className="text-gray-500">مساهمات جهة العمل:</span> {iqdWhole(detailPerson.employer_contributions_amount)}</div>
                  <div><span className="text-gray-500">الصافي:</span> <span className="font-semibold">{iqdWhole(detailPerson.net_amount)}</span></div>
                </div>

                {(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'] as const).map((type) => {
                  const rows = linesByType(type);
                  return (
                    <div key={type}>
                      <h4 className="font-semibold mb-1">{label(COMPONENT_TYPE, type)}</h4>
                      {rows.length === 0 ? (
                        <p className="text-gray-400 text-xs mb-2">لا بنود</p>
                      ) : (
                        <table className="w-full border rounded mb-2">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="p-1.5 text-right">الرمز</th>
                              <th className="text-right">الاسم</th>
                              <th className="text-right">المبلغ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((l) => (
                              <tr key={l.id} className="border-t">
                                <td className="p-1.5 font-mono text-xs">{l.component_code_snapshot}</td>
                                <td>{l.component_name_snapshot}</td>
                                <td>{iqdWhole(l.calculated_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}

                <div>
                  <h4 className="font-semibold mb-1">الملاحظات والمشكلات</h4>
                  {detailIssues.length === 0 ? (
                    <p className="text-gray-400 text-xs">لا توجد مشكلات</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailIssues.map((iss) => (
                        <li key={iss.id} className="border rounded p-2">
                          <div className="flex flex-wrap gap-2 items-center mb-1">
                            <span className="font-mono text-xs">{iss.issue_code}</span>
                            <span className="text-xs text-gray-500">{iss.severity}</span>
                            {iss.blocking && (
                              <span className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5">حاجب</span>
                            )}
                          </div>
                          <p>{iss.message_ar}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={calcOpen}
        title="تأكيد احتساب الرواتب"
        message="سيقوم النظام بتجميد بيانات الأشخاص والعقود والمخصصات والاستقطاعات وفق تاريخ الاحتساب، ثم إنشاء نتائج الرواتب. لا يمكن تعديل النتائج بعد اكتمال الاحتساب دون مسار إعادة احتساب مستقل."
        warning="الإصدار الحالي يدعم الدينار العراقي IQD فقط."
        confirmLabel="بدء الاحتساب"
        busyLabel="جارٍ احتساب الرواتب..."
        busy={calculating}
        onCancel={() => { if (!calculating) { setCalcOpen(false); setCalcMsg(''); } }}
        onConfirm={() => void doCalculate()}
      />

      <ConfirmDialog
        open={recalcOpen}
        title="تأكيد إعادة احتساب الرواتب"
        message="سيعيد النظام قراءة بيانات الموظفين والعقود والمخصصات والاستقطاعات وفق تاريخ الاحتساب، ثم يستبدل نتائج التشغيل الحالية بنتائج جديدة. ستبقى معلومات العملية السابقة محفوظة في سجل التدقيق، لكن لن تبقى تفاصيل أسطرها قابلة للعرض."
        warning="قد تتغير قائمة الموظفين والمبالغ والأخطاء إذا تغيرت العقود أو التكليفات أو المخصصات منذ الاحتساب السابق."
        extraWarning="الإصدار الحالي يدعم الدينار العراقي IQD فقط."
        reasonRequired
        reason={recalcReason}
        onReasonChange={setRecalcReason}
        reasonLabel="سبب إعادة الاحتساب"
        reasonPlaceholder="مثال: تعديل الراتب الأساسي لموظف أو تصحيح مخصصات مستحقة"
        reasonHelper="اكتب سبباً واضحاً لا يقل عن 10 أحرف."
        reasonMinLength={10}
        confirmLabel="بدء إعادة الاحتساب"
        cancelLabel="إلغاء"
        busyLabel="جارٍ إعادة احتساب الرواتب..."
        busy={recalculating}
        onCancel={() => {
          if (!recalculating) {
            setRecalcOpen(false);
            setRecalcMsg('');
            setRecalcReason('');
          }
        }}
        onConfirm={() => void doRecalculate()}
      />

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
