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
  approveDecisionErrorMsg,
  rejectDecisionErrorMsg,
  fetchJson,
  iqdWhole,
  label,
  runUrl,
  runCancelUrl,
  runCalculateUrl,
  runRecalculateUrl,
  runRecalculationsUrl,
  runSubmitReviewUrl,
  runApproveUrl,
  runRejectUrl,
  runApprovalHistoryUrl,
  runPeopleUrl,
  runPersonDetailUrl,
  runScopeUrl,
  runScopeMemberUrl,
  approvalHistoryActionBadge,
  approvalStatusTransitionLabel,
  shortApprovalHashDisplay,
  APPROVAL_HISTORY_ACTION_DETAIL_AR,
} from '../../_lib';

// إعادة تصدير لرسائل القرار — متاحة للاختبارات من مسار الصفحة أيضاً
export { approveDecisionErrorMsg, rejectDecisionErrorMsg };

type PeopleFilter = 'ALL' | 'CALCULATED' | 'ERROR' | 'EXCLUDED';

const READINESS_BLOCKER_LABEL: Record<string, string> = {
  STATUS_NOT_CALCULATED: 'الحالة ليست محتسبة',
  UNSUPPORTED_CURRENCY: 'العملة غير مدعومة (IQD فقط)',
  HAS_ERRORS: 'توجد أخطاء احتساب يجب معالجتها',
  HAS_BLOCKING_ISSUES: 'توجد مشكلات حاجبة',
  MISSING_SNAPSHOT_HASH: 'بصمة اللقطة ناقصة أو غير صالحة',
};

const APPROVAL_BLOCKER_LABEL: Record<string, string> = {
  STATUS_NOT_UNDER_REVIEW: 'التشغيل ليس قيد المراجعة',
  HAS_ERRORS: 'توجد أخطاء احتساب يجب معالجتها',
  HAS_BLOCKING_ISSUES: 'توجد مشكلات حاجبة',
  SNAPSHOT_DRIFT: 'تغيرت بصمة اللقطة بعد الإرسال للمراجعة',
  MISSING_REVIEW_HASH: 'بصمة قفل المراجعة ناقصة أو غير صالحة',
  SOD_SUBMITTER: 'لا يجوز لمرسل المراجعة اعتماد أو رفض نفس التشغيل',
};

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

/** رسائل أخطاء إرسال للمراجعة — للاختبارات والواجهة. */
export function submitReviewErrorMsg(r: any): string {
  const code = r?.error?.code;
  if (r?.__status === 400 || code === 'INVALID_COMMENT') {
    return r?.error?.message || r?.message || 'تعذر قبول التعليق. يجب ألا يتجاوز 500 حرف.';
  }
  if (r?.__status === 403 || code === 'FORBIDDEN') {
    return 'ليس لديك صلاحية إرسال تشغيل الرواتب للمراجعة.';
  }
  if (r?.__status === 404 || code === 'PAYROLL_RUN_NOT_FOUND') {
    return 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.';
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.';
  }
  if (code === 'APPROVAL_INTEGRITY_CONFLICT') {
    return 'تعذر التحقق من عملية إرسال سابقة. لم يتم تعديل تشغيل الرواتب.';
  }
  if (code === 'STALE_PAYROLL_RUN' || (r?.__status === 409 && !code)) {
    return 'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 409) {
    return r?.error?.message || r?.message || 'لا يمكن إرسال تشغيل الرواتب للمراجعة في حالته الحالية.';
  }
  if (code === 'PAYROLL_HAS_ERRORS') {
    return 'لا يمكن إرسال تشغيل الرواتب للمراجعة لوجود أخطاء يجب معالجتها أولًا.';
  }
  if (code === 'PAYROLL_HAS_BLOCKING_ISSUES') {
    return 'لا يمكن إرسال تشغيل الرواتب للمراجعة لوجود مشكلات حاجبة.';
  }
  if (code === 'UNSUPPORTED_PAYROLL_CURRENCY') {
    return 'الإصدار الحالي من الرواتب يدعم الدينار العراقي IQD فقط.';
  }
  if (r?.__status === 422) {
    return r?.error?.message || r?.message || 'تعذر إرسال تشغيل الرواتب للمراجعة بسبب إعدادات التشغيل الحالية.';
  }
  if (r?.__status === 500 || code === 'TECHNICAL_FAILURE') {
    return 'حدث خطأ تقني أثناء إرسال الرواتب للمراجعة. بقيت حالة التشغيل دون تغيير.';
  }
  return errMsg(r);
}

