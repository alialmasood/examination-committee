import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { getStudentCreditNoteOptions } from '@/src/lib/accounts/student-credit-notes';
import { STUDENT_RECEIVABLES_CAPABILITIES, assertStudentReceivablesCapability } from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
export async function GET(request: NextRequest) { const auth=await requireAccountsAccess(request); if(isAuthFailure(auth))return auth.response; try { await assertStudentReceivablesCapability(null,auth.user.id,STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_VIEW); return jsonSuccess({data:await withTransaction(getStudentCreditNoteOptions)}); } catch(e) { return e instanceof AccountsHttpError?jsonError(e.message,e.status):mapPgError(e); } }
