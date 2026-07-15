# 6.B — دفعات الموردين والمصروفات التشغيلية المباشرة

**Baseline:** `502556d` — fix(accounts): harden supplier payables integrity 6A

## الفرق بين المسارين

| | Supplier Payment | Direct Operating Expense |
|--|------------------|--------------------------|
| الغرض | سداد ذمة مورد موجودة | مصروف مدفوع مباشرة دون ذمة |
| القيد | Dr Payables / Cr Cash\|Bank | Dr Expense / Cr Cash\|Bank |
| الآلية | Cash/Bank Payment Voucher (`counter` = Payables) | Cash/Bank Payment Voucher (`counter` = Expense) |
| Supplier Subledger | PAYMENT / PAYMENT_REVERSAL | لا يدخل |
| Allocations على الفواتير | إلزامي قبل POST | ممنوع |
| رصيد المورد | يقل عند الدفع | لا يتأثر |

لا Advance، ولا Credit Balance للمورد، ولا قيد دفع مكرر مستقل عن السند.

## Allocations

- يدوي أو تلقائي (due_date → invoice_date → invoice_number).
- Preview لا يكتب؛ POST يعيد التحقق.
- `Σ allocations = payment.amount`.
- لا تخصيص على VOID/PAID، ولا تجاوز outstanding، ولا فاتورة مورد آخر.
- دعم جزئي / متعدد فواتير / عدة دفعات ضمن الرصيد.

## Orchestration (ذرية POST)

داخل `withTransaction` + `acquireJournalEntriesLock` + أقفال الموارد:

1. أقفال Payment / Account / Ledger / Invoices / Cash|Bank / GL.
2. إنشاء وترحيل Cash/Bank Payment Voucher (TxClient).
3. قيد دفتر `PAYMENT` (مدين).
4. تحديث outstanding/status للفواتير.
5. `supplier_payments → POSTED` + ربط `cash_voucher_id` / `bank_voucher_id`.
6. Audit.

Fault injection: `after_voucher` | `after_ledger` | `after_invoice` → rollback كامل.

## القواعد المحاسبية

- مصدر الحقيقة: دفتر الأستاذ POSTED (قيود السند).
- Payables counter على سند دفعة المورد.
- Expense counter على سند المصروف المباشر؛ ليس Payables/Cash/Bank/Receivables.
- مركز الكلفة حسب الحساب/النوع.

## VOID

| | DRAFT | POSTED |
|--|-------|--------|
| Payment | VOID بلا سند/دفتر | عكس السند + PAYMENT_REVERSAL + استعادة outstanding |
| Direct Expense | VOID بلا سند | عكس السند فقط (بلا دفتر مورد) |

يمنع: VOID مزدوج، جزئي، فترة مغلقة، ترك آثار ناقصة.

## الصلاحيات

`supplier_payments.view|prepare|post|void`  
`direct_expenses.view|prepare|post|void`  
`direct_expense_types.manage`  

Viewer عرض · Clerk إعداد DRAFT · Admin الكل · Backend إلزامي بلا username override.

## الأقفال والتزامن

`SUPPLIER_PAYMENT` · `DIRECT_EXPENSE` · `SUPPLIER_ACCOUNT` · `SUPPLIER_LEDGER` · فواتير · صندوق/جلسة أو بنك · GL · Journal source.

اختبارات سباق: دفعتان / تخصيصان / POST+VOID / fault.

## APIs

- `/api/accounts/supplier-payments` (+ `[id]`, preview-allocation, post, void, options)
- `/api/accounts/direct-expenses` (+ `[id]`, post, void)
- `/api/accounts/direct-expense-types` (+ `[id]`, deactivate)

## UI

`/accounts/suppliers` تبويبات: موردون · فواتير · دفعات · مصروفات مباشرة · أنواع فواتير · أنواع مصروفات.  
طباعة: إيصال دفعة / سند مصروف (كلية الشرق + توقيعات).

## Seed

`seedSupplierPaymentsExpensesDemo` عبر `external_reference` (DEMO-SPY-* / DEMO-DEX-*) — idempotent.

## Verify

`npm run accounts:verify-supplier-payables` (+ `--strict`):

- فواتير ↔ دفتر INVOICE
- دفعات ↔ سندات ↔ PAYMENT/PAYMENT_REVERSAL
- Allocations / outstanding / status
- counter GL = Payables
- تطابق Subledger ↔ مصادر AP (يشمل JE العكس للسندات الملغاة)
- Direct Expenses **خارج** هذا الـ verify (تدخل verify-balances العام)

## Acceptance Criteria

 انظر طلب المرحلة 6.B §33 — تغطية `npm run test:supplier-payments-expenses`.

## ما يؤجل إلى Purchasing (6.C+)

أوامر شراء · استلام · مخزون · مطابقة ثلاثية · دفعات مقدمة / Credit Balance.
