import { NextRequest } from 'next/server';
import { AccountsHttpError,isAuthFailure,jsonError,jsonSuccess,mapPgError,requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { deactivateSupplierInvoiceType,serializeSupplierInvoiceType } from '@/src/lib/accounts/supplier-invoice-types';
import { SUPPLIER_PAYABLES_CAPABILITIES,assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function POST(request:NextRequest,context:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{const {id}=await context.params;const body=await request.json().catch(()=>({}));const row=await withTransaction(async client=>{await assertSupplierPayablesCapability(client,auth.user.id,SUPPLIER_PAYABLES_CAPABILITIES.INVOICE_TYPES_MANAGE);const r=await deactivateSupplierInvoiceType(client,{id,userId:auth.user.id,version:body.version,updated_at:body.updated_at});await writeFinancialAudit(client,{userId:auth.user.id,action:'SUPPLIER_INVOICE_TYPE_DEACTIVATED',entityType:'supplier_invoice_type',entityId:id,newValues:serializeSupplierInvoiceType(r),description:`إيقاف نوع فاتورة ${r.code}`,ipAddress:auth.ipAddress,userAgent:auth.userAgent});return r;});return jsonSuccess({data:serializeSupplierInvoiceType(row)});}catch(error){return error instanceof AccountsHttpError?jsonError(error.message,error.status):mapPgError(error);}}
