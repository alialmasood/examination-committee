'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { useSilentPromotionRefresh } from '../_hooks/useSilentPromotionRefresh';

type GroupRow = {
  department: string;
  stage: string;
  stageLabel: string;
  total: number;
  ready: number;
  owed: number;
  pending: number;
};

function groupsSignature(groups: GroupRow[]) {
  return groups
    .map(
      (g) =>
        `${g.department}:${g.stage}:${g.total}:${g.ready}:${g.owed}:${g.pending}`
    )
    .join('|');
}

export default function PromotionsGroupsPage() {
  const params = useParams();
  const year = decodeURIComponent(String(params.year || ''));
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef('');

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!year) return;
      const silent = Boolean(opts?.silent);
      try {
        if (!silent) setLoading(true);
        const res = await fetch(
          `/api/student-affairs/promotions/${encodeURIComponent(year)}/groups`,
          { credentials: 'include', cache: 'no-store' }
        );
        const data = await res.json();
        if (!data.success) {
          if (!silent) {
            setError(data.error || 'تعذر التحميل');
            setGroups([]);
          }
          return;
        }
        const next = (data.data || []) as GroupRow[];
        const nextSig = groupsSignature(next);
        if (nextSig !== signatureRef.current) {
          signatureRef.current = nextSig;
          setGroups(next);
        }
        setError(null);
      } catch {
        if (!silent) {
          setError('خطأ في الاتصال');
          setGroups([]);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [year]
  );

  useSilentPromotionRefresh(load, Boolean(year));

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
          <Link href="/student-affairs/promotions" className="hover:text-slate-800">
            ترحيل الطلبة
          </Link>
          <span>/</span>
          <span className="text-slate-700">{year}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">أقسام العام {year}</h1>
        <p className="mt-1 text-sm text-slate-500">
          كل صف يمثل قسماً مع مرحلته الحالية. جاهز = مسدد بالكامل · بذمة = متبقٍ · معلّق = بانتظار الحسابات
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          تُحدَّث الأعداد تلقائياً عند موافقة الحسابات أو تغيّر حالة الترحيل
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">جارٍ التحميل...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">لا يوجد طلبة في هذا العام</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-right text-slate-600">
                <th className="px-4 py-3 font-semibold">القسم</th>
                <th className="px-4 py-3 font-semibold">المرحلة</th>
                <th className="px-4 py-3 font-semibold">العدد</th>
                <th className="px-4 py-3 font-semibold">جاهز</th>
                <th className="px-4 py-3 font-semibold">بذمة</th>
                <th className="px-4 py-3 font-semibold">معلّق</th>
                <th className="px-4 py-3 font-semibold w-28"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={`${g.department}-${g.stage}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{g.department}</td>
                  <td className="px-4 py-3 text-slate-700">{g.stageLabel}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{g.total}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-700">{g.ready}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700">{g.owed}</td>
                  <td className="px-4 py-3 tabular-nums text-sky-700">{g.pending}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/student-affairs/promotions/${encodeURIComponent(year)}/${encodeURIComponent(g.department)}/${g.stage}`}
                      className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white"
                    >
                      فتح
                    </Link>
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
