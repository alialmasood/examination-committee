# 9.A.2.3.1 — Payroll Calculation Core

> **الحالة:** Implemented  
> **بلا Migration 097 · بلا API عام · بلا UI · بلا Recalculate · بلا Push**  
> **Baseline معماري:** `3628a03` · Migrations **094/095/096 Frozen**

## الهدف

نواة احتساب حتمية وذرّية على `payroll_runs`:

`DRAFT → CALCULATING → CALCULATED` داخل معاملة واحدة، مع Persist للقطة الأشخاص/الأسطر/المشاكل حتى عند `error_count > 0`.

## الملفات

| ملف | دور |
|-----|-----|
| `payroll-scope-resolver.ts` | حل نطاق الأشخاص (ALL / DEPARTMENT / COLLEGE / COST_CENTER / PERSON_LIST) |
| `payroll-contract-resolver.ts` | عقد ACTIVE وحيد يغطي التاريخ + عملة التشغيل |
| `payroll-component-resolver.ts` | مصادر PCA مرتبة حتمياً |
| `payroll-calculation-formulas.ts` | FIXED / PERCENTAGE + ROUND_HALF_UP (bigint) |
| `payroll-calculation-issues.ts` | رموز Issues وحمولات عربية |
| `payroll-snapshot-builder.ts` | `PayrollPersonSnapshotJson` + hash شخص/تشغيل |
| `payroll-calculation-engine.ts` | `calculatePayrollRunCore` |
| `verify-payroll-calculation-core.ts` | تحقق اتساق CALCULATED |

## COLLEGE — مسار الاستعلام المعتمد

```text
student_affairs.colleges
  ← student_affairs.departments.college_id
    ← accounts.payroll_assignments.department_id
      ← accounts.payroll_people
```

شروط: تكليف `ACTIVE` يغطي `calculation_date`، شخص `ACTIVE` يغطي التاريخ، `DISTINCT` على الشخص، ترتيب `person_code ASC, id ASC`.

**COLLEGE ≠ DEPARTMENT.** إنشاء التشغيل يتحقق من `student_affairs.colleges` لمرجع COLLEGE.

## سياسة الأساسي (B)

- `basic_amount` = `contract.base_amount`
- `gross` = Σ أسطر `EARNING` فقط
- `net` = gross − deductions (مساهمات جهة العمل خارج الصافي)
- شخص `ERROR`: بلا أسطر مالية، totals = 0، يُحسب في `people_count` و`error_count` فقط

## تقريب

`ROUND_HALF_UP` عبر `payroll-calculation-formulas` (مقياس داخلي 6، بلا `Number`):

| عملية | مخزّن (IQD) |
|-------|-------------|
| 1000 × 12.5% | 125 |
| 1001 × 12.5% | 125 |
| 1004 × 12.5% | 126 |

## PERSON_LIST فارغة

`422` **قبل** clear / تغيير الحالة / artifacts / Audit Started. التشغيل يبقى `DRAFT`.

## Idempotency

`idempotency_key` → UUID في `calculation_request_id`.  
إن `CALCULATED` و`last_calculation_request_id` يطابق → replay بلا إعادة بناء.  
`CALCULATING` أو مفتاح جديد على CALCULATED → 409.

## تشغيل التحقق

```bash
npm run test:payroll-calculation-core
npm run accounts:verify-payroll-calculation-core
npm run accounts:verify-payroll-calculation-core:strict
```

## خارج النطاق (→ 9.A.2.3.2 / 9.A.2.4)

- `POST .../calculate` + UI  
- Recalculate  
- Posting / Payment / Approval  
