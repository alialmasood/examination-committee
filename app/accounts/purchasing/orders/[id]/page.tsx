'use client';

import { use } from 'react';
import { OrderDetail } from '../../_components/PurchasingPages';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrderDetail id={id} />;
}
