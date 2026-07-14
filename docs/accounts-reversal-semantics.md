# Reversal Semantics — قرار وMigration Plan

## الوضع الحالي (Baseline بعد 4.C)

1. `createReversalEntry` يضع القيد الأصلي على `REVERSED` وينشئ قيد عكس `POSTED` مع `is_reversal` / `reverses_entry_id`.
2. مسارات VOID (سند نقد/بنك، تحويل بنك، …) تعيد الأصل إلى `POSTED` داخل نفس المعاملة مع الإبقاء على `reversal_entry_id`.
3. السبب: `getAccountBookBalance` يجمع فقط قيود `POSTED`؛ إن بقي الأصل `REVERSED` بدون احتساب العكس لوحده ينكسر الرصيد أو يعتمد على مسار هش.

هذا يعمل لكنه غير موحّد مع التسمية `REVERSED`.

## النموذج المفضّل (هدف)

- القيد الأصلي يبقى `POSTED` دائماً بعد الترحيل الأول.
- القيد العكسي `POSTED` مع `is_reversal=true` و`reverses_entry_id`.
- الأصل يحمل `reversal_entry_id`.
- وثيقة المصدر (سند/تحويل) تصبح `VOID`.
- التقارير: كل قيود `POSTED` بما فيها العكس (صافي صفر للوثيقة الملغاة).
- لا تُستخدم حالة `REVERSED` لمنع دخول الأصل في الرصيد عند وجود عكس.

## قرار Sprint A

**لا نغيّر semantics بالكامل الآن** لتجنب كسر اختبارات/بيانات كثيرة.

ما نُفِّذ في Sprint A:

- توثيق هذا القرار هنا وفي `accounts-architecture-sprint-a.md`
- الإبقاء على سلوك VOID الحالي (إعادة POSTED) كمسار موحّد عملياً للمستندات البنكية/النقدية
- عدم إضافة مسارات جديدة تذهب ذهاباً وإياباً بطريقة مختلفة

## Migration Plan (Sprint لاحق آمن)

1. إضافة فحص invariant: إن وُجد `reversal_entry_id` وكان العكس POSTED، فالأصل يجب أن يكون POSTED (أو نقبل REVERSED مؤقتاً مع عدم استخدامه في SUM).
2. تعديل `createReversalEntry` لعدم وضع الأصل على REVERSED (أو جعله اختيارياً).
3. تحديث كل مسارات VOID/cancel التي تعتمد على إعادة POSTED.
4. ترحيل بيانات: `UPDATE ... SET status='POSTED' WHERE status='REVERSED' AND reversal_entry_id IS NOT NULL`.
5. تشغيل suite القيود + vouchers + transfers + verify-balances.
6. إزالة الاعتماد على حالة REVERSED من التقارير إن وُجدت.

لا إسقاط قيود ولا تغيير IDs.
