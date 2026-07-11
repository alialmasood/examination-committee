'use client';

import { SESSION_STATUS_LABEL, sessionStatusBadgeClass } from './session-types';

export default function SessionStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${sessionStatusBadgeClass(status)}`}
    >
      {SESSION_STATUS_LABEL[status as keyof typeof SESSION_STATUS_LABEL] || status}
    </span>
  );
}
