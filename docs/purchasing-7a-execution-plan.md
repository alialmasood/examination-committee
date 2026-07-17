# خطة تنفيذ المشتريات 7.A — الحالة الفعلية المعتمدة

## النطاق

دورة مشتريات غير مخزنية: طلب شراء → أمر شراء → استلام → مطابقة فاتورة مورد.

**منفّذ:** Migrations 089–091، خدمات، APIs، واجهة `/accounts/purchasing/**`، طباعة، Seed DEMO، `verify-purchasing` (±strict)، اختبارات قبول.

**مؤجّل:** مخزون، GRNI، FIFO، أصول ثابتة كاملة، مناقصات، Multi-currency، دفعات مقدمة، إلغاء سطر PO جزئي تشغيلي.

---

## الصلاحيات — Least Privilege

| الحالة | الصلاحيات |
|--------|-----------|
| Accounts Admin / `accounts_admin` | Admin (بما فيها POST/VOID Receipt و MATCH_OVERRIDE) |
| `accounts_approver` | عرض + موافقات/رفض |
| `accounts_clerk` | عرض + إعداد/تقديم/إلغاء طلب + إعداد PO/Receipt/Matching |
| `accounts_viewer` | عرض فقط |
| عضو ACCOUNTS **بلا** دور platform صريح | **VIEW_ONLY فقط** — لا ترقية ضمنية إلى Clerk |
| بلا عضوية | لا صلاحيات |

لا username override. التحقق في Backend عبر `assertPurchasingCapability`.

---

## سياسات الأعمال

### المورد عند الاستلام

- **SUSPENDED:** يمنع إنشاء/اعتماد PO جديد؛ **يسمح** بالاستلام على PO معتمد قائم (تنفيذ التزام).
- **CLOSED** (مورد أو حساب): يمنع الاستلام الجديد.

### فاتورة DRAFT

لا تحجز الكمية. الحجز الفعلي عند POST تحت الأقفال.

### تسامح السعر

متماثل (زيادة ونقصان). الافتراضي 0%. تجاوز عبر capability + UI + ConfirmDialog + Audit.

### SERVICE

كميات عشرية كالمواد غير المخزنية؛ الوحدة نص حر؛ لا نسب مئوية.

### إغلاق/إلغاء سطر PO (حل B)

`cancelled_quantity` وحالات السطر `CANCELLED`/`CLOSED` تمهيدية. `closePurchaseOrder` يغلق **الرأس** فقط عند `open_receive=0`؛ الرأس `CLOSED` يمنع الحركة اللاحقة.

### Multi-line PO

رأس `PARTIALLY_INVOICED` لا يحجب استلام سطور لها `open_receive > 0`.

---

## المحاسبة

لا Journal / Supplier Ledger عند PRQ أو PO أو Receipt. القيد فقط عند POST فاتورة المورد.

---

## Verify

```
npm run accounts:verify-purchasing
npm run accounts:verify-purchasing:strict
npx tsx src/scripts/verify-purchasing.ts --strict
```

النتيجة تطبع `strict` / `mismatches` / `warnings` / `unexplained`. Mismatch يفشل دائمًا؛ warnings/unexplained تفشل في `--strict` فقط.

---

## الواجهة

لوحة، طلبات، أوامر، استلامات، مطابقة (مع تجاوز تسامح للمخولين)، طباعة، ConfirmDialog.
