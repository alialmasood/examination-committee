'use client';

import type { SessionStats } from './session-types';

export default function SessionSummaryCards({
  stats,
  loading,
}: {
  stats: SessionStats | null;
  loading?: boolean;
}) {
  const cards = [
    { label: 'الإجمالي', value: stats?.total },
    { label: 'مفتوحة', value: stats?.open },
    { label: 'قيد الإغلاق', value: stats?.closing },
    { label: 'مغلقة', value: stats?.closed },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
        >
          <div className="text-xs text-gray-500">{c.label}</div>
          <div className="text-lg font-semibold text-gray-900 mt-1">
            {loading ? (
              <span className="inline-block h-6 w-10 bg-gray-200 animate-pulse rounded" />
            ) : (
              c.value ?? '—'
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
