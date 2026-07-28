'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  STAGE_PROMOTIONS_CHANNEL,
  useSilentPromotionRefresh,
} from '../../../_hooks/useSilentPromotionRefresh';

type StudentRow = {
  id: string;
  universityId: string;
  fullName: string;
  nickname: string;
  studyType: 'morning' | 'evening';
  stage: string;
  stageLabel: string;
  nextStage: string | null;
  nextStageLabel: string | null;
  feeYear: number;
  remaining: number;
  paid: number;
  target: number;
  isComplete: boolean;
  canPromote: boolean;
  pendingRequestId: string | null;
};

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function listSignature(morning: StudentRow[], evening: StudentRow[]) {
  return [...morning, ...evening]
    .map(
      (s) =>
        `${s.id}:${s.isComplete}:${s.remaining}:${s.pendingRequestId || ''}:${s.stage}`
    )
    .join('|');
}

export default function PromotionsStudentsPage() {
  const params = useParams();
  const year = decodeURIComponent(String(params.year || ''));
  const department = decodeURIComponent(String(params.department || ''));
  const stage = String(params.stage || '');

  const [morning, setMorning] = useState<StudentRow[]>([]);
  const [evening, setEvening] = useState<StudentRow[]>([]);
  const [stageLabel, setStageLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const signatureRef = useRef('');
  const submittingRef = useRef(false);

  const isFourth = stage === 'fourth';
  const allStudents = useMemo(() => [...morning, ...evening], [morning, evening]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!year || !department || !stage) return;
      const silent = Boolean(opts?.silent);
      if (silent && submittingRef.current) return;

      try {
        if (!silent) setLoading(true);
        const qs = new URLSearchParams({ year, department, stage });
        const res = await fetch(`/api/student-affairs/promotions/students?${qs}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await res.json();
        if (!data.success) {
          if (!silent) {
            setError(data.error || 'تعذر التحميل');
            setMorning([]);
            setEvening([]);
          }
          return;
        }

        const nextMorning = (data.morning || []) as StudentRow[];
        const nextEvening = (data.evening || []) as StudentRow[];
        const nextSig = listSignature(nextMorning, nextEvening);

        if (nextSig !== signatureRef.current) {
          signatureRef.current = nextSig;
          setMorning(nextMorning);
          setEvening(nextEvening);
          setStageLabel(data.stageLabel || '');

          const alive = new Set(
            [...nextMorning, ...nextEvening].map((s) => s.id)
          );
          setSelected((prev) => {
            if (!silent) return new Set();
            const next = new Set<string>();
            for (const id of prev) {
              if (alive.has(id)) next.add(id);
            }
            return next;
          });
        } else if (!silent) {
          setStageLabel(data.stageLabel || '');
          setSelected(new Set());
        }
        setError(null);
      } catch {
        if (!silent) setError('خطأ في الاتصال');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [year, department, stage]
  );

  useSilentPromotionRefresh(load, Boolean(year && department && stage));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectReady = (list: StudentRow[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of list) {
        if (s.canPromote && !s.pendingRequestId && s.isComplete) next.add(s.id);
      }
      return next;
    });
  };

  const selectAllInList = (list: StudentRow[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of list) {
        if (s.canPromote && !s.pendingRequestId) next.add(s.id);
      }
      return next;
    });
  };

  const clearList = (list: StudentRow[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of list) next.delete(s.id);
      return next;
    });
  };

  const promote = async (ids: string[]) => {
    if (!ids.length || isFourth || submitting) return;

    const owed = allStudents.filter((s) => ids.includes(s.id) && !s.isComplete);
    if (owed.length > 0) {
      const names = owed
        .slice(0, 3)
        .map((s) => s.fullName)
        .join('، ');
      const more = owed.length > 3 ? ` و${owed.length - 3} آخرين` : '';
      const ok = confirm(
        `بعض الطلبة بذمتهم مبلغ غير مسدد (${names}${more}).\n\nسيتم إرسال طلب تأكيد إلى نظام الحسابات بدل الترحيل المباشر.\nالمسددون بالكامل سيُرحَّلون فوراً.\n\nهل تريد المتابعة؟`
      );
      if (!ok) return;
    } else {
      const ok = confirm(
        `تأكيد ترحيل ${ids.length} طالب من المرحلة ${stageLabel} إلى المرحلة التالية؟`
      );
      if (!ok) return;
    }

    try {
      submittingRef.current = true;
      setSubmitting(true);
      setMessage(null);
      const res = await fetch('/api/student-affairs/promotions/promote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: ids, stage, year, department }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'فشل الترحيل');
        return;
      }
      setMessage(data.message || 'تمت العملية');
      if (data.result?.requested?.length) {
        try {
          const ch = new BroadcastChannel(STAGE_PROMOTIONS_CHANNEL);
          ch.postMessage({
            type: 'promotion-request-created',
            count: data.result.requested.length,
          });
          ch.close();
        } catch {
          // ignore
        }
      }
      if (data.result?.promoted?.length) {
        try {
          const ch = new BroadcastChannel(STAGE_PROMOTIONS_CHANNEL);
          ch.postMessage({ type: 'promotion-reviewed', action: 'direct-promote' });
          ch.close();
        } catch {
          // ignore
        }
      }
      await load({ silent: true });
    } catch {
      setError('خطأ في الاتصال أثناء الترحيل');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const renderList = (title: string, list: StudentRow[]) => (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{list.length} طالب</p>
        </div>
        {!isFourth && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => selectReady(list)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-white"
            >
              تحديد الجاهزين
            </button>
            <button
              type="button"
              onClick={() => selectAllInList(list)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-white"
            >
              تحديد الكل
            </button>
            <button
              type="button"
              onClick={() => clearList(list)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-white"
            >
              إلغاء التحديد
            </button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">لا يوجد طلبة</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((s) => {
            const disabled = isFourth || Boolean(s.pendingRequestId) || !s.canPromote;
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50/70"
              >
                {!isFourth && (
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    disabled={disabled}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-800"
                  />
                )}
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                    s.pendingRequestId
                      ? 'bg-sky-500'
                      : s.isComplete
                        ? 'bg-emerald-500'
                        : 'bg-amber-500'
                  }`}
                  title={
                    s.pendingRequestId
                      ? 'طلب معلّق'
                      : s.isComplete
                        ? 'مسدد بالكامل'
                        : 'بذمة متبقية'
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{s.fullName}</span>
                    {s.nickname ? (
                      <span className="text-xs text-slate-400">{s.nickname}</span>
                    ) : null}
                    {s.pendingRequestId ? (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                        بانتظار الحسابات
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="tabular-nums">{s.universityId}</span>
                    {!s.isComplete && (
                      <span className="text-amber-700 tabular-nums">
                        متبقٍ: {formatMoney(s.remaining)} د.ع
                      </span>
                    )}
                    {s.isComplete && (
                      <span className="text-emerald-700">ملف السنة مكتمل</span>
                    )}
                  </div>
                </div>
                {!isFourth && !s.pendingRequestId && s.canPromote && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void promote([s.id])}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    ترحيل
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
          <Link href="/student-affairs/promotions" className="hover:text-slate-800">
            ترحيل الطلبة
          </Link>
          <span>/</span>
          <Link
            href={`/student-affairs/promotions/${encodeURIComponent(year)}`}
            className="hover:text-slate-800"
          >
            {year}
          </Link>
          <span>/</span>
          <span className="text-slate-700">
            {department} · المرحلة {stageLabel || stage}
          </span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{department}</h1>
            <p className="mt-1 text-sm text-slate-500">
              المرحلة الحالية: {stageLabel || stage}
              {isFourth
                ? ' — لا يمكن الترحيل من المرحلة الرابعة'
                : ' — الترحيل إلى المرحلة التالية'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              تُحدَّث القائمة تلقائياً عند موافقة الحسابات أو تغيّر الحالة
            </p>
          </div>
          {!isFourth && (
            <button
              type="button"
              disabled={submitting || selected.size === 0}
              onClick={() => void promote(Array.from(selected))}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'جارٍ التنفيذ...' : `ترحيل المحدد (${selected.size})`}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> مسدد بالكامل
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> بذمة متبقية
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-500" /> طلب معلّق للحسابات
          </span>
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

      {loading ? (
        <p className="text-sm text-slate-500">جارٍ التحميل...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {renderList('الدراسة الصباحية', morning)}
          {renderList('الدراسة المسائية', evening)}
        </div>
      )}
    </div>
  );
}
