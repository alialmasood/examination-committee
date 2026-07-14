# Architecture Hardening Sprint A — قرارات معمارية

Baseline: `b46b927` — fix(accounts): scope bank voucher lists by can_view

## 1) Accounts Admin

- الدور الرسمي: `student_affairs.roles.code = accounts_admin`
- الربط: `platform.user_system_roles` + `platform.systems.code = ACCOUNTS`
- Helpers: `hasAccountsAdminAccess` / `requireAccountsAdmin` / `grantAccountsAdminRole` في `accounts-access.ts`
- Fallback مؤقت لأسماء مستخدمين قديمة (accounts/admin/…) مركزي مع تحذير — ليس الأساس الدائم
- Seed: `seed:accounts` و`seed:accounts-demo` يمنحان الدور

## 2) سياسة رؤية القوائم

| المورد | Admin | تشغيلي |
|---|---|---|
| cashboxes / sessions / vouchers | الكل | صناديق بتعيين أمين ساري (`valid_to IS NULL`) |
| cash transfers | الكل | يرى المصدر أو الوجهة |
| bank accounts / vouchers | الكل | `can_view` على الحساب |
| bank transfers | الكل | `can_view` على المصدر والوجهة معاً |

قوائم GET وتفاصيل GET بنفس السياسة (IDOR → 404 حيث ينطبق).

قيد: لا يوجد عزل فرع/قسم إضافي بعد؛ الأمين يرى ما هو مُعيَّن عليه فقط.

## 3) الأقفال

- `acquireAccountingResourceLocks` + مفاتيح `DOMAIN:id` عبر `pg_advisory_xact_lock(ns, hashtext(key))`
- ترتيب ثابت بعد normalize/dedupe/sort
- استُبدلت الأقفال العالمية في مسارات الترحيل/الإلغاء/إرسال-استلام التحويل النقدي
- الأقفال العالمية القديمة ما زالت موجودة لعمليات صيانة الدليل غير المتعلقة بالرصيد

## 4) Balance projection

- جدول `accounts.gl_account_balances` + `gl_balance_applications`
- journal POSTED = مصدر الحقيقة
- المستوى في Sprint A: سنوي (`fiscal_period_id` NULL)
- **write-path مؤجّل** — التعبئة عبر `accounts:rebuild-balances` والتحقق عبر `accounts:verify-balances`
- فهارس أداء في 071

## 5) Reversal semantics

انظر `docs/accounts-reversal-semantics.md` — التفضيل: الأصل يبقى POSTED + العكس POSTED. التغيير الشامل مؤجّل؛ المسارات الحالية تعيد POSTED بعد `createReversalEntry` لمنع انكسار SUM.

## 6) Document sequence types

- جدول `document_sequence_types` + FK بدل CHECK (migration 073)
- إضافة نوع جديد = صف في الجدول المرجعي لا ALTER CHECK

## 7) Currency

- `normalizeCurrencyCode` في `currency.ts` (ISO 3 أحرف)
- لا FX في هذا الـ Sprint

## خارج النطاق (مؤجّل)

Bank Reconciliation، AR/AP، Purchasing، Inventory، Assets، Budget، Reports، Cheques، FX، multi-branch.
