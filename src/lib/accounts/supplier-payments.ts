/** دفعات الموردين وتخصيصها على الفواتير — 6.B */
import { acquireAccountingResourceLocks, bankAccountLock, cashboxLock, cashSessionLock, glAccountLock, journalSourceLock, supplierAccountLock, supplierInvoiceLock, supplierLedgerLock, supplierLock, supplierPaymentLock } from './accounting-locks';
import { AccountsHttpError } from './auth';
import { createBankVoucher, loadBankVoucher, postBankVoucher, voidBankVoucher } from './bank-vouchers';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { createCashVoucher, loadCashVoucher, postCashVoucher, voidCashVoucher } from './cash-vouchers';
import { normalizeCurrencyCode } from './currency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import { moneyEquals, moneyIsPositive, moneyIsZero, moneyToMillis, moneyToMillisSigned, millisToMoney, normalizeMoneyInput, sumMoney } from './money';
import { getSupplierAccountBalance, loadSupplierAccount } from './supplier-accounts';
import { type SupplierInvoiceRow, loadSupplierInvoice, writeSupplierLedgerEntry } from './supplier-invoices';
import { loadSupplier } from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierPaymentStatus = 'DRAFT' | 'POSTED' | 'VOID';
export type SupplierPaymentMethod = 'CASH' | 'BANK';
export type SupplierPaymentRow = {
  id:string; payment_number:string; supplier_account_id:string; supplier_id:string; fiscal_year_id:string; fiscal_period_id:string;
  payment_date:Date|string; amount:string; currency_code:string; payment_method:SupplierPaymentMethod;
  cash_box_id:string|null; cash_box_session_id:string|null; bank_account_id:string|null; cash_voucher_id:string|null; bank_voucher_id:string|null;
  external_reference:string|null; payee_name:string|null; description:string; status:SupplierPaymentStatus;
  posted_at:Date|string|null; posted_by:string|null; voided_at:Date|string|null; voided_by:string|null; void_reason:string|null;
  created_by:string; updated_by:string|null; created_at:Date|string; updated_at:Date|string; version:number;
};
export type AllocationRow = {
  id:string; supplier_payment_id:string; supplier_invoice_id:string; allocated_amount:string; created_by:string; created_at:Date|string;
  invoice_number?:string; supplier_invoice_number?:string;
};
export type AllocationInput = { invoice_id: string; amount: string };

