# Execution Plan — المرحلة 3.A (معدَّل ومعتمد)
## Cash Management Foundation

| الحقل | القيمة |
|--------|--------|
| **الإصدار** | 1.1 (بعد تعديلات الاعتماد) |
| **التاريخ** | 12 تموز 2026 |
| **الحالة** | **A1–A8 مكتملة** — المرحلة 3.A منتهية · التالي: 3.B بعد أمر صريح |
| **Baseline** | `accounting-engine-v1` |

---

## تعديلات معتمدة على الخطة الأصلية

### 1) إعدادات النظام
- **لا** جدول `accounts.system_settings`.
- لا يوجد جدول إعدادات عام حالياً → يُنشأ **`platform.system_settings`** كخدمة مشتركة لكل الأنظمة.
- مفاتيح فروقات الجرد (لاحقاً في A5): `cash_variance_gain_account_id` / `cash_variance_loss_account_id`.

### 2) أنواع الصناديق
- جدول مرجعي **`accounts.cash_box_types`** (قابل للتوسع دون كسر FK).
- القيم الابتدائية عبر **Seed مستقل** (ليس داخل Migration): `MAIN`, `PETTY`, `FEES`, `TEMPORARY`.
- لا `SUB` / `OTHER` في العقد الحالي.

### 3) حالات الصندوق
- `DRAFT` | `ACTIVE` | `SUSPENDED` | `CLOSED` فقط.
- لا `CANCELLED`.
- بعد أول `ACTIVE`: لا حذف فعلي — تعليق أو إغلاق فقط.

### 4) حذف الصندوق
مسموح **فقط** إذا: `DRAFT` + لا أمناء + لا جلسات + لا مراجع مستقبلية.  
غير ذلك: `SUSPEND` / `CLOSE` فقط.

### 5) ربط الحساب
الحساب يجب أن يكون: تفصيلي · `allow_posting` · `is_active` · نوع `ASSET` · غير مرتبط بصندوق `ACTIVE` أو `SUSPENDED` آخر.

### 6) الرصيد الدفتري
- لا تخزين رصيد.
- Helper معزول (واجهة مستقرة) — بدون Cache في 3.A؛ قابل للاستبدال لاحقاً.

### 7) التزامن
- `version` + `updated_at` في التحقق المتفائل.

### 8) Audit (أسماء منذ البداية)
`cash_box.created` · `updated` · `activated` · `suspended` · `closed` · `custodian_assigned` · `custodian_removed`

### 9) API
استجابة / ترقيم / أخطاء / تحقق موحّدة وصالحة لـ Mobile لاحقاً.

### 10) Migration
الجداول والقيود والفهارس فقط — **بلا بيانات تشغيلية**.

### 11) Helpers
مسؤولية واحدة لكل ملف/دالة رئيسية.

---

## نطاق A1 فقط (هذه الدفعة)

**Migration `062`:**
1. `platform.system_settings`
2. `accounts.cash_box_types` (هيكل فقط)
3. `accounts.cash_boxes`
4. `accounts.cash_box_custodians`

**خارج A1:** أي Helper، API، UI، Seed، أو خطوة A2+.

---

## خطوات التنفيذ المتبقية (بعد A1)

| خطوة | المحتوى |
|------|---------|
| A2 | Helpers صغيرة + Audit actions |
| A3 | APIs CRUD + options (عقد موحّد) |
| A4 | custodians + activate |
| A5 | إعدادات فروقات عبر `platform.system_settings` |
| A6 | UI قائمة |
| A7 | UI تفاصيل |
| A8 | تحقق نهائي + Acceptance 3.A |

## حالة التنفيذ

| خطوة | الحالة |
|------|--------|
| A1 Migration 062 | مكتملة |
| A2 Helpers | مكتملة |
| A3–A5 APIs + Seed | مكتملة |
| A6 قائمة UI | مكتملة |
| A7 تفاصيل + أمناء + تفعيل | مكتملة |
| A8 إعدادات فروقات + Acceptance | مكتملة |

**لا تبدأ 3.B (جلسات/جرد) دون أمر تنفيذ صريح.**

— نهاية الخطة المعدَّلة —
