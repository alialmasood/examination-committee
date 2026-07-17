'use client';

import { Suspense } from 'react';
import { ReceiptList } from '../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <ReceiptList />
    </Suspense>
  );
}
