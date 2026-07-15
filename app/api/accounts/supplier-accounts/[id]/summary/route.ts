import { NextRequest } from 'next/server';
import { AccountsHttpError,isAuthFailure,jsonError,jsonSuccess,mapPgError,requireAccountsAccess } from '@/src/lib/accounts/auth';
import { getSupplierAccountSummary } from '@/src/lib/accounts/supplier-invoices';
import { SUPPLIER_PAYABLES_CAPABILITIES,assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:NextRequest,context:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{await assertSupplierPayablesCapability(null,auth.user.id,SUPPLIER_PAYABLES_CAPABILITIES.VIEW);const {id}=await context.params;return jsonSuccess({data:await withTransaction(client=>getSupplierAccountSummary(client,id))});}catch(error){return error instanceof AccountsHttpError?jsonError(error.message,error.status):mapPgError(error);}}
