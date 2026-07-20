# 9.A.2.4.2 — Payroll Recalculate API + UI + Audit Integration

> **الحالة:** IMPLEMENTED (بانتظار Acceptance Review)
> **Baseline Core:** `3a17ca6` (9.A.2.4.1 ACCEPTED)
> **Architecture:** `docs/payroll-9a24-recalculate-architecture.md` (معتمدة — لا Architecture جديدة)
> **Migrations Frozen:** 094 · 095 · 096 · **لا 097**

---

## Endpoint

```
POST /api/accounts/payroll/runs/[id]/recalculate
```

يستدعي مباشرة `recalculatePayrollRunCore` داخل Transaction — بلا إعادة تنفيذ locking / formulas / scope / delete-rebuild في الـ Route.

```
GET /api/accounts/payroll/runs/[id]/recalculations?page=&page_size=
```

ملخصات تاريخية من Audit فقط (pagination).

`GET /api/accounts/payroll/runs/[id]` يضيف كتلة `recalculation` (can_recalculate، آخر ملخص، has_history، …).

---

## Request

```json
{
  "version": 1,
  "updated_at": "ISO-8601",
  "idempotency_key": "string 1..128",
  "reason": "string 10..500 بعد تطبيع Core",
  "confirmation": true
}
```

- `reason` و `idempotency_key` يمرّان عبر `normalizeRecalculateReason` / Core validators (لا تطبيع مختلف في Route).
- لا `actor` / `user_id` من العميل.

---

## Capability

`payroll_recalculate` عبر `assertPayrollCapability`.

- `accounts_admin`: مسموح.
- لا تُمنح تلقائياً مع `payroll_calculate`.
- clerk/viewer: 403.

---

## Status codes

| Code | حالات |
|------|--------|
| 400 | JSON / UUID / confirmation / version / updated_at / key / reason |
| 403 | بلا capability |
| 404 | Run غير موجود أو غير مرئي (نمط موحّد) |
| 409 | stale · status · concurrency · IDEMPOTENCY_CONFLICT · integrity/duplicate Audit |
| 422 | IQD-only · empty PERSON_LIST · business block قبل المسح |
| 500 | فشل تقني معقّم — اللقطة السابقة محفوظة |
| 200 | نجاح جديد أو idempotent replay |

---

## Response (نجاح)

`ok` · `success` · `idempotent_replay` · `run` (totals كسلاسل) · `recalculation` (before/after) · `summary`.

**لا يُعرض:** `request_key_hash` · `request_payload_hash` · raw key · snapshot_json · Audit JSON الخام.

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

أكواد عامة: `INVALID_REASON` · `PAYROLL_RUN_NOT_CALCULATED` · `STALE_PAYROLL_RUN` · `IDEMPOTENCY_CONFLICT` · `UNSUPPORTED_PAYROLL_CURRENCY` · `EMPTY_PERSON_LIST` · `RECALCULATION_INTEGRITY_CONFLICT` · `TECHNICAL_FAILURE` · …

---

## Idempotency / Replay

- نفس المفتاح + نفس الحمولة → 200 replay.
- نفس المفتاح + حمولة مختلفة → 409 `IDEMPOTENCY_CONFLICT`.
- Audit تالف / مكرر → 409 integrity — بلا mutation.

---

## Audit

| Action | مصدر |
|--------|------|
| `payroll_run.recalculated` | Core فقط (نجاح) |
| `payroll_run.recalculation_started` | Core |
| `payroll_run.recalculation_blocked` | Route best-effort عند 422 |
| `payroll_run.recalculation_failed` | Route best-effort عند 500 |

Masked key فقط · بلا SQL/stack/body كامل · بلا تكرار نجاح عند replay.

---

## History API

`GET .../recalculations` — created_at · actor display · reason · counts/totals before/after · short hashes · `no_change`.

بلا request hashes · بلا raw old/new_values · بلا Lines قديمة.

Visibility: `VIEW_RUNS` + تحميل Run أولاً (404 موحّد).

---

## UI (`/accounts/payroll/runs/[id]`)

- زر **إعادة احتساب الرواتب** عند `CALCULATED` + capability + IQD.
- ConfirmDialog مع سبب 10–500 وتحذيرات المعمارية.
- Loading / double-submit / idempotency key ثابت لكل محاولة.
- Toast: نجاح / no-op / replay.
- قسم **سجل إعادة الاحتساب**.
- تحديث Run + People + summary بعد النجاح.
- لا زر Posting.

---

## Immutability

بعد Recalculate يبقى `CALCULATED`. تحديث التشغيل والنطاق مرفوضان خارج `DRAFT` (بدون استثناء بسبب Recalculate).

---

## IQD-only · Previous snapshot

عملة غير IQD أو قائمة فارغة → 422 قبل المسح؛ اللقطة السابقة كاملة. فشل تقني → Rollback؛ النتائج السابقة محفوظة.

لا أرشفة لقطة كاملة · لا Lines تاريخية للعرض.

---

## Testing

```
npm run test:payroll-recalculate-integration
npm run accounts:verify-payroll-recalculate-integration[:strict]
```

+ انحدار Core / Calculation / Snapshot / Periods / Foundation.

---

## مؤجّل

Approval · Under Review · Posting · Journal · Payments · Payslips · Snapshot Archive · Revision Runs · Migration 097 · Push.
