# 9.C.1 — Payroll Posting Data Model + Core

> **الحالة:** Implementation
> **Architecture:** `docs/payroll-9c-posting-architecture.md` (ACCEPTED)
> **Baseline قبل التنفيذ:** `db48bb3` · Architecture commit: `docs(accounts): approve payroll posting architecture 9C`

## النطاق

- Migration `098_payroll_posting.sql`
- `postPayrollRunCore`
- Idempotency `payroll-post`
- Failpoints
- `accounts:verify-payroll-posting`
- `test:payroll-posting-core`

**خارج النطاق:** API · UI · Reversal · Payments · Payslips · Migration 099

## Data model

- `payroll_runs.status` يشمل `POSTED` (في live regular index أيضًا)
- حقول: `posted_at`, `posted_by`, `posting_journal_entry_id`, `posted_snapshot_hash`
- جدول `accounts.payroll_run_postings` — صف نجاح واحد لكل تشغيل (append-only تطبيقيًا)

## Core

`APPROVED → POSTED` داخل Tx واحدة.

**Lock order الفعلي:**

1. Payroll Period + Payroll Run + `journalSourceLock('PAYROLL_RUN')` عبر `acquirePayrollLocks` (فرز حتمي)
2. `FOR UPDATE` على `fiscal_periods`
3. حسابات GL المطلوبة `chartAccountLock` (مرتبة UUID)
4. `acquireJournalEntriesLock` + `documentSequenceLock`
5. Insert Journal / Posting / Update Run / Audit

**Rounding:** عتبة مركزية `PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD = 1.000` · فوقها رفض.

**posting_date:** مدخل صريح للـ Core · الافتراضي في الاختبارات = نهاية/بداية سياق الفترة المالية المفتوحة · فترة مغلقة → رفض بلا انتقال صامت.

## Scripts

```bash
npm run test:payroll-posting-core
npm run accounts:verify-payroll-posting
npm run accounts:verify-payroll-posting:strict
```

## مؤجّل

- 9.C.1.b API `POST …/post`
- 9.C.1.c UI
- 9.C.2 Reversal
- SoD Approver≠Poster (اختياري مستقبلًا)
