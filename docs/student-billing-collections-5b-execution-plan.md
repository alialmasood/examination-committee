# 5.B — خطط الرسوم والأقساط والتحصيل

**Baseline:** `85b32aa` — fix(accounts): harden student receivables access and integrity 5A

## القرار المعماري

**قسط واحد = Student Charge واحد (POSTED عند تفعيل الخطة).**

الأسباب: استحقاق مستقل، due_date مستقل، تحصيل جزئي وتقارير أدق، دون تعديل مطالبة مجمّعة.

**Fee Type:** حقل `fee_type_id` على الخطة (نوع واحد لكل خطة في 5.B). لا جدول `plan_items` ولا توزيع معقد — قابل للتوسع لاحقاً عبر عمود على القسط.

## دورة الخطة

1. DRAFT: إنشاء/تعديل + توليد أقساط (متساوٍ أو يدوي؛ آخر قسط يحمل فرق التقريب).
2. ACTIVE (transaction): قفل → تحقق المجموع/التواريخ → إنشاء وترحيل Charge لكل قسط → ربط `student_charge_id` → ACTIVE + Audit.
3. COMPLETED عندما كل الأقساط PAID.
4. CANCELLED (سياسة محافظة):
   - CANCELLED → idempotent؛ COMPLETED → 409.
   - رفض إذا وُجدت تحصيلات DRAFT/POSTED مخصّصة لأقساط أو مطالبات الخطة.
   - DRAFT: إلغاء أقساط PENDING/DUE فقط.
   - ACTIVE: إبطال المطالبات POSTED غير المسددة (outstanding = original) عبر voidStudentCharge، ثم إلغاء كل الأقساط غير الملغاة.

## دورة التحصيل

1. DRAFT: مبلغ ≤ رصيد الطالب؛ تخصيص يدوي أو auto (أقدم due ثم installment_number ثم charge_date)؛ `sum(allocations) = amount`.
2. POST: orchestration داخلي → Cash/Bank Receipt Voucher (المقابل = Receivables GL) → Student Ledger `COLLECTION` credit → تحديث outstanding/status.
3. **لا يُنشأ قيد قبض ثانٍ** من Student Collections — السند هو مصدر قيد GL.

## VOID

- DRAFT: VOID مباشر.
- POSTED: void السند المرتبط + `COLLECTION_REVERSAL` debit + عكس التخصيصات داخل transaction.

## الصلاحيات

امتداد 5.A: `student_billing.view|manage|activate` و `student_collections.prepare|post|void`.  
Viewer=عرض؛ Clerk=manage+prepare؛ Admin=الكل. لا username override للقدرات.

## خارج النطاق (5.C+)

خصومات، استرداد، غرامات، بوابة دفع، شيكات، متعدد عملات، Credit Balance / Advance.
