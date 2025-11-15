import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

const STAGE_LABELS: Record<string, { id: string; name: string; order: number }> = {
  first: { id: 'stage-first', name: 'المرحلة الأولى', order: 1 },
  second: { id: 'stage-second', name: 'المرحلة الثانية', order: 2 },
  third: { id: 'stage-third', name: 'المرحلة الثالثة', order: 3 },
  fourth: { id: 'stage-fourth', name: 'المرحلة الرابعة', order: 4 },
};

const SEMESTER_LABELS: Record<string, string> = {
  first: 'الفصل الأول',
  second: 'الفصل الثاني',
  third: 'الفصل الثالث',
  fourth: 'الفصل الرابع',
  fifth: 'الفصل الخامس',
  sixth: 'الفصل السادس',
  seventh: 'الفصل السابع',
  eighth: 'الفصل الثامن',
};

function resolveStageMeta(rawAdmissionType: string | null): { id: string; name: string; order: number } {
  const key = (rawAdmissionType || '').toLowerCase().trim();
  if (key && STAGE_LABELS[key]) {
    return STAGE_LABELS[key];
  }

  if (!key) {
    return { id: 'stage-undefined', name: 'مرحلة غير محددة', order: 99 };
  }

  return {
    id: `stage-${key.replace(/[^a-z0-9\u0600-\u06FF]+/gi, '-') || 'other'}`,
    name: rawAdmissionType || 'مرحلة أخرى',
    order: 50,
  };
}

function resolveSemesterMeta(
  stageId: string,
  rawSemester: string | null
): { id: string; name: string; raw: string | null } {
  const value = (rawSemester || '').toLowerCase().trim();

  if (!value) {
    return {
      id: `${stageId}-semester-undefined`,
      name: 'فصل غير محدد',
      raw: rawSemester,
    };
  }

  const normalized = value.replace(/[^a-z0-9\u0600-\u06FF]+/gi, '-');
  const label = SEMESTER_LABELS[value] || rawSemester || value;

  return {
    id: `${stageId}-semester-${normalized || 'other'}`,
    name: label,
    raw: rawSemester,
  };
}

