/**
 * مصدر أقساط الأقسام السنوية (صباحي/مسائي) — مخزّن في قاعدة البيانات.
 * الصفحة: /accounts/students/department-installments
 */
import { query } from '@/src/lib/db';
import {
  STUDENT_DEPARTMENTS,
  getAnnualTuitionFee,
  getDefaultAnnualTuitionFee,
  normalizeDeptKey,
  type TuitionFeeLookupMap,
} from '@/app/accounts/students/lib/tuitionFees';

export type DepartmentTuitionFeeRow = {
  id: string;
  department_name: string;
  name_aliases: string[];
  morning_fee: number;
  evening_fee: number;
  updated_at: string | null;
};

let feeCache: {
  at: number;
  map: TuitionFeeLookupMap;
  rows: DepartmentTuitionFeeRow[];
} | null = null;
const FEE_CACHE_TTL_MS = 20_000;

const DEPARTMENT_ALIASES: Record<string, string[]> = {
  // الأقسام الموحّدة: لا تُعرض أسماء بديلة
};

/** مطابقة داخلية فقط لبيانات قديمة دون عرضها كأسماء بديلة */
const LOOKUP_ONLY_ALIASES: Record<string, string[]> = {
  cybersecurity: [
    'تقنيات الامن السيبراني',
    'تقنيات الأمن السيبراني',
  ],
  dental: ['تقنيات صناعة الأسنان'],
  construction: ['تقنيات البناء والاستشارات'],
  radiology: ['تقنيات الأشعة'],
};

const CYBER_CANONICAL =
  'هندسة تقنيات الامن السيبراني والحوسبة السحابية';

const DENTAL_CANONICAL = 'تقنيات صناعة الاسنان';

const CONSTRUCTION_CANONICAL = 'هندسة تقنيات البناء والانشاءات';

const RADIOLOGY_CANONICAL = 'تقنيات الاشعة';

export function invalidateTuitionFeeCache(): void {
  feeCache = null;
}

