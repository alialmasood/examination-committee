/**
 * تحميل خريطة أقساط الأقسام من المصدر الرئيسي (صفحة أقساط الأقسام).
 * للاستخدام في Client Components.
 */
import {
  normalizeDeptKey,
  type TuitionFeeLookupMap,
} from '@/app/accounts/students/lib/tuitionFees';

type ApiFeeRow = {
  department_name: string;
  name_aliases?: string[];
  morning_fee: number;
  evening_fee: number;
};

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
    const entry = {
      morning: Number(row.morning_fee) || 0,
      evening: Number(row.evening_fee) || 0,
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
