import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  buildYearLedger,
  getYearVisualEntries,
  type SettlementHistoryRow,
  type YearVisualEntry,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  expectedAnnualFee,
  getAnnualTuitionFee,
} from '@/app/accounts/students/lib/tuitionFees';
import { loadTuitionFeeMap } from '@/src/lib/accounts/department-tuition-fees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PaidStudentRow = {
  id: string;
  department: string;
  study_type: string | null;
  admission_channel: string | null;
  discount_percentage: number | null;
  final_fee: number | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
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
         COALESCE(s.major, '') AS department,
         s.study_type,
         s.admission_channel,
         s.discount_percentage::float8 AS discount_percentage,
         s.final_fee_after_discount::float8 AS final_fee
       FROM student_affairs.students s
       WHERE COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') = 'paid'
       LIMIT 5000`
    );

    const students = studentsRes.rows as PaidStudentRow[];
    const studentIds = students.map((s) => s.id);

    const receiptsByStudent = new Map<string, SettlementHistoryRow[]>();

    if (studentIds.length > 0) {
      try {
        const receiptsRes = await query(
          `SELECT
             student_id,
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
             periods,
             settlement_date,
             created_at
           FROM accounts.student_settlement_receipts
           WHERE student_id = ANY($1::uuid[])`,
          [studentIds]
        );

        for (const row of receiptsRes.rows) {
          const sid = String(row.student_id);
          const list = receiptsByStudent.get(sid) || [];
          list.push(row as SettlementHistoryRow);
          receiptsByStudent.set(sid, list);
        }
      } catch {
        // جدول الوصولات قد لا يكون موجوداً بعد
      }
    }

    const feeMap = await loadTuitionFeeMap();

    const byStudent: Record<
      string,
      {
        current_year: number | null;
        all_completed: boolean;
        years: YearVisualEntry[];
        receipts_count: number;
      }
    > = {};

    for (const student of students) {
      const dept = student.department || '';
      const annual =
        expectedAnnualFee(
          {
            major: dept,
            study_type: student.study_type,
            admission_channel: student.admission_channel,
            discount_percentage: student.discount_percentage,
            final_fee_after_discount: student.final_fee,
          },
          feeMap
        ) || getAnnualTuitionFee(dept, student.study_type, feeMap);

      const receipts = receiptsByStudent.get(student.id) || [];
      const ledger = buildYearLedger(receipts, annual);
      byStudent[student.id] = {
        current_year: ledger.currentYear,
        all_completed: ledger.allYearsCompleted,
        years: getYearVisualEntries(ledger),
        receipts_count: receipts.filter(
          (r) => Math.max(0, Number(r.pay_amount || 0)) > 0
        ).length,
      };
    }

    return NextResponse.json(
      { success: true, data: byStudent },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('year-status error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل حالة سنوات التسديد' },
      { status: 500 }
    );
  }
}
