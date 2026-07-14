import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { createStudentCreditNote, listStudentCreditNotes, serializeStudentCreditNote } from '@/src/lib/accounts/student-credit-notes';
import { STUDENT_RECEIVABLES_CAPABILITIES, assertStudentReceivablesCapability } from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;
  try {await assertStudentReceivablesCapability(null,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_VIEW);const q=request.nextUrl.searchParams;const result=await withTransaction(c=>listStudentCreditNotes(c,{status:q.get('status'),student_account_id:q.get('student_account_id'),page:Number(q.get('page')||1),page_size:Number(q.get('page_size')||20)}));return jsonSuccess({data:result.rows.map(serializeStudentCreditNote),pagination:{page:result.page,page_size:result.page_size,total:result.total,total_pages:Math.ceil(result.total/result.page_size)||1}})}
  catch(e){return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e)}
}
export async function POST(request: NextRequest) {
  const auth=await requireAccountsAccess(request);if(isAuthFailure(auth))return auth.response;
  try {const body=await request.json();const row=await withTransaction(async c=>{await assertStudentReceivablesCapability(c,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_PREPARE);const created=await createStudentCreditNote(c,{...body,requested_by:auth.user.id});await writeFinancialAudit(c,{userId:auth.user.id,action:'student_credit_note.created',entityType:'student_credit_note',entityId:created.id,newValues:serializeStudentCreditNote(created),description:`إنشاء إشعار دائن ${created.credit_note_number}`,ipAddress:auth.ipAddress,userAgent:auth.userAgent});return created});return jsonSuccess({data:serializeStudentCreditNote(row)},201)}
  catch(e){return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e)}
}
