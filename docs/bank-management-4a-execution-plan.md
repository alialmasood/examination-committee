# خطة تنفيذ المرحلة 4.A — تأسيس الحسابات المصرفية

**Baseline:** `104196e` — feat(accounts): add cash transfers between cashboxes 3E

## الهدف
إنشاء الأساس الإداري والمحاسبي للحسابات المصرفية داخل الكلية: تعريف المصارف والفروع والحسابات البنكية وربط كل حساب بـ GL واحد واضح، تمهيداً لسندات القبض/الصرف المصرفي والتحويلات والشيكات والتسويات في المراحل اللاحقة.

## نطاق المرحلة
- إدارة المصارف والفروع والحسابات المصرفية
- ربط الحساب المصرفي بحساب GL (واحد لواحد)
- العملات عبر `currency_code` (ISO-style)
- IBAN ورقم الحساب مع تطبيع و uniqueness
- رصيد افتتاحي مرجعي (عرض فقط)
- مستخدمون مخولون تمهيديون
- سجل تدقيق وواجهة إدارة وطباعة بطاقة حساب

## خارج نطاق 4.A
سند قبض/صرف مصرفي · تحويل مصرفي · شيكات · كشف حساب · تسوية · مطابقة حركات · استيراد ملفات مصرفية.

## قرارات تصميمية

### الرصيد الافتتاحي
حقول مرجعية فقط: `opening_balance_reference` + `opening_balance_date`.
لا يُنشأ قيد محاسبي تلقائياً من صفحة الحساب البنكي.
الواجهة توضّح أنه رصيد مرجعي للعرض/الإعداد فقط ما لم يُدخل عبر محرك القيود.

### الحساب الأساسي
حساب أساسي **واحد لكل عملة** (`is_primary` + `currency_code`).
عند تعيين أساسي جديد تُلغى صفة الأساسي عن بقية حسابات نفس العملة داخل معاملة Backend.

### العملات
لا جدول عملات جديد. `currency_code` بطول 3، الافتراضي `IQD`. Seed يعرض IQD وUSD اختيارياً دون عمليات فعلية.

### العلاقة مع GL
- `UNIQUE(gl_account_id)` على `accounts.bank_accounts`
- شروط: موجود · فعّال · `allow_posting` · ليس مجموعة · نوع ASSET · غير مستخدم لصندوق · غير مرتبط بحساب بنكي آخر
- `assertValidBankGlAccount` جاهز لإضافة منع تغيير GL بعد وجود حركات مصرفية لاحقاً

### حالات الحساب
| الحالة | المعنى |
|--------|--------|
| ACTIVE | صالح للاستخدام المستقبلي |
| SUSPENDED | ظاهر؛ ممنوع في عمليات جديدة؛ يمكن إعادة تفعيله |
| CLOSED | نهائي في 4.A؛ لا حذف؛ لا إعادة فتح؛ يُرفض الإغلاق إن رصيد GL ≠ 0 |

## قاعدة البيانات (Migration 067)
- `accounts.banks`
- `accounts.bank_branches`
- `accounts.bank_accounts`
- `accounts.bank_account_users`

قيود: PK/FK · unique على الأكواد · unique رقم الحساب داخل المصرف · unique IBAN عالمي · unique أساسي لكل عملة · unique GL.

## الخدمات المركزية
`createBank` / `updateBank` / `deactivateBank` · `createBankBranch` / `updateBankBranch` / `deactivateBankBranch` · `createBankAccount` / `updateBankAccount` / `suspendBankAccount` / `activateBankAccount` / `closeBankAccount` · `assignBankAccountUser` / `removeBankAccountUser` · `assertValidBankGlAccount`

معاملات + `acquireBanksLock` + تدقيق من مسارات API + رسائل عربية.

## الصلاحيات
`requireAccountsAccess` على جميع APIs. Super Admin / Accounts Admin يريان الجميع.
`bank_account_users` تمهيدي للعرض/الإدارة مع صلاحيات `can_view|prepare|post|approve|reconcile`.

## APIs
- `/api/accounts/banks` · `/api/accounts/banks/[id]` · `.../deactivate`
- `/api/accounts/bank-branches` · `/api/accounts/bank-branches/[id]` · `.../deactivate`
- `/api/accounts/bank-accounts` · `/api/accounts/bank-accounts/[id]` · suspend/activate/close
- `/api/accounts/bank-accounts/[id]/users` · `.../users/[userId]`
- `/api/accounts/bank-accounts/options`

## الواجهة
`/accounts/banks` — تبويبات: المصارف · الفروع · الحسابات + ملخصات.
`/accounts/banks/[id]` — تفاصيل + مستخدمون مخولون + طباعة بطاقة حساب.

## Seed
`npm run seed:accounts-demo` — DEMO-BANK · DEMO-BR-MAIN · DEMO-BA-IQD · DEMO-BA-USD · DEMO-BANK-GL · DEMO-BANK-GL-USD (idempotent، DEMO فقط).

## الاختبارات
`npm run test:bank-accounts` — إنشاء/قيود/GL/IBAN/أساسي/تعليق/إغلاق/مستخدمون/auth/smoke لوحدات النقد.

## Acceptance Criteria
انظر مواصفات المستخدم §27 — جميع البنود مطلوبة لاكتمال 4.A.

## سيناريو العرض أمام العميد (≈5 دقائق)
1. فتح `/accounts/banks` وإظهار الملخص (مصارف/فروع/حالات).
2. تبويب المصارف: DEMO-BANK «مصرف الشرق التجريبي».
3. تبويب الفروع: DEMO-BR-MAIN «فرع البصرة الرئيسي».
4. تبويب الحسابات: DEMO-BA-IQD مربوط بـ DEMO-BANK-GL + عملة IQD؛ DEMO-BA-USD اختياري.
5. فتح تفاصيل الحساب وطباعة بطاقة التعريف.
6. التأكيد: لا سندات مصرفية بعد — هذه مرحلة تأسيس فقط.
