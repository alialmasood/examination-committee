# 9.A.2.3.2 — Payroll Calculation Integration

> **الحالة:** Implemented
> **بلا Migration 097 · بلا Recalculate · بلا Posting endpoint · بلا Push**
> **Baseline:** يعتمد على نواة 9.A.2.3.1 · Migrations **094/095/096 Frozen**

## الهدف

ربط محرك الاحتساب بطبقة HTTP + صلاحيات + تدقيق + واجهة عرض النتائج، مع حارس جاهزية الترحيل (وثائقي/وحدوي) دون تنفيذ Posting.

## الملفات الرئيسية

| ملف | دور |
|-----|-----|
| `app/api/accounts/payroll/runs/[id]/calculate/route.ts` | `POST` احتساب |
| `app/api/accounts/payroll/runs/[id]/route.ts` | `GET` تشغيل + `calculation_summary` |
| `app/api/accounts/payroll/runs/[id]/people/route.ts` | قائمة أشخاص التشغيل |
| `app/api/accounts/payroll/runs/[id]/people/[runPersonId]/route.ts` | تفاصيل شخص + أسطر + Issues |
| `src/lib/accounts/payroll-calculation-results.ts` | خدمات القراءة (بلا `snapshot_json`) |
| `src/lib/accounts/payroll-calculation-audit.ts` | تدقيق blocked/failed |
| `src/lib/accounts/payroll-posting-guard.ts` | `assertPayrollRunReadyForPosting` |
| `app/accounts/payroll/runs/[id]/page.tsx` | UI احتساب + نتائج |
| `app/accounts/payroll/_lib.tsx` | `runCalculateUrl` · `iqdWhole` · `CAP` · `PERSON_CALC_STATUS` |
| `src/scripts/test-payroll-calculation-integration.ts` | اختبارات HTTP تكامل |

---

## 1. API Contract — `POST .../runs/[id]/calculate`

**Capability:** `payroll_calculate` (Accounts Admin فقط)

**Request JSON:**

```json
{
  "confirmation": true,
  "version": 3,
  "updated_at": "<iso>",
  "idempotency_key": "<uuid-or-key ≤128>"
}
```

| حقل | إلزامي | ملاحظة |
|-----|--------|--------|
| `confirmation` | نعم | يجب `true` وإلا 400 |
| `version` | نعم | Optimistic concurrency |
| `updated_at` | نعم | يجب مطابقة التشغيل |
| `idempotency_key` | نعم | غير فارغ، طول ≤ 128 |

**Response 200:**

```json
{
  "success": true,
  "ok": true,
  "idempotent_replay": false,
  "run": {
    "id": "...",
    "status": "CALCULATED",
    "version": 4,
    "updated_at": "...",
    "people_count": 1,
    "error_count": 0,
    "warning_count": 0,
    "gross_total": "120000.000",
    "deduction_total": "0.000",
    "employer_contribution_total": "0.000",
    "net_total": "120000.000",
    "snapshot_hash": "...",
    "calculated_at": "..."
  },
  "summary": {
    "calculated_people": 1,
    "error_people": 0,
    "excluded_people": 0,
    "blocking_issues": 0,
    "warnings": 0
  }
}
```

**Totals تُعاد كسلاسل عشرية** (`typeof string`) — لا أرقام JS عائمة.

### مسارات القراءة المرتبطة

| Method | Path | Capability |
|--------|------|------------|
| GET | `/runs/[id]` | `payroll_view_runs` — يتضمن `calculation_summary` |
| GET | `/runs/[id]/people?status=&search=&page=` | `payroll_view_runs` |
| GET | `/runs/[id]/people/[runPersonId]` | `payroll_view_runs` — IDOR → 404 إن لم ينتمِ للتشغيل |

---

## 2. Capability

| دور | `payroll_calculate` | `payroll_view_runs` |
|-----|---------------------|---------------------|
| accounts_admin | ✅ | ✅ |
| accounts_clerk | ❌ → 403 | ✅ |
| accounts_viewer | ❌ → 403 | ✅ |
| accounts_approver | ❌ | ✅ |

---

## 3. Status Codes

| HTTP | متى |
|------|-----|
| **200** | نجاح احتساب أو idempotent replay |
| **400** | validation: confirmation / version / updated_at / idempotency_key / UUID غير صالح |
| **403** | بلا `payroll_calculate` |
| **404** | تشغيل غير موجود (GET) أو شخص تشغيل خارج النطاق (IDOR) |
| **409** | stale version / CALCULATING / ليس DRAFT / مفتاح جديد بعد CALCULATED |
| **422** | PERSON_LIST فارغة · عملة غير IQD — **قبل** أي mutation |
| **500** | خطأ تقني مُعقَّم عربي — بلا تسريب تفاصيل داخلية |

---

## 4. Idempotency

- `idempotency_key` → يُخزَّن كـ `calculation_request_id` / `last_calculation_request_id`.
- نفس المفتاح بعد `CALCULATED` ⇒ **200** مع `idempotent_replay: true` بلا إعادة بناء أسطر/تدقيق `calculated` إضافي.
- مفتاح مختلف بعد `CALCULATED` ⇒ **409** (Recalculate مؤجّل لـ 9.A.2.4).
- تزامن طلبين: أحدهما ينجح والآخر 409، أو كلاهما 200 إن كان نفس المفتاح (replay).

---

## 5. Audit Events

