import { paymentTransition } from '@/src/lib/accounts/supplier-payables-api';
export async function POST(request: Request, context: {params:Promise<{id:string}>}) { return paymentTransition(request as never, context, 'void'); }
