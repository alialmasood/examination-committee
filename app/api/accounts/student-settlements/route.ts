import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  getOpenYearState,
  perPeriodFromRemaining,
  recalculateRemainingByReceipt,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  parseDiscountFeeYears,
  serializeDiscountFeeYears,
} from '@/app/accounts/students/lib/admissionChannels';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import {
  postStudentSettlementJournalEntry,
  type SettlementJournalResult,
} from '@/src/lib/accounts/student-settlement-gl';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function ensureSettlementReceiptsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS accounts.student_settlement_receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_number VARCHAR(40) NOT NULL UNIQUE,
      student_id UUID NOT NULL
        REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
      university_id VARCHAR(64),
      student_name TEXT,
      department TEXT,
      study_type VARCHAR(32),
      admission_type VARCHAR(32),
      settlement_date DATE NOT NULL,
      annual_fee NUMERIC(18, 2) NOT NULL DEFAULT 0,
      four_years_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
      discount_mode VARCHAR(16) NOT NULL DEFAULT 'none'
        CHECK (discount_mode IN ('none', 'amount', 'percent')),
      discount_years SMALLINT NOT NULL DEFAULT 1
        CHECK (discount_years BETWEEN 1 AND 4),
      discount_base NUMERIC(18, 2) NOT NULL DEFAULT 0,
      discount_input NUMERIC(18, 2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
      after_discount NUMERIC(18, 2) NOT NULL DEFAULT 0,
      pay_amount NUMERIC(18, 2) NOT NULL CHECK (pay_amount > 0),
      remaining_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
      periods SMALLINT NOT NULL DEFAULT 1
        CHECK (periods BETWEEN 1 AND 10),
      per_period_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
      fee_year SMALLINT NOT NULL DEFAULT 1
        CHECK (fee_year BETWEEN 1 AND 4),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID NULL
    )
  `).catch(() => undefined);

  await query(`
    ALTER TABLE accounts.student_settlement_receipts
      ADD COLUMN IF NOT EXISTS fee_year SMALLINT NOT NULL DEFAULT 1
  `).catch(() => undefined);

  await query(`
    ALTER TABLE accounts.student_settlement_receipts
      ADD COLUMN IF NOT EXISTS journal_entry_id UUID NULL
  `).catch(() => undefined);

  await query(`
    ALTER TABLE accounts.student_settlement_receipts
      ADD COLUMN IF NOT EXISTS discount_channel VARCHAR(50)
  `).catch(() => undefined);

  await query(`
    ALTER TABLE accounts.student_settlement_receipts
      ADD COLUMN IF NOT EXISTS discount_fee_years VARCHAR(20)
  `).catch(() => undefined);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_student_settlement_receipts_student
      ON accounts.student_settlement_receipts (student_id, settlement_date DESC, created_at DESC)
  `).catch(() => undefined);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_student_settlement_receipts_fee_year
      ON accounts.student_settlement_receipts (student_id, fee_year, settlement_date DESC)
  `).catch(() => undefined);
}

function toMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function nextReceiptNumber(settlementDate: string): Promise<string> {
  const dayKey = String(settlementDate || '').replace(/-/g, '').slice(0, 8);
  const prefix = `STR-${dayKey || '00000000'}-`;

  const res = await query(
    `SELECT receipt_number
     FROM accounts.student_settlement_receipts
     WHERE receipt_number LIKE $1
     ORDER BY receipt_number DESC
     LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  const last = res.rows[0]?.receipt_number as string | undefined;
  if (last) {
    const part = last.slice(prefix.length);
    const n = Number(part);
    if (Number.isFinite(n) && n >= 1) seq = n + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAccountsAccess(request);
    if (isAuthFailure(auth)) return auth.response;

    await ensureSettlementReceiptsTable();

    const studentId = request.nextUrl.searchParams.get('student_id')?.trim() || '';
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'student_id مطلوب' },
        { status: 400 }
      );
    }

    const result = await query(
      `SELECT
         id,
         receipt_number,
         student_id,
         university_id,
         student_name,
         department,
         study_type,
         admission_type,
         settlement_date,
         annual_fee,
         four_years_total,
         discount_mode,
         discount_years,
         discount_base,
         discount_input,
         discount_amount,
         after_discount,
         pay_amount,
         remaining_amount,
         periods,
         per_period_amount,
         COALESCE(fee_year, 1) AS fee_year,
         discount_channel,
         discount_fee_years,
         notes,
         created_at
       FROM accounts.student_settlement_receipts
       WHERE student_id = $1
       ORDER BY COALESCE(fee_year, 1) ASC, settlement_date ASC, created_at ASC`,
      [studentId]
    );

    // إصلاح المتبقي التراكمي إن كان محفوظاً بشكل خاطئ سابقاً
    const annualHint = result.rows.reduce((max: number, row: { annual_fee?: unknown }) => {
      const n = Number(row.annual_fee);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const repaired = recalculateRemainingByReceipt(
      result.rows as SettlementHistoryRow[],
      annualHint
    );
    const byId = new Map(repaired.map((r) => [r.id, r]));
    for (const row of repaired) {
      const original = result.rows.find((r: { id: string }) => r.id === row.id);
      if (!original) continue;
      const oldRem = Number(original.remaining_amount);
      if (Math.abs(oldRem - row.remaining_amount) > 0.01) {
        await query(
          `UPDATE accounts.student_settlement_receipts
           SET remaining_amount = $2
           WHERE id = $1`,
          [row.id, row.remaining_amount]
        ).catch(() => undefined);
      }
    }

    const data = result.rows.map((row: Record<string, unknown>) => {
      const fix = byId.get(String(row.id));
      return fix
        ? { ...row, remaining_amount: fix.remaining_amount, fee_year: fix.fee_year }
        : row;
    });

    // سنة تصاعدياً، وداخل السنة الأحدث أولاً
    data.sort((
      a: { fee_year?: number; created_at?: string; settlement_date?: string },
      b: { fee_year?: number; created_at?: string; settlement_date?: string }
    ) => {
      const ya = Number(a.fee_year || 1);
      const yb = Number(b.fee_year || 1);
      if (ya !== yb) return ya - yb;
      const ta = Date.parse(String(a.created_at || a.settlement_date || ''));
      const tb = Date.parse(String(b.created_at || b.settlement_date || ''));
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('خطأ في جلب وصولات التسديد:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب وصولات التسديد' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAccountsAccess(request);
    if (isAuthFailure(auth)) return auth.response;

    await ensureSettlementReceiptsTable();

    const body = await request.json().catch(() => ({}));
    const studentId = String(body?.student_id || '').trim();
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'معرف الطالب مطلوب' },
        { status: 400 }
      );
    }

    const studentRes = await query(
      `SELECT
         id,
         university_id,
         COALESCE(
           NULLIF(TRIM(full_name_ar), ''),
           NULLIF(TRIM(full_name), ''),
           TRIM(CONCAT_WS(' ', first_name, middle_name, last_name))
         ) AS name,
         COALESCE(major, '') AS department,
         study_type,
         admission_type
       FROM student_affairs.students
       WHERE id = $1`,
      [studentId]
    );

    if (studentRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }

    const student = studentRes.rows[0];
    const settlementDate = String(body?.settlement_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) {
      return NextResponse.json(
        { success: false, error: 'تاريخ التسديد غير صالح' },
        { status: 400 }
      );
    }

    const payAmount = toMoney(body?.pay_amount);
    if (payAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'مبلغ الدفع يجب أن يكون أكبر من صفر' },
        { status: 400 }
      );
    }

    const historyRes = await query(
      `SELECT
         id,
         fee_year,
         pay_amount,
         after_discount,
         remaining_amount,
         annual_fee,
         discount_mode,
         discount_input,
         discount_amount,
         discount_channel,
         discount_fee_years,
         periods,
         settlement_date,
         created_at
       FROM accounts.student_settlement_receipts
       WHERE student_id = $1
       ORDER BY created_at ASC`,
      [studentId]
    );
    const historyRows = historyRes.rows as SettlementHistoryRow[];

    const annualFee =
      toMoney(body?.annual_fee) ||
      historyRows.reduce((max, row) => {
        const n = toMoney(row.annual_fee);
        return n > max ? n : max;
      }, 0);

    if (annualFee > 0 && payAmount > annualFee + 0.0001) {
      return NextResponse.json(
        {
          success: false,
          error: 'مبلغ الدفع لا يجوز أن يتجاوز القسط الكلي السنوي',
        },
        { status: 400 }
      );
    }

    const openState = getOpenYearState(historyRows, annualFee);
    if (!openState.feeYear) {
      return NextResponse.json(
        { success: false, error: 'تم استيفاء أقساط السنوات الأربع لهذا الطالب' },
        { status: 400 }
      );
    }

    const feeYear = openState.feeYear;
    const yearPaidBefore = openState.yearPaidBefore;

    const discountModeRaw = String(body?.discount_mode || 'none');
    let discountMode =
      discountModeRaw === 'amount' || discountModeRaw === 'percent'
        ? discountModeRaw
        : 'none';
    const discountChannel =
      typeof body?.discount_channel === 'string'
        ? body.discount_channel.trim()
        : '';
    const discountFeeYearsUnique: number[] = parseDiscountFeeYears(
      body?.discount_fee_years
    );
    const discountYears = Math.max(
      1,
      Math.min(4, discountFeeYearsUnique.length || Number(body?.discount_years) || 1)
    );
    const discountFeeYearsText =
      discountFeeYearsUnique.length > 0
        ? serializeDiscountFeeYears(discountFeeYearsUnique)
        : String(feeYear);
    const periods = Math.max(1, Math.min(10, Number(body?.periods) || 1));
    const fourYearsTotal = toMoney(body?.four_years_total) || annualFee * 4;
    const assignAdmissionChannel = Boolean(body?.assign_admission_channel);

    // الخصم يُحتسب دائماً من طلب المودال الحالي (لا يُثبَّت من أول وصل)
    const discountBase = toMoney(body?.discount_base) || annualFee;
    let discountInput = toMoney(body?.discount_input);
    let discountAmount = 0;
    let afterDiscount = annualFee;

    const yearInDiscountPlan =
      discountFeeYearsUnique.length === 0 ||
      discountFeeYearsUnique.includes(feeYear);

    if (discountMode === 'percent' && yearInDiscountPlan) {
      const pct = Math.max(0, Math.min(discountInput, 100));
      discountInput = pct;
      discountAmount = Math.round(((discountBase * pct) / 100) * 100) / 100;
    } else if (discountMode === 'amount' && yearInDiscountPlan) {
      discountAmount = Math.max(
        0,
        Math.min(toMoney(body?.discount_amount) || discountInput, discountBase)
      );
      discountInput = discountAmount;
    } else {
      discountMode = 'none';
      discountAmount = 0;
      discountInput = 0;
    }

    afterDiscount = Math.max(0, discountBase - discountAmount);
    if (annualFee > 0) {
      afterDiscount = Math.min(afterDiscount, annualFee);
    }

    // المتبقي = مستحق السنة حسب خصم المودال الحالي − المدفوع سابقاً لهذه السنة
    const outstandingBefore = Math.max(0, afterDiscount - yearPaidBefore);

    if (outstandingBefore <= 0.01) {
      return NextResponse.json(
        { success: false, error: 'لا يوجد متبقي على السنة الحالية' },
        { status: 400 }
      );
    }

    if (payAmount > outstandingBefore + 0.0001) {
      return NextResponse.json(
        {
          success: false,
          error: `مبلغ الدفع أكبر من المتبقي للسنة الحالية (${outstandingBefore})`,
        },
        { status: 400 }
      );
    }

    const remainingAmount = Math.max(0, outstandingBefore - payAmount);
    const perPeriodAmount = perPeriodFromRemaining(outstandingBefore, periods);

    const receiptNumber = await nextReceiptNumber(settlementDate);

    const createdByRaw = String(auth.user?.id || '');
    const createdBy = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      createdByRaw
    )
      ? createdByRaw
      : null;

    const insert = await query(
      `INSERT INTO accounts.student_settlement_receipts (
         receipt_number,
         student_id,
         university_id,
         student_name,
         department,
         study_type,
         admission_type,
         settlement_date,
         annual_fee,
         four_years_total,
         discount_mode,
         discount_years,
         discount_base,
         discount_input,
         discount_amount,
         after_discount,
         pay_amount,
         remaining_amount,
         periods,
         per_period_amount,
         fee_year,
         discount_channel,
         discount_fee_years,
         created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::date,
         $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
       )
       RETURNING *`,
      [
        receiptNumber,
        studentId,
        student.university_id || body?.university_id || null,
        student.name || body?.student_name || null,
        student.department || body?.department || null,
        student.study_type || body?.study_type || null,
        student.admission_type || body?.admission_type || null,
        settlementDate,
        annualFee,
        fourYearsTotal,
        discountMode,
        discountYears,
        discountBase,
        discountInput,
        discountAmount,
        afterDiscount,
        payAmount,
        remainingAmount,
        periods,
        Math.round(perPeriodAmount * 100) / 100,
        feeYear,
        discountChannel || null,
        discountFeeYearsText,
        createdBy,
      ]
    );

    // تسجيل قناة التخفيض على ملف الطالب لتظهر في إحصائيات شؤون الطلبة
    if (assignAdmissionChannel && discountChannel) {
      try {
        await query(`
          ALTER TABLE student_affairs.students
            ADD COLUMN IF NOT EXISTS admission_channel VARCHAR(50),
            ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
        `);
      } catch {
        // العمود موجود
      }

      await query(
        `UPDATE student_affairs.students
         SET admission_channel = COALESCE(NULLIF(TRIM(admission_channel), ''), $2),
             discount_percentage = CASE
               WHEN $3 = 'percent' THEN $4
               ELSE COALESCE(discount_percentage, 0)
             END,
             discount_amount = CASE
               WHEN $3 = 'amount' THEN $5
               WHEN $3 = 'percent' THEN $5
               ELSE COALESCE(discount_amount, 0)
             END,
             final_fee_after_discount = CASE
               WHEN $3 IN ('amount', 'percent') THEN $6
               ELSE COALESCE(final_fee_after_discount, 0)
             END,
             updated_at = NOW()
         WHERE id = $1
           AND (
             admission_channel IS NULL
             OR TRIM(admission_channel) = ''
             OR TRIM(admission_channel) = 'general'
           )`,
        [
          studentId,
          discountChannel,
          discountMode,
          discountInput,
          discountAmount,
          afterDiscount,
        ]
      ).catch((err) => {
        console.error('تعذر تحديث قناة القبول للطالب بعد التسديد:', err);
      });
    }

    // إصلاح متبقيات الوصولات السابقة لنفس الطالب بعد الحفظ
    const allRes = await query(
      `SELECT id, fee_year, pay_amount, after_discount, remaining_amount, annual_fee,
              discount_mode, discount_input, discount_amount,
              settlement_date, created_at
       FROM accounts.student_settlement_receipts
       WHERE student_id = $1`,
      [studentId]
    );
    const fixed = recalculateRemainingByReceipt(
      allRes.rows as SettlementHistoryRow[],
      annualFee
    );
    for (const row of fixed) {
      await query(
        `UPDATE accounts.student_settlement_receipts
         SET remaining_amount = $2, fee_year = $3
         WHERE id = $1`,
        [row.id, row.remaining_amount, row.fee_year]
      ).catch(() => undefined);
    }

    // ترحيل القيد إلى دفتر اليومية: مدين الصندوق / دائن إيرادات الطلبة
    const savedReceipt = insert.rows[0];
    let journalEntry: SettlementJournalResult | null = null;
    let journalWarning: string | null = null;

    if (!createdBy) {
      journalWarning =
        'تعذر ترحيل القيد: لا يمكن تحديد المستخدم المرحِّل';
    } else {
      try {
        journalEntry = await withTransaction((client) =>
          postStudentSettlementJournalEntry(client, {
            receiptId: savedReceipt.id,
            receiptNumber,
            settlementDate,
            amount: payAmount,
            studentName: student.name || null,
            universityId: student.university_id || null,
            studyType: student.study_type || null,
            userId: createdBy,
          })
        );
        await query(
          `UPDATE accounts.student_settlement_receipts
           SET journal_entry_id = $2
           WHERE id = $1`,
          [savedReceipt.id, journalEntry.id]
        ).catch(() => undefined);
      } catch (glError) {
        journalWarning =
          glError instanceof Error
            ? glError.message
            : 'تعذر ترحيل القيد إلى دفتر اليومية';
        console.error('settlement journal posting error:', glError);
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          ...savedReceipt,
          remaining_amount: remainingAmount,
          fee_year: feeYear,
          outstanding_before: outstandingBefore,
          year_paid_before: yearPaidBefore,
          journal_entry: journalEntry,
        },
        journal_warning: journalWarning,
        message: journalEntry
          ? `تم حفظ وصل التسديد وترحيل القيد ${journalEntry.entry_number} إلى دفتر اليومية`
          : 'تم حفظ وصل التسديد بنجاح',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('خطأ في حفظ وصل التسديد:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ وصل التسديد' },
      { status: 500 }
    );
  }
}