export async function GET() {
  try {
    const [departmentsResult, stagesResult, totalStudentsResult, columnCheckResult] = await Promise.all([
      query(`
        SELECT 
          normalize_arabic(COALESCE(major, 'غير محدد')) AS normalized_major,
          MAX(COALESCE(major, 'غير محدد')) AS display_name,
          COUNT(*)::int AS count
        FROM student_affairs.students
        GROUP BY normalized_major
        ORDER BY count DESC, display_name ASC
      `),
      query(`
        SELECT 
          normalize_arabic(COALESCE(major, 'غير محدد')) AS normalized_major,
          COALESCE(major, 'غير محدد') AS display_major,
          COALESCE(admission_type, '') AS admission_type,
          COALESCE(semester, '') AS semester,
          COUNT(*)::int AS count
        FROM student_affairs.students
        GROUP BY normalize_arabic(COALESCE(major, 'غير محدد')), COALESCE(major, 'غير محدد'), admission_type, semester
      `),
      query('SELECT COUNT(*)::int AS count FROM student_affairs.students'),
      query(`
        SELECT
          MAX(CASE WHEN column_name = 'payment_status' THEN 1 ELSE 0 END)::int AS has_payment_status,
          MAX(CASE WHEN column_name = 'status' THEN 1 ELSE 0 END)::int AS has_status,
          MAX(CASE WHEN column_name = 'registration_status' THEN 1 ELSE 0 END)::int AS has_registration_status,
          MAX(CASE WHEN column_name = 'admission_type' THEN 1 ELSE 0 END)::int AS has_admission_type,
          MAX(CASE WHEN column_name = 'semester' THEN 1 ELSE 0 END)::int AS has_semester
        FROM information_schema.columns
        WHERE table_schema = 'student_affairs'
          AND table_name = 'students'
      `),
    ]);

    const columnFlags = columnCheckResult.rows[0] || {};
    const departmentIdFromNormalized = new Map<string, string>();
    const hasAdmissionType = Boolean(columnFlags?.has_admission_type);
    const hasSemester = Boolean(columnFlags?.has_semester);

    const departments = departmentsResult.rows
      .filter((row) => (row.display_name || '').trim() !== '')
      .map((row, index) => {
        const idBase = (row.normalized_major || row.display_name || `department-${index}`)
          .toString()
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\u0600-\u06FF-]+/gi, '')
          .toLowerCase();

        const id = idBase || `department-${index}`;
        departmentIdFromNormalized.set(row.normalized_major || id, id);

        return {
          id,
          name: row.display_name || 'قسم غير محدد',
          count: Number(row.count) || 0,
        };
      });

    const stageMap: Record<
      string,
      {
        id: string;
        name: string;
        order: number;
        total: number;
        rawAdmissionType: string | null;
        semesters: { id: string; name: string; raw: string | null; count: number }[];
      }
    > = {};
    const departmentStageMap: Record<
      string,
      Record<
        string,
        {
          id: string;
          name: string;
          order: number;
          total: number;
          rawAdmissionType: string | null;
          semesters: Record<string, { id: string; name: string; raw: string | null; count: number }>;
        }
      >
    > = {};

    if (hasAdmissionType) {
      stagesResult.rows.forEach((row) => {
        const stageMeta = resolveStageMeta(row.admission_type);
        if (!stageMap[stageMeta.id]) {
          stageMap[stageMeta.id] = {
            id: stageMeta.id,
            name: stageMeta.name,
            order: stageMeta.order,
            total: 0,
            rawAdmissionType: row.admission_type,
            semesters: [],
          };
        }

        stageMap[stageMeta.id].total += Number(row.count) || 0;

        if (hasSemester) {
          const semesterMeta = resolveSemesterMeta(stageMeta.id, row.semester);
          stageMap[stageMeta.id].semesters.push({
            ...semesterMeta,
            count: Number(row.count) || 0,
          });
        }

        const departmentKey = departmentIdFromNormalized.get(row.normalized_major) || (() => {
          const fallbackId = (row.normalized_major || row.display_major || 'department-other')
            .toString()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\u0600-\u06FF-]+/gi, '')
            .toLowerCase();
          return fallbackId || 'department-other';
        })();

        if (!departmentStageMap[departmentKey]) {
          departmentStageMap[departmentKey] = {};
        }

        if (!departmentStageMap[departmentKey][stageMeta.id]) {
          departmentStageMap[departmentKey][stageMeta.id] = {
            id: stageMeta.id,
            name: stageMeta.name,
            order: stageMeta.order,
            total: 0,
            rawAdmissionType: row.admission_type,
            semesters: {},
          };
        }

        const departmentStage = departmentStageMap[departmentKey][stageMeta.id];
        departmentStage.total += Number(row.count) || 0;

        if (hasSemester) {
          const semesterMeta = resolveSemesterMeta(stageMeta.id, row.semester);
          if (!departmentStage.semesters[semesterMeta.id]) {
            departmentStage.semesters[semesterMeta.id] = {
              id: semesterMeta.id,
              name: semesterMeta.name,
              raw: semesterMeta.raw,
              count: 0,
            };
          }
          departmentStage.semesters[semesterMeta.id].count += Number(row.count) || 0;
        }
      });
    }

    const stages = Object.values(stageMap)
      .map((stage) => ({
        ...stage,
        semesters: stage.semesters.sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      }))
      .sort((a, b) => {
        if (a.order === b.order) {
          return a.name.localeCompare(b.name, 'ar');
        }
        return a.order - b.order;
      });

    const departmentStages: Record<string, { id: string; name: string; rawAdmissionType: string | null; order: number; total: number; semesters: { id: string; name: string; raw: string | null; count: number }[] }[]> =
      {};

    Object.entries(departmentStageMap).forEach(([deptId, stageEntries]) => {
      const stageArray = Object.values(stageEntries)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          order: entry.order,
          rawAdmissionType: entry.rawAdmissionType,
          total: entry.total,
          semesters: Object.values(entry.semesters).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
        }))
        .sort((a, b) => {
          if (a.order === b.order) {
            return a.name.localeCompare(b.name, 'ar');
          }
          return a.order - b.order;
        });

      if (stageArray.length) {
        departmentStages[deptId] = stageArray;
      }
    });

    const newStudentsConditions: string[] = [];
    const newStudentsParams: string[] = [];

    if (columnFlags?.has_payment_status) {
      newStudentsParams.push('registration_pending');
      newStudentsConditions.push(`COALESCE(payment_status, '') = $${newStudentsParams.length}`);
    }

    if (columnFlags?.has_status) {
      newStudentsParams.push('registration_pending');
      newStudentsConditions.push(`COALESCE(status, '') = $${newStudentsParams.length}`);
    }

    if (columnFlags?.has_registration_status) {
      newStudentsParams.push('pending');
      newStudentsConditions.push(`COALESCE(registration_status, '') = $${newStudentsParams.length}`);
    }

    let newStudentsCount = 0;
    if (newStudentsConditions.length > 0) {
      const newStudentsResult = await query(
        `
          SELECT COUNT(*)::int AS count
          FROM student_affairs.students
          WHERE ${newStudentsConditions.join(' OR ')}
        `,
        newStudentsParams
      );
      newStudentsCount = Number(newStudentsResult.rows[0]?.count) || 0;
    }

    const totalStudents = Number(totalStudentsResult.rows[0]?.count) || 0;

    return NextResponse.json({
      success: true,
      data: {
        departments,
        stages,
        departmentStages,
        newStudentsCount,
        totals: {
          totalStudents,
        },
      },
    });
  } catch (error) {
    console.error('خطأ في جلب ملخص الاتصالات:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'تعذر جلب بيانات المراسلات',
      },
      { status: 500 }
    );
  }
}