const OVERPAYMENT = 'لا يمكن تسجيل دفعة أكبر من الرصيد المستحق للمورد.';
const iso=(v:Date|string|null|undefined)=>v==null?null:v instanceof Date?v.toISOString():new Date(String(v)).toISOString();
const txt=(v:unknown,n:number)=>{const s=String(v??'').trim().slice(0,n);return s||null;};
function optimistic(r:SupplierPaymentRow,v:unknown,u:unknown){assertCashSessionOptimisticConcurrency({currentVersion:r.version,currentUpdatedAt:r.updated_at,expectedVersion:v,expectedUpdatedAt:u});}
function amount(v:unknown){try{const a=normalizeMoneyInput(v);if(!moneyIsPositive(a))throw new Error();return a;}catch{throw new AccountsHttpError('مبلغ الدفعة يجب أن يكون أكبر من صفر',400);}}
function iq(v:unknown){const c=normalizeCurrencyCode(v,'IQD');if(c!=='IQD')throw new AccountsHttpError('عملة دفعة المورد هي IQD فقط',400);return c;}
async function fiscal(c:TxClient,d:string){const r=await txQuery<{year_id:string;period_id:string}>(c,`SELECT y.id year_id,p.id period_id FROM accounts.fiscal_years y JOIN accounts.fiscal_periods p ON p.fiscal_year_id=y.id WHERE y.status='ACTIVE' AND p.status='OPEN' AND p.start_date<=$1::date AND p.end_date>=$1::date ORDER BY y.is_default DESC,p.start_date LIMIT 1`,[d]);if(!r.rows[0])throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ الدفعة',409);return r.rows[0];}
/**
 * سياسة 6.B لتسوية الذمم:
 * - CLOSED: ممنوع إنشاء/ترحيل دفعات.
 * - SUSPENDED (مورد أو حساب): مسموح لتسوية الذمم القائمة فقط؛
 *   الفواتير الجديدة تبقى ممنوعة حسب 6.A.
 */
async function assertSettlementAccount(c:TxClient,id:string){const a=await loadSupplierAccount(c,id,true);if(a.status==='CLOSED')throw new AccountsHttpError('لا يمكن تسجيل دفعة على حساب مورد مغلق',409);const s=await loadSupplier(c,a.supplier_id,true);if(s.status==='CLOSED')throw new AccountsHttpError('لا يمكن تسجيل دفعة لمورد مغلق',409);return{a,s};}

export function serializeSupplierPayment(r:SupplierPaymentRow){return {...r,payment_date:pgDateOnly(r.payment_date),amount:normalizeMoneyInput(r.amount),posted_at:iso(r.posted_at),voided_at:iso(r.voided_at),created_at:iso(r.created_at)!,updated_at:iso(r.updated_at)!};}
export async function allocateSupplierPaymentNumber(c:TxClient,year:string){const y=await txQuery<{start_date:string}>(c,`SELECT start_date::text start_date FROM accounts.fiscal_years WHERE id=$1::uuid`,[year]);if(!y.rows[0])throw new AccountsHttpError('السنة المالية غير موجودة',404);await txQuery(c,`INSERT INTO accounts.document_sequences(document_type,fiscal_year_id,prefix,current_number,padding_length,reset_yearly,is_active) SELECT 'SUPPLIER_PAYMENT',$1::uuid,'SPY',0,6,TRUE,TRUE WHERE NOT EXISTS(SELECT 1 FROM accounts.document_sequences WHERE document_type='SUPPLIER_PAYMENT' AND fiscal_year_id=$1::uuid)`,[year]);try{return(await nextDocumentNumber(c,{documentType:'SUPPLIER_PAYMENT',fiscalYearId:year,yearLabel:yearLabelFromDate(y.rows[0].start_date)})).formatted;}catch(e){throw new AccountsHttpError(e instanceof Error?e.message:'تعذر تخصيص رقم الدفعة',409);}}
export async function loadSupplierPayment(c:TxClient,id:string,forUpdate=false){const r=await txQuery<SupplierPaymentRow>(c,`SELECT * FROM accounts.supplier_payments WHERE id=$1::uuid ${forUpdate?'FOR UPDATE':''}`,[id]);if(!r.rows[0])throw new AccountsHttpError('دفعة المورد غير موجودة',404);return r.rows[0];}
export async function listSupplierPaymentAllocations(c:TxClient,id:string){return(await txQuery<AllocationRow>(c,`SELECT a.*,i.invoice_number,i.supplier_invoice_number FROM accounts.supplier_payment_allocations a JOIN accounts.supplier_invoices i ON i.id=a.supplier_invoice_id WHERE a.supplier_payment_id=$1::uuid ORDER BY a.created_at,a.id`,[id])).rows;}
export async function listOpenSupplierInvoices(c:TxClient,accountId:string){return(await txQuery<SupplierInvoiceRow>(c,`SELECT * FROM accounts.supplier_invoices WHERE supplier_account_id=$1::uuid AND status IN ('POSTED','PARTIALLY_PAID') AND outstanding_amount>0 ORDER BY due_date ASC NULLS LAST,invoice_date ASC,invoice_number ASC`,[accountId])).rows;}
function drafts(v:unknown,expected?:string):AllocationInput[]{if(!Array.isArray(v))throw new AccountsHttpError('تخصيصات الدفعة غير صالحة',400);const ids=new Set<string>();const r=v.map(x=>{const a=x as Record<string,unknown>,id=String(a.invoice_id??a.supplier_invoice_id??'').trim();if(!id)throw new AccountsHttpError('معرّف الفاتورة مطلوب في التخصيص',400);if(ids.has(id))throw new AccountsHttpError('تخصيص مكرر لنفس الفاتورة',400);ids.add(id);return{invoice_id:id,amount:amount(a.amount??a.allocated_amount)};});if(expected&&(!r.length||!moneyEquals(sumMoney(r.map(x=>x.amount)),expected)))throw new AccountsHttpError('مجموع التخصيصات يجب أن يساوي مبلغ الدفعة',400);return r;}
async function validateAllocations(c:TxClient,accountId:string,all:AllocationInput[],lock=false){for(const x of all){const inv=await loadSupplierInvoice(c,x.invoice_id,lock);if(inv.supplier_account_id!==accountId)throw new AccountsHttpError('الفاتورة المخصصة لا تنتمي لحساب المورد',409);if(!['POSTED','PARTIALLY_PAID'].includes(inv.status)||moneyIsZero(normalizeMoneyInput(inv.outstanding_amount)))throw new AccountsHttpError('لا يمكن تخصيص دفعة على فاتورة غير مفتوحة',409);if(moneyToMillis(x.amount)>moneyToMillis(normalizeMoneyInput(inv.outstanding_amount)))throw new AccountsHttpError(`مبلغ التخصيص يتجاوز الرصيد المتبقي للفاتورة ${inv.invoice_number}`,409);}}
async function replaceAllocations(c:TxClient,paymentId:string,all:AllocationInput[],user:string){await txQuery(c,`DELETE FROM accounts.supplier_payment_allocations WHERE supplier_payment_id=$1::uuid`,[paymentId]);for(const x of all)await txQuery(c,`INSERT INTO accounts.supplier_payment_allocations(supplier_payment_id,supplier_invoice_id,allocated_amount,created_by) VALUES($1::uuid,$2::uuid,$3::numeric,$4::uuid)`,[paymentId,x.invoice_id,x.amount,user]);}

export async function previewSupplierPaymentAllocation(c:TxClient,p:{supplierAccountId:string;amount:unknown;mode:'auto'|'manual';allocations?:AllocationInput[]}){const a=amount(p.amount);await loadSupplierAccount(c,p.supplierAccountId);let proposed:AllocationInput[]=[];if(p.mode==='manual'){proposed=drafts(p.allocations,a);await validateAllocations(c,p.supplierAccountId,proposed);}else{let left=moneyToMillis(a);for(const inv of await listOpenSupplierInvoices(c,p.supplierAccountId)){if(left<=BigInt(0))break;const open=moneyToMillis(normalizeMoneyInput(inv.outstanding_amount)),take=left<open?left:open;if(take>BigInt(0)){proposed.push({invoice_id:inv.id,amount:millisToMoney(take)});left-=take;}}}const total=sumMoney(proposed.map(x=>x.amount));const rem=millisToMoney(moneyToMillis(a)-moneyToMillis(total));if(!moneyIsZero(rem))throw new AccountsHttpError(OVERPAYMENT,409);return{allocations:proposed,total_allocated:total,remaining:rem};}

export async function createSupplierPayment(c:TxClient,input:{supplier_account_id:unknown;payment_date?:unknown;amount:unknown;payment_method:unknown;cash_box_id?:unknown;cash_box_session_id?:unknown;bank_account_id?:unknown;payee_name?:unknown;description?:unknown;external_reference?:unknown;currency_code?:unknown;allocations?:AllocationInput[];created_by:string}){const accountId=String(input.supplier_account_id??'').trim();if(!accountId)throw new AccountsHttpError('الحساب المالي للمورد مطلوب',400);const {a}=await assertSettlementAccount(c,accountId);const amt=amount(input.amount);const balance=await getSupplierAccountBalance(c,a.id);if(moneyToMillisSigned(amt)>moneyToMillisSigned(balance)||moneyToMillisSigned(balance)<=BigInt(0))throw new AccountsHttpError(OVERPAYMENT,409);const d=input.payment_date?pgDateOnly(String(input.payment_date)):pgDateOnly(new Date());const f=await fiscal(c,d);await assertFiscalContextForEntry(c,{fiscalYearId:f.year_id,fiscalPeriodId:f.period_id,entryDate:d});const method=String(input.payment_method??'').toUpperCase() as SupplierPaymentMethod;if(method!=='CASH'&&method!=='BANK')throw new AccountsHttpError('طريقة الدفع غير صالحة',400);const cash=txt(input.cash_box_id,100),session=txt(input.cash_box_session_id,100),bank=txt(input.bank_account_id,100);if(method==='CASH'&&(!cash||!session))throw new AccountsHttpError('الصندوق والجلسة مطلوبان للدفع النقدي',400);if(method==='BANK'&&!bank)throw new AccountsHttpError('الحساب المصرفي مطلوب للدفع المصرفي',400);const all=input.allocations===undefined?[]:drafts(input.allocations,amt);if(all.length)await validateAllocations(c,a.id,all);const r=await txQuery<SupplierPaymentRow>(c,`INSERT INTO accounts.supplier_payments(payment_number,supplier_account_id,supplier_id,fiscal_year_id,fiscal_period_id,payment_date,amount,currency_code,payment_method,cash_box_id,cash_box_session_id,bank_account_id,payee_name,description,external_reference,status,created_by,updated_by) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::numeric,$8,$9,$10::uuid,$11::uuid,$12::uuid,$13,$14,$15,'DRAFT',$16::uuid,$16::uuid) RETURNING *`,[await allocateSupplierPaymentNumber(c,f.year_id),a.id,a.supplier_id,f.year_id,f.period_id,d,amt,iq(input.currency_code??a.currency_code),method,method==='CASH'?cash:null,method==='CASH'?session:null,method==='BANK'?bank:null,txt(input.payee_name,200),txt(input.description,4000)??`دفعة مورد`,txt(input.external_reference,100),input.created_by]);if(all.length)await replaceAllocations(c,r.rows[0].id,all,input.created_by);return{payment:r.rows[0],allocations:await listSupplierPaymentAllocations(c,r.rows[0].id)};}

export async function updateSupplierPayment(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown;payment_date?:unknown;amount?:unknown;payee_name?:unknown;description?:unknown;external_reference?:unknown;allocations?:AllocationInput[]}){const row=await loadSupplierPayment(c,p.id,true);optimistic(row,p.version,p.updated_at);if(row.status!=='DRAFT')throw new AccountsHttpError('يمكن تعديل مسودات الدفعات فقط',409);await assertSettlementAccount(c,row.supplier_account_id);const amt=p.amount===undefined?normalizeMoneyInput(row.amount):amount(p.amount);const bal=await getSupplierAccountBalance(c,row.supplier_account_id);if(moneyToMillisSigned(amt)>moneyToMillisSigned(bal)||moneyToMillisSigned(bal)<=BigInt(0))throw new AccountsHttpError(OVERPAYMENT,409);const d=p.payment_date===undefined?pgDateOnly(row.payment_date):pgDateOnly(String(p.payment_date));const f=await fiscal(c,d);await assertFiscalContextForEntry(c,{fiscalYearId:f.year_id,fiscalPeriodId:f.period_id,entryDate:d});const existing=await listSupplierPaymentAllocations(c,row.id);const all=p.allocations===undefined?existing.map(x=>({invoice_id:x.supplier_invoice_id,amount:x.allocated_amount})):drafts(p.allocations,amt);if(all.length&&!moneyEquals(sumMoney(all.map(x=>x.amount)),amt))throw new AccountsHttpError('عند تغيير المبلغ يجب إعادة تحديد التخصيصات',409);if(all.length)await validateAllocations(c,row.supplier_account_id,all);const r=await txQuery<SupplierPaymentRow>(c,`UPDATE accounts.supplier_payments SET payment_date=$2::date,fiscal_year_id=$3::uuid,fiscal_period_id=$4::uuid,amount=$5::numeric,payee_name=$6,description=$7,external_reference=$8,updated_by=$9::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,d,f.year_id,f.period_id,amt,p.payee_name===undefined?row.payee_name:txt(p.payee_name,200),p.description===undefined?row.description:txt(p.description,4000)??row.description,p.external_reference===undefined?row.external_reference:txt(p.external_reference,100),p.userId]);if(p.allocations!==undefined)await replaceAllocations(c,row.id,all,p.userId);return{payment:r.rows[0],allocations:await listSupplierPaymentAllocations(c,row.id)};}

let __fault:null|'after_voucher'|'after_ledger'|'after_invoice'|'after_payment_status'=null;
export const setSupplierPaymentPostFaultForTests=(v:typeof __fault)=>{__fault=v;};
async function locks(c:TxClient,row:SupplierPaymentRow,all:AllocationRow[]){const a=await loadSupplierAccount(c,row.supplier_account_id,false);await acquireAccountingResourceLocks(c,[supplierPaymentLock(row.id),supplierAccountLock(row.supplier_account_id),supplierLedgerLock(row.supplier_account_id),supplierLock(row.supplier_id),glAccountLock(a.payable_gl_account_id),journalSourceLock('SUPPLIER_PAYMENT',row.id),...all.map(x=>supplierInvoiceLock(x.supplier_invoice_id)),...(row.payment_method==='CASH'?[cashboxLock(row.cash_box_id!),cashSessionLock(row.cash_box_session_id!)]:[bankAccountLock(row.bank_account_id!)])]);}
export function deriveInvoiceStatusAfterOutstanding(total:string,outstanding:string):'POSTED'|'PARTIALLY_PAID'|'PAID'{if(moneyIsZero(outstanding))return'PAID';return moneyEquals(total,outstanding)?'POSTED':'PARTIALLY_PAID';}
export async function postSupplierPayment(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown}){const peek=await loadSupplierPayment(c,p.id,false);const allocPeek=await listSupplierPaymentAllocations(c,p.id);await locks(c,peek,allocPeek);const row=await loadSupplierPayment(c,p.id,true);if(row.status==='POSTED')return{payment:row,created:false};if(row.status!=='DRAFT')throw new AccountsHttpError('يمكن ترحيل مسودات الدفعات فقط',409);optimistic(row,p.version,p.updated_at);const {a}=await assertSettlementAccount(c,row.supplier_account_id);const all=await listSupplierPaymentAllocations(c,row.id);const amt=normalizeMoneyInput(row.amount);if(!all.length||!moneyEquals(sumMoney(all.map(x=>x.allocated_amount)),amt))throw new AccountsHttpError('مجموع التخصيصات يجب أن يساوي مبلغ الدفعة قبل الترحيل',409);await validateAllocations(c,a.id,all.map(x=>({invoice_id:x.supplier_invoice_id,amount:x.allocated_amount})),true);const bal=await getSupplierAccountBalance(c,a.id);if(moneyToMillisSigned(amt)>moneyToMillisSigned(bal)||moneyToMillisSigned(bal)<=BigInt(0))throw new AccountsHttpError(OVERPAYMENT,409);const date=pgDateOnly(row.payment_date);await assertFiscalContextForEntry(c,{fiscalYearId:row.fiscal_year_id,fiscalPeriodId:row.fiscal_period_id,entryDate:date});let voucherId:string,journalId:string;if(row.payment_method==='CASH'){const v=await createCashVoucher(c,{voucher_type:'CASH_PAYMENT',cash_box_id:row.cash_box_id,cash_box_session_id:row.cash_box_session_id,counter_account_id:a.payable_gl_account_id,voucher_date:date,amount:amt,party_name:row.payee_name,party_reference:row.payment_number,external_reference:row.external_reference,description:row.description,created_by:p.userId});const x=await postCashVoucher(c,{id:v.id,userId:p.userId,version:v.version,updated_at:v.updated_at});voucherId=x.voucher.id;journalId=x.voucher.journal_entry_id!;}else{const v=await createBankVoucher(c,{voucher_type:'BANK_PAYMENT',bank_account_id:row.bank_account_id,counter_account_id:a.payable_gl_account_id,voucher_date:date,amount:amt,party_name:row.payee_name,party_reference:row.payment_number,external_reference:row.external_reference,description:row.description,currency_code:row.currency_code,created_by:p.userId});const x=await postBankVoucher(c,{id:v.id,userId:p.userId,version:v.version,updated_at:v.updated_at});voucherId=x.voucher.id;journalId=x.voucher.journal_entry_id!;}if(__fault==='after_voucher')throw new Error('FAULT_AFTER_VOUCHER');await writeSupplierLedgerEntry(c,{accountId:a.id,supplierId:a.supplier_id,entryDate:date,entryType:'PAYMENT',sourceType:'SUPPLIER_PAYMENT',sourceId:row.id,description:`دفعة مورد ${row.payment_number} — ${row.description}`,debit:amt,credit:'0',currencyCode:row.currency_code,journalEntryId:journalId,userId:p.userId});if(__fault==='after_ledger')throw new Error('FAULT_AFTER_LEDGER');for(const x of all){const inv=await loadSupplierInvoice(c,x.supplier_invoice_id,true);const out=millisToMoney(moneyToMillis(normalizeMoneyInput(inv.outstanding_amount))-moneyToMillis(x.allocated_amount));if(moneyToMillis(out)<BigInt(0))throw new AccountsHttpError('مبلغ التخصيص يتجاوز الرصيد المتبقي للفاتورة',409);await txQuery(c,`UPDATE accounts.supplier_invoices SET outstanding_amount=$2::numeric,status=$3,updated_at=NOW(),version=version+1 WHERE id=$1::uuid`,[inv.id,out,deriveInvoiceStatusAfterOutstanding(normalizeMoneyInput(inv.total_amount),out)]);}if(__fault==='after_invoice')throw new Error('FAULT_AFTER_INVOICE');const r=await txQuery<SupplierPaymentRow>(c,`UPDATE accounts.supplier_payments SET status='POSTED',cash_voucher_id=CASE WHEN payment_method='CASH' THEN $2::uuid ELSE NULL END,bank_voucher_id=CASE WHEN payment_method='BANK' THEN $2::uuid ELSE NULL END,posted_by=$3::uuid,posted_at=NOW(),updated_by=$3::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,voucherId,p.userId]);if(__fault==='after_payment_status')throw new Error('FAULT_AFTER_PAYMENT_STATUS');return{payment:r.rows[0],created:true};}
export async function voidSupplierPayment(c:TxClient,p:{id:string;userId:string;version:unknown;updated_at:unknown;reason?:unknown}){
  const peek=await loadSupplierPayment(c,p.id,false);
  if(peek.status==='VOID')return peek;
  if(peek.status==='DRAFT'){
    const row=await loadSupplierPayment(c,p.id,true);
    optimistic(row,p.version,p.updated_at);
    if(row.status==='VOID')return row;
    if(row.status!=='DRAFT')throw new AccountsHttpError('حالة الدفعة لا تسمح بالإلغاء',409);
    const r=await txQuery<SupplierPaymentRow>(c,`UPDATE accounts.supplier_payments SET status='VOID',void_reason=$2,voided_by=$3::uuid,voided_at=NOW(),updated_by=$3::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,txt(p.reason,2000)??'إلغاء مسودة',p.userId]);
    return r.rows[0];
  }
  if(peek.status!=='POSTED')throw new AccountsHttpError('حالة الدفعة لا تسمح بالإلغاء',409);
  const reason=txt(p.reason,2000);
  if(!reason)throw new AccountsHttpError('سبب الإلغاء مطلوب للدفعة المرحّلة',400);
  const allocPeek=await listSupplierPaymentAllocations(c,peek.id);
  await locks(c,peek,allocPeek);
  const row=await loadSupplierPayment(c,p.id,true);
  optimistic(row,p.version,p.updated_at);
  if(row.status==='VOID')return row;
  if(row.status!=='POSTED')throw new AccountsHttpError('حالة الدفعة لا تسمح بالإلغاء',409);
  const all=await listSupplierPaymentAllocations(c,row.id);
  const a=await loadSupplierAccount(c,row.supplier_account_id,true);
  let je:string|null=null;
  if(row.payment_method==='CASH'&&row.cash_voucher_id){
    const v=await loadCashVoucher(c,row.cash_voucher_id,true);
    const x=await voidCashVoucher(c,{id:v.id,userId:p.userId,version:v.version,updated_at:v.updated_at,reason});
    je=x.reversal_journal_entry_id??x.journal_entry_id;
  }else if(row.payment_method==='BANK'&&row.bank_voucher_id){
    const v=await loadBankVoucher(c,row.bank_voucher_id,true);
    const x=await voidBankVoucher(c,{id:v.id,userId:p.userId,version:v.version,updated_at:v.updated_at,reason});
    je=x.reversal_journal_entry_id??x.journal_entry_id;
  }else throw new AccountsHttpError('الدفعة المرحّلة بلا سند صرف مرتبط',409);
  await writeSupplierLedgerEntry(c,{accountId:a.id,supplierId:a.supplier_id,entryDate:pgDateOnly(row.payment_date),entryType:'PAYMENT_REVERSAL',sourceType:'SUPPLIER_PAYMENT',sourceId:row.id,description:`عكس دفعة مورد ${row.payment_number}: ${reason}`,debit:'0',credit:normalizeMoneyInput(row.amount),currencyCode:row.currency_code,journalEntryId:je,userId:p.userId});
  for(const x of all){
    const inv=await loadSupplierInvoice(c,x.supplier_invoice_id,true);
    const out=millisToMoney(moneyToMillis(normalizeMoneyInput(inv.outstanding_amount))+moneyToMillis(x.allocated_amount));
    if(moneyToMillis(out)>moneyToMillis(normalizeMoneyInput(inv.total_amount)))throw new AccountsHttpError('عكس التخصيص يتجاوز إجمالي الفاتورة',409);
    await txQuery(c,`UPDATE accounts.supplier_invoices SET outstanding_amount=$2::numeric,status=$3,updated_at=NOW(),version=version+1 WHERE id=$1::uuid`,[inv.id,out,deriveInvoiceStatusAfterOutstanding(normalizeMoneyInput(inv.total_amount),out)]);
  }
  const r=await txQuery<SupplierPaymentRow>(c,`UPDATE accounts.supplier_payments SET status='VOID',void_reason=$2,voided_by=$3::uuid,voided_at=NOW(),updated_by=$3::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,[row.id,reason,p.userId]);
  return r.rows[0];
}
export async function getSupplierPaymentDetail(c:TxClient,id:string){
  const payment=await loadSupplierPayment(c,id);
  const allocations=await listSupplierPaymentAllocations(c,id);
  const supplier=await loadSupplier(c,payment.supplier_id,false);
  const balanceNow=await getSupplierAccountBalance(c,payment.supplier_account_id);
  const amt=normalizeMoneyInput(payment.amount);
  let balance_before=balanceNow;
  let balance_after=balanceNow;
  if(payment.status==='POSTED'){
    balance_after=balanceNow;
    balance_before=millisToMoney(moneyToMillisSigned(balanceNow)+moneyToMillis(amt));
  }else if(payment.status==='DRAFT'){
    balance_before=balanceNow;
    balance_after=millisToMoney(moneyToMillisSigned(balanceNow)-moneyToMillis(amt));
  }else{
    balance_after=balanceNow;
    balance_before=millisToMoney(moneyToMillisSigned(balanceNow)+moneyToMillis(amt));
  }
  let voucher_number:string|null=null;
  let channel_label:string|null=null;
  if(payment.cash_voucher_id){
    const v=await txQuery<{voucher_number:string;cash_box_id:string}>(c,`SELECT voucher_number,cash_box_id FROM accounts.cash_vouchers WHERE id=$1::uuid`,[payment.cash_voucher_id]);
    voucher_number=v.rows[0]?.voucher_number??null;
    if(v.rows[0]){
      const box=await txQuery<{code:string;name_ar:string}>(c,`SELECT code,name_ar FROM accounts.cash_boxes WHERE id=$1::uuid`,[v.rows[0].cash_box_id]);
      channel_label=box.rows[0]?`${box.rows[0].code} — ${box.rows[0].name_ar}`:null;
    }
  }else if(payment.bank_voucher_id){
    const v=await txQuery<{voucher_number:string;bank_account_id:string}>(c,`SELECT voucher_number,bank_account_id FROM accounts.bank_vouchers WHERE id=$1::uuid`,[payment.bank_voucher_id]);
    voucher_number=v.rows[0]?.voucher_number??null;
    if(v.rows[0]){
      const ba=await txQuery<{code:string;account_name_ar:string}>(c,`SELECT code,account_name_ar FROM accounts.bank_accounts WHERE id=$1::uuid`,[v.rows[0].bank_account_id]);
      channel_label=ba.rows[0]?`${ba.rows[0].code} — ${ba.rows[0].account_name_ar}`:null;
    }
  }else if(payment.payment_method==='CASH'&&payment.cash_box_id){
    const box=await txQuery<{code:string;name_ar:string}>(c,`SELECT code,name_ar FROM accounts.cash_boxes WHERE id=$1::uuid`,[payment.cash_box_id]);
    channel_label=box.rows[0]?`${box.rows[0].code} — ${box.rows[0].name_ar}`:null;
  }else if(payment.payment_method==='BANK'&&payment.bank_account_id){
    const ba=await txQuery<{code:string;account_name_ar:string}>(c,`SELECT code,account_name_ar FROM accounts.bank_accounts WHERE id=$1::uuid`,[payment.bank_account_id]);
    channel_label=ba.rows[0]?`${ba.rows[0].code} — ${ba.rows[0].account_name_ar}`:null;
  }
  return{
    payment,
    allocations,
    supplier_name_ar:supplier.name_ar,
    balance_before,
    balance_after,
    voucher_number,
    channel_label,
  };
}
export async function listSupplierPayments(c:TxClient,p:{q?:string;status?:string|null;supplier_account_id?:string|null;supplier_id?:string|null;payment_method?:string|null;page?:number;page_size?:number}){const page=Math.max(1,p.page??1),page_size=Math.min(100,Math.max(1,p.page_size??20)),q=(p.q??'').trim(),v=[q,p.status??null,p.supplier_account_id??null,p.supplier_id??null,p.payment_method??null];const where=`WHERE ($1='' OR sp.payment_number ILIKE '%'||$1||'%' OR sp.description ILIKE '%'||$1||'%' OR COALESCE(sp.external_reference,'') ILIKE '%'||$1||'%') AND ($2::text IS NULL OR sp.status=$2) AND ($3::uuid IS NULL OR sp.supplier_account_id=$3::uuid) AND ($4::uuid IS NULL OR sp.supplier_id=$4::uuid) AND ($5::text IS NULL OR sp.payment_method=$5)`;const n=await txQuery<{total:number}>(c,`SELECT COUNT(*)::int total FROM accounts.supplier_payments sp ${where}`,v);const r=await txQuery<SupplierPaymentRow&{supplier_name_ar:string;account_number:string}>(c,`SELECT sp.*,s.name_ar supplier_name_ar,sa.account_number FROM accounts.supplier_payments sp JOIN accounts.suppliers s ON s.id=sp.supplier_id JOIN accounts.supplier_accounts sa ON sa.id=sp.supplier_account_id ${where} ORDER BY sp.payment_date DESC,sp.created_at DESC LIMIT $6 OFFSET $7`,[...v,page_size,(page-1)*page_size]);return{rows:r.rows,total:n.rows[0]?.total??0,page,page_size};}
