import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { getStudentRefund, listStudentRefundAllocations, updateStudentRefund, serializeStudentRefund } from '@/src/lib/accounts/student-refunds';
import { STUDENT_RECEIVABLES_CAPABILITIES, assertStudentReceivablesCapability } from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{await assertStudentReceivablesCapability(null,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.REFUNDS_VIEW);const {id}=await params;const data=await withTransaction(async c=>({...serializeStudentRefund(await getStudentRefund(c,id)),allocations:await listStudentRefundAllocations(c,id)}));return jsonSuccess({data});}catch(e){return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e)}}
export async function PATCH(request:NextRequest,{params}:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{const {id}=await params;const body=await request.json();const r=await withTransaction(async c=>{await assertStudentReceivablesCapability(c,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.REFUNDS_PREPARE);return updateStudentRefund(c,{...body,id,userId:auth.user.id});});return jsonSuccess({data:serializeStudentRefund(r)});}catch(e){return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e)}}



