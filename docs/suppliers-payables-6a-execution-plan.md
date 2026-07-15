# 6.A — تأسيس الموردين والذمم الدائنة

**Baseline:** `92ac574` — fix(accounts): harden student credit balance and refunds 5C2

## الهدف
أساس مالي كامل للمورد: سجل موحّد · حساب مالي · فواتير · ذمم · دفتر فرعي · رصيد · كشف حساب · قيود استحقاق · DRAFT/POSTED/VOID · صلاحيات · Audit · واجهة · طباعة · Seed · اختبارات.

## خارج النطاق
أوامر/طلبات الشراء · استلام مواد · مخزون · مطابقة ثلاثية · **دفعات الموردين (6.B)** · شيكات · ضرائب استقطاع/VAT · Multi-currency AP · عقود · اعتماد متعدد المراحل.

## النماذج

### Supplier (`accounts.suppliers`)
`ACTIVE | SUSPENDED | CLOSED` · أنواع: LOCAL/INTERNATIONAL/GOVERNMENT/INDIVIDUAL/SERVICE_PROVIDER/OTHER  
`supplier_number` فريد · `code` فريد إن استُخدم · عملة IQD · CLOSED نهائي · SUSPENDED يمنع فواتير جديدة.

### Supplier Account (`accounts.supplier_accounts`)
مورد واحد = حساب/عملة · `payable_gl_account_id` = LIABILITY ترحيلي موحّد  
**لا GL مستقل لكل مورد** · التفصيل في Subledger · `opening_reference` ملاحظة فقط.

### Invoice Types (`accounts.supplier_invoice_types`)
خدمات/صيانة/… + Expense GL افتراضي + مركز كلفة اختياري.

### Invoices (`accounts.supplier_invoices`)
حالات: DRAFT / POSTED / PARTIALLY_PAID / PAID / VOID  
في 6.A: DRAFT/POSTED/VOID فعّالة · PARTIALLY_PAID/PAID تأسيس لـ 6.B.  
`invoice_number` داخلي (SIN) · `supplier_invoice_number` خارجي فريد لكل مورد.

### Subledger (`accounts.supplier_ledger_entries`)
`INVOICE` (credit) · `INVOICE_REVERSAL` (debit)  
**Balance = Σ credits − Σ debits** (مستحق للمورد) · بدون OPENING_REFERENCE.

## المحاسبة
**POST:** Dr Expense / Cr Payables · `source_type=SUPPLIER_INVOICE` · قيد POSTED · `outstanding=total`  
**VOID POSTED:** Dr Payables / Cr Expense (عكس) · الأصل يبقى POSTED · Ledger reversal · `outstanding=0`  
يمنع VOID عند PARTIALLY_PAID/PAID.

## الترقيم
`SUP` · `SPA` · `SIN` — FOR UPDATE عبر document_sequences (لا COUNT+1).

## الأقفال
`SUPPLIER` · `SUPPLIER_ACCOUNT` · `SUPPLIER_INVOICE` · `SUPPLIER_LEDGER` · `GL_ACCOUNT` · `JOURNAL_SOURCE`

## الصلاحيات
| Capability | Viewer | Clerk | Admin |
|---|---|---|---|
| suppliers.view | ✓ | ✓ | ✓ |
| suppliers.manage | | ✓ | ✓ |
| supplier_invoice_types.manage | | ✓ | ✓ |
| supplier_invoices.prepare | | ✓ | ✓ |
| supplier_invoices.post | | | ✓ |
| supplier_invoices.void | | | ✓ |
| إغلاق حساب مورد | | | ✓ |

لا username override · Backend enforcement إلزامي.

## APIs
`/api/accounts/suppliers` · `.../[id]` · suspend/activate/close · `.../[id]/accounts`  
`/api/accounts/supplier-invoice-types` · deactivate  
`/api/accounts/supplier-invoices` · post/void  
`/api/accounts/supplier-accounts/[id]/ledger|summary`  
`/api/accounts/supplier-options`

## الواجهة
`/accounts/suppliers` — تبويبات: الموردون · الفواتير · أنواع الفواتير  
ملخص · قائمة بفلاتر وpagination · صفحة مورد · نموذج فاتورة مع معاينة قيد · طباعة فاتورة وكشف حساب.

## Seed
`seedSupplierPayablesDemo` — 3 موردين · أنواع · POSTED · DRAFT · VOID · رصيد/صفر · idempotent.

## Verify
`npm run accounts:verify-supplier-payables`  
عادي: تطابق فاتورة↔دفتر↔GL AP sources · outstanding · VOID  
`--strict`: يفشل أيضاً عند unexplained على Payables GL.

## Acceptance
موردون يعملون · Payables GL موحّد · ذمة صحيحة · Subledger · VOID يعكس · لا double posting · صلاحيات/IDOR · Audit/طباعة · Seed · Verify · اختبارات · tsc/eslint/build.

## خطة 6.B
دفعات موردين عبر Cash/Bank Payment Vouchers · تخصيص على الفواتير · حالات PARTIALLY_PAID/PAID · حركة PAYMENT في الدفتر الفرعي · شيكات/استقطاع لاحقاً.
