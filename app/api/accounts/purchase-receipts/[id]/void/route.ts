import { purchaseReceiptTransition } from '@/src/lib/accounts/purchasing-api';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return purchaseReceiptTransition(request as never, context, 'void');
}
