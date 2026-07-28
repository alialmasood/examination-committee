'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useSilentPromotionRefresh } from './_hooks/useSilentPromotionRefresh';

type YearRow = { year: string; studentCount: number };

function yearsSignature(years: YearRow[]) {
  return years.map((y) => `${y.year}:${y.studentCount}`).join('|');
}

export default function PromotionsYearsPage() {
  const [years, setYears] = useState<YearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/student-affairs/promotions/years', {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data.success) {
        if (!silent) {
          setError(data.error || 'تعذر التحميل');
          setYears([]);
        }
        return;
      }
      const next = (data.data || []) as YearRow[];
      const nextSig = yearsSignature(next);
      if (nextSig !== signatureRef.current) {
        signatureRef.current = nextSig;
        setYears(next);
      }
      setError(null);
    } catch {
      if (!silent) {
        setError('خطأ في الاتصال');
        setYears([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useSilentPromotionRefresh(load);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-800">ترحيل الطلبة</h1>
        <p className="mt-1 text-sm text-slate-500">
          اختر العام الدراسي ثم القسم والمرحلة لترحيل الطلبة إلى المرحلة التالية
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          تُحدَّث الأعداد تلقائياً عند تغيّر حالات الترحيل
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">جارٍ التحميل...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : years.length === 0 ? (
        <p className="text-sm text-slate-500">لا توجد أعوام دراسية مسجّلة</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-right text-slate-600">
                <th className="px-4 py-3 font-semibold">العام الدراسي</th>
                <th className="px-4 py-3 font-semibold">عدد الطلبة</th>
                <th className="px-4 py-3 font-semibold w-28"></th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-800 tabular-nums">{y.year}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{y.studentCount}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/student-affairs/promotions/${encodeURIComponent(y.year)}`}
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
