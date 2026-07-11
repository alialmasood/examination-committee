# Execution Plan — المرحلة 3.B
## الجلسات اليومية + جرد إغلاق مبسّط + CLOSING

| الحقل | القيمة |
|--------|--------|
| **الإصدار** | 1.1 (معتمد بعد تعديلات الاعتماد) |
| **التاريخ** | 12 تموز 2026 |
| **الحالة** | **3.B مكتملة (Backend + UI)** · لا تبدأ 3.C حتى أمر صريح |
| **المرجعية** | Design Spec v1.1 · Acceptance · Architecture v2.0 · 3.A (`dd7264d`) |

---

## الهدف

دورة جلسة يومية: فتح → بدء إغلاق → جرد بمبلغ إجمالي → إغلاق بفرق صفر، مع لقطة دفترية قابلة للتحقق (رصيد + آخر قيد POSTED).

## خارج النطاق

- قيد تسوية فرق الجرد → **3.C**
- `cash_count_lines` / فئات العملة → **3.C**
- جرد مفاجئ · REOPEN بعد CLOSED → لاحقاً
- سندات · بنوك · UI (دفعة منفصلة)

---

## Migration `063`

جداول فقط:

1. `accounts.cash_box_sessions`
2. `accounts.cash_counts`

**لا** `cash_count_lines` في 3.B.

### الجلسة — حالات
`OPEN` | `CLOSING` | `CLOSED`

انتقالات:
- `OPEN` → `CLOSING` (`start-closing`)
- `CLOSING` → `OPEN` (`cancel-closing` + سبب إلزامي + Audit)
- `CLOSING` → `CLOSED` (`close` بفرق 0 + سلامة اللقطة)
- `CLOSED` قراءة فقط — لا REOPEN في 3.B

### لقطة الجرد (`cash_counts`)
سجل جديد لكل محاولة (لا overwrite): `sequence_no` + `is_current`.

حقول إلزامية للتحقق:
`counted_at`, `counted_by`, `book_balance_at_count`, `last_posted_entry_id_at_count`, `last_posted_entry_at_count`, `counted_amount`, `variance_amount`

### لقطة الفتح
`opening_book_balance` من الخادم فقط + `opening_last_posted_entry_id` / `opening_last_posted_at`.

### قيود
- UNIQUE جزئي: جلسة حية واحدة (`OPEN`|`CLOSING`) لكل صندوق
- UNIQUE: `(cash_box_id, session_date)` جلسة واحدة لكل يوم لكل صندوق

---

## APIs (Backend فقط)

| طريقة | مسار |
|-------|------|
| GET/POST | `/api/accounts/cash-box-sessions` |
| GET | `/api/accounts/cash-box-sessions/options` |
| GET | `/api/accounts/cash-box-sessions/[id]` |
| POST | `…/[id]/start-closing` |
| POST | `…/[id]/count` |
| POST | `…/[id]/close` |
| POST | `…/[id]/cancel-closing` |
| GET | `…/[id]/counts` |

---

## قواعد مختصرة

- فتح: ACTIVE + أمين أساسي + فاعل = أمين أو guard لاحق + سنة ACTIVE + فترة OPEN + تاريخ ضمن الحدود + لا جلسة حية + لا تكرار لنفس التاريخ.
- جرد/إغلاق: داخل `CLOSING`؛ فرق ≠ 0 يمنع الإغلاق النهائي بلا قيد تسوية.
- عند الإغلاق: إعادة حساب الرصيد + مقارنة آخر قيد (id + posted_at)؛ إن تغيّر → 409 والبقاء `CLOSING` مع رسالة إعادة الجرد.
- تزامن: `FOR UPDATE` على الصندوق/الجلسة + `version` + فهرس جزئي.
- Audit: `cash_session.opened|closing_started|count_recorded|closing_cancelled|closed`

---

## دفعات التنفيذ

| دفعة | المحتوى | الحالة |
|------|---------|--------|
| **1 Backend** | Migration + Helpers + APIs + اختبارات | **مكتملة** |
| **2 UI** | صفحات الجلسة | **مكتملة** |

لا واجهات في هذه الدفعة.
