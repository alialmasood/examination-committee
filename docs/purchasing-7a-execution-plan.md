# خطة تنفيذ المشتريات 7.A — الحالة الفعلية

## النطاق (Scope)

المرحلة **7.A** تغطي دورة مشتريات **غير مخزنية** عبر:

| المستند | البادئة | الجدول | ترحيل GL |
|---------|---------|--------|----------|
| طلب شراء (PRQ) | `PRQ` | `purchase_requisitions` | لا |
| أمر شراء (POR) | `POR` | `purchase_orders` | لا |
| محضر استلام (PRC) | `PRC` | `purchase_receipts` | لا |
| فاتورة مورد من PO | `SINV` | `supplier_invoices` + `supplier_invoice_lines` | نعم عند POST |

**منفّذ بالكامل في 7.A:** الخدمات، APIs، الواجهة `/accounts/purchasing/**`، الطباعة، Seed DEMO، `verify-purchasing`، اختبارات القبول.

**مؤجّل (خارج 7.A):** مخزون، FIFO/Average، GRNI، حركة مخزنية، أصول ثابتة كاملة، مناقصات، Multi-currency، دفعات مقدمة، ضريبة شراء متقدمة.

---

## سير العمل والحالات

### طلب الشراء (PRQ)

```
DRAFT → SUBMITTED → APPROVED | REJECTED
DRAFT | SUBMITTED → CANCELLED
APPROVED → PARTIALLY_ORDERED → ORDERED  (مشتق من الكميات)
```

- العودة `SUBMITTED → DRAFT` **غير مدعومة**.
- `REJECTED → APPROVED` مباشرة **ممنوع**.
- التعديل المالي بعد `SUBMITTED` ممنوع (مسودة فقط).
- لا إلغاء لطلب مرتبط بـ PO غير ملغى/مرفوض.

### أمر الشراء (POR)

```
DRAFT → SUBMITTED → APPROVED | REJECTED
DRAFT | SUBMITTED | APPROVED(بلا استلام) → CANCELLED
APPROVED → PARTIALLY_RECEIVED → RECEIVED → PARTIALLY_INVOICED → INVOICED
→ CLOSED (يدوي عند عدم وجود open_receive)
```

اشتقاق الرأس (`derivePoHeaderStatus`) بعد الاعتماد — الأولوية:

1. إن كان الرأس DRAFT/SUBMITTED/REJECTED/CANCELLED/CLOSED → يبقى كما هو.
2. كل السطور النشطة INVOICED/CLOSED → `INVOICED`
3. أي سطر INVOICED أو PARTIALLY_INVOICED → `PARTIALLY_INVOICED`
4. كل السطور RECEIVED أو مفوترة → `RECEIVED`
5. أي PARTIALLY_RECEIVED أو RECEIVED → `PARTIALLY_RECEIVED`
6. وإلا → `APPROVED`

### محضر الاستلام (PRC)

```
DRAFT → POSTED → VOID
```

DRAFT لا يؤثر على كميات PO. POST/VOID داخل معاملة واحدة مع أقفال.

---

## معادلات الكمية (من الكود)

### سطر الطلب

- `estimated_total = ROUND(requested × estimated_unit_price, 3)` عبر money helpers
- `total_estimated_amount = Σ estimated_total`
- `ordered_quantity_active = Σ PO lines حيث PO ∉ {REJECTED,CANCELLED}`
- `remaining_order = requested − ordered`

### سطر الأمر

- `line_total = ROUND(qty×price,3) − discount + tax` (لا سالب)
- Header: `subtotal=Σ(qty×price)`, `discount=Σdisc`, `tax=Σtax`, `total=Σline_total` و`total > 0`
- `open_receive = ordered − cancelled − received`
- `available_to_invoice = accepted − invoiced` (**ليس** received؛ المرفوض غير قابل للفوترة)

### سطر الاستلام

- `received > 0` و `accepted + rejected = received`
- SERVICE: نفس الكميات العشرية (مثل 0.500 من 1.000)؛ الوحدة نص حر؛ **لا** نموذج نسبة مئوية.

---

## مطابقة الفاتورة (3-way مبسّط)

PO ↔ Accepted Receipt ↔ Supplier Invoice

- `invoice_source = PURCHASE_ORDER`
- المورد والعملة من PO؛ GL/Cost Center من سطر PO
- **فاتورة DRAFT لا تحجز الكمية**؛ التحقق النهائي عند POST تحت الأقفال
- تسامح السعر (`purchasing_config.price_tolerance_percent`) **متماثل** (زيادة ونقصان)
- الافتراضي 0%؛ `override_tolerance` يتطلب capability `purchase_invoice_matching.override_tolerance`

---

## الحدود المحاسبية

| الحدث | Journal | Supplier Ledger |
|-------|---------|-----------------|
| PRQ / PO / Receipt | لا | لا |
| Supplier Invoice POST | Dr Expense (متعدد) / Cr Payables | INVOICE credit |
| Invoice VOID | قيد عكسي | عكس + تخفيض invoiced_quantity |

---

## الأقفال

`acquireAccountingResourceLocks` يرتّب حسب `domain:resourceId` أبجدياً (ثابت عالمياً) ثم `FOR UPDATE`.

عمليات نموذجية تجمع: Receipt/Order/Lines أو PO/Match/Supplier/GL.

---

## الصلاحيات

`purchasing-access.ts` — Viewer عرض؛ Clerk إعداد؛ Approver موافقات؛ Admin ترحيل/إبطال/تجاوز تسامح. بدون username override.

---

## التحقق

```
npm run accounts:verify-purchasing
npm run accounts:verify-purchasing -- --strict
```

Strict يفشل أيضاً عند: سطور فاتورة بلا PO line، اختلاف GL عن سطر الأمر، فاتورة مرحّلة بلا قيد.

---

## الواجهة

- `/accounts/purchasing` (لوحة)
- `/accounts/purchasing/requisitions|orders|receipts|matching`
- طباعة: `.../[id]/print`
- ConfirmDialog موحّد (لا `window.confirm`)

---

## Seed / اختبارات

- `npm run seed:accounts-demo` (idempotent؛ يشمل purchasing DEMO)
- `npm run test:purchasing`
- `npm run accounts:verify-purchasing`
