import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { serializeSupplier, suspendSupplier } from '@/src/lib/accounts/suppliers';
import { SUPPLIER_PAYABLES_CAPABILITIES, assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Ctx) {
 const auth=await requireAccountsAccess(request); if(isAuthFailure(auth)) return auth.response;
 try { const {id}=await context.params; const body=await request.json().catch(()=>({})); const row=await withTransaction(async client=>{ await assertSupplierPayablesCapability(client,auth.user.id,SUPPLIER_PAYABLES_CAPABILITIES.MANAGE); const r=await suspendSupplier(client,{id,userId:auth.user.id,version:body.version,updated_at:body.updated_at}); await writeFinancialAudit(client,{userId:auth.user.id,action:'SUPPLIER_SUSPENDED',entityType:'supplier',entityId:id,newValues:serializeSupplier(r),description:`تعليق المورد ${r.supplier_number}`,ipAddress:auth.ipAddress,userAgent:auth.userAgent}); return r; }); return jsonSuccess({data:serializeSupplier(row)}); } catch(error) { return error instanceof AccountsHttpError?jsonError(error.message,error.status):mapPgError(error); }
}
