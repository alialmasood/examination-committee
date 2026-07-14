'use client';

import { Suspense } from 'react';
import StudentChargesPageInner from './ChargesPageInner';

export default function StudentChargesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6" dir="rtl">
          <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
        </div>
      }
    >
      <StudentChargesPageInner />
    </Suspense>
  );
}
