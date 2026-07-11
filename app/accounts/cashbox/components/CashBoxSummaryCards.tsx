'use client';

import { CashBoxStats, formatIqd } from './types';

type Props = {
  stats: CashBoxStats | null;
  pageBalancesSum: string | null;
  loading?: boolean;
};

export default function CashBoxSummaryCards({
  stats,
  pageBalancesSum,
  loading,
}: Props) {
  const cards = [
    { label: 'إجمالي الصناديق', value: stats ? String(stats.total) : '—' },
    { label: 'النشطة', value: stats ? String(stats.active) : '—' },
    { label: 'المسودات', value: stats ? String(stats.draft) : '—' },
    { label: 'المعلّقة', value: stats ? String(stats.suspended) : '—' },
    {
      label: 'مجموع أرصدة الصفحة',
      value: pageBalancesSum != null ? formatIqd(pageBalancesSum) : '—',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <div className="text-xs text-gray-500 mb-1">{c.label}</div>
          <div className="text-lg font-semibold text-red-950">
            {loading ? '…' : c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
