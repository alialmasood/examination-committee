import { NextRequest } from 'next/server';
import { AccountsHttpError,isAuthFailure,jsonError,jsonSuccess,mapPgError,requireAccountsAccess } from '@/src/lib/accounts/auth';
import { getSupplierLedger,serializeSupplierLedgerEntry } from '@/src/lib/accounts/supplier-invoices';
import { SUPPLIER_PAYABLES_CAPABILITIES,assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:NextRequest,context:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{await assertSupplierPayablesCapability(null,auth.user.id,SUPPLIER_PAYABLES_CAPABILITIES.VIEW);const {id}=await context.params;const sp=request.nextUrl.searchParams;const r=await withTransaction(client=>getSupplierLedger(client,{supplierAccountId:id,date_from:sp.get('date_from'),date_to:sp.get('date_to'),page:Math.max(1,Number(sp.get('page')||1)),page_size:Math.min(100,Math.max(1,Number(sp.get('page_size')||50)))}));return jsonSuccess({data:r.rows.map(serializeSupplierLedgerEntry),balance:r.balance,pagination:{page:r.page,page_size:r.page_size,total:r.total,total_pages:Math.ceil(r.total/r.page_size)||1}});}catch(error){return error instanceof AccountsHttpError?jsonError(error.message,error.status):mapPgError(error);}}
