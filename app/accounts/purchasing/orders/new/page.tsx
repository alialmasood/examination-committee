'use client';

import { Suspense } from 'react';
import { OrderNew } from '../../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <OrderNew />
    </Suspense>
  );
}
