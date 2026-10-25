'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyStudentsLiveUpdate } from '@/src/lib/students-live-sync';

type ApprovalRow = {
  id: string;
  studentId: string;
  studentName: string;
  universityId: string;
  department: string;
  academicYear: string | null;
  fromStageLabel: string;
  toStageLabel: string;
  feeYear: number;
  remainingAmount: number;
  status: string;
  requestedBy: string | null;
  createdAt: string;
};

type SearchHit = {
  id: string;
  fullName: string;
  universityId: string;
  department: string;
  currentStage: string;
  currentStageLabel: string;
};

type HistoryItem = {
  id: string;
  source: string;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  feeYear: number | null;
  targetStage: string | null;
  clearedFeeYearsRevoked: number[];
  actorUsername: string | null;
  notes: string | null;
  createdAt: string;
};

type HistoryPayload = {
  student: {
    id: string;
    fullName: string;
    universityId: string;
    department: string;
    academicYear: string | null;
    currentStage: string;
    currentStageLabel: string;
  };
  history: HistoryItem[];
  availableTargets: Array<{ stage: string; label: string; feeYear: number }>;
  warningsByTarget: Record<
    string,
    Array<{ feeYear: number; receiptCount: number; totalPaid: number }>
  >;
};

type TabKey = 'pending' | 'revert';

const POLL_MS = 8000;
const CHANNEL_NAME = 'stage-promotions';

const KIND_LABELS: Record<string, string> = {
  direct: 'ترحيل مباشر',
  approved_request: 'موافقة ترحيل',
  approved: 'موافقة ترحيل',
  revert: 'إرجاع',
  reverted: 'ملغى الاجتياز',
  pending: 'معلّق',
  rejected: 'مرفوض',
};

const STAGE_LABELS: Record<string, string> = {
  first: 'الأولى',
  second: 'الثانية',
  third: 'الثالثة',
  fourth: 'الرابعة',
};

