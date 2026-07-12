# خطة تنفيذ المرحلة 3.E — التحويلات النقدية بين الصناديق

**Baseline:** `03c69d0` — fix(accounts): harden cash voucher posting and integration

## القرار المحاسبي: الخيار B — Cash in Transit (قيدان)

### السبب

1. عند **DISPATCHED** يجب أن ينخفض الرصيد المتاح والدفتري للصندوق المرسل فوراً، حتى قبل تأكيد الاستلام.
2. الخيار A (قيد واحد عند RECEIVED) يترك فجوة: إما حجز تشغيلي بلا أثر دفتري (يصعّب إغلاق جلسة المرسل والجرد)، أو منع إغلاق الجلسة طالما التحويل قيد النقل.
3. مع حساب **نقد بالطريق**:
   - DISPATCHED: Dr CIT / Cr Source → خروج محاسبي مكتمل من المرسل.
   - RECEIVED: Dr Destination / Cr CIT → دخول للمستلم وإفراغ CIT.
   - صافي الأثر النهائي: Dr Destination / Cr Source.
4. يسمح بإغلاق جلسة المرسل بعد الإرسال لأن الأثر الدفتري مسجّل.
5. التسلسل `FINANCIAL_TRANSFER` (TR) و`entry_type=TRANSFER` جاهزان في المحرك.

### ربط المصادر

- قيد الإرسال: `source_type=CASH_TRANSFER_DISPATCH`, `source_id=transfer.id`
- قيد الاستلام: `source_type=CASH_TRANSFER_RECEIVE`, `source_id=transfer.id`
- فهرس `uq_journal_entries_source` يمنع التكرار لكل مصدر على حدة.

### حساب CIT

- مفتاح إعداد: `cash_in_transit_account_id` في `platform.system_settings`
- حساب ترحيلي ASSET، ليس حساب صندوق، يُضبط عبر seed التجريبي أو الإعدادات.

### سياسة الإلغاء

| الحالة | السياسة |
|--------|---------|
| DRAFT | → CANCELLED مباشرة |
| DISPATCHED | عكس قيد الإرسال (createReversalEntry) ثم CANCELLED؛ لا حذف |
| RECEIVED | **ممنوع الإلغاء المباشر** — رسالة تطلب إنشاء تحويل عكسي جديد (خارج نطاق 3.E للعكس الآلي) |

### الرصيد المتوقع للجلسة

```
expected = opening + receipts - payments - transfers_out + transfers_in
```

- `transfers_out`: تحويلات بحالة DISPATCHED أو RECEIVED على `source_session_id`
- `transfers_in`: تحويلات بحالة RECEIVED على `destination_session_id`
- DRAFT و CANCELLED لا يُحتسبان
