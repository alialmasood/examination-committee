import { expenseTransition } from '@/src/lib/accounts/supplier-payables-api';
export async function POST(request: Request, context: {params:Promise<{id:string}>}) { return expenseTransition(request as never, context, 'post'); }
