# 9.B.4 — سجل اعتماد الرواتب والتحقق النهائي

## النطاق والحالة المقبولة

تكتمل 9.B.1–9.B.4 في حدود دورة اعتماد التشغيل:

| المرحلة | الحالة المقبولة |
|---|---|
| 9.B.1 | `CALCULATED → UNDER_REVIEW` مع لقطة المراجعة وفصل الواجبات |
| 9.B.2 | صلاحيات الإرسال والمراجعة والواجهة |
| 9.B.3 | `UNDER_REVIEW → APPROVED` أو `UNDER_REVIEW → CALCULATED` مع idempotency والتدقيق |
| 9.B.4 | سجل تاريخ معقّم، تحقق نهائي، واختبارات تكامل |

لا يوجد ترحيل 098، ولا endpoints للترحيل أو المدفوعات أو كشوفات الدفع. هذه الموضوعات مؤجلة عمداً.

## History endpoint والصلاحية

`GET /api/accounts/payroll/runs/:id/approval-history?page=1&page_size=20` يتطلب
`payroll_view_approval_history`. المراجع وAccounts Admin يملكانها، بينما clerk لا يملكها.
عدم الصلاحية يعيد `403`، والتشغيل غير المرئي أو المفقود يعيد `404` موحداً.

يُحمّل endpoint التشغيل أولاً ثم يعيد المصدر الوحيد للتاريخ:
`accounts.payroll_run_approval_actions`. سجلات audit من `approval_blocked` و`approval_failed`
وما يقابلها للرفض ليست عناصر تاريخ.

## DTO والـ pagination

العنصر العام يحتوي: معرّف الحدث، الدورة، الإجراء والتسمية العربية، انتقال الحالة، actor،
التعليق أو السبب، بصمة لقطة مختصرة، الإصدارات ووقت الإنشاء. الترتيب ثابت:
`created_at DESC, id DESC`، مع حد أعلى `page_size=100`.

لا تظهر البصمة الكاملة أو `snapshot_json` أو `metadata_json` أو
`request_key_hash` أو `request_payload_hash` أو مفتاح idempotency الخام. اسم actor يستعمل
الاسم الحي، ثم لقطة الاسم، ثم «مستخدم سابق».

## الواجهة

واجهة التشغيل تستعمل `approval.can_view_history` لإظهار القسم. أدوات `_lib.tsx` توفر
`runApprovalHistoryUrl` ووسم الإجراء وانتقال الحالة واختصار البصمة؛ تغطيها اختبارات نقية
بدون RTL.

## مصفوفة lifecycle والحراس

1. احتساب التشغيل.
2. إرسال للمراجعة (الدورة 1).
3. لا يستطيع المُرسل الاعتماد أو الرفض.
4. المراجع يرفض، فيعود التشغيل إلى `CALCULATED`.
5. إعادة الاحتساب ثم إرسال الدورة 2.
6. مراجع مختلف يعتمد، فتكون الحالة `APPROVED`.

بعد `APPROVED` تُرفض calculate/recalculate/update/scope/cancel/submit/approve/reject.
`assertPayrollRunReadyForPosting` يقبل فقط تشغيلاً معتمداً بلا أخطاء وبصمات متطابقة؛ لا
ينفذ ترحيلاً.

## التحقق والاختبارات

- `npm run accounts:verify-payroll-approval-workflow`
- `npm run accounts:verify-payroll-approval-workflow:strict`
- `npm run test:payroll-approval-history-integration`
- `npm run test:payroll-approval-workflow-integration`

التحقق النهائي يعيد `ok`, `strict`, `mismatches`, `warnings`, `mismatch_count` وملخصاً.
البيئة الخالية سليمة (`ok=true`, `mismatch_count=0`). الوضع strict يفشل عند أي mismatch.
يفحص حالة التشغيل وسلسلة الأفعال وSoD وidempotency وDTO والتدقيق.

### مخزون اختبارات 9.B.1–9.B.4

- 9.B.1: `test:payroll-approval-core` و`verify-payroll-approval-core`.
- 9.B.2: `test:payroll-submit-review-integration`.
- 9.B.3: `test:payroll-approval-decision-integration` (75 حالة مسماة).
- 9.B.4: `test:payroll-approval-history-integration` (28 حالة مسماة) و
  `test:payroll-approval-workflow-integration` (E2E خطي 16 خطوة: Calculate→Submit→Reject→Recalc→Submit→Approve→guards).

كل اختبار تكامل ينشئ صفوفاً مملوكة ويزيلها في `finally` ويتحقق من صفر بقايا. القيد المعروف:
لا توجد RTL؛ اختبارات الواجهة هنا تختبر المساعدات النقية، أما سلوك العرض فيغطيه عقد HTTP.
