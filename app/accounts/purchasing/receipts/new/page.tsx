'use client';

import { Suspense } from 'react';
import { ReceiptNew } from '../../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <ReceiptNew />
    </Suspense>
  );
}
