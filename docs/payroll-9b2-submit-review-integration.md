# 9.B.2 — Payroll Submit-for-Review API + UI + Audit Integration

> **الحالة:** IMPLEMENTED (بانتظار Acceptance Review)
> **Baseline Core:** 9.B.1 Approval Core (`docs/payroll-9b1-approval-core.md`)
> **Architecture:** `docs/payroll-9b-approval-workflow-architecture.md` (معتمدة — لا Architecture جديدة)
> **Migrations Frozen:** 094 · 095 · 096 · 097 · **لا 098**

---

## Endpoint

```
POST /api/accounts/payroll/runs/[id]/submit-review
```

يستدعي مباشرة `submitPayrollRunForReviewCore` داخل Transaction — بلا إعادة تنفيذ lifecycle / readiness / idempotency في الـ Route.

`GET /api/accounts/payroll/runs/[id]` يضيف كتلة `approval` (can_submit_for_review، readiness_blockers، submitted_for_review_by/at، approval_cycle، submit_comment، …).

---

## Request

```json
{
  "version": 1,
  "updated_at": "ISO-8601",
  "idempotency_key": "string 1..128",
  "comment": "string 0..500 بعد تطبيع Core (اختياري / null)",
  "confirmation": true
}
```

- `comment` و `idempotency_key` يمرّان عبر `normalizeApprovalComment` / Core validators (لا تطبيع مختلف في Route).
- لا `actor` / `user_id` من العميل.

---

## Capability

`payroll_submit_review` عبر `assertPayrollCapability`.

- `accounts_admin`: مسموح.
- لا تُمنح تلقائياً مع `payroll_calculate` أو `payroll_recalculate`.
- clerk/viewer: 403.

---

## Status codes

| Code | حالات |
|------|--------|
| 400 | JSON / UUID / confirmation / version / updated_at / key / comment |
| 403 | بلا capability |
| 404 | Run غير موجود أو غير مرئي (نمط موحّد) |
| 409 | stale · status · concurrency · IDEMPOTENCY_CONFLICT · APPROVAL_INTEGRITY_CONFLICT |
| 422 | IQD-only · HAS_ERRORS · HAS_BLOCKING_ISSUES · readiness قبل التحويل |
| 500 | فشل تقني معقّم — الحالة تبقى CALCULATED |
| 200 | نجاح جديد أو idempotent replay |

---

## Response (نجاح)

`ok` · `success` · `idempotent_replay` · `run` (status=`UNDER_REVIEW`، totals كسلاسل) · `submission` (action=`SUBMITTED_FOR_REVIEW`، comment، approval_cycle، snapshot_hash، submitted_at).

**لا يُعرض:** `request_key_hash` · `request_payload_hash` · raw key · snapshot_json · Audit JSON الخام.

كتلة `approval` على `GET /runs/[id]` (ليست جسم نجاح POST): can_submit_for_review · readiness_blockers · review_state · …

Replay: نفس العقد؛ بلا version/updated_at جديد؛ بلا Audit نجاح جديد.

---

## Error contract

```json
{
  "success": false,
  "ok": false,
  "message": "…",
  "error": { "code": "STALE_PAYROLL_RUN", "message": "…" }
}
```

أكواد عامة: `INVALID_COMMENT` · `PAYROLL_HAS_ERRORS` · `PAYROLL_HAS_BLOCKING_ISSUES` · `STALE_PAYROLL_RUN` · `IDEMPOTENCY_CONFLICT` · `UNSUPPORTED_PAYROLL_CURRENCY` · `APPROVAL_INTEGRITY_CONFLICT` · `TECHNICAL_FAILURE` · …

---

## Idempotency / Replay

- نفس المفتاح + نفس الحمولة → 200 replay.
- نفس المفتاح + حمولة مختلفة → 409 `IDEMPOTENCY_CONFLICT`.
- Audit تالف / مكرر → 409 integrity — بلا mutation.

---

## Audit

| Action | مصدر |
|--------|------|
| `payroll_run.submitted_for_review` | Core فقط (نجاح) |
| `payroll_run.submit_review_blocked` | Route best-effort عند 422 |
| `payroll_run.submit_review_failed` | Route best-effort عند 500 |

Masked key فقط · بلا SQL/stack/body كامل · بلا تكرار نجاح عند replay.

---

## UI (`/accounts/payroll/runs/[id]`)

- زر **إرسال للمراجعة** عند `CALCULATED` + capability + IQD + جاهزية.
- زر معطّل + blockers عند `can_submit_for_review === false` (مع وجود capability).
- إخفاء الزر بالكامل بلا `payroll_submit_review`.
- ConfirmDialog مع تعليق اختياري ≤500 وملخص totals/تحذيرات/بصمة.
- Loading / double-submit / idempotency key ثابت لكل محاولة تعليق.
- Toast: نجاح / replay.
- بانر **قيد المراجعة** عند `UNDER_REVIEW` (مُرسل · وقت · دورة · تعليق).
- نتائج الأشخاص والملخص تظهر لـ `CALCULATED` | `UNDER_REVIEW` | `APPROVED`.
- لا أزرار Approve / Reject في هذه المرحلة.

---

## Immutability

بعد Submit يصبح `UNDER_REVIEW`. لا Recalculate · لا Edit · لا Cancel حتى قرار المراجع (9.B.3).

---

## IQD-only · Previous state

عملة غير IQD أو أخطاء/مشكلات حاجبة → 422 قبل التحويل؛ الحالة تبقى `CALCULATED`. فشل تقني → Rollback؛ بلا UNDER_REVIEW جزئي.

لا Migration 098 · لا Approve/Reject API في هذه الشريحة.

---

## Testing

```
npm run test:payroll-submit-review-integration
npm run accounts:verify-payroll-submit-review-integration[:strict]
```

+ انحدار Approval Core / Recalculate / Calculation / Snapshot / Periods / Foundation.

---

## مؤجّل (9.B.3+)

Approve · Reject · Reviewer decision UI · Posting · Journal · Payments · Payslips · Snapshot Archive · Revision Runs · Migration 098 · Push.
