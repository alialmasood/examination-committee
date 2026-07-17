'use client';

import { Suspense } from 'react';
import { MatchingPage } from '../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <MatchingPage />
    </Suspense>
  );
}
