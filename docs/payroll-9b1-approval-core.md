# 9.B.1 — Payroll Approval Data Model + Lifecycle Core

> **الحالة:** تنفيذ 9.B.1
> **Baseline معماري:** `c4d3afe` (Architecture ACCEPTED)
> **Migration:** `097_payroll_approval_workflow.sql`
> **خارج النطاق:** Public API · UI · History API · Posting · Payments · Payslips · Push · 9.B.2+

---

## ما يُسلَّم

| عنصر | المسار |
|------|--------|
| Migration | `db/migrations/097_payroll_approval_workflow.sql` |
| Submit / Approve / Reject Core | `src/lib/accounts/payroll-approval-core.ts` |
| Idempotency | `src/lib/accounts/payroll-approval-idempotency.ts` |
| Failpoints (اختبار فقط) | `src/lib/accounts/payroll-approval-failpoints.ts` |
| Audit blocked/failed | `src/lib/accounts/payroll-approval-audit.ts` |
| Verify | `src/lib/accounts/verify-payroll-approval-core.ts` |
| اختبارات | `npm run test:payroll-approval-core` |
| Verify CLI | `npm run accounts:verify-payroll-approval-core[:strict]` |

---

## Lifecycle

```
DRAFT → CALCULATING → CALCULATED → UNDER_REVIEW → APPROVED
                         ↑______________|
                              Reject
```

- لا حالة Run باسم `REJECTED` أو `POSTED`.
- Cancel ممنوع من `UNDER_REVIEW` و `APPROVED`.
- Recalculate مسموح فقط من `CALCULATED` (بعد Reject يعود CALCULATED).

---

## SoD

- Submitter ≠ Approver و Submitter ≠ Rejector (يشمل `accounts_admin`).
- لا Override / Emergency / self-approval.
- Capabilities: `payroll_submit_review` · `payroll_approve` · `payroll_reject` · `payroll_view_approval_history`.

---

## Source of Truth

- نجاح Workflow → `accounts.payroll_run_approval_actions` (append-only تطبيقيًا).
- Blocked/Failed → `financial_audit_log`.
- `approval_cycle` يزيد عند كل Submit ناجح؛ لا ينقص عند Reject.

---

## حارس الترحيل (مستقبلي)

`assertPayrollRunReadyForPosting` يشترط الآن:

- `status = APPROVED`
- `approved_snapshot_hash = snapshot_hash`
- بلا أخطاء / مشكلات حاجبة

لا يوجد endpoint ترحيل في 9.B.1.

---

## حدود Verify

بلا أرشيف لقطة كامل — يُكشف انحراف الحقول/الأفعال/SoD/hashes الظاهرة، لا محتوى اللقطة التاريخي.
