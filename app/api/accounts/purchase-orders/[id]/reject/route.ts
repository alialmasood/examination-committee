import { purchaseOrderTransition } from '@/src/lib/accounts/purchasing-api';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return purchaseOrderTransition(request as never, context, 'reject');
}
