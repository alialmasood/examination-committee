/**
 * تحميل خريطة أقساط الأقسام من المصدر الرئيسي (صفحة أقساط الأقسام).
 * للاستخدام في Client Components.
 */
import {
  normalizeDeptKey,
  type TuitionFeeByYear,
  type TuitionFeeLookupMap,
} from '@/app/accounts/students/lib/tuitionFees';

type ApiFeeRow = {
  department_name: string;
  name_aliases?: string[];
  morning_fee: number;
  evening_fee: number;
  morning_fee_y1?: number;
  morning_fee_y2?: number;
  morning_fee_y3?: number;
  morning_fee_y4?: number;
  evening_fee_y1?: number;
  evening_fee_y2?: number;
  evening_fee_y3?: number;
  evening_fee_y4?: number;
};

function byYear(
  y1: number | undefined,
  y2: number | undefined,
  y3: number | undefined,
  y4: number | undefined,
  fallback: number
): TuitionFeeByYear {
  const f = Math.max(0, Number(fallback) || 0);
  return {
    1: Math.max(0, Number(y1 ?? f) || 0),
    2: Math.max(0, Number(y2 ?? f) || 0),
    3: Math.max(0, Number(y3 ?? f) || 0),
    4: Math.max(0, Number(y4 ?? f) || 0),
  };
}

export async function fetchTuitionFeeMap(): Promise<TuitionFeeLookupMap> {
  const res = await fetch('/api/accounts/department-tuition-fees', {
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    return {};
  }

  const map: TuitionFeeLookupMap = {};
  for (const row of body.data as ApiFeeRow[]) {
    const morningByYear = byYear(
      row.morning_fee_y1,
      row.morning_fee_y2,
      row.morning_fee_y3,
      row.morning_fee_y4,
      row.morning_fee
    );
    const eveningByYear = byYear(
      row.evening_fee_y1,
      row.evening_fee_y2,
      row.evening_fee_y3,
      row.evening_fee_y4,
      row.evening_fee
    );
    const entry = {
      morning: morningByYear[1],
      evening: eveningByYear[1],
      morningByYear,
      eveningByYear,
    };
    const key = normalizeDeptKey(row.department_name);
    if (key) map[key] = entry;
    for (const alias of row.name_aliases || []) {
      const a = normalizeDeptKey(alias);
      if (a) map[a] = entry;
    }
  }
  return map;
}