function money(n: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function rowsSignature(rows: ApprovalRow[], pendingCount: number) {
  return `${pendingCount}:${rows.map((r) => r.id).join(',')}`;
}

function stageText(code: string | null | undefined) {
  if (!code) return '—';
  return STAGE_LABELS[code] || code;
}

export default function PromotionApprovalsPage() {
  const [tab, setTab] = useState<TabKey>('pending');
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const signatureRef = useRef('');
  const busyRef = useRef(false);

  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [targetStage, setTargetStage] = useState('');
  const [revertBusy, setRevertBusy] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (busyRef.current && silent) return;

    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/accounts/promotion-approvals?status=pending', {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data.success) {
        if (!silent) {
          setError(data.error || data.message || 'تعذر التحميل');
          setRows([]);
        }
        return;
      }

      const nextRows = (data.data || []) as ApprovalRow[];
      const nextCount = Number(data.pendingCount || 0);
      const nextSig = rowsSignature(nextRows, nextCount);

      if (nextSig !== signatureRef.current) {
        signatureRef.current = nextSig;
        setRows(nextRows);
        setPendingCount(nextCount);
      }
      setError(null);
    } catch {
      if (!silent) setError('خطأ في الاتصال');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ silent: false });

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (tab !== 'pending') return;
      void load({ silent: true });
    }, POLL_MS);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (
          event?.data?.type === 'promotion-request-created' ||
          event?.data?.type === 'promotion-reviewed' ||
          event?.data?.type === 'promotion-reverted'
        ) {
          void load({ silent: true });
        }
      };
    } catch {
      // BroadcastChannel غير متاح
    }

    const onFocus = () => {
      if (tab === 'pending') void load({ silent: true });
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      try {
        channel?.close();
      } catch {
        // ignore
      }
    };
  }, [load, tab]);

  const review = async (requestId: string, action: 'approve' | 'reject') => {
    const label = action === 'approve' ? 'الموافقة وترحيل الطالب' : 'رفض الطلب';
    if (!confirm(`تأكيد ${label}؟`)) return;

    try {
      busyRef.current = true;
      setBusyId(requestId);
      setMessage(null);
      const res = await fetch('/api/accounts/promotion-approvals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || data.message || 'فشلت العملية');
        return;
      }
      setMessage(data.message);
      try {
        const ch = new BroadcastChannel(CHANNEL_NAME);
        ch.postMessage({ type: 'promotion-reviewed', action });
        ch.close();
      } catch {
        // ignore
      }
      if (action === 'approve') {
        notifyStudentsLiveUpdate({
          type: 'student-updated',
          studentIds: [rows.find((r) => r.id === requestId)?.studentId].filter(
            Boolean
          ) as string[],
          source: 'accounts/promotion-approvals',
        });
      }
      await load({ silent: true });
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) {
      setSearchHits([]);
      return;
    }
    try {
      setSearching(true);
      setError(null);
      const res = await fetch(
        `/api/accounts/promotion-approvals?view=search&q=${encodeURIComponent(q)}`,
        { credentials: 'include', cache: 'no-store' }
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'تعذر البحث');
        setSearchHits([]);
        return;
      }
      setSearchHits((data.data || []) as SearchHit[]);
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setSearching(false);
    }
  };

  const loadHistory = async (studentId: string) => {
    try {
      setHistoryLoading(true);
      setError(null);
      setMessage(null);
      setTargetStage('');
      const res = await fetch(
        `/api/accounts/promotion-approvals?view=history&studentId=${encodeURIComponent(studentId)}`,
        { credentials: 'include', cache: 'no-store' }
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'تعذر جلب السجل');
        setHistory(null);
        return;
      }
      setHistory(data as HistoryPayload);
      const targets = (data.availableTargets || []) as HistoryPayload['availableTargets'];
      if (targets.length === 1) setTargetStage(targets[0].stage);
    } catch {
      setError('خطأ في الاتصال');
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const doRevert = async () => {
    if (!history || !targetStage) return;
    const target = history.availableTargets.find((t) => t.stage === targetStage);
    if (!target) return;

    const warnings = history.warningsByTarget?.[targetStage] || [];
    let confirmMsg = `تأكيد إرجاع الطالب إلى المرحلة ${target.label}؟\nسيتم إلغاء اجتياز ملفات السنوات من السنة ${target.feeYear} فما فوق.`;
    if (warnings.length > 0) {
      confirmMsg +=
        `\n\nتنبيه: توجد وصولات على سنوات أعلى ولن تُحذف:\n` +
        warnings
          .map(
            (w) =>
              `• سنة ${w.feeYear}: ${w.receiptCount} وصل / ${money(w.totalPaid)} د.ع`
          )
          .join('\n');
    }
    if (!confirm(confirmMsg)) return;

    try {
      setRevertBusy(true);
      setError(null);
      const res = await fetch('/api/accounts/promotion-approvals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revert',
          studentId: history.student.id,
          targetStage,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'فشل الإرجاع');
        return;
      }
      setMessage(data.message);
      try {
        const ch = new BroadcastChannel(CHANNEL_NAME);
        ch.postMessage({ type: 'promotion-reverted', studentId: history.student.id });
        ch.close();
      } catch {
        // ignore
      }
      notifyStudentsLiveUpdate({
        type: 'student-updated',
        studentIds: [history.student.id],
        source: 'accounts/promotion-approvals',
      });
      await loadHistory(history.student.id);
      await load({ silent: true });
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setRevertBusy(false);
    }
  };

  const selectedWarnings =
    history && targetStage ? history.warningsByTarget?.[targetStage] || [] : [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">موافقات ترحيل المراحل</h1>
            <p className="mt-1 text-sm text-slate-500">
              طلبات الترحيل المعلّقة، وسجل الترحيلات مع إمكانية الإرجاع لمرحلة سابقة
            </p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            معلّق: {pendingCount}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === 'pending'
                ? 'bg-slate-800 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            الطلبات المعلّقة
          </button>
          <button
            type="button"
            onClick={() => setTab('revert')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === 'revert'
                ? 'bg-slate-800 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            سجل وإرجاع
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {tab === 'pending' && (
        <>
          {loading ? (
            <p className="text-sm text-slate-500">جارٍ التحميل...</p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              لا توجد طلبات معلّقة حالياً
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-right text-slate-600">
                    <th className="px-4 py-3 font-semibold">الطالب</th>
                    <th className="px-4 py-3 font-semibold">القسم / العام</th>
                    <th className="px-4 py-3 font-semibold">الترحيل</th>
                    <th className="px-4 py-3 font-semibold">المتبقي</th>
                    <th className="px-4 py-3 font-semibold">مقدّم الطلب</th>
                    <th className="px-4 py-3 font-semibold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.studentName}</div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {r.universityId}
                        </div>
                        <Link
                          href={`/accounts/students/accounts/student/${r.studentId}`}
                          className="text-[11px] text-sky-700 hover:underline"
                        >
                          فتح الحساب
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{r.department || '—'}</div>
                        <div className="text-xs text-slate-400">{r.academicYear || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.fromStageLabel}
                        <span className="mx-1 text-slate-400">→</span>
                        {r.toStageLabel}
                        <div className="text-xs text-slate-400">ملف السنة {r.feeYear}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-amber-700 font-medium">
                        {money(r.remainingAmount)} د.ع
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <div>{r.requestedBy || '—'}</div>
                        <div className="text-slate-400">
                          {r.createdAt
                            ? new Date(r.createdAt).toLocaleString('ar-IQ')
                            : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void review(r.id, 'approve')}
                            className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            موافقة
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void review(r.id, 'reject')}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            رفض
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'revert' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">بحث عن طالب</h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch();
                }}
                placeholder="الاسم أو الرقم الجامعي"
                className="h-9 min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {searching ? 'جارٍ البحث...' : 'بحث'}
              </button>
            </div>
            {searchHits.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {searchHits.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void loadHistory(s.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right text-sm hover:bg-slate-50"
                    >
                      <div>
                        <div className="font-medium text-slate-800">{s.fullName}</div>
                        <div className="text-xs text-slate-500">
                          {s.universityId} · {s.department || '—'}
                        </div>
                      </div>
                      <span className="text-xs text-slate-600">
                        المرحلة {s.currentStageLabel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {historyLoading && (
            <p className="text-sm text-slate-500">جارٍ تحميل السجل...</p>
          )}

          {history && !historyLoading && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800">
                      {history.student.fullName}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {history.student.universityId} · {history.student.department || '—'} ·{' '}
                      {history.student.academicYear || '—'}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      المرحلة الحالية:{' '}
                      <span className="font-semibold">
                        {history.student.currentStageLabel}
                      </span>
                    </p>
                  </div>
                  <Link
                    href={`/accounts/students/accounts/student/${history.student.id}`}
                    className="text-xs text-sky-700 hover:underline"
                  >
                    فتح بطاقة الحساب
                  </Link>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                  سجل الترحيلات
                </div>
                {history.history.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500">
                    لا يوجد سجل ترحيل محفوظ لهذا الطالب بعد. يمكن الإرجاع يدوياً إن كانت
                    المرحلة الحالية أعلى من المستهدفة.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-right text-slate-600">
                        <th className="px-4 py-2 font-semibold">التاريخ</th>
                        <th className="px-4 py-2 font-semibold">النوع</th>
                        <th className="px-4 py-2 font-semibold">الانتقال</th>
                        <th className="px-4 py-2 font-semibold">ملف السنة</th>
                        <th className="px-4 py-2 font-semibold">المنفّذ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.history.map((h) => (
                        <tr
                          key={h.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="px-4 py-2 text-xs text-slate-500">
                            {h.createdAt
                              ? new Date(h.createdAt).toLocaleString('ar-IQ')
                              : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {KIND_LABELS[h.kind] || h.kind}
                          </td>
                          <td className="px-4 py-2 text-slate-700">
                            {h.kind === 'revert' ? (
                              <>
                                {stageText(h.fromStage)}
                                <span className="mx-1 text-slate-400">←</span>
                                {stageText(h.targetStage || h.toStage)}
                                {h.clearedFeeYearsRevoked?.length > 0 && (
                                  <div className="text-[11px] text-amber-700">
                                    أُلغي اجتياز:{' '}
                                    {h.clearedFeeYearsRevoked
                                      .map((y) => `سنة ${y}`)
                                      .join('، ')}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                {stageText(h.fromStage)}
                                <span className="mx-1 text-slate-400">→</span>
                                {stageText(h.toStage)}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-slate-600">
                            {h.feeYear ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-500">
                            {h.actorUsername || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">إرجاع إلى مرحلة سابقة</h3>
                {history.availableTargets.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    لا يمكن الإرجاع — الطالب في المرحلة الأولى أو لا توجد مرحلة أقدم.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          المرحلة المستهدفة
                        </label>
                        <select
                          value={targetStage}
                          onChange={(e) => setTargetStage(e.target.value)}
                          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
                        >
                          <option value="">اختر المرحلة</option>
                          {history.availableTargets.map((t) => (
                            <option key={t.stage} value={t.stage}>
                              {t.label} (ملف السنة {t.feeYear})
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        disabled={!targetStage || revertBusy}
                        onClick={() => void doRevert()}
                        className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        {revertBusy ? 'جارٍ الإرجاع...' : 'إرجاع المرحلة'}
                      </button>
                    </div>
                    {selectedWarnings.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        تنبيه: توجد وصولات على سنوات أعلى من المرحلة المستهدفة ولن تُحذف:
                        <ul className="mt-1 list-disc pr-4">
                          {selectedWarnings.map((w) => (
                            <li key={w.feeYear}>
                              سنة {w.feeYear}: {w.receiptCount} وصل /{' '}
                              {money(w.totalPaid)} د.ع
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400">
                      الإرجاع يعيد مرحلة الطالب ويلغي اجتياز ملفات السنوات المرتبطة بالترحيل
                      الخاطئ، دون حذف الوصولات.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
