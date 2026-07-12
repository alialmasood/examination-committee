# Execution Plan — المرحلة 3.C
## تسوية فروقات الجرد — كيان مستقل `cash_count_adjustments`

| الحقل | القيمة |
|--------|--------|
| **الإصدار** | 1.1 (معتمد — فصل كيان التسوية) |
| **التاريخ** | 12 تموز 2026 |
| **الحالة** | **Backend + UI مكتملان** · جاهز للعرض |
| **المرجعية** | Design Spec v1.1 · 3.A (`dd7264d`) · 3.B (`080a0ab`) |

---

## القرار المعماري المعتمد

| كيان | المسؤولية |
|------|-----------|
| `cash_counts` | الجرد التشغيلي فقط — **بلا حقول محاسبية** |
| `cash_count_adjustments` | عملية التسوية المحاسبية |
| `journal_entries` | الأثر الدفتري (`ADJUSTMENT` / `CASH_COUNT_VARIANCE`) |

- **لا** توسيع `cash_counts` أو `cash_box_sessions` بحقول تسوية.
- **لا** جرد اصطناعي بفرق صفر بعد التسوية.
- `source_id` للقيد = `cash_count_adjustments.id` (وليس `cash_count_id`).
- تسوية ناجحة واحدة لكل جرد (`UNIQUE cash_count_id`).

---

## Migration `064`

`db/migrations/064_create_cash_count_adjustments.sql` فقط — دون تعديل 063 أو أقدم.

---

## قواعد مختصرة

1. جلسة `CLOSING` + جرد `is_current` + فرق ≠ 0 + لا تسوية سابقة.
2. إعدادات فروقات الجرد موجودة؛ لقطات الحسابات على صف التسوية.
3. قبل الإنشاء: رفض drift عن لقطة الجرد (409).
4. Transaction ذرّية: adjustment + قيد POSTED + Audit → COMMIT أو ROLLBACK كامل.
5. GAIN / LOSS بأسطر متوازنة عبر محرك القيود.
6. الإغلاق بعد `POSTED` adjustment: الرصيد الحالي = `counted_amount` + لا POSTED أحدث من قيد التسوية.

---

## APIs (Backend)

| طريقة | مسار |
|-------|------|
| POST | `/api/accounts/cash-box-sessions/[id]/adjust-variance` |
| GET | `/api/accounts/cash-box-sessions/[id]/adjustments` |
| GET | `/api/accounts/cash-count-adjustments/[id]` |

---

## دفعات

| دفعة | المحتوى | الحالة |
|------|---------|--------|
| **1 Backend** | Migration + Helpers + APIs + close + اختبارات | **مكتمل** |
| **2 UI** | قسم تسوية فرق الجرد داخل تفاصيل الجلسة + سجل التسويات | **مكتمل** |

---

## Seed العرض

```bash
npm run seed:accounts-demo
```

ينشئ أكواد `DEMO-*` فقط، ولا يحذف بيانات موجودة، ولا يغيّر إعدادات الفروقات إن كانت مكتملة.
