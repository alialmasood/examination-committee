'use client';

import { STATUS_LABEL, statusBadgeClass } from './types';

export default function CashBoxStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(status)}`}
    >
      {STATUS_LABEL[status as keyof typeof STATUS_LABEL] || status}
    </span>
  );
}
