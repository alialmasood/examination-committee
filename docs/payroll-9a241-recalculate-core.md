# 9.A.2.4.1 — Payroll Recalculate Core

> **الحالة:** Implemented (Core only)  
> **Architecture:** `docs/payroll-9a24-recalculate-architecture.md` (ACCEPTED)  
> **Baseline:** `4dacb95` · Architecture commit: `2417923`  
> **خارج النطاق:** Public API · UI · Migration 097 · 9.A.2.4.2 · تعديل 094–096

---

## ما نُفّذ

| جزء | ملف |
|-----|-----|
| Idempotency / reason | `src/lib/accounts/payroll-recalculate-idempotency.ts` |
| Failpoints | `src/lib/accounts/payroll-recalculate-failpoints.ts` |
| Core | `src/lib/accounts/payroll-recalculate-core.ts` |
| Shared rebuild | `rebuildPayrollRunArtifactsWhileCalculating` في `payroll-calculation-engine.ts` |
| Capability | `PAYROLL_CAPABILITIES.RECALCULATE = 'payroll_recalculate'` (ADMIN فقط) |
| Audit actions | `recalculation_started` · `recalculated` · `recalculation_blocked` · `recalculation_failed` |
| Verify | `verify-payroll-recalculate-core` |
| Tests | `test:payroll-recalculate-core` |

---

## تدفق المعاملة

1. تطبيع المفتاح/السبب + بصمات `request_key_hash` / `request_payload_hash`
2. قفل Period ثم Run
3. **Idempotency lookup قبل concurrency** (ليعمل replay بنفس جسم الطلب الأصلي الذي يتضمن version/updated_at)
4. عند عدم replay: `assertPayrollConcurrency` + حواجز الحالة (CALCULATED فقط)
5. تحقّقات ما قبل المسح (IQD · فترة · PERSON_LIST · بصمة)
6. التقاط PreviousSummary → failpoint `after_previous_summary`
7. `CALCULATED → CALCULATING` + attempt++ + `calculation_request_id`
8. Audit `recalculation_started` (يختفي عند Rollback)
9. `clearRunCalculationArtifacts` → failpoint `after_delete`
10. `rebuildPayrollRunArtifactsWhileCalculating` (نفس صيغ Calculate)
11. Audit `payroll_run.recalculated` (previous_* / new_* + fingerprints)
12. Commit

**لا يُحذف** `payroll_run_scope_members`.

---

## Fingerprints

```
request_key_hash     = SHA-256("payroll-recalc:" + trimmed_key) → hex 64
request_payload_hash = SHA-256(canonical JSON:
  operation, run_id, reason, expected_version, expected_updated_at)
calculation_request_id = UUID v4-shaped من أول 16 بايت من request_key_hash
```

- Namespace منفصل عن `payroll-calc:`.
- المطابقة عبر hashes فقط — **ليس** masked key.
- Replay: نفس key + نفس payload → لا حذف · لا Audit نجاح جديد · لا version++.
- Conflict: نفس key + payload مختلف → 409 IDEMPOTENCY_CONFLICT.

---

## حدود التاريخ (Historical Summary)

Audit يحفظ قبل/بعد: hash · counts · totals · reason · fingerprints.

**لا** يمكن استعادة Lines/People/Issues للنسخة السابقة — ليست Full Snapshot Archive.

فجوة Verify: لا يُفترض وجود أرشيف لقطة كاملة؛ الفحوص تتحقق من اكتمال ملخص Audit وتوافق آخر `new_snapshot_hash` مع `run.snapshot_hash` عند CALCULATED.

---

## Failpoints (اختبارات)

`RECALC_FAILPOINT_*`: after_previous_summary · after_delete · after_first_person · after_first_line · before_run_hash · before_totals_update · during_audit.

عند الفشل: Rollback → Run يبقى CALCULATED باللقطة السابقة.

---

## أوامر

```bash
npm run test:payroll-recalculate-core
npm run accounts:verify-payroll-recalculate-core
npm run accounts:verify-payroll-recalculate-core:strict
```

انحدار Calculate بعد refactor المحرك:

```bash
npm run test:payroll-calculation-core
```

---

## ما لم يُنفَّذ (9.A.2.4.2)

- `POST .../runs/[id]/recalculate`
- UI ConfirmDialog + حقل السبب
- Audit blocked/failed خارج Tx من الـ Route
- اختبارات HTTP/IDOR على الـ API
