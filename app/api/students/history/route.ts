import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  StudentHistorySummary,
  StudentHistoryResponse,
} from '@/src/lib/types/student-history';
import {
  normalizeStageFilter,
  normalizeStatusFilter,
  resolveStageLabel,
  resolveStatusLabel,
  STAGE_LABELS,
} from './helpers';

const BASE_CTE = `
WITH grade_history AS (
  SELECT
    s.id AS student_id,
    s.university_id,
    COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) AS full_name,
    COALESCE(ts.department, s.major, 'غير محدد') AS department,
    smg.academic_year,
    LOWER(COALESCE(NULLIF(ts.stage, ''), NULLIF(s.admission_type, ''), NULLIF(s.level, ''))) AS stage_code,
    LOWER(COALESCE(s.status, 'غير محدد')) AS status_code,
    s.study_type,
    AVG(
      COALESCE(
        smg.second_final_100,
        smg.first_final_100,
        smg.second_total_60 * (100.0 / 60.0),
        smg.first_total_60 * (100.0 / 60.0),
        smg.sae_40 * (100.0 / 40.0)
      )
    ) AS gpa_value,
    COUNT(*) AS subjects_count
  FROM examination_committee.sub_master_grades smg
  JOIN student_affairs.students s ON s.id = smg.student_id
  LEFT JOIN examination_committee.teaching_subjects ts ON ts.id = smg.subject_id
  GROUP BY
    s.id,
    s.university_id,
    COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)),
    COALESCE(ts.department, s.major, 'غير محدد'),
    smg.academic_year,
    LOWER(COALESCE(NULLIF(ts.stage, ''), NULLIF(s.admission_type, ''), NULLIF(s.level, ''))),
    LOWER(COALESCE(s.status, 'غير محدد')),
    s.study_type
),
current_snapshot AS (
  SELECT
    s.id AS student_id,
    s.university_id,
    COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) AS full_name,
    COALESCE(s.major, 'غير محدد') AS department,
    COALESCE(s.academic_year, 'غير محدد') AS academic_year,
    LOWER(COALESCE(NULLIF(s.admission_type, ''), NULLIF(s.level, ''))) AS stage_code,
    LOWER(COALESCE(s.status, 'غير محدد')) AS status_code,
    s.study_type,
    NULL::numeric AS gpa_value,
    NULL::integer AS subjects_count
  FROM student_affairs.students s
  WHERE NOT EXISTS (
    SELECT 1
    FROM examination_committee.sub_master_grades smg
    WHERE smg.student_id = s.id
  )
),
combined AS (
  SELECT *
  FROM grade_history
  UNION ALL
  SELECT *
  FROM current_snapshot
)
`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const year = (searchParams.get('year') || 'all').trim();
  const department = (searchParams.get('department') || 'all').trim();
  const stageFilters = normalizeStageFilter(searchParams.get('stage'));
  const statusFilters = normalizeStatusFilter(searchParams.get('status'));
  const search = searchParams.get('search')?.trim() || '';
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);

  const filterClauses: string[] = [];
  const filterParams: (string | string[] | number)[] = [];
  let paramIndex = 1;

  if (year !== 'all') {
    filterClauses.push(`combined.academic_year = $${paramIndex}`);
    filterParams.push(year);
    paramIndex += 1;
  }

  if (department !== 'all') {
    filterClauses.push(`combined.department = $${paramIndex}`);
    filterParams.push(department);
    paramIndex += 1;
  }

  if (stageFilters.length) {
    filterClauses.push(`combined.stage_code = ANY($${paramIndex}::text[])`);
    filterParams.push(stageFilters);
    paramIndex += 1;
  }

  if (statusFilters.length) {
    filterClauses.push(`combined.status_code = ANY($${paramIndex}::text[])`);
    filterParams.push(statusFilters);
    paramIndex += 1;
  }

  if (search) {
    filterClauses.push(
      `(combined.full_name ILIKE $${paramIndex} OR combined.university_id ILIKE $${paramIndex} OR combined.student_id::text ILIKE $${paramIndex})`
    );
    filterParams.push(`%${search}%`);
    paramIndex += 1;
  }

  const whereClause = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  try {
    const metaResult = await query(
      `
${BASE_CTE}
SELECT
  ARRAY(
    SELECT DISTINCT academic_year
    FROM combined
    WHERE academic_year IS NOT NULL
    ORDER BY academic_year DESC
  ) AS years,
  ARRAY(
    SELECT DISTINCT department
    FROM combined
    WHERE department IS NOT NULL AND department <> 'غير محدد'
    ORDER BY department
  ) AS departments,
  ARRAY(
    SELECT DISTINCT stage_code
    FROM combined
    WHERE stage_code IS NOT NULL AND stage_code <> ''
    ORDER BY stage_code
  ) AS stages,
  ARRAY(
    SELECT DISTINCT status_code
    FROM combined
    WHERE status_code IS NOT NULL AND status_code <> ''
    ORDER BY status_code
  ) AS statuses
FROM combined;
      `
    );

    const countResult = await query(
      `
${BASE_CTE}
SELECT COUNT(*) AS total
FROM combined
${whereClause};
      `,
      filterParams
    );

    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * limit;

    const dataResult = await query(
      `
${BASE_CTE}
SELECT
  combined.student_id,
  combined.university_id,
  combined.full_name,
  combined.academic_year,
  combined.stage_code,
  combined.status_code,
  combined.department,
  combined.study_type,
  combined.gpa_value,
  combined.subjects_count
FROM combined
${whereClause}
ORDER BY combined.academic_year DESC NULLS LAST, combined.full_name ASC
LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `,
      [...filterParams, limit, safeOffset]
    );

    const students: StudentHistorySummary[] = dataResult.rows.map((row) => {
      const stageCode = row.stage_code ? String(row.stage_code) : null;
      const statusCode = row.status_code ? String(row.status_code) : 'unknown';

      return {
        studentId: row.student_id,
        universityId: row.university_id,
        fullName: row.full_name,
        academicYear: row.academic_year ?? 'غير محدد',
        stageCode,
        stage: resolveStageLabel(stageCode),
        department: row.department ?? 'غير محدد',
        status: statusCode,
        statusLabel: resolveStatusLabel(statusCode),
        studyType: row.study_type,
        gpa: row.gpa_value !== null && row.gpa_value !== undefined ? Number(row.gpa_value) : null,
      };
    });

    const metaRow = metaResult.rows[0] ?? {};
    const metaYears: string[] = Array.isArray(metaRow.years)
      ? metaRow.years.filter((year: string | null) => Boolean(year)) ?? []
      : [];
    const metaDepartments: string[] = Array.isArray(metaRow.departments)
      ? metaRow.departments.filter((dept: string | null) => Boolean(dept)) ?? []
      : [];

    const metaStagesRaw: string[] = Array.isArray(metaRow.stages) ? metaRow.stages : [];
    const metaStageCodes = Array.from(
      new Set(
        metaStagesRaw
          .map((value: string | null) => value && value.trim())
          .filter((value): value is string => Boolean(value))
          .map((value: string) => {
            const label = resolveStageLabel(value);
            const entry = Object.entries(STAGE_LABELS).find(([, l]) => l === label);
            return entry ? entry[0] : value;
          })
      )
    );

    const metaStatusesRaw: string[] = Array.isArray(metaRow.statuses) ? metaRow.statuses : [];
    const metaStatusCodes = Array.from(
      new Set(
        metaStatusesRaw
          .map((value: string | null) => value && value.trim())
          .filter((value): value is string => Boolean(value))
          .map((value: string) => value.toLowerCase())
      )
    );

    const response: StudentHistoryResponse = {
      success: true,
      data: {
        students,
        page: safePage,
        limit,
        total,
        totalPages,
      },
      meta: {
        years: metaYears,
        departments: metaDepartments,
        stages: metaStageCodes,
        statuses: metaStatusCodes,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('خطأ في جلب السجل الأكاديمي:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب السجل الأكاديمي للطلبة' },
      { status: 500 }
    );
  }
}
