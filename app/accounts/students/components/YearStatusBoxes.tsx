'use client';

import type { YearVisualEntry, YearVisualStatus } from '../lib/settlementYearLedger';

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

const VISUAL_CLASS: Record<YearVisualStatus, string> = {
  completed: 'bg-emerald-500 text-white border-emerald-600',
  current_partial: 'bg-amber-400 text-amber-950 border-amber-500',
  current_unpaid: 'bg-red-500 text-white border-red-600',
  pending: 'bg-white text-gray-500 border-gray-300',
};

const VISUAL_LABEL: Record<YearVisualStatus, string> = {
  completed: 'مكتملة',
  current_partial: 'جارية — مسدد جزئياً',
  current_unpaid: 'جارية — غير مسددة',
  pending: 'لم تبدأ',
};

export function YearStatusLegend() {
  const items: Array<{ status: YearVisualStatus; label: string }> = [
    { status: 'completed', label: 'مكتملة' },
    { status: 'current_partial', label: 'جارية جزئياً' },
    { status: 'current_unpaid', label: 'جارية بلا تسديد' },
    { status: 'pending', label: 'لم تبدأ' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
      <span className="font-medium text-gray-700">دليل السنوات:</span>
      {items.map((item) => (
        <span key={item.status} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3.5 w-3.5 rounded-sm border ${VISUAL_CLASS[item.status]}`}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

type Props = {
  years?: YearVisualEntry[] | null;
};

export default function YearStatusBoxes({ years }: Props) {
  const list =
    years && years.length === 4
      ? years
      : ([1, 2, 3, 4] as const).map((year) => ({
          year,
          label: `السنة ${year}`,
          visual: 'pending' as YearVisualStatus,
          target: 0,
          paid: 0,
          remaining: 0,
          isCurrent: year === 1,
        }));

  return (
    <div
      className="inline-flex items-center shrink-0 rounded-sm overflow-hidden border border-gray-300"
      title="حالة تسديد السنوات الأربع"
      dir="ltr"
    >
      {list.map((entry) => {
        const tip = [
          entry.label,
          VISUAL_LABEL[entry.visual],
          `مستحق: ${money(entry.target)} IQD`,
          `مدفوع: ${money(entry.paid)} IQD`,
          `متبقي: ${money(entry.remaining)} IQD`,
        ].join(' · ');

        return (
          <span
            key={entry.year}
            title={tip}
            className={`inline-flex h-5 w-5 items-center justify-center text-[10px] font-bold border-l border-black/10 first:border-l-0 ${
              VISUAL_CLASS[entry.visual]
            } ${entry.isCurrent ? 'ring-2 ring-inset ring-indigo-700/70' : ''}`}
          >
            {entry.year}
          </span>
        );
      })}
    </div>
  );
}
