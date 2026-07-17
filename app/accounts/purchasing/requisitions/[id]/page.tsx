'use client';

import { use } from 'react';
import { RequisitionDetail } from '../../_components/PurchasingPages';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequisitionDetail id={id} />;
}
