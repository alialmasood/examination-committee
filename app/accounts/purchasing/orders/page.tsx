'use client';

import { Suspense } from 'react';
import { OrderList } from '../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <OrderList />
    </Suspense>
  );
}
