# 9.C.2 — Final Acceptance: Payroll Posting Integration

> **Status:** Implementation ready / Final acceptance candidate (pending commits — not ACCEPTED yet)
> **Note:** Reversal deferred (out of scope for 9.C.2; already listed under Out of scope).
> **Baseline:** `1673c96`
> **Architecture:** `docs/payroll-9c-posting-architecture.md`
> **Prior:** 9.C.1 Core (`docs/payroll-9c1-posting-core.md`) · 9.B.4 History Final

## ملخص القبول / Acceptance summary

إغلاق مسار الرواتب حتى الترحيل المحاسبي:

| Stage | Outcome |
|---|---|
| 9.B.x | اعتماد APPROVED مع history / SoD / idempotency |
| 9.C.1 | Core `postPayrollRunCore` + migration 098 |
| **9.C.2** | **HTTP `POST …/post` + UI helpers + verify-final + E2E** |

**Out of scope / مؤجّل:** Reversal · Payments · Payslips · **Migration 099** · push إلى remote.

## Endpoint

`POST /api/accounts/payroll/runs/:id/post`

**Capability:** `payroll_post` (`PAYROLL_CAPABILITIES.POST` / `CAP.POST`)

### Request (JSON)

| Field | Required | Notes |
|---|---|---|
| `confirmation` | yes | must be `true` |
| `version` | yes | integer ≥ 1 |
| `updated_at` | yes | ISO concurrency token |
| `idempotency_key` | yes | 1..128 chars |
| `posting_date` | yes | `YYYY-MM-DD` inside open fiscal period |
| `comment` | no | trim / max 500 → else 400 |

### Success response

- `ok` / `success`
- `idempotent_replay`
- `run` (status `POSTED`, version, posted_*)
- `posting.journal_entry` (`SALARY`, `POSTED`, debit/credit strings, `display_url`)
- nested `data.posting` للتوافق

### GET posting preview

`GET /api/accounts/payroll/runs/:id` يضم قسم `posting` عبر `buildPayrollPostingSection`:

- قبل الترحيل: `is_posted=false`, `can_post` / `readiness` / blockers
- بعد الترحيل: `is_posted=true`, `can_post=false`, journal summary

`verifyPayrollPostingPublicDto` يتحقق من عدم تسريب hashes/مفاتيح/`snapshot_json`.

## Status codes (مختصر)

| Code | Typical HTTP |
|---|---|
| `MALFORMED_JSON` / `INVALID_*` / `MISSING_CONFIRMATION` | 400 |
| `FORBIDDEN` | 403 |
| `PAYROLL_RUN_NOT_FOUND` | 404 |
| `STALE_PAYROLL_RUN` / `PAYROLL_ALREADY_POSTED` / `IDEMPOTENCY_CONFLICT` / `FISCAL_PERIOD_NOT_OPEN` / not APPROVED | 409 |
| `PAYROLL_HAS_ERRORS` / mapping / currency / rounding / approval integrity | 422 |
| `TECHNICAL_FAILURE` | 500 |

## Idempotency

- نفس المفتاح + نفس payload ⇒ replay (`idempotent_replay=true`)، نفس journal / document number، **بدون** `version++`، سجل posting واحد.
- نفس المفتاح + payload مختلف (تعليق / تاريخ) ⇒ **409**.
- مفتاح جديد بعد POSTED ⇒ **409** (`PAYROLL_ALREADY_POSTED` / conflict).

## Immutability بعد POSTED

محظور: calculate · recalculate · PATCH · scope · cancel · submit-review · approve · reject.

## Audit

- `payroll_run.post*` بدون `idempotency_key` خام، بدون `snapshot_json`، بدون SQL.
- blocked/failed audits best-effort من مسار الـ route.

## UI helpers (`app/accounts/payroll/_lib.tsx`)

- `CAP.POST`, `can()`, `runPostUrl`, `shortApprovalHashDisplay`
- `postingButtonVisibility` (showEnabled / showDisabled / hidden)
- `postingErrorMsg`
- **لا ادّعاء RTL** في اختبارات الوحدات — وحدات نقية فقط.

## Scripts

```bash
npm run test:payroll-posting-ui-helpers
npm run test:payroll-posting-integration
npm run test:payroll-final-workflow
npm run accounts:verify-payroll-final
npm run accounts:verify-payroll-final:strict
```

Related prior:

```bash
npm run test:payroll-posting-core
npm run accounts:verify-payroll-posting
```

## verify-payroll-final

`verifyPayrollFinal(client, { strict? })` يجمّع:

`foundation` · `periods_runs` · `snapshot` · `calculation` · `recalculate` · `approval` · `posting`

النتيجة: `{ ok, strict, modules, mismatch_count }` حيث `ok` = كل الوحدات ناجحة و`mismatch_count===0`.

## Test coverage (تقريبي)

| Suite | ~cases |
|---|---|
| `test-payroll-posting-ui-helpers` | 12 |
| `test-payroll-posting-integration` | 70+ named `it()` |
| `test-payroll-final-workflow` | ~20 named steps |

## Deferred (صراحة)

- Reversal / void posting
- Employee payments / payslips
- Migration **099**
- Soft SoD Approver≠Poster (سياسة لاحقة)
- **No git push** في قبول 9.C.2

## Notes

- Cleanup في الاختبارات يعيد POSTED→APPROVED ثم يحذف postings/journals مثل posting-core.
- Failpoints: `__setPayrollPostingFailpointForTests`
- Capabilities override: `__setPayrollCapabilitiesOverrideForTests`