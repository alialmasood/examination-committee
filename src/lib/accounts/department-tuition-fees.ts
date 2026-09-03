/**
 * مصدر أقساط الأقسام حسب المرحلة (1–4) وصباحي/مسائي — مخزّن في قاعدة البيانات.
 * الصفحة: /accounts/students/department-installments
 */
import { query } from '@/src/lib/db';
import {
  STUDENT_DEPARTMENTS,
  emptyFeesByYear,
  feesByYearFromFlat,
  getAnnualTuitionFee,
  getDefaultAnnualTuitionFee,
  normalizeDeptKey,
  normalizeFeeYear,
  type FeeYearKey,
  type TuitionFeeByYear,
  type TuitionFeeEntry,
  type TuitionFeeLookupMap,
} from '@/app/accounts/students/lib/tuitionFees';

export type DepartmentTuitionFeeRow = {
  id: string;
  department_name: string;
  name_aliases: string[];
  /** توافق خلفي = قسط المرحلة الأولى صباحي */
  morning_fee: number;
  /** توافق خلفي = قسط المرحلة الأولى مسائي */
  evening_fee: number;
  morning_fee_y1: number;
  morning_fee_y2: number;
  morning_fee_y3: number;
  morning_fee_y4: number;
  evening_fee_y1: number;
  evening_fee_y2: number;
  evening_fee_y3: number;
  evening_fee_y4: number;
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

const STAGE_FEE_COLUMNS = [
  'morning_fee_y1',
  'morning_fee_y2',
  'morning_fee_y3',
  'morning_fee_y4',
  'evening_fee_y1',
  'evening_fee_y2',
  'evening_fee_y3',
  'evening_fee_y4',
] as const;

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

function numFee(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : Math.max(0, fallback);
}

function byYearFromRow(
  row: Record<string, unknown>,
  prefix: 'morning' | 'evening'
): TuitionFeeByYear {
  const flat = numFee(row[`${prefix}_fee`], 0);
  return {
    1: numFee(row[`${prefix}_fee_y1`], flat),
    2: numFee(row[`${prefix}_fee_y2`], flat),
    3: numFee(row[`${prefix}_fee_y3`], flat),
    4: numFee(row[`${prefix}_fee_y4`], flat),
  };
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

  for (const col of STAGE_FEE_COLUMNS) {
    await query(
      `ALTER TABLE accounts.department_tuition_fees
       ADD COLUMN IF NOT EXISTS ${col} NUMERIC(14,2) NOT NULL DEFAULT 0`
    ).catch(() => undefined);
  }

  // تعبئة أولية لمرة واحدة فقط: كل أعمدة المراحل صفر والقسط القديم موجود
  await query(`
    UPDATE accounts.department_tuition_fees
    SET
      morning_fee_y1 = morning_fee,
      morning_fee_y2 = morning_fee,
      morning_fee_y3 = morning_fee,
      morning_fee_y4 = morning_fee
    WHERE COALESCE(morning_fee_y1, 0) = 0
      AND COALESCE(morning_fee_y2, 0) = 0
      AND COALESCE(morning_fee_y3, 0) = 0
      AND COALESCE(morning_fee_y4, 0) = 0
      AND COALESCE(morning_fee, 0) > 0
  `).catch(() => undefined);

  await query(`
    UPDATE accounts.department_tuition_fees
    SET
      evening_fee_y1 = evening_fee,
      evening_fee_y2 = evening_fee,
      evening_fee_y3 = evening_fee,
      evening_fee_y4 = evening_fee
    WHERE COALESCE(evening_fee_y1, 0) = 0
      AND COALESCE(evening_fee_y2, 0) = 0
      AND COALESCE(evening_fee_y3, 0) = 0
      AND COALESCE(evening_fee_y4, 0) = 0
      AND COALESCE(evening_fee, 0) > 0
  `).catch(() => undefined);

  for (const dept of STUDENT_DEPARTMENTS) {
    const morning = getDefaultAnnualTuitionFee(dept.name, 'morning');
    const evening = getDefaultAnnualTuitionFee(dept.name, 'evening');
    const aliases = DEPARTMENT_ALIASES[dept.id] || [];
    await query(
      `INSERT INTO accounts.department_tuition_fees
         (id, department_name, name_aliases,
          morning_fee, evening_fee,
          morning_fee_y1, morning_fee_y2, morning_fee_y3, morning_fee_y4,
          evening_fee_y1, evening_fee_y2, evening_fee_y3, evening_fee_y4,
          updated_at)
       VALUES ($1, $2, $3::text[],
               $4, $5,
               $4, $4, $4, $4,
               $5, $5, $5, $5,
               NOW())
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
  const morningByYear = byYearFromRow(row, 'morning');
  const eveningByYear = byYearFromRow(row, 'evening');
  return {
    id: String(row.id),
    department_name: String(row.department_name || ''),
    name_aliases: aliases,
    morning_fee: morningByYear[1],
    evening_fee: eveningByYear[1],
    morning_fee_y1: morningByYear[1],
    morning_fee_y2: morningByYear[2],
    morning_fee_y3: morningByYear[3],
    morning_fee_y4: morningByYear[4],
    evening_fee_y1: eveningByYear[1],
    evening_fee_y2: eveningByYear[2],
    evening_fee_y3: eveningByYear[3],
    evening_fee_y4: eveningByYear[4],
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function entryFromRow(row: DepartmentTuitionFeeRow): TuitionFeeEntry {
  const morningByYear: TuitionFeeByYear = {
    1: row.morning_fee_y1,
    2: row.morning_fee_y2,
    3: row.morning_fee_y3,
    4: row.morning_fee_y4,
  };
  const eveningByYear: TuitionFeeByYear = {
    1: row.evening_fee_y1,
    2: row.evening_fee_y2,
    3: row.evening_fee_y3,
    4: row.evening_fee_y4,
  };
  return {
    morning: morningByYear[1],
    evening: eveningByYear[1],
    morningByYear,
    eveningByYear,
  };
}

function buildMap(rows: DepartmentTuitionFeeRow[]): TuitionFeeLookupMap {
  const map: TuitionFeeLookupMap = {};
  for (const row of rows) {
    const entry = entryFromRow(row);
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

const SELECT_FEE_COLUMNS = `
  id, department_name, name_aliases,
  morning_fee, evening_fee,
  morning_fee_y1, morning_fee_y2, morning_fee_y3, morning_fee_y4,
  evening_fee_y1, evening_fee_y2, evening_fee_y3, evening_fee_y4,
  updated_at
`;

export async function listDepartmentTuitionFees(): Promise<
  DepartmentTuitionFeeRow[]
> {
  await ensureDepartmentTuitionFeesTable();
  const result = await query(
    `SELECT ${SELECT_FEE_COLUMNS}
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

/** القسط من DB مع احتياطي افتراضي (مرحلة اختيارية) */
export async function resolveAnnualTuitionFee(
  department: string,
  studyType?: string | null,
  feeYear?: number | string | null
): Promise<number> {
  const map = await loadTuitionFeeMap();
  return getAnnualTuitionFee(department, studyType, map, feeYear);
}

function parseStageFees(
  input: Record<string, unknown>,
  prefix: 'morning' | 'evening',
  legacyFlat?: number
): TuitionFeeByYear {
  const hasStage = ([1, 2, 3, 4] as FeeYearKey[]).some((y) => {
    const key = `${prefix}_fee_y${y}`;
    return input[key] != null && Number.isFinite(Number(input[key]));
  });

  if (hasStage) {
    const base =
      legacyFlat != null && Number.isFinite(legacyFlat)
        ? Math.max(0, Math.round(legacyFlat))
        : 0;
    const out = emptyFeesByYear(base);
    for (const y of [1, 2, 3, 4] as FeeYearKey[]) {
      const key = `${prefix}_fee_y${y}`;
      if (input[key] != null && Number.isFinite(Number(input[key]))) {
        out[y] = Math.max(0, Math.round(Number(input[key])));
      }
    }
    return out;
  }

  if (legacyFlat != null && Number.isFinite(legacyFlat)) {
    return feesByYearFromFlat(Math.max(0, Math.round(legacyFlat)));
  }

  return emptyFeesByYear(0);
}

export async function updateDepartmentTuitionFee(input: {
  id: string;
  morning_fee?: number;
  evening_fee?: number;
  morning_fee_y1?: number;
  morning_fee_y2?: number;
  morning_fee_y3?: number;
  morning_fee_y4?: number;
  evening_fee_y1?: number;
  evening_fee_y2?: number;
  evening_fee_y3?: number;
  evening_fee_y4?: number;
  updated_by?: string | null;
}): Promise<DepartmentTuitionFeeRow | null> {
  await ensureDepartmentTuitionFeesTable();

  const morningByYear = parseStageFees(
    input as Record<string, unknown>,
    'morning',
    input.morning_fee
  );
  const eveningByYear = parseStageFees(
    input as Record<string, unknown>,
    'evening',
    input.evening_fee
  );

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
         morning_fee_y1 = $4,
         morning_fee_y2 = $5,
         morning_fee_y3 = $6,
         morning_fee_y4 = $7,
         evening_fee_y1 = $8,
         evening_fee_y2 = $9,
         evening_fee_y3 = $10,
         evening_fee_y4 = $11,
         updated_at = NOW(),
         updated_by = $12::uuid
     WHERE id = $1
     RETURNING ${SELECT_FEE_COLUMNS}`,
    [
      input.id,
      morningByYear[1],
      eveningByYear[1],
      morningByYear[1],
      morningByYear[2],
      morningByYear[3],
      morningByYear[4],
      eveningByYear[1],
      eveningByYear[2],
      eveningByYear[3],
      eveningByYear[4],
      updatedBy,
    ]
  );

  invalidateTuitionFeeCache();
  if (!result.rows[0]) return null;
  return rowToFee(result.rows[0] as Record<string, unknown>);
}

/** للتوافق إن وُجد استيراد قديم */
export { normalizeFeeYear };
