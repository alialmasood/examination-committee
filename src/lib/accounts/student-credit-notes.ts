/**
 * الإشعارات الدائنة للطلبة — 5.C.2.
 * CREDIT_BALANCE_CREATE يولد رصيداً في الدفتر الفرعي فقط ولا يغير استحقاق المطالبة.
 */
import {
  acquireAccountingResourceLocks,
  chartAccountLock,
  journalSourceLock,
  studentAccountLock,
  studentChargeLock,
  studentCreditNoteLock,
  studentLedgerLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  createReversalEntry,
  loadJournalEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import { moneyIsPositive, moneyToMillis, moneyToMillisSigned, millisToMoney, normalizeMoneyInput } from './money';
import { assertPostingAccountWithType } from './posting-account';
import { loadStudentAccount } from './student-accounts';
import { listEligibleReliefExpenseGlAccounts } from './student-relief-types';
import {
  applyChargeCreditNote,
  loadStudentCharge,
  reverseChargeCreditNote,
  writeStudentLedgerEntry,
} from './student-charges';
import {
  recalculateStudentBillingPlanSettlement,
  recalculateStudentInstallmentSettlement,
  sumPostedCollectionsOnCharge,
} from './student-settlement';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentCreditNoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'REJECTED' | 'VOID';
export type StudentCreditNoteMode = 'DEBT_REDUCTION' | 'CREDIT_BALANCE_CREATE';
export type StudentCreditNoteRow = {
  id: string; credit_note_number: string; student_account_id: string; student_id: string;
  student_charge_id: string | null; student_installment_id: string | null; billing_plan_id: string | null;
  fiscal_year_id: string; fiscal_period_id: string; credit_note_date: string | Date;
  reason_code: string; reason: string; amount: string; currency_code: string; application_mode: StudentCreditNoteMode;
  status: StudentCreditNoteStatus; revenue_adjustment_gl_account_id: string;
  journal_entry_id: string | null; reversal_journal_entry_id: string | null;
  external_reference: string | null; requested_by: string; approved_by: string | null; approved_at: Date | string | null;
  rejected_by: string | null; rejected_at: Date | string | null; rejection_reason: string | null;
  posted_by: string | null; posted_at: Date | string | null; voided_by: string | null; voided_at: Date | string | null;
  void_reason: string | null; created_at: Date | string; updated_at: Date | string; version: number;
};

const REASONS = new Set(['FEE_CORRECTION','DUPLICATE_CHARGE','ACADEMIC_WITHDRAWAL','SERVICE_NOT_PROVIDED','ADMINISTRATIVE_ADJUSTMENT','OTHER']);
const iso = (v: Date | string | null) => v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
function optimistic(row: StudentCreditNoteRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({ currentVersion: row.version, currentUpdatedAt: row.updated_at, expectedVersion: version, expectedUpdatedAt: updatedAt });
}
function amount(v: unknown): string {
  let a: string; try { a = normalizeMoneyInput(v); } catch { throw new AccountsHttpError('مبلغ الإشعار الدائن غير صالح', 400); }
  if (!moneyIsPositive(a)) throw new AccountsHttpError('مبلغ الإشعار الدائن يجب أن يكون أكبر من صفر', 400);
  return a;
}
function mode(v: unknown): StudentCreditNoteMode {
  const m = String(v ?? '').trim().toUpperCase();
  if (m !== 'DEBT_REDUCTION' && m !== 'CREDIT_BALANCE_CREATE') throw new AccountsHttpError('وضع تطبيق الإشعار الدائن غير صالح', 400);
  return m;
}
async function fiscal(client: TxClient, date: string) {
  const r = await txQuery<{year_id:string;period_id:string}>(client, `SELECT y.id year_id,p.id period_id FROM accounts.fiscal_years y JOIN accounts.fiscal_periods p ON p.fiscal_year_id=y.id WHERE y.status='ACTIVE' AND p.status='OPEN' AND p.start_date <= $1::date AND p.end_date >= $1::date ORDER BY y.is_default DESC,p.start_date LIMIT 1`, [date]);
  if (!r.rows[0]) throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ الإشعار الدائن', 409);
  return r.rows[0];
}
async function number(client: TxClient, fiscalYearId: string, date: string) {
  await txQuery(client, `INSERT INTO accounts.document_sequences (document_type,fiscal_year_id,prefix,current_number,padding_length,reset_yearly,is_active) SELECT 'STUDENT_CREDIT_NOTE',$1::uuid,'SCN',0,6,TRUE,TRUE WHERE NOT EXISTS (SELECT 1 FROM accounts.document_sequences WHERE document_type='STUDENT_CREDIT_NOTE' AND fiscal_year_id=$1::uuid)`, [fiscalYearId]);
  return (await nextDocumentNumber(client, {documentType:'STUDENT_CREDIT_NOTE', fiscalYearId, yearLabel:yearLabelFromDate(date)})).formatted;
}
export function serializeStudentCreditNote(row: StudentCreditNoteRow) {
  return {...row, amount:normalizeMoneyInput(row.amount), credit_note_date:pgDateOnly(row.credit_note_date), approved_at:iso(row.approved_at), rejected_at:iso(row.rejected_at), posted_at:iso(row.posted_at), voided_at:iso(row.voided_at), created_at:iso(row.created_at)!, updated_at:iso(row.updated_at)!};
}
export async function loadStudentCreditNote(client: TxClient, id: string, forUpdate=false) {
  const r=await txQuery<StudentCreditNoteRow>(client,`SELECT * FROM accounts.student_credit_notes WHERE id=$1::uuid ${forUpdate?'FOR UPDATE':''}`,[id]);
  if(!r.rows[0]) throw new AccountsHttpError('الإشعار الدائن غير موجود',404); return r.rows[0];
}
export async function sumReservedCreditNotesOnCharge(client: TxClient, chargeId: string, app: StudentCreditNoteMode, excludeId?: string|null) {
  const r=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_credit_notes WHERE student_charge_id=$1::uuid AND application_mode=$2 AND status IN ('PENDING_APPROVAL','APPROVED') AND ($3::uuid IS NULL OR id<>$3::uuid)`,[chargeId,app,excludeId??null]);
  return normalizeMoneyInput(r.rows[0]?.total??'0');
}
export async function calculateCreditNoteEligibleAmount(client: TxClient, chargeId: string, applicationMode: StudentCreditNoteMode, excludeId?: string|null) {
  const charge=await loadStudentCharge(client,chargeId,false);
  if (!['POSTED','PARTIALLY_SETTLED','SETTLED'].includes(charge.status)) return '0.000';
  const reserved=await sumReservedCreditNotesOnCharge(client,chargeId,applicationMode,excludeId);
  if(applicationMode==='DEBT_REDUCTION') {
    const eligible=moneyToMillis(normalizeMoneyInput(charge.outstanding_amount))-moneyToMillis(reserved);
    return eligible>BigInt(0)?millisToMoney(eligible):'0.000';
  }
  const collected=await sumPostedCollectionsOnCharge(client,chargeId);
  if (moneyToMillis(collected) <= BigInt(0)) return '0.000';
  const creditModePosted=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_credit_notes WHERE student_charge_id=$1::uuid AND application_mode='CREDIT_BALANCE_CREATE' AND status='POSTED'`,[chargeId]);
  const chargeEligible=moneyToMillis(collected)-moneyToMillis(normalizeMoneyInput(creditModePosted.rows[0]?.total??'0'))-moneyToMillis(reserved);
  const accountId=charge.student_account_id;
  const accountCollected=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_collections WHERE student_account_id=$1::uuid AND status='POSTED'`,[accountId]);
  const accountPostedCreditCNs=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_credit_notes WHERE student_account_id=$1::uuid AND application_mode='CREDIT_BALANCE_CREATE' AND status='POSTED'`,[accountId]);
  const accountReservedCreditCNs=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_credit_notes WHERE student_account_id=$1::uuid AND application_mode='CREDIT_BALANCE_CREATE' AND status IN ('PENDING_APPROVAL','APPROVED') AND ($2::uuid IS NULL OR id<>$2::uuid)`,[accountId,excludeId??null]);
  const accountPostedRefunds=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_refunds WHERE student_account_id=$1::uuid AND status='POSTED'`,[accountId]);
  const accountReservedRefunds=await txQuery<{total:string}>(client,`SELECT COALESCE(SUM(amount),0)::text total FROM accounts.student_refunds WHERE student_account_id=$1::uuid AND status IN ('PENDING_APPROVAL','APPROVED')`,[accountId]);
  const headroom=moneyToMillis(normalizeMoneyInput(accountCollected.rows[0]?.total??'0'))-moneyToMillis(normalizeMoneyInput(accountPostedCreditCNs.rows[0]?.total??'0'))-moneyToMillis(normalizeMoneyInput(accountReservedCreditCNs.rows[0]?.total??'0'))-moneyToMillis(normalizeMoneyInput(accountPostedRefunds.rows[0]?.total??'0'))-moneyToMillis(normalizeMoneyInput(accountReservedRefunds.rows[0]?.total??'0'));
  const chargeEl=chargeEligible>BigInt(0)?chargeEligible:BigInt(0);
  const headEl=headroom>BigInt(0)?headroom:BigInt(0);
  const eligible=chargeEl<headEl?chargeEl:headEl;
  return eligible>BigInt(0)?millisToMoney(eligible):'0.000';
}
async function links(client: TxClient, chargeId: string) {
  const r=await txQuery<{id:string;billing_plan_id:string}>(client,`SELECT id,billing_plan_id FROM accounts.student_installments WHERE student_charge_id=$1::uuid LIMIT 1`,[chargeId]);
  return {student_installment_id:r.rows[0]?.id??null,billing_plan_id:r.rows[0]?.billing_plan_id??null};
}
export async function createStudentCreditNote(client: TxClient, input: Record<string,unknown>&{requested_by:string}) {
  const chargeId=text(input.student_charge_id,100); if(!chargeId) throw new AccountsHttpError('المطالبة المالية مطلوبة',400);
  const charge=await loadStudentCharge(client,chargeId,true); const applicationMode=mode(input.application_mode); const a=amount(input.amount);
  if (applicationMode === 'CREDIT_BALANCE_CREATE') {
    const collectedOnCharge = await sumPostedCollectionsOnCharge(client, chargeId);
    if (moneyToMillis(collectedOnCharge) <= BigInt(0)) {
      throw new AccountsHttpError('لا يمكن إنشاء إشعار رصيد دائن دون الحاجة لتحصيل مرحّل سابق على المطالبة', 409);
    }
  }
  const eligible=await calculateCreditNoteEligibleAmount(client,chargeId,applicationMode);
  if(moneyToMillis(a)>moneyToMillis(eligible)) throw new AccountsHttpError('مبلغ الإشعار الدائن يتجاوز الرصيد المؤهل للمطالبة',409);
  const account=await loadStudentAccount(client,charge.student_account_id,true); if(account.status==='CLOSED') throw new AccountsHttpError('لا يمكن إنشاء إشعار دائن على حساب مغلق',409);
  const date=input.credit_note_date?pgDateOnly(String(input.credit_note_date)):pgDateOnly(new Date());
  const f=await fiscal(client,date); const gl=text(input.revenue_adjustment_gl_account_id,100); if(!gl) throw new AccountsHttpError('حساب مصروف تعديل الإيراد مطلوب',400);
  const posting=await assertPostingAccountWithType(client,gl,'حساب مصروف تعديل الإيراد',{invalidStatusCode:400});
  if(posting.account_type_code!=='EXPENSE') throw new AccountsHttpError('حساب تعديل الإيراد يجب أن يكون من نوع مصروف',400);
  const reasonCode=text(input.reason_code,40).toUpperCase(); if(!REASONS.has(reasonCode)) throw new AccountsHttpError('سبب الإشعار الدائن غير صالح',400);
  const reason=text(input.reason,4000); if(!reason) throw new AccountsHttpError('سبب الإشعار الدائن مطلوب',400);
  const l=await links(client,charge.id);
  const r=await txQuery<StudentCreditNoteRow>(client,`INSERT INTO accounts.student_credit_notes (credit_note_number,student_account_id,student_id,student_charge_id,student_installment_id,billing_plan_id,fiscal_year_id,fiscal_period_id,credit_note_date,reason_code,reason,amount,currency_code,application_mode,status,revenue_adjustment_gl_account_id,external_reference,requested_by) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::date,$10,$11,$12::numeric,'IQD',$13,'DRAFT',$14::uuid,$15,$16::uuid) RETURNING *`,[await number(client,f.year_id,date),account.id,account.student_id,charge.id,l.student_installment_id,l.billing_plan_id,f.year_id,f.period_id,date,reasonCode,reason,a,applicationMode,gl,text(input.external_reference,100)||null,input.requested_by]);
  return r.rows[0];
}
export async function updateStudentCreditNote(client: TxClient, p: Record<string,unknown>&{id:string;userId:string;version:unknown;updated_at:unknown}) {
  const row=await loadStudentCreditNote(client,p.id,true); if(row.status!=='DRAFT') throw new AccountsHttpError('يمكن تعديل المسودات فقط',409); optimistic(row,p.version,p.updated_at);
  const a=p.amount===undefined?normalizeMoneyInput(row.amount):amount(p.amount); const app=p.application_mode===undefined?row.application_mode:mode(p.application_mode);
  const eligible=await calculateCreditNoteEligibleAmount(client,row.student_charge_id!,app,row.id); if(moneyToMillis(a)>moneyToMillis(eligible)) throw new AccountsHttpError('مبلغ الإشعار الدائن يتجاوز الرصيد المؤهل للمطالبة',409);
  const r=await txQuery<StudentCreditNoteRow>(client,`UPDATE accounts.student_credit_notes SET amount=$2::numeric,application_mode=$3,reason_code=$4,reason=$5,external_reference=$6,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,a,app,p.reason_code===undefined?row.reason_code:text(p.reason_code,40).toUpperCase(),p.reason===undefined?row.reason:text(p.reason,4000),p.external_reference===undefined?row.external_reference:text(p.external_reference,100)||null]);
  return r.rows[0];
}
async function transition(client: TxClient,id:string,userId:string,version:unknown,updatedAt:unknown,from:StudentCreditNoteStatus,to:StudentCreditNoteStatus,reason?:unknown) {
  if (to === 'PENDING_APPROVAL' || to === 'APPROVED') {
    const peek=await loadStudentCreditNote(client,id,false);
    await acquireAccountingResourceLocks(client,[studentChargeLock(peek.student_charge_id!)]);
  }
  const row=await loadStudentCreditNote(client,id,true); if(row.status!==from) throw new AccountsHttpError('حالة الإشعار الدائن لا تسمح بهذه العملية',409); optimistic(row,version,updatedAt);
  if (to === 'PENDING_APPROVAL' || to === 'APPROVED') {
    const eligible=await calculateCreditNoteEligibleAmount(client,row.student_charge_id!,row.application_mode,row.id);
    if(moneyToMillis(row.amount)>moneyToMillis(eligible)) throw new AccountsHttpError('مبلغ الإشعار الدائن يتجاوز الرصيد المؤهل للمطالبة',409);
  }
  if (to === 'APPROVED') {
    const r = await txQuery<StudentCreditNoteRow>(
      client,
      `UPDATE accounts.student_credit_notes SET
         status='APPROVED', approved_by=$2::uuid, approved_at=NOW(),
         updated_at=NOW(), version=version+1
       WHERE id=$1::uuid RETURNING *`,
      [id, userId]
    );
    return r.rows[0];
  }
  if (to === 'REJECTED') {
    const r = await txQuery<StudentCreditNoteRow>(
      client,
      `UPDATE accounts.student_credit_notes SET
         status='REJECTED', rejected_by=$2::uuid, rejected_at=NOW(),
         rejection_reason=$3, updated_at=NOW(), version=version+1
       WHERE id=$1::uuid RETURNING *`,
      [id, userId, text(reason, 2000) || null]
    );
    return r.rows[0];
  }
  const r = await txQuery<StudentCreditNoteRow>(
    client,
    `UPDATE accounts.student_credit_notes SET
       status=$2, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [id, to]
  );
  return r.rows[0];
}
export const submitStudentCreditNote=(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown})=>transition(c,p.id,p.userId,p.version,p.updated_at,'DRAFT','PENDING_APPROVAL');
export const approveStudentCreditNote=(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown})=>transition(c,p.id,p.userId,p.version,p.updated_at,'PENDING_APPROVAL','APPROVED');
export async function rejectStudentCreditNote(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown;reason:unknown}) { if(!text(p.reason,2000)) throw new AccountsHttpError('سبب الرفض مطلوب',400); return transition(c,p.id,p.userId,p.version,p.updated_at,'PENDING_APPROVAL','REJECTED',p.reason); }
export async function postStudentCreditNote(client:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown}) {
  const peek=await loadStudentCreditNote(client,p.id,false); if(peek.status==='POSTED'&&peek.journal_entry_id)return {creditNote:peek,created:false};
  const account=await loadStudentAccount(client,peek.student_account_id,false); await acquireAccountingResourceLocks(client,[studentCreditNoteLock(peek.id),studentChargeLock(peek.student_charge_id!),studentAccountLock(account.id),studentLedgerLock(account.id),chartAccountLock(account.receivable_gl_account_id),chartAccountLock(peek.revenue_adjustment_gl_account_id),journalSourceLock('STUDENT_CREDIT_NOTE',peek.id)]);
  const row=await loadStudentCreditNote(client,p.id,true); optimistic(row,p.version,p.updated_at); if(row.status!=='APPROVED')throw new AccountsHttpError('يمكن ترحيل الإشعارات الدائنة المعتمدة فقط',409);
  const eligible=await calculateCreditNoteEligibleAmount(client,row.student_charge_id!,row.application_mode,row.id); if(moneyToMillis(row.amount)>moneyToMillis(eligible))throw new AccountsHttpError('قيمة الإشعار لم تعد مؤهلة للترحيل',409);
  const locked=await loadStudentAccount(client,row.student_account_id,true); const exp=await assertPostingAccountWithType(client,row.revenue_adjustment_gl_account_id,'حساب مصروف تعديل الإيراد'); if(exp.account_type_code!=='EXPENSE')throw new AccountsHttpError('حساب تعديل الإيراد يجب أن يكون من نوع مصروف',400);
  const date=pgDateOnly(row.credit_note_date); await assertFiscalContextForEntry(client,{fiscalYearId:row.fiscal_year_id,fiscalPeriodId:row.fiscal_period_id,entryDate:date});
  const n=await normalizeAndValidateLines(client,[{account_id:exp.id,cost_center_id:null,debit_amount:row.amount,credit_amount:'0',description:`إشعار دائن طالب — ${row.credit_note_number}`},{account_id:locked.receivable_gl_account_id,cost_center_id:null,debit_amount:'0',credit_amount:row.amount,description:row.reason}],'strict');
  const ji=(await txQuery<{id:string}>(client,`INSERT INTO accounts.journal_entries (entry_number,fiscal_year_id,fiscal_period_id,entry_date,entry_type,source_type,source_id,reference_number,description,total_debit,total_credit,status,version,created_by,updated_by,posted_by,posted_at) VALUES ($1,$2::uuid,$3::uuid,$4::date,'ADJUSTMENT','STUDENT_CREDIT_NOTE',$5::uuid,$6,$7,$8::numeric,$9::numeric,'POSTED',1,$10::uuid,$10::uuid,$10::uuid,NOW()) RETURNING id`,[await allocateJournalEntryNumber(client,row.fiscal_year_id),row.fiscal_year_id,row.fiscal_period_id,date,row.id,row.external_reference||row.credit_note_number,`إشعار دائن طالب — ${row.credit_note_number} — ${row.reason}`,n.totalDebit,n.totalCredit,p.userId])).rows[0].id;
  await replaceJournalLines(client,ji,n.lines); await writeStudentLedgerEntry(client,{account:locked,entryDate:date,entryType:'CREDIT_NOTE',sourceType:'STUDENT_CREDIT_NOTE',sourceId:row.id,description:`إشعار دائن ${row.credit_note_number}`,debit:'0',credit:row.amount,currencyCode:'IQD',journalEntryId:ji,userId:p.userId});
  if(row.application_mode==='DEBT_REDUCTION') await applyChargeCreditNote(client,{chargeId:row.student_charge_id!,creditNoteAmount:row.amount});
  const upd=await txQuery<StudentCreditNoteRow>(client,`UPDATE accounts.student_credit_notes SET status='POSTED',journal_entry_id=$2::uuid,posted_by=$3::uuid,posted_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,ji,p.userId]);
  if(row.student_installment_id)await recalculateStudentInstallmentSettlement(client,row.student_installment_id,date); if(row.billing_plan_id)await recalculateStudentBillingPlanSettlement(client,row.billing_plan_id); return {creditNote:upd.rows[0],created:true};
}
export async function voidStudentCreditNote(client:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown;reason?:unknown}) {
  const row=await loadStudentCreditNote(client,p.id,true); optimistic(row,p.version,p.updated_at); if(row.status==='VOID')return row; const reason=text(p.reason,2000);
  if(row.status!=='POSTED'||!row.journal_entry_id){const r=await txQuery<StudentCreditNoteRow>(client,`UPDATE accounts.student_credit_notes SET status='VOID',void_reason=$2,voided_by=$3::uuid,voided_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,reason||'إلغاء',p.userId]);return r.rows[0];}
  if(!reason)throw new AccountsHttpError('سبب الإلغاء مطلوب للإشعار المرحّل',400);
  const account=await loadStudentAccount(client,row.student_account_id,false); await acquireAccountingResourceLocks(client,[studentCreditNoteLock(row.id),studentAccountLock(account.id),studentLedgerLock(account.id),journalSourceLock('STUDENT_CREDIT_NOTE_REVERSAL',row.id)]);
  const balance=await txQuery<{balance:string}>(client,`SELECT COALESCE(SUM(debit_amount-credit_amount),0)::text balance FROM accounts.student_ledger_entries WHERE student_account_id=$1::uuid AND entry_type <> 'OPENING_REFERENCE'`,[row.student_account_id]);
  const refunds=await txQuery(client,`SELECT 1 FROM accounts.student_refunds WHERE student_account_id=$1::uuid AND status='POSTED' LIMIT 1`,[row.student_account_id]);
  // عكس إشعار دائن يرفع الرصيد المدين بمقداره؛ يمنع فقط إن بقيت استردادات
  // مرحّلة وكان الرصيد الدائن المتاح لا يغطي هذا العكس.
  if (
    refunds.rows[0] &&
    moneyToMillisSigned(String(balance.rows[0]?.balance ?? '0')) +
      moneyToMillis(row.amount) >
      BigInt(0)
  ) {
    throw new AccountsHttpError('لا يمكن إلغاء الإشعار الدائن لأن الاستردادات المرحّلة تجعل الرصيد الدائن سالباً',409);
  }
  const original=await loadJournalEntry(client,row.journal_entry_id);
  const reversal=await createReversalEntry(client,{original,reversalDate:pgDateOnly(row.credit_note_date),reason:`إلغاء إشعار دائن ${row.credit_note_number}: ${reason}`,userId:p.userId});
  // نفس سياسة 5.A/5.C.1: القيد الأصلي يبقى POSTED مع ربط العكس، والعكس يُوسم بمصدر STUDENT_*_REVERSAL.
  await txQuery(client,`UPDATE accounts.journal_entries SET source_type='STUDENT_CREDIT_NOTE_REVERSAL',source_id=$2::uuid,status='POSTED',updated_at=NOW(),version=version+1 WHERE id=$1::uuid`,[reversal.id,row.id]);
  await txQuery(client,`UPDATE accounts.journal_entries SET status='POSTED',reversal_entry_id=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid`,[original.id,reversal.id]);
  await writeStudentLedgerEntry(client,{account:await loadStudentAccount(client,row.student_account_id,true),entryDate:pgDateOnly(row.credit_note_date),entryType:'CREDIT_NOTE_REVERSAL',sourceType:'STUDENT_CREDIT_NOTE',sourceId:row.id,description:`عكس إشعار دائن ${row.credit_note_number}: ${reason}`,debit:row.amount,credit:'0',currencyCode:'IQD',journalEntryId:reversal.id,userId:p.userId});
  if(row.application_mode==='DEBT_REDUCTION')await reverseChargeCreditNote(client,{chargeId:row.student_charge_id!,creditNoteAmount:row.amount});
  const r=await txQuery<StudentCreditNoteRow>(client,`UPDATE accounts.student_credit_notes SET status='VOID',reversal_journal_entry_id=$2::uuid,void_reason=$3,voided_by=$4::uuid,voided_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,reversal.id,reason,p.userId]);
  if(row.student_installment_id)await recalculateStudentInstallmentSettlement(client,row.student_installment_id,pgDateOnly(row.credit_note_date)); if(row.billing_plan_id)await recalculateStudentBillingPlanSettlement(client,row.billing_plan_id);return r.rows[0];
}
export async function listStudentCreditNotes(client:TxClient, f:{status?:string|null;student_account_id?:string|null;page?:number;page_size?:number}) {
  const page=Math.max(1,f.page??1), page_size=Math.min(100,Math.max(1,f.page_size??20)), offset=(page-1)*page_size;
  const r=await txQuery<StudentCreditNoteRow & {account_number:string;student_full_name_ar:string;charge_number:string|null}>(client,`SELECT cn.*,sa.account_number,COALESCE(s.full_name_ar,s.full_name) student_full_name_ar,sc.charge_number FROM accounts.student_credit_notes cn JOIN accounts.student_accounts sa ON sa.id=cn.student_account_id JOIN student_affairs.students s ON s.id=cn.student_id LEFT JOIN accounts.student_charges sc ON sc.id=cn.student_charge_id WHERE ($1::text IS NULL OR cn.status=$1) AND ($2::uuid IS NULL OR cn.student_account_id=$2::uuid) ORDER BY cn.credit_note_date DESC,cn.created_at DESC LIMIT $3 OFFSET $4`,[f.status??null,f.student_account_id??null,page_size,offset]);
  const c=await txQuery<{total:number}>(client,`SELECT COUNT(*)::int total FROM accounts.student_credit_notes WHERE ($1::text IS NULL OR status=$1) AND ($2::uuid IS NULL OR student_account_id=$2::uuid)`,[f.status??null,f.student_account_id??null]);return {rows:r.rows,total:c.rows[0]?.total??0,page,page_size};
}
export async function getStudentCreditNote(client:TxClient,id:string){return loadStudentCreditNote(client,id);}
export async function getStudentCreditNoteOptions(client:TxClient) {
  return {
    reason_codes:[...REASONS],
    application_modes:[{code:'DEBT_REDUCTION',name_ar:'تخفيض الذمة'},{code:'CREDIT_BALANCE_CREATE',name_ar:'إنشاء رصيد دائن'}],
    statuses:[{code:'DRAFT',name_ar:'مسودة'},{code:'PENDING_APPROVAL',name_ar:'بانتظار الاعتماد'},{code:'APPROVED',name_ar:'معتمد'},{code:'POSTED',name_ar:'مرحّل'},{code:'REJECTED',name_ar:'مرفوض'},{code:'VOID',name_ar:'ملغى'}],
    expense_gl_accounts:await listEligibleReliefExpenseGlAccounts(client),
  };
}

