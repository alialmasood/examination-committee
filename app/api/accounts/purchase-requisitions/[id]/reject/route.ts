import { requisitionTransition } from '@/src/lib/accounts/purchasing-api';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return requisitionTransition(request as never, context, 'reject');
}