function formatReadinessBlockers(blockers: unknown): string {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return 'التشغيل غير جاهز للإرسال للمراجعة.';
  }
  return blockers
    .map((b) => READINESS_BLOCKER_LABEL[String(b)] ?? String(b))
    .join(' · ');
}

function formatApprovalBlockers(blockers: unknown): string {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return 'التشغيل غير جاهز للاعتماد.';
  }
  return blockers
    .map((b) => APPROVAL_BLOCKER_LABEL[String(b)] ?? String(b))
    .join(' · ');
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

  const [approvalMeta, setApprovalMeta] = useState<any>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitComment, setSubmitComment] = useState('');
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitIdempotencyKey, setSubmitIdempotencyKey] = useState<string | null>(null);
  const [submitAttemptComment, setSubmitAttemptComment] = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [approveMsg, setApproveMsg] = useState('');
  const [approveIdempotencyKey, setApproveIdempotencyKey] = useState<string | null>(null);
  const [approveAttemptComment, setApproveAttemptComment] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMsg, setRejectMsg] = useState('');
  const [rejectIdempotencyKey, setRejectIdempotencyKey] = useState<string | null>(null);
  const [rejectAttemptReason, setRejectAttemptReason] = useState<string | null>(null);

  const [approvalHistory, setApprovalHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyFetchKey, setHistoryFetchKey] = useState(0);

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

  const loadApprovalHistory = async (page = 1) => {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const r = await fetchJson(
        `${runApprovalHistoryUrl(id)}?page=${page}&page_size=20`
      );
      if (r.__status === 403) {
        setApprovalHistory([]);
        setHistoryTotal(0);
        setHistoryHasMore(false);
        setHistoryError('ليس لديك صلاحية عرض سجل مراجعة واعتماد الرواتب');
        return;
      }
      if (!r.success && !r.ok) {
        setHistoryError('تعذر تحميل سجل المراجعة والاعتماد.');
        return;
      }
      const hist = r.data?.history ?? r.history ?? null;
      const items = Array.isArray(hist?.items) ? hist.items : [];
      setApprovalHistory(items);
      setHistoryPage(Number(hist?.page ?? page) || page);
      setHistoryTotal(Number(hist?.total ?? items.length) || 0);
      setHistoryHasMore(hist?.has_more === true);
    } catch {
      setHistoryError('تعذر تحميل سجل المراجعة والاعتماد.');
    } finally {
      setHistoryLoading(false);
    }
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
    setApprovalMeta(r.data?.approval ?? null);
    const status = String(nextRun?.status ?? '');
    if (status === 'CALCULATED' || status === 'UNDER_REVIEW' || status === 'APPROVED') {
      await loadPeople();
      if (status === 'CALCULATED') await loadRecalcHistory();
      else setRecalcHistory([]);
    } else {
      setPeople([]);
      setRecalcHistory([]);
    }
    // سجل الاعتماد مستقل — فشله لا يمنع صفحة التشغيل
    setHistoryFetchKey((k) => k + 1);
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
    if (!historyFetchKey) return;
    const canHist =
      can(caps, CAP.VIEW_APPROVAL_HISTORY) ||
      approvalMeta?.can_view_history === true;
    if (!canHist && caps.length > 0 && approvalMeta != null && approvalMeta.can_view_history === false) {
      setApprovalHistory([]);
      setHistoryError('');
      return;
    }
    void loadApprovalHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFetchKey]);

  useEffect(() => {
    const st = run?.status;
    if (st !== 'CALCULATED' && st !== 'UNDER_REVIEW' && st !== 'APPROVED') return;
    void loadPeople(peopleFilter, peopleSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleFilter]);

  const create = can(caps, CAP.CREATE_RUNS);
  const cancelCap = can(caps, CAP.CANCEL_RUNS);
  const canCalculate = can(caps, CAP.CALCULATE);
  const canRecalculateCap = can(caps, CAP.RECALCULATE);
  const canSubmitCap = can(caps, CAP.SUBMIT_REVIEW);
  const canApproveCap = can(caps, CAP.APPROVE);
  const canRejectCap = can(caps, CAP.REJECT);
  const canViewHistoryCap =
    can(caps, CAP.VIEW_APPROVAL_HISTORY) || approvalMeta?.can_view_history === true;
  const decisionBusy = approving || rejecting;
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

  function openSubmitDialog() {
    setSubmitMsg('');
    setSubmitComment('');
    setSubmitIdempotencyKey(newIdempotencyKey());
    setSubmitAttemptComment(null);
    setSubmitOpen(true);
  }

  async function doSubmitReview() {
    const trimmed = submitComment.trim();
    if (trimmed.length > 500) {
      setSubmitMsg('التعليق يجب ألا يتجاوز 500 حرفاً.');
      return;
    }
    if (submitting || decisionBusy) return;
    let key = submitIdempotencyKey;
    if (!key || (submitAttemptComment != null && submitAttemptComment !== trimmed)) {
      key = newIdempotencyKey();
      setSubmitIdempotencyKey(key);
    }
    setSubmitAttemptComment(trimmed);
    setSubmitting(true);
    setSubmitMsg('');
    try {
      const r = await fetchJson(runSubmitReviewUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: run.version,
          updated_at: run.updated_at,
          idempotency_key: key,
          comment: trimmed || null,
          confirmation: true,
        }),
      });
      if (!r.success) {
        const msg = submitReviewErrorMsg(r);
        setSubmitMsg(msg);
        setError(msg);
        return;
      }
      setSubmitOpen(false);
      setSubmitComment('');
      setSubmitMsg('');
      setError('');
      setSubmitIdempotencyKey(null);
      setSubmitAttemptComment(null);
      setToast(
        r.idempotent_replay
          ? 'تم تأكيد إرسال الرواتب للمراجعة السابق دون إنشاء عملية جديدة.'
          : 'تم إرسال تشغيل الرواتب للمراجعة بنجاح.'
      );
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  function openApproveDialog() {
    setApproveMsg('');
    setApproveComment('');
    setApproveIdempotencyKey(newIdempotencyKey());
    setApproveAttemptComment(null);
    setApproveOpen(true);
  }

  async function doApprove() {
    const trimmed = approveComment.trim();
    if (trimmed.length > 500) {
      setApproveMsg('التعليق يجب ألا يتجاوز 500 حرفاً.');
      return;
    }
    if (approving || rejecting || submitting) return;
    let key = approveIdempotencyKey;
    if (!key || (approveAttemptComment != null && approveAttemptComment !== trimmed)) {
      key = newIdempotencyKey();
      setApproveIdempotencyKey(key);
    }
    setApproveAttemptComment(trimmed);
    setApproving(true);
    setApproveMsg('');
    try {
      const r = await fetchJson(runApproveUrl(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: run.version,
          updated_at: run.updated_at,
          idempotency_key: key,
          comment: trimmed || null,
          confirmation: true,
        }),
      });
      if (!r.success) {
        const msg = approveDecisionErrorMsg(r);
        setApproveMsg(msg);
        setError(msg);
        return;
      }
      setApproveOpen(false);
      setApproveComment('');
      setApproveMsg('');
      setError('');
      setApproveIdempotencyKey(null);
      setApproveAttemptComment(null);
      setToast(
        r.idempotent_replay
          ? 'تم تأكيد اعتماد الرواتب السابق دون إنشاء عملية جديدة.'
          : 'تم اعتماد تشغيل الرواتب بنجاح.'
      );
      await load();
    } finally {
      setApproving(false);
    }
  }

  function openRejectDialog() {
    setRejectMsg('');
    setRejectReason('');
    setRejectIdempotencyKey(newIdempotencyKey());
    setRejectAttemptReason(null);
    setRejectOpen(true);
  }

  async function doReject() {
    const trimmed = rejectReason.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      setRejectMsg('يجب إدخال سبب واضح للرفض يتراوح بين 10 و500 حرف.');
      return;
    }
    if (rejecting || approving || submitting) return;
    let key = rejectIdempotencyKey;
    if (!key || (rejectAttemptReason != null && rejectAttemptReason !== trimmed)) {
      key = newIdempotencyKey();
      setRejectIdempotencyKey(key);
    }
    setRejectAttemptReason(trimmed);
    setRejecting(true);
    setRejectMsg('');
    try {
      const r = await fetchJson(runRejectUrl(id), {
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
        const msg = rejectDecisionErrorMsg(r);
        setRejectMsg(msg);
        setError(msg);
        return;
      }
      setRejectOpen(false);
      setRejectReason('');
      setRejectMsg('');
      setError('');
      setRejectIdempotencyKey(null);
      setRejectAttemptReason(null);
      setToast(
        r.idempotent_replay
          ? 'تم تأكيد رفض المراجعة السابق دون إنشاء عملية جديدة.'
          : 'تم رفض المراجعة وإعادة التشغيل للتصحيح.'
      );
      await load();
    } finally {
      setRejecting(false);
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
  const isUnderReview = run.status === 'UNDER_REVIEW';
  const isApproved = run.status === 'APPROVED';
  const showResults = isCalculated || isUnderReview || isApproved;
  const canEdit = create && isDraft && !isApproved;
  const canScope = create && isDraft && run.scope_type === 'PERSON_LIST' && !isApproved;
  const canCancel =
    cancelCap &&
    !isApproved &&
    !isUnderReview &&
    (run.status === 'DRAFT' || run.status === 'CALCULATED');
  const showCalculate = isDraft && canCalculate && !isApproved;
  const showRecalculate =
    isCalculated &&
    !isUnderReview &&
    !isApproved &&
    canRecalculateCap &&
    run.currency_code === 'IQD' &&
    recalcMeta?.can_recalculate !== false &&
    !recalculating &&
    !decisionBusy;
  const showSubmitEnabled =
    canSubmitCap &&
    isCalculated &&
    !isApproved &&
    run.currency_code === 'IQD' &&
    approvalMeta?.can_submit_for_review !== false &&
    !submitting &&
    !decisionBusy;
  const showSubmitDisabled =
    canSubmitCap &&
    isCalculated &&
    !isApproved &&
    approvalMeta?.can_submit_for_review === false;
  const isCurrentUserSubmitter = approvalMeta?.is_current_user_submitter === true;
  const showApproveEnabled =
    canApproveCap &&
    isUnderReview &&
    !isCurrentUserSubmitter &&
    approvalMeta?.can_approve !== false &&
    !decisionBusy &&
    !submitting;
  const showApproveDisabled =
    canApproveCap &&
    isUnderReview &&
    !isCurrentUserSubmitter &&
    approvalMeta?.can_approve === false;
  const showRejectEnabled =
    canRejectCap &&
    isUnderReview &&
    !isCurrentUserSubmitter &&
    approvalMeta?.can_reject !== false &&
    !decisionBusy &&
    !submitting;
  const showRejectDisabled =
    canRejectCap &&
    isUnderReview &&
    !isCurrentUserSubmitter &&
    approvalMeta?.can_reject === false;
  // if !canSubmitCap: hide entirely (neither enabled nor disabled)
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
  const lastRejection = approvalMeta?.last_rejection ?? null;

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
      {(error || calcMsg || recalcMsg || submitMsg || approveMsg || rejectMsg) && (
        <p className="text-red-600 mb-3 text-sm">{error || calcMsg || recalcMsg || submitMsg || approveMsg || rejectMsg}</p>
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

      {isUnderReview && (
        <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded p-3 text-sm mb-4 space-y-1">
          <p className="font-semibold">التشغيل قيد المراجعة — النتائج مقفلة.</p>
          <p>لا يمكن إعادة الاحتساب أو التعديل أو الإلغاء أثناء المراجعة.</p>
          <p>
            المُرسل: {approvalMeta?.submitted_for_review_by?.display_name || '—'}
            {' · '}
            الوقت: {approvalMeta?.submitted_for_review_at
              ? new Date(approvalMeta.submitted_for_review_at).toLocaleString('ar-IQ')
              : '—'}
            {' · '}
            الدورة: {approvalMeta?.approval_cycle ?? '—'}
          </p>
          {approvalMeta?.submit_comment && (
            <p>تعليق الإرسال: {approvalMeta.submit_comment}</p>
          )}
          {isCurrentUserSubmitter ? (
            <p className="text-amber-900 font-medium">
              أنت مرسل هذه المراجعة. لا يمكنك اعتماد أو رفض نفس التشغيل (فصل الواجبات). بانتظار قرار مراجع آخر مخول.
            </p>
          ) : (
            <>
              <p className="text-amber-800">بانتظار قرار المراجع المخول.</p>
              <p className="text-xs text-amber-700">سيظهر قرار المراجع هنا بعد اكتمال مرحلة الاعتماد.</p>
            </>
          )}
        </div>
      )}

      {isApproved && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 rounded p-3 text-sm mb-4 space-y-1">
          <p className="font-semibold">تم اعتماد تشغيل الرواتب.</p>
          <p>
            المعتمد: {approvalMeta?.approved_by?.display_name || '—'}
            {' · '}
            الوقت: {approvalMeta?.approved_at
              ? new Date(approvalMeta.approved_at).toLocaleString('ar-IQ')
              : '—'}
            {' · '}
            الدورة: {approvalMeta?.approval_cycle ?? '—'}
          </p>
          <p className="text-emerald-800">التشغيل جاهز لمرحلة الترحيل لاحقاً. لا يوجد ترحيل في هذه المرحلة.</p>
        </div>
      )}

      {isCalculated && lastRejection && (
        <div className="bg-orange-50 border border-orange-300 text-orange-950 rounded p-3 text-sm mb-4 space-y-1">
          <p className="font-semibold">أُعيد التشغيل للتصحيح بعد رفض المراجعة.</p>
          <p>سبب الرفض: {lastRejection.reason}</p>
          <p>
            الرافض: {lastRejection.rejected_by?.display_name || '—'}
            {' · '}
            الوقت: {lastRejection.rejected_at
              ? new Date(lastRejection.rejected_at).toLocaleString('ar-IQ')
              : '—'}
            {' · '}
            الدورة: {lastRejection.approval_cycle ?? '—'}
          </p>
          <p className="text-orange-800">يمكن إعادة الاحتساب أو التصحيح ثم الإرسال للمراجعة مجدداً.</p>
        </div>
      )}

      {showResults ? (
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
        {showSubmitEnabled && (
          <button className="bg-emerald-800 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={submitting || decisionBusy} onClick={openSubmitDialog}>
            إرسال للمراجعة
          </button>
        )}
        {showSubmitDisabled && (
          <div className="flex flex-col gap-1 max-w-md">
            <button className="bg-gray-300 text-gray-600 rounded px-3 py-1.5 text-sm cursor-not-allowed" disabled>
              إرسال للمراجعة
            </button>
            <p className="text-xs text-amber-800">{formatReadinessBlockers(approvalMeta?.readiness_blockers)}</p>
          </div>
        )}
        {showApproveEnabled && (
          <button
            className="bg-teal-800 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={decisionBusy || submitting}
            onClick={openApproveDialog}
          >
            اعتماد الرواتب
          </button>
        )}
        {showApproveDisabled && (
          <div className="flex flex-col gap-1 max-w-md">
            <button className="bg-gray-300 text-gray-600 rounded px-3 py-1.5 text-sm cursor-not-allowed" disabled>
              اعتماد الرواتب
            </button>
            <p className="text-xs text-amber-800">{formatApprovalBlockers(approvalMeta?.approval_blockers)}</p>
          </div>
        )}
        {showRejectEnabled && (
          <button
            className="bg-rose-800 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={decisionBusy || submitting}
            onClick={openRejectDialog}
          >
            رفض وإعادة للتصحيح
          </button>
        )}
        {showRejectDisabled && (
          <div className="flex flex-col gap-1 max-w-md">
            <button className="bg-gray-300 text-gray-600 rounded px-3 py-1.5 text-sm cursor-not-allowed" disabled>
              رفض وإعادة للتصحيح
            </button>
            <p className="text-xs text-amber-800">{formatApprovalBlockers(approvalMeta?.approval_blockers)}</p>
          </div>
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

      {(canViewHistoryCap || historyError || historyLoading || approvalHistory.length > 0) && (
        <section className="mb-6" aria-label="سجل مراجعة واعتماد الرواتب">
          <h2 className="text-lg font-semibold mb-2">سجل مراجعة واعتماد الرواتب</h2>
          {!canViewHistoryCap && !historyLoading && (
            <p className="text-sm text-gray-500 bg-gray-50 border rounded p-3">
              ليس لديك صلاحية عرض سجل مراجعة واعتماد الرواتب.
            </p>
          )}
          {canViewHistoryCap && historyLoading && (
            <p className="text-sm text-gray-500">جارٍ تحميل سجل المراجعة...</p>
          )}
          {canViewHistoryCap && !historyLoading && historyError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded p-3">
              {historyError}
            </p>
          )}
          {canViewHistoryCap && !historyLoading && !historyError && approvalHistory.length === 0 && (
            <p className="text-sm text-gray-500 bg-white border rounded p-3">
              لا توجد إجراءات مراجعة أو اعتماد لهذا التشغيل حتى الآن.
            </p>
          )}
          {canViewHistoryCap && !historyLoading && !historyError && approvalHistory.length > 0 && (
            <div className="bg-white shadow rounded p-4">
              <ol className="relative border-r border-gray-200 pr-4 space-y-4">
                {approvalHistory.map((item) => {
                  const badge =
                    item.action === 'APPROVED'
                      ? 'bg-green-100 text-green-800'
                      : item.action === 'REJECTED'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-blue-100 text-blue-800';
                  return (
                    <li key={item.id} className="relative">
                      <span className="absolute -right-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-gray-400" />
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-xs rounded px-2 py-0.5 ${badge}`}>
                          {approvalHistoryActionBadge(item.action)}
                        </span>
                        <span className="text-xs text-gray-500">
                          دورة المراجعة {item.approval_cycle}
                        </span>
                        <span className="text-xs text-gray-400">
                          {item.created_at
                            ? new Date(item.created_at).toLocaleString('ar-IQ')
                            : '—'}
                        </span>
                      </div>
                      <p className="text-sm font-medium">
                        {item.action_label_ar ||
                          APPROVAL_HISTORY_ACTION_DETAIL_AR[item.action] ||
                          item.action}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        المنفذ: {item.actor?.display_name || 'مستخدم سابق'}
                      </p>
                      <p className="text-xs text-gray-600">
                        الانتقال:{' '}
                        {approvalStatusTransitionLabel(item.from_status, item.to_status)}
                      </p>
                      {item.action === 'REJECTED' && item.reason && (
                        <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                          سبب الرفض: {item.reason}
                        </p>
                      )}
                      {item.action !== 'REJECTED' && item.comment && (
                        <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                          تعليق: {item.comment}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1 font-mono">
                        بصمة: {shortApprovalHashDisplay(item.snapshot_hash_short)}
                        {item.version_before != null && item.version_after != null
                          ? ` · إصدار ${item.version_before} → ${item.version_after}`
                          : ''}
                      </p>
                    </li>
                  );
                })}
              </ol>
              {(historyPage > 1 || historyHasMore) && (
                <div className="flex gap-2 mt-4 justify-end">
                  <button
                    type="button"
                    className="border rounded px-3 py-1 text-sm disabled:opacity-40"
                    disabled={historyLoading || historyPage <= 1}
                    onClick={() => void loadApprovalHistory(historyPage - 1)}
                  >
                    السابق
                  </button>
                  <span className="text-xs text-gray-500 self-center">
                    صفحة {historyPage}
                    {historyTotal ? ` من ${Math.max(1, Math.ceil(historyTotal / 20))}` : ''}
                  </span>
                  <button
                    type="button"
                    className="border rounded px-3 py-1 text-sm disabled:opacity-40"
                    disabled={historyLoading || !historyHasMore}
                    onClick={() => void loadApprovalHistory(historyPage + 1)}
                  >
                    التالي
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {showResults && (
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
        open={submitOpen}
        title="إرسال تشغيل الرواتب للمراجعة"
        message="سيتم قفل نتائج التشغيل وإرسالها للمراجعة. لن يمكن إعادة الاحتساب أو التعديل أو الإلغاء إلى أن يُتخذ قرار من المراجع المخول."
        warning="لن يُسمح بالإرسال عند وجود أخطاء احتساب أو مشكلات حاجبة."
        commentOptional
        reason={submitComment}
        onReasonChange={setSubmitComment}
        reasonLabel="تعليق (اختياري)"
        reasonPlaceholder="ملاحظة للمراجع إن لزم…"
        reasonHelper="التعليق اختياري وبحد أقصى 500 حرف."
        summaryLines={[
          { label: 'الأشخاص', value: String(totalPeople) },
          { label: 'الاستحقاقات', value: iqdWhole(run.gross_total) },
          { label: 'الاستقطاعات', value: iqdWhole(run.deduction_total) },
          { label: 'الصافي', value: iqdWhole(run.net_total) },
          { label: 'تحذيرات', value: String(run.warning_count ?? approvalMeta?.warning_count ?? 0) },
          ...(run.snapshot_hash
            ? [{ label: 'بصمة', value: String(run.snapshot_hash).slice(0, 12) }]
            : []),
        ]}
        confirmLabel="إرسال للمراجعة"
        busyLabel="جارٍ إرسال الرواتب للمراجعة..."
        busy={submitting}
        onCancel={() => {
          if (!submitting) {
            setSubmitOpen(false);
            setSubmitMsg('');
            setSubmitComment('');
          }
        }}
        onConfirm={() => void doSubmitReview()}
      />

      <ConfirmDialog
        open={approveOpen}
        title="اعتماد تشغيل الرواتب"
        message="سيُعتمد التشغيل وتُثبَّت نتائج المراجعة. لن يمكن إعادة الاحتساب أو التعديل بعد الاعتماد في هذه المرحلة."
        warning="التحقق من سلامة النتائج إلزامي قبل الاعتماد. لا يوجد ترحيل محاسبي في هذه المرحلة."
        commentOptional
        reason={approveComment}
        onReasonChange={setApproveComment}
        reasonLabel="تعليق الاعتماد (اختياري)"
        reasonPlaceholder="ملاحظة عند الاعتماد إن لزم…"
        reasonHelper="التعليق اختياري وبحد أقصى 500 حرف."
        summaryLines={[
          { label: 'الأشخاص', value: String(totalPeople) },
          { label: 'الاستحقاقات', value: iqdWhole(run.gross_total) },
          { label: 'الاستقطاعات', value: iqdWhole(run.deduction_total) },
          { label: 'الصافي', value: iqdWhole(run.net_total) },
          { label: 'الدورة', value: String(approvalMeta?.approval_cycle ?? '—') },
          ...(approvalMeta?.review_snapshot_hash_short
            ? [{ label: 'بصمة المراجعة', value: String(approvalMeta.review_snapshot_hash_short) }]
            : run.snapshot_hash
              ? [{ label: 'بصمة', value: String(run.snapshot_hash).slice(0, 12) }]
              : []),
        ]}
        confirmLabel="اعتماد الرواتب"
        busyLabel="جارٍ اعتماد الرواتب..."
        busy={approving}
        onCancel={() => {
          if (!approving) {
            setApproveOpen(false);
            setApproveMsg('');
            setApproveComment('');
          }
        }}
        onConfirm={() => void doApprove()}
      />

      <ConfirmDialog
        open={rejectOpen}
        title="رفض مراجعة الرواتب"
        message="سيُعاد التشغيل إلى حالة محتسب للتصحيح. يمكن بعد ذلك إعادة الاحتساب أو الإرسال للمراجعة من جديد."
        warning="سبب الرفض إلزامي وواضح للمُرسل."
        reasonRequired
        reason={rejectReason}
        onReasonChange={setRejectReason}
        reasonLabel="سبب الرفض"
        reasonPlaceholder="مثال: تصحيح راتب موظف أو معالجة أخطاء ظاهرة في النتائج"
        reasonHelper="اكتب سبباً واضحاً لا يقل عن 10 أحرف."
        reasonMinLength={10}
        summaryLines={[
          { label: 'الأشخاص', value: String(totalPeople) },
          { label: 'الصافي', value: iqdWhole(run.net_total) },
          { label: 'الدورة', value: String(approvalMeta?.approval_cycle ?? '—') },
        ]}
        confirmLabel="رفض وإعادة للتصحيح"
        busyLabel="جارٍ رفض المراجعة..."
        busy={rejecting}
        onCancel={() => {
          if (!rejecting) {
            setRejectOpen(false);
            setRejectMsg('');
            setRejectReason('');
          }
        }}
        onConfirm={() => void doReject()}
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
