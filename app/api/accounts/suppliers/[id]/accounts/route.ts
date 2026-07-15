import { NextRequest } from 'next/server';
import { AccountsHttpError,isAuthFailure,jsonError,jsonSuccess,mapPgError,requireAccountsAccess } from '@/src/lib/accounts/auth';
import { createSupplierAccount,serializeSupplierAccount } from '@/src/lib/accounts/supplier-accounts';
import { SUPPLIER_PAYABLES_CAPABILITIES,assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function POST(request:NextRequest,context:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{const {id}=await context.params;const body=await request.json();const row=await withTransaction(async client=>{await assertSupplierPayablesCapability(client,auth.user.id,SUPPLIER_PAYABLES_CAPABILITIES.MANAGE);return createSupplierAccount(client,{...body,supplier_id:id,created_by:auth.user.id});});return jsonSuccess({data:serializeSupplierAccount(row)},201);}catch(error){return error instanceof AccountsHttpError?jsonError(error.message,error.status):mapPgError(error);}}
