import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { approveStudentCreditNote } from '@/src/lib/accounts/student-credit-notes';
import { STUDENT_RECEIVABLES_CAPABILITIES, assertStudentReceivablesCapability } from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
type Ctx={params:Promise<{id:string}>};
export async function POST(request:NextRequest,{params}:Ctx){const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;try{const {id}=await params;const body=await request.json().catch(()=>({}));const result=await withTransaction(async c=>{await assertStudentReceivablesCapability(c,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_APPROVE); const r=await approveStudentCreditNote(c,{id,userId:auth.user.id,version:body.version,updated_at:body.updated_at});return r;});return jsonSuccess({data:result});}catch(e){return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e)}}



