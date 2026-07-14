# 5.C.1 — الخصومات والمنح والإعفاءات (Student Reliefs)

**Baseline:** `68ce0a5` — fix(accounts): harden student billing collection integrity 5B

## القرار المحاسبي

لا يوجد نوع حساب `CONTRA_REVENUE` في محرك الحسابات الحالي (فقط ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE).

**القاعدة في 5.C.1:**
- DISCOUNT / SCHOLARSHIP / WAIVER → حساب **EXPENSE** ترحيلي نشط (ليس ذمم، ليس إيراد المطالبة، ليس نقد/بنك).
- القيد عند POST: **Dr Relief EXPENSE GL / Cr Student Receivables GL**.
- عند VOID: العكس.
- التمييز التشغيلي عبر `relief_kind` وليس نوع حساب جديد.

## القسط والمدفوع والمعفى

- `paid_amount` = تحصيلات نقدية/مصرفية فقط.
- `relief_amount` = تخفيضات مرحّلة.
- `outstanding = amount - paid_amount - relief_amount`.
- عند `outstanding = 0` تبقى الحالة `PAID` بمعنى **مغلق/مسدد** (قد يكون مزيج دفع + إعفاء) — الواجهة تعرض التفصيل منفصلاً.

الخطة COMPLETED عندما: `paid_amount + relief_amount = total_amount` (مشتق على الأقساط).

## دورة الحالات

DRAFT → PENDING_APPROVAL → APPROVED → POSTED  
DRAFT → APPROVED (إن `requires_approval=false`)  
PENDING_APPROVAL → REJECTED  
DRAFT / PENDING / APPROVED → VOID بلا قيد  
POSTED → VOID بقيد عكسي

## خارج النطاق (5.C.2)

Credit Notes، Refunds نقد/بنك، رصيد دائن، Advance Payments.