| Action (DB) | متى |
|-------------|-----|
| `payroll_run.calculation_started` | بعد التحويل إلى `CALCULATING` |
| `payroll_run.calculated` | بعد `CALCULATED` ناجح (مرة لكل احتساب فعلي) |
| `payroll_run.calculation_blocked` | 422 (قائمة فارغة / عملة…) — best-effort من الـ route |
| `payroll_run.calculation_failed` | فشل تقني بعد rollback — best-effort |

- Replay **لا** يضاعف `payroll_run.calculated`.
- 422 قبل mutation: **لا** `calculation_started`.

---

## 6. UI States (صفحة التشغيل)

| حالة التشغيل | زر Calculate | ملاحظات |
|--------------|--------------|---------|
| `DRAFT` + صلاحية | ظاهر + ConfirmDialog | يتطلب `confirmation: true` |
| أثناء الطلب | processing | تعطيل تفاعل مزدوج |
| `CALCULATED` | مخفي/معطّل | عرض totals + Issues |
| `CALCULATING` | معطّل | نادرًا يظهر للعميل (Tx قصيرة) |
| Recalculate | placeholder معطّل | → 9.A.2.4 |

مساعدات العرض: `iqdWhole` (IQD بدون كسور ظاهرة)، `PERSON_CALC_STATUS`, `CAP.CALCULATE`.

> سلوكيات الصفحة تُغطّى باختبارات HTTP + فحوصات المساعدات النقية — بلا React Testing Library في هذه المرحلة.

---

## 7. Results Views

1. **ملخص التشغيل** (`calculation_summary`): أعداد CALCULATED / ERROR / EXCLUDED / PENDING + blocking/warnings.
2. **قائمة الأشخاص** مع فلتر `status` وبحث.
3. **تفاصيل الشخص**: أسطر مكوّنات + Issues — **بدون** `snapshot_json` في الاستجابة.

شخص `ERROR`: totals مالية = 0، بلا أسطر مالية، يُحسب في `people_count` و`error_count`.

---

## 8. Security

- Capability على كل مسار.
- UUID validation → 400 قبل الاستعلام.
- تحميل تشغيل غير موجود → 404 (لا تمييز زائد).
- **IDOR:** `runPersonId` من تشغيل A تحت تشغيل B → 404.
- رسالة 500 معقّمة — لا تفصح failpoint / stack للعميل.

---

## 9. IQD-only

- احتساب الإصدار الحالي يدعم **IQD فقط**.
- تشغيل/فترة بعملة أخرى ⇒ **422** قبل CALCULATING / clear / artifacts / audit started.
- يمكن محاكاة ذلك في الاختبار عبر `UPDATE ... SET currency_code='USD'`.

---

## 10. Error Handling

| نوع | سلوك |
|-----|------|
| تجاري 422/409 | رسالة عربية من المحرك/التحقق |
| تقني داخل Tx | rollback كامل → DRAFT · 500 معقّم · audit `calculation_failed` |
| failpoint اختبار | `__setPayrollCalcFailpointForTests` ثم clear إلزامي |

---

## 11. No Partial Results

- معاملة واحدة (D22): فشل منتصف الاحتساب ⇒ لا people/lines/issues حية، الحالة تعود `DRAFT`.
- CALCULATED مع `error_count > 0` **ليس** «جزئيًا» — هو نجاح تقني + Persist ذرّي كامل لأشخاص ERROR.

---

## 12. Posting Boundary

`assertPayrollRunReadyForPosting(run)` يرفض إن:

- `status !== 'CALCULATED'`
- `error_count > 0`
- `snapshot_hash` غير صالح
- (اختياري) `blocking_issues_count > 0`

**لا endpoint ترحيل/اعتماد/دفع في 9.A.2.3.2** — الحارس جاهز للاستدعاء لاحقًا.

---

## 13. Recalculate Excluded

- Calculate على **DRAFT فقط**.
- لا `/recalculate` هنا → **9.A.2.4** (D25 على نفس التشغيل + reason + مفتاح جديد).
- H7: لا mutate على CALCULATED إلا عبر مسار Recalculate الصريح لاحقًا.

---

## 14. Testing

```bash
npm run test:payroll-calculation-integration
```

التغطية (ملخص):

1. Admin calculate نجاح
2. clerk/viewer → 403
3. بدون confirmation → 400
4. UUID غير صالح → 400
5. stale version → 409
6. PERSON_LIST فارغة → 422 + DRAFT
7. USD عبر SQL → 422 قبل mutation
8. مختلط OK + بلا عقد → CALCULATED + error_count≥1
9. Idempotent replay
10. مفتاح مختلف بعد CALCULATED → 409
11. Concurrent calculate
12. failpoint → 500 معقّم + DRAFT
13. viewer GET تشغيل مفقود → 404
14. IDOR تفاصيل شخص
15. Decimal strings
16–17. Audit calculated مرة واحدة / بلا تكرار عند replay
18. Posting guard وحدوي
19. GET people filter
20. GET run + calculation_summary
21. Cleanup leftover = 0
22. مساعدات UI نقية

عزل: ownership token + حذف audit لـ `payroll_run` المملوكة. تشغيل مرتين ⇒ 0 بقايا.

تحقق إضافي: `verify-payroll-calculation-integration` (تدقيق + حارس ترحيل على CALCULATED).

---

## خارج النطاق

- Migration 097+
- Recalculate / Approval Run
- Posting / Journal / Payment endpoints
- CUSTOM_FORMULA / Attendance / Lecturer Hours
- تعديل 094 / 095 / 096

---

*نهاية توثيق 9.A.2.3.2 — Calculation Integration*
