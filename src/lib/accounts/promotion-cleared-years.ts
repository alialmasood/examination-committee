/**
 * سنوات القسط المكتملة بموافقة ترحيل من نظام الحسابات.
 * المصدر: طلبات stage_promotion_requests بحالة approved فقط (بدون ترحيل قديم).
 */
import 'server-only';

import { query } from '@/src/lib/db';
import type { FeeYear } from '@/app/accounts/students/lib/settlementYearLedger';

function toFeeYear(value: unknown): FeeYear | null {
  const n = Math.round(Number(value));
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}

function feeYearFromStage(stage: unknown): FeeYear | null {
  const raw = String(stage || '')
    .trim()
    .toLowerCase();
  if (raw === 'first' || raw === '1') return 1;
  if (raw === 'second' || raw === '2') return 2;
  if (raw === 'third' || raw === '3') return 3;
  if (raw === 'fourth' || raw === '4') return 4;
  return null;
}

/** خريطة studentId → سنوات القسط المكتملة بالترحيل المعتمد */
export async function loadClearedFeeYearsByStudents(
  studentIds: string[]
): Promise<Map<string, FeeYear[]>> {
  const map = new Map<string, FeeYear[]>();
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return map;

  try {
    const result = await query(
      `SELECT student_id, fee_year, from_stage
       FROM student_affairs.stage_promotion_requests
       WHERE status = 'approved'
         AND student_id = ANY($1::uuid[])`,
      [ids]
    );

    const sets = new Map<string, Set<FeeYear>>();
    for (const row of result.rows) {
      const sid = String(row.student_id || '');
      if (!sid) continue;
      const year =
        toFeeYear(row.fee_year) || feeYearFromStage(row.from_stage);
      if (!year) continue;
      let set = sets.get(sid);
      if (!set) {
        set = new Set<FeeYear>();
        sets.set(sid, set);
      }
      set.add(year);
    }

    for (const [sid, set] of sets) {
      map.set(sid, [...set].sort((a, b) => a - b));
    }
  } catch (error) {
    console.warn('loadClearedFeeYearsByStudents:', error);
  }

  return map;
}

export async function loadClearedFeeYearsForStudent(
  studentId: string
): Promise<FeeYear[]> {
  if (!studentId) return [];
  const map = await loadClearedFeeYearsByStudents([studentId]);
  return map.get(studentId) || [];
}
