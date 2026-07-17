'use client';

import { Suspense } from 'react';
import { RequisitionList } from '../_components/PurchasingPages';

export default function Page() {
  return (
    <Suspense>
      <RequisitionList />
    </Suspense>
  );
}
