import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  STUDENT_DEPARTMENTS,
  expectedAnnualFee,
  getAnnualTuitionFee,
} from '@/app/accounts/students/lib/tuitionFees';
import {
  formatAdmissionChannelLabel,
  getAdmissionChannelDef,
} from '@/app/accounts/students/lib/admissionChannels';
import {
  buildYearLedger,
  paymentCategoryFromYearStatus,
  getYearVisualEntries,
  type FeeYear,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  primaryYearSettlementDiscount,
  resolveStudentFeeDiscount,
} from '@/app/accounts/students/lib/studentFeeDiscount';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STUDY_TYPES = new Set(['morning', 'evening']);
const STAGES = new Set(['first', 'second', 'third', 'fourth']);

const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
};

const STUDY_LABELS: Record<string, string> = {
  morning: 'الدراسة الصباحية',
  evening: 'الدراسة المسائية',
};

/** سنة القسط المطابقة لمرحلة القبول المعروضة في الصفحة */
const STAGE_TO_FEE_YEAR: Record<string, FeeYear> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

type ReceiptRow = SettlementHistoryRow & {
  student_id?: string;
  pay_amount?: number | string | null;
};

function receiptTime(row: ReceiptRow): number {
  const a = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(a)) return a;
  const b = Date.parse(String(row.settlement_date || ''));
  return Number.isFinite(b) ? b : 0;
}

/** قناة التخفيض من ملف الطالب أو أول وصل يحمل قناة */
function resolveDiscountChannelKey(
  admissionChannel: string | null | undefined,
  receipts: ReceiptRow[]
): string {
  const fromStudent = String(admissionChannel || '')
    .trim()
    .toLowerCase();
  if (fromStudent && fromStudent !== 'general') return fromStudent;

  const sorted = [...receipts].sort((a, b) => receiptTime(a) - receiptTime(b));
  for (const r of sorted) {
    const ch = String(r.discount_channel || '')
      .trim()
      .toLowerCase();
    if (ch && ch !== 'general') return ch;
  }
  return '';
}

/**
 * تصنيف نوع التخفيض للجدول:
 * - إن وُجدت قناة قبول معروفة → نوعها + تصنيف «قناة قبول»
 * - وإلا إن وُجد تخفيض على الوصل/الملف بدون قناة → «خصم عند التسديد»
 */
function resolveDiscountTypeBucket(
  admissionChannel: string | null | undefined,
  receipts: ReceiptRow[]
): { key: string; label: string; kind: 'channel' | 'settlement' } | null {
  const channelKey = resolveDiscountChannelKey(admissionChannel, receipts);
  if (channelKey) {
    const def = getAdmissionChannelDef(channelKey);
    return {
      key: `channel:${channelKey}`,
      label: def?.label || formatAdmissionChannelLabel(channelKey),
      kind: 'channel',
    };
  }

  const hasSettlementDiscount = receipts.some((r) => {
    const mode = String(r.discount_mode || 'none');
    return mode !== 'none' && Math.max(0, Number(r.discount_amount || 0)) > 0.5;
  });
  if (hasSettlementDiscount) {
    return {
      key: 'settlement:modal',
      label: 'خصم عند التسديد',
      kind: 'settlement',
    };
  }

  return {
    key: 'settlement:profile',
    label: 'تخفيض على ملف الطالب',
    kind: 'settlement',
  };
}

function matchesStudyType(
  raw: string | null | undefined,
  wanted: string
): boolean {
  const st = String(raw || '').toLowerCase().trim();
  if (wanted === 'morning') {
    return st === 'morning' || st === 'صباحي' || st === '';
  }
  return st === 'evening' || st === 'مسائي';
}

/**
 * GET /api/accounts/students/departments/[id]/[studyType]/[stage]
 * تفصيل مالي كامل لمرحلة ضمن قسم ونوع دراسة.
 */
