'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const POLL_MS = 8000;
const CHANNEL_NAME = 'stage-promotions';

function money(n: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function rowsSignature(rows: ApprovalRow[], pendingCount: number) {
  return `${pendingCount}:${rows.map((r) => r.id).join(',')}`;
}

export default function PromotionApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const signatureRef = useRef('');
  const busyRef = useRef(false);

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
      void load({ silent: true });
    }, POLL_MS);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event?.data?.type === 'promotion-request-created' || event?.data?.type === 'promotion-reviewed') {
          void load({ silent: true });
        }
      };
    } catch {
      // BroadcastChannel غير متاح
    }

    const onFocus = () => void load({ silent: true });
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
  }, [load]);

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
      await load({ silent: true });
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">موافقات ترحيل المراحل</h1>
            <p className="mt-1 text-sm text-slate-500">
              طلبات من شؤون الطلبة لترحيل طلبة عليهم متبقٍ مالي — الموافقة ترحّل الطالب فوراً
            </p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            معلّق: {pendingCount}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          تُحدَّث القائمة تلقائياً عند وصول طلبات جديدة
        </p>
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
                    <div className="text-xs text-slate-500 tabular-nums">{r.universityId}</div>
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
    </div>
  );
}