/** توحيد اسم قسم في بيانات الطلبة والوصولات وجدول الأقساط */
async function unifyDepartmentCanonicalName(
  departmentId: string,
  canonicalName: string,
  aliases: string[]
): Promise<void> {
  if (aliases.length === 0) return;

  await query(
    `UPDATE student_affairs.students
     SET major = $1,
         updated_at = NOW()
     WHERE normalize_arabic(TRIM(COALESCE(major, ''))) = ANY(
       SELECT normalize_arabic(a) FROM unnest($2::text[]) AS a
     )`,
    [canonicalName, aliases]
  ).catch(() => undefined);

  await query(
    `UPDATE accounts.student_settlement_receipts
     SET department = $1
     WHERE normalize_arabic(TRIM(COALESCE(department, ''))) = ANY(
       SELECT normalize_arabic(a) FROM unnest($2::text[]) AS a
     )`,
    [canonicalName, aliases]
  ).catch(() => undefined);

  await query(
    `UPDATE accounts.department_tuition_fees
     SET name_aliases = '{}'::text[],
         department_name = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [canonicalName, departmentId]
  ).catch(() => undefined);
}

/** توحيد أسماء الأقسام المعتمدة */
async function unifyCanonicalDepartmentNames(): Promise<void> {
  await unifyDepartmentCanonicalName(
    'cybersecurity',
    CYBER_CANONICAL,
    LOOKUP_ONLY_ALIASES.cybersecurity || []
  );
  await unifyDepartmentCanonicalName(
    'dental',
    DENTAL_CANONICAL,
    LOOKUP_ONLY_ALIASES.dental || []
  );
  await unifyDepartmentCanonicalName(
    'construction',
    CONSTRUCTION_CANONICAL,
    LOOKUP_ONLY_ALIASES.construction || []
  );
  await unifyDepartmentCanonicalName(
    'radiology',
    RADIOLOGY_CANONICAL,
    LOOKUP_ONLY_ALIASES.radiology || []
  );
}

export async function ensureDepartmentTuitionFeesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS accounts.department_tuition_fees (
      id TEXT PRIMARY KEY,
      department_name TEXT NOT NULL UNIQUE,
      name_aliases TEXT[] NOT NULL DEFAULT '{}',
      morning_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
      evening_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by UUID NULL
    )
  `);

  for (const dept of STUDENT_DEPARTMENTS) {
    const morning = getDefaultAnnualTuitionFee(dept.name, 'morning');
    const evening = getDefaultAnnualTuitionFee(dept.name, 'evening');
    const aliases = DEPARTMENT_ALIASES[dept.id] || [];
    await query(
      `INSERT INTO accounts.department_tuition_fees
         (id, department_name, name_aliases, morning_fee, evening_fee, updated_at)
       VALUES ($1, $2, $3::text[], $4, $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [dept.id, dept.name, aliases, morning, evening]
    ).catch(() => undefined);
  }

  await unifyCanonicalDepartmentNames();
}

function rowToFee(row: Record<string, unknown>): DepartmentTuitionFeeRow {
  const aliasesRaw = row.name_aliases;
  const aliases = Array.isArray(aliasesRaw)
    ? aliasesRaw.map((a) => String(a))
    : [];
  return {
    id: String(row.id),
    department_name: String(row.department_name || ''),
    name_aliases: aliases,
    morning_fee: Math.max(0, Number(row.morning_fee || 0)),
    evening_fee: Math.max(0, Number(row.evening_fee || 0)),
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function buildMap(rows: DepartmentTuitionFeeRow[]): TuitionFeeLookupMap {
  const map: TuitionFeeLookupMap = {};
  for (const row of rows) {
    const entry = {
      morning: row.morning_fee,
      evening: row.evening_fee,
    };
    map[normalizeDeptKey(row.department_name)] = entry;
    for (const alias of row.name_aliases) {
      map[normalizeDeptKey(alias)] = entry;
    }
    const lookupOnly = LOOKUP_ONLY_ALIASES[row.id] || [];
    for (const alias of lookupOnly) {
      map[normalizeDeptKey(alias)] = entry;
    }
  }
  return map;
}

export async function listDepartmentTuitionFees(): Promise<
  DepartmentTuitionFeeRow[]
> {
  await ensureDepartmentTuitionFeesTable();
  const result = await query(
    `SELECT id, department_name, name_aliases, morning_fee, evening_fee, updated_at
     FROM accounts.department_tuition_fees
     ORDER BY department_name ASC`
  );
  return result.rows.map((r) => rowToFee(r as Record<string, unknown>));
}

export async function loadTuitionFeeMap(
  force = false
): Promise<TuitionFeeLookupMap> {
  if (!force && feeCache && Date.now() - feeCache.at < FEE_CACHE_TTL_MS) {
    return feeCache.map;
  }
  const rows = await listDepartmentTuitionFees();
  const map = buildMap(rows);
  feeCache = { at: Date.now(), map, rows };
  return map;
}

/** القسط من DB مع احتياطي افتراضي */
export async function resolveAnnualTuitionFee(
  department: string,
  studyType?: string | null
): Promise<number> {
  const map = await loadTuitionFeeMap();
  return getAnnualTuitionFee(department, studyType, map);
}

export async function updateDepartmentTuitionFee(input: {
  id: string;
  morning_fee: number;
  evening_fee: number;
  updated_by?: string | null;
}): Promise<DepartmentTuitionFeeRow | null> {
  await ensureDepartmentTuitionFeesTable();
  const morning = Math.max(0, Math.round(Number(input.morning_fee) || 0));
  const evening = Math.max(0, Math.round(Number(input.evening_fee) || 0));
  const updatedBy =
    input.updated_by &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.updated_by
    )
      ? input.updated_by
      : null;

  const result = await query(
    `UPDATE accounts.department_tuition_fees
     SET morning_fee = $2,
         evening_fee = $3,
         updated_at = NOW(),
         updated_by = $4::uuid
     WHERE id = $1
     RETURNING id, department_name, name_aliases, morning_fee, evening_fee, updated_at`,
    [input.id, morning, evening, updatedBy]
  );

  invalidateTuitionFeeCache();
  if (!result.rows[0]) return null;
  return rowToFee(result.rows[0] as Record<string, unknown>);
}