export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string; studyType: string; stage: string }>;
  }
) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id, studyType, stage } = await context.params;
    if (!STUDY_TYPES.has(studyType) || !STAGES.has(stage)) {
      return NextResponse.json(
        { success: false, error: 'معاملات غير صالحة' },
        { status: 400 }
      );
    }

    const dept = STUDENT_DEPARTMENTS.find((d) => d.id === id);
    if (!dept) {
      return NextResponse.json(
        { success: false, error: 'القسم غير موجود' },
        { status: 404 }
      );
    }

    await query(`
      ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
    `).catch(() => undefined);

    const studentsRes = await query(
      `SELECT
         s.id,
         COALESCE(s.university_id, '') AS university_id,
         COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(s.full_name), ''), '—') AS name,
         COALESCE(s.major, '') AS major,
         s.gender,
         s.study_type,
         s.admission_type,
         s.admission_channel,
         COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') AS payment_status,
         s.discount_percentage::float8 AS discount_percentage,
         COALESCE(s.discount_amount, 0)::float8 AS discount_amount,
         s.final_fee_after_discount::float8 AS final_fee_after_discount
       FROM student_affairs.students s
       WHERE normalize_arabic(COALESCE(s.major, '')) = normalize_arabic($1)
         AND COALESCE(NULLIF(TRIM(s.admission_type), ''), '') = $2
       ORDER BY s.university_id ASC NULLS LAST`,
      [dept.name, stage]
    );

    const filtered = studentsRes.rows.filter((row: { study_type: string | null }) =>
      matchesStudyType(row.study_type, studyType)
    );

    const studentIds = filtered.map((s: { id: string }) => s.id);
    const receiptsByStudent = new Map<string, ReceiptRow[]>();

    if (studentIds.length > 0) {
      try {
        const receiptsRes = await query(
          `SELECT
             student_id::text AS student_id,
             id,
             receipt_number,
             fee_year,
             pay_amount,
             after_discount,
             remaining_amount,
             annual_fee,
             discount_mode,
             discount_input,
             discount_amount,
             discount_channel,
             settlement_date,
             created_at
           FROM accounts.student_settlement_receipts
           WHERE student_id = ANY($1::uuid[])`,
          [studentIds]
        );
        for (const row of receiptsRes.rows) {
          const sid = String(row.student_id);
          const list = receiptsByStudent.get(sid) || [];
          list.push(row as ReceiptRow);
          receiptsByStudent.set(sid, list);
        }
      } catch {
        // لا وصولات بعد
      }
    }

    type DiscountBucket = {
      key: string;
      label: string;
      kind: 'channel' | 'settlement';
      students_count: number;
      amount: number;
    };

    const discountTypes = new Map<string, DiscountBucket>();

    let males = 0;
    let females = 0;
    let unknownGender = 0;
    let fullyPaid = 0;
    let partialPaid = 0;
    let unpaid = 0;
    let receiptsCount = 0;
    let collected = 0;
    let debt = 0;
    let annualBaseTotal = 0;
    let expectedAnnualTotal = 0;
    let channelDiscountTotal = 0;
    let settlementDiscountTotal = 0;
    let studentsWithDiscount = 0;

    const students = [];

    for (const row of filtered) {
      const major = row.major || dept.name;
      const annualBase = getAnnualTuitionFee(major, studyType);
      const expectedNet = expectedAnnualFee({
        major,
        study_type: studyType,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        discount_amount: row.discount_amount,
        final_fee_after_discount: row.final_fee_after_discount,
      });

      const channelFromProfile = Math.max(0, Number(row.discount_amount || 0));

      const receipts = receiptsByStudent.get(String(row.id)) || [];
      const settlementFromReceipt = primaryYearSettlementDiscount(receipts);
      const resolved = resolveStudentFeeDiscount({
        annualBase,
        profileDiscountAmount: channelFromProfile,
        expectedNet,
        finalFeeAfterDiscount: row.final_fee_after_discount,
        settlementDiscountAmount: settlementFromReceipt,
        discountPercentage: row.discount_percentage,
        admissionChannel: row.admission_channel,
      });
      const discountTotal = resolved.totalDiscount;
      const netDue = resolved.netDue;

      const paid = receipts.reduce(
        (sum, r) => sum + Math.max(0, Number(r.pay_amount || 0)),
        0
      );
      const receiptsForStudent = receipts.filter(
        (r) => Math.max(0, Number(r.pay_amount || 0)) > 0
      ).length;

      // دفتر السنوات — الحالة تُقيَّم على سنة القسط المطابقة لهذه المرحلة فقط
      const annualForLedger = netDue > 0 ? netDue : annualBase > 0 ? annualBase : 0;
      const ledger = buildYearLedger(receipts, annualForLedger);
      const yearVisual = getYearVisualEntries(ledger);
      const stageFeeYear = STAGE_TO_FEE_YEAR[stage] ?? 1;
      const category = paymentCategoryFromYearStatus(
        {
          current_year: ledger.currentYear,
          all_completed: ledger.allYearsCompleted,
          years: yearVisual,
        },
        stageFeeYear
      );
      const yearEntry = yearVisual.find((y) => y.year === stageFeeYear);
      const paidForStageYear = yearEntry ? yearEntry.paid : 0;
      // الدين لهذه المرحلة/السنة فقط: مستحق السنة − المدفوع لها
      const stageYearTarget =
        yearEntry && yearEntry.target > 0
          ? yearEntry.target
          : annualForLedger;
      const studentDebt = Math.max(0, stageYearTarget - paidForStageYear);

      const g = String(row.gender || '')
        .trim()
        .toLowerCase();
      if (['male', 'm', 'ذكر', 'ذ'].includes(g)) males += 1;
      else if (['female', 'f', 'أنثى', 'انثى', 'ا'].includes(g)) females += 1;
      else unknownGender += 1;

      if (category === 'settled') fullyPaid += 1;
      else if (category === 'partial') partialPaid += 1;
      else unpaid += 1;

      receiptsCount += receiptsForStudent;
      collected += paid;
      debt += studentDebt;
      annualBaseTotal += annualBase;
      expectedAnnualTotal += netDue;
      if (discountTotal > 0.5) studentsWithDiscount += 1;

      const resolvedChannelKey =
        resolveDiscountChannelKey(row.admission_channel, receipts) ||
        String(row.admission_channel || 'general').trim() ||
        'general';

      let attributedChannel = 0;
      let attributedSettlement = 0;

      // جدول أنواع التخفيض: يُنسب حسب القناة الفعلية (ملف/وصل) وليس حسب تقسيم المبالغ الداخلي
      if (discountTotal > 0.5) {
        const typeMeta = resolveDiscountTypeBucket(
          row.admission_channel,
          receipts
        );
        if (typeMeta) {
          let bucket = discountTypes.get(typeMeta.key);
          if (!bucket) {
            bucket = {
              key: typeMeta.key,
              label: typeMeta.label,
              kind: typeMeta.kind,
              students_count: 0,
              amount: 0,
            };
            discountTypes.set(typeMeta.key, bucket);
          }
          bucket.students_count += 1;
          bucket.amount += discountTotal;

          if (typeMeta.kind === 'channel') {
            attributedChannel = discountTotal;
            channelDiscountTotal += discountTotal;
          } else {
            attributedSettlement = discountTotal;
            settlementDiscountTotal += discountTotal;
          }
        }
      }

      const statusLabel =
        category === 'settled'
          ? `مسدد بالكامل — السنة ${stageFeeYear}`
          : category === 'partial'
            ? `تسديد جزئي — السنة ${stageFeeYear}`
            : `غير مسدد — السنة ${stageFeeYear}`;

      students.push({
        id: row.id,
        university_id: String(row.university_id || '').trim() || '—',
        name: String(row.name || '').trim() || '—',
        gender:
          ['male', 'm', 'ذكر', 'ذ'].includes(g)
            ? 'ذكر'
            : ['female', 'f', 'أنثى', 'انثى', 'ا'].includes(g)
              ? 'أنثى'
              : '—',
        admission_channel: resolvedChannelKey,
        admission_channel_label: formatAdmissionChannelLabel(resolvedChannelKey),
        annual_fee: annualBase,
        expected_fee: netDue,
        discount_amount: discountTotal,
        channel_discount: attributedChannel,
        settlement_discount: attributedSettlement,
        paid_amount: paidForStageYear,
        debt_amount: studentDebt,
        receipts_count: receiptsForStudent,
        payment_category: category,
        status_label: statusLabel,
        fee_year: stageFeeYear,
        expected_four_years: netDue * 4,
      });
    }

    students.sort((a, b) =>
      a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' })
    );

    const totalDiscount = channelDiscountTotal + settlementDiscountTotal;
    const discountImpactPercent =
      annualBaseTotal > 0
        ? Math.round((totalDiscount / annualBaseTotal) * 1000) / 10
        : 0;
    const collectionRatePercent =
      expectedAnnualTotal > 0
        ? Math.round((collected / expectedAnnualTotal) * 1000) / 10
        : 0;

    const discountTypesList = Array.from(discountTypes.values()).sort(
      (a, b) => b.amount - a.amount
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          generated_at: new Date().toISOString(),
          department: { id: dept.id, name: dept.name },
          study_type: studyType,
          study_type_label: STUDY_LABELS[studyType],
          stage,
          stage_label: STAGE_LABELS[stage],
          summary: {
            total_students: students.length,
            males,
            females,
            unknown_gender: unknownGender,
            fully_paid_count: fullyPaid,
            partial_paid_count: partialPaid,
            unpaid_count: unpaid,
            receipts_count: receiptsCount,
            collected_amount: collected,
            debt_amount: debt,
            annual_base_total: annualBaseTotal,
            expected_annual_total: expectedAnnualTotal,
            expected_four_years_total: expectedAnnualTotal * 4,
            channel_discount_amount: channelDiscountTotal,
            settlement_discount_amount: settlementDiscountTotal,
            total_discount_amount: totalDiscount,
            students_with_discount: studentsWithDiscount,
            discount_impact_percent: discountImpactPercent,
            collection_rate_percent: collectionRatePercent,
          },
          discount_types: discountTypesList,
          students,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('stage detail error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل تفصيل المرحلة' },
      { status: 500 }
    );
  }
}
