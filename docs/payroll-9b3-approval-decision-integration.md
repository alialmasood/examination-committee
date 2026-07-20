# 9.B.3 — Payroll Approve / Reject API + UI Integration

> **الحالة:** IMPLEMENTED (بانتظار Acceptance Review)
> **Baseline Core:** 9.B.1 · 9.B.2 ACCEPTED
> **Architecture:** `docs/payroll-9b-approval-workflow-architecture.md`
> **Migrations Frozen:** 094 · 095 · 096 · 097 · **لا 098**

---

## Endpoints

```
POST /api/accounts/payroll/runs/[id]/approve
POST /api/accounts/payroll/runs/[id]/reject
```

يستدعيان `approvePayrollRunCore` / `rejectPayrollRunReviewCore` داخل Transaction — بلا إعادة تنفيذ lifecycle في الـ Route.

`GET /api/accounts/payroll/runs/[id]` يوسّع كتلة `approval` بـ: can_approve · can_reject · is_current_user_submitter · segregation_of_duties_blocked · approval_blockers · readiness_for_approval · last_rejection · approved_by/at.

---

## Request

**Approve**
```json
{ "version": 1, "updated_at": "ISO-8601", "idempotency_key": "1..128", "comment": "اختياري 0..500", "confirmation": true }
```

**Reject**
```json
{ "version": 1, "updated_at": "ISO-8601", "idempotency_key": "1..128", "reason": "إلزامي 10..500", "confirmation": true }
```

لا `actor` / `user_id` من العميل.

---

## Capability

- `payroll_approve` · `payroll_reject` عبر `assertPayrollCapability` (مستقلتان).
- `accounts_admin` مسموح لكن **لا يتجاوز SoD**.
- clerk/viewer: 403.

---

## Segregation of Duties

Submitter ≠ Approver و Submitter ≠ Rejector — حتى للإدارة. أكواد HTTP: `PAYROLL_SELF_APPROVAL_FORBIDDEN` / `PAYROLL_SELF_REJECTION_FORBIDDEN` (403).

---

## Status codes

| Code | حالات |
|------|--------|
| 400 | JSON / UUID / confirmation / version / updated_at / key / comment / reason |
| 403 | بلا capability · SoD |
| 404 | Run غير موجود أو غير مرئي |
| 409 | stale · status · concurrency · IDEMPOTENCY_CONFLICT · APPROVAL_INTEGRITY · SNAPSHOT_CHANGED · ALREADY_DECIDED |
| 422 | IQD-only · HAS_ERRORS · HAS_BLOCKING · PERIOD_NOT_OPEN · readiness |
| 500 | فشل تقني معقّم — الحالة تبقى UNDER_REVIEW |
| 200 | نجاح جديد أو idempotent replay |

---

## Response (نجاح)

`ok` · `success` · `idempotent_replay` · `run` (totals كسلاسل) · `decision` (APPROVED|REJECTED).

**لا يُعرض:** `request_key_hash` · `request_payload_hash` · raw key · snapshot_json.

Reject يعيد التشغيل إلى `CALCULATED` مع تصفير حقول المراجعة النشطة؛ التاريخ في `payroll_run_approval_actions`.

---

## Audit

| Action | مصدر |
|--------|------|
| `payroll_run.approved` / `payroll_run.review_rejected` | Core (نجاح) |
| `payroll_run.approval_blocked` / `rejection_blocked` | Route best-effort عند 422/403 |
| `payroll_run.approval_failed` / `rejection_failed` | Route best-effort عند 500 |

Masked key فقط · بلا SQL/stack · بلا تكرار نجاح عند replay.

---

## UI (`/accounts/payroll/runs/[id]`)

- أزرار **اعتماد الرواتب** / **رفض وإعادة للتصحيح** عند UNDER_REVIEW + capability + ليس Submitter.
- زر معطّل + approval_blockers عند عدم الجاهزية.
- بانر Submitter (فصل الواجبات).
- بانر APPROVED (معتمد · جاهز للترحيل لاحقاً — **بلا زر Posting**).
- بانر last_rejection بعد العودة لـ CALCULATED.
- ConfirmDialog: تعليق اختياري للاعتماد · سبب إلزامي ≥10 للرفض.
- تعطيل متبادل أثناء approving/rejecting (+ submit).
- إخفاء الطفرات عند APPROVED · الإبقاء على Submit Review من 9.B.2.

---

## Immutability

- UNDER_REVIEW: لا Recalculate · لا Edit · لا Cancel.
- APPROVED: لا Recalculate · لا Cancel · لا Submit · لا Reject.
- بعد Reject: Recalculate/Submit مسموحان.

---

## Testing

```
npm run test:payroll-approval-decision-integration
npm run accounts:verify-payroll-approval-decision-integration[:strict]
```

~75 حالة HTTP (Approve + Reject + SoD + capabilities + concurrency + cleanup).

---

## مؤجّل (9.B.4+)

History API · Posting · Journal · Payments · Payslips · Snapshot Archive · Review Withdrawal · Multi-level · Migration 098 · Push.
