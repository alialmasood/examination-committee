import { expenseType } from '@/src/lib/accounts/supplier-payables-api';
export async function POST(request: Request, context: {params:Promise<{id:string}>}) { return expenseType(request as never, context, 'deactivate'); }
