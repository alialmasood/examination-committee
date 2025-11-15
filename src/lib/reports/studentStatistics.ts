import { pool } from '@/src/lib/db';
import {
  StudentReportFilters,
  DepartmentSummaryEntry,
  StageSummaryEntry,
  DepartmentStageSummaryEntry,
  SimpleStatEntry,
  StudentReportData,
  StageBreakdownEntry,
  SemesterBreakdownEntry,
} from '@/src/lib/types/reports';

const STAGE_LABELS: Record<string, { id: string; name: string; order: number }> = {
  first: { id: 'stage-first', name: 'المرحلة الأولى', order: 1 },
  second: { id: 'stage-second', name: 'المرحلة الثانية', order: 2 },
  third: { id: 'stage-third', name: 'المرحلة الثالثة', order: 3 },
  fourth: { id: 'stage-fourth', name: 'المرحلة الرابعة', order: 4 },
  fifth: { id: 'stage-fifth', name: 'المرحلة الخامسة', order: 5 },
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

type DepartmentBreakdownRow = {
  normalized_major: string | null;
  display_major: string | null;
  count: string | number;
};

type StageBreakdownRow = {
  admission_type: string | null;
  count: string | number;
};

type SemesterBreakdownRow = {
  admission_type: string | null;
  semester: string | null;
  count: string | number;
};

type SimpleStatRow = {
  key: string | null;
  count: string | number;
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

function resolveSemesterMeta(stageId: string, rawSemester: string | null): { id: string; name: string; raw: string | null } {
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

interface ColumnAvailability {
  hasAdmissionType: boolean;
  hasSemester: boolean;
  hasGender: boolean;
  hasStatus: boolean;
  hasAdmissionChannel: boolean;
  hasStudyType: boolean;
  hasAcademicYear: boolean;
  hasPaymentStatus: boolean;
}

function buildFilterClause(
  filters: StudentReportFilters,
  options: {
    departmentNameFromId: Map<string, string>;
    stageRawFromId: Map<string, string | null>;
    semesterRawFromId: Map<string, { raw: string | null; stageRaw: string | null }>; 
    columnAvailability: ColumnAvailability;
  }
) {
  const clauses: string[] = [];
  const params: (string | null)[] = [];

  if (filters.departmentId && filters.departmentId !== 'all') {
    const departmentName = options.departmentNameFromId.get(filters.departmentId);
    if (departmentName) {
      params.push(departmentName);
      clauses.push(`normalize_arabic(COALESCE(s.major, 'غير محدد')) = normalize_arabic($${params.length})`);
    }
  }

  if (filters.stageId && filters.stageId !== 'all' && options.columnAvailability.hasAdmissionType) {
    const stageRaw = options.stageRawFromId.get(filters.stageId) ?? '';
    params.push(stageRaw || '');
    clauses.push(`COALESCE(s.admission_type, '') = $${params.length}`);
  }

  if (filters.semesterId && filters.semesterId !== 'all' && options.columnAvailability.hasSemester) {
    const semesterMeta = options.semesterRawFromId.get(filters.semesterId);
    if (semesterMeta) {
      params.push(semesterMeta.raw || '');
      clauses.push(`COALESCE(s.semester, '') = $${params.length}`);
    }
  }

  if (filters.academicYear && filters.academicYear !== 'all' && options.columnAvailability.hasAcademicYear) {
    params.push(filters.academicYear === 'undefined' ? '' : filters.academicYear);
    clauses.push(`COALESCE(s.academic_year, '') = $${params.length}`);
  }

  if (filters.status && filters.status !== 'all' && options.columnAvailability.hasStatus) {
    params.push(filters.status);
    clauses.push(`COALESCE(s.status, '') = $${params.length}`);
  }

  if (filters.gender && filters.gender !== 'all' && options.columnAvailability.hasGender) {
    params.push(filters.gender);
    clauses.push(`COALESCE(s.gender, '') = $${params.length}`);
  }

  if (filters.admissionChannel && filters.admissionChannel !== 'all' && options.columnAvailability.hasAdmissionChannel) {
    params.push(filters.admissionChannel);
    clauses.push(`COALESCE(s.admission_channel, '') = $${params.length}`);
  }

  if (filters.studyType && filters.studyType !== 'all' && options.columnAvailability.hasStudyType) {
    params.push(filters.studyType);
    clauses.push(`COALESCE(s.study_type, '') = $${params.length}`);
  }

  if (filters.paymentStatus && filters.paymentStatus !== 'all' && options.columnAvailability.hasPaymentStatus) {
    params.push(filters.paymentStatus);
    clauses.push(`COALESCE(s.payment_status, '') = $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereClause, params };
}

export async function getStudentStatistics(filters: StudentReportFilters = {}): Promise<StudentReportData> {
  const columnCheckResult = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'student_affairs'
        AND table_name = 'students'
    `
  );

  const columnNames = new Set<string>(columnCheckResult.rows.map((row) => row.column_name as string));
  const columnAvailability: ColumnAvailability = {
    hasAdmissionType: columnNames.has('admission_type'),
    hasSemester: columnNames.has('semester'),
    hasGender: columnNames.has('gender'),
    hasStatus: columnNames.has('status'),
    hasAdmissionChannel: columnNames.has('admission_channel'),
    hasStudyType: columnNames.has('study_type'),
    hasAcademicYear: columnNames.has('academic_year'),
    hasPaymentStatus: columnNames.has('payment_status'),
  };

  const departmentsPromise = pool.query(
    `
      SELECT
        normalize_arabic(COALESCE(major, 'غير محدد')) AS normalized_major,
        MAX(COALESCE(major, 'غير محدد')) AS display_name,
        COUNT(*)::int AS count
      FROM student_affairs.students
      GROUP BY normalized_major
      ORDER BY count DESC, display_name ASC
    `
  );

  const stagesPromise = columnAvailability.hasAdmissionType
    ? pool.query(
        `
          SELECT
            normalize_arabic(COALESCE(major, 'غير محدد')) AS normalized_major,
            COALESCE(major, 'غير محدد') AS display_major,
            COALESCE(admission_type, '') AS admission_type,
            COALESCE(semester, '') AS semester,
            COUNT(*)::int AS count
          FROM student_affairs.students
          GROUP BY normalize_arabic(COALESCE(major, 'غير محدد')), COALESCE(major, 'غير محدد'), admission_type, semester
        `
      )
    : Promise.resolve({ rows: [] } as const);

  const totalStudentsResult = await pool.query('SELECT COUNT(*)::int AS count FROM student_affairs.students');

  const [departmentsResult, stagesResult] = await Promise.all([departmentsPromise, stagesPromise]);

  const totalStudents = Number(totalStudentsResult.rows[0]?.count) || 0;
  const departmentNameFromId = new Map<string, string>();
  const departmentIdFromNormalized = new Map<string, string>();

  const departments = departmentsResult.rows.map((row, index) => {
    const idBase = (row.normalized_major || row.display_name || `department-${index}`)
      .toString()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u0600-\u06FF-]+/gi, '')
      .toLowerCase();

    const id = idBase || `department-${index}`;
    const count = Number(row.count) || 0;
    const percentage = totalStudents ? Number(((count / totalStudents) * 100).toFixed(2)) : 0;

    departmentNameFromId.set(id, row.display_name || 'قسم غير محدد');
    departmentIdFromNormalized.set(row.normalized_major || row.display_name || id, id);

    return {
      id,
      name: row.display_name || 'قسم غير محدد',
      count,
      percentage,
    };
  });

  const stageMap: Record<string, StageSummaryEntry> = {};
  const departmentStageMap: Record<string, Record<string, DepartmentStageSummaryEntry>> = {};
  const stageRawFromId = new Map<string, string | null>();
  const semesterRawFromId = new Map<string, { raw: string | null; stageRaw: string | null }>();

  if (columnAvailability.hasAdmissionType) {
    stagesResult.rows.forEach((row) => {
      const stageMeta = resolveStageMeta(row.admission_type);
      const stageId = stageMeta.id;
      stageRawFromId.set(stageId, row.admission_type);

      if (!stageMap[stageId]) {
        stageMap[stageId] = {
          id: stageId,
          name: stageMeta.name,
          order: stageMeta.order,
          count: 0,
          percentage: 0,
          rawAdmissionType: row.admission_type,
          semesters: [],
        };
      }

      stageMap[stageId].count += Number(row.count) || 0;

      if (columnAvailability.hasSemester) {
        const semesterMeta = resolveSemesterMeta(stageId, row.semester);
        semesterRawFromId.set(semesterMeta.id, { raw: semesterMeta.raw, stageRaw: row.admission_type });

        stageMap[stageId].semesters.push({
          id: semesterMeta.id,
          name: semesterMeta.name,
          raw: semesterMeta.raw,
          stageId,
          count: Number(row.count) || 0,
          percentage: 0,
        });
      }

      const departmentKey = departmentIdFromNormalized.get(row.normalized_major) ||
        departmentIdFromNormalized.get(row.display_major) ||
        (row.normalized_major || row.display_major || 'department-other');

      if (!departmentStageMap[departmentKey]) {
        departmentStageMap[departmentKey] = {};
      }

      if (!departmentStageMap[departmentKey][stageId]) {
        departmentStageMap[departmentKey][stageId] = {
          id: stageId,
          name: stageMeta.name,
          order: stageMeta.order,
          rawAdmissionType: row.admission_type,
          total: 0,
          semesters: [],
        };
      }

      const departmentStage = departmentStageMap[departmentKey][stageId];
      departmentStage.total += Number(row.count) || 0;

      if (columnAvailability.hasSemester) {
        const semesterMeta = resolveSemesterMeta(stageId, row.semester);
        semesterRawFromId.set(semesterMeta.id, { raw: semesterMeta.raw, stageRaw: row.admission_type });

        const existingSemester = departmentStage.semesters.find((item) => item.id === semesterMeta.id);
        if (existingSemester) {
          existingSemester.count += Number(row.count) || 0;
        } else {
          departmentStage.semesters.push({
            id: semesterMeta.id,
            name: semesterMeta.name,
            raw: semesterMeta.raw,
            stageId,
            count: Number(row.count) || 0,
            percentage: 0,
          });
        }
      }
    });
  }

  const stages = Object.values(stageMap)
    .map((stage) => ({
      ...stage,
      percentage: totalStudents ? Number(((stage.count / totalStudents) * 100).toFixed(2)) : 0,
      semesters: stage.semesters
        .map((semester) => ({
          ...semester,
          percentage: stage.count ? Number(((semester.count / stage.count) * 100).toFixed(2)) : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    }))
    .sort((a, b) => {
      if (a.order === b.order) {
        return a.name.localeCompare(b.name, 'ar');
      }
      return a.order - b.order;
    });

  const semesters = stages.flatMap((stage) => stage.semesters);

  const departmentStages: Record<string, DepartmentStageSummaryEntry[]> = {};
  Object.entries(departmentStageMap).forEach(([departmentId, stageEntries]) => {
    departmentStages[departmentId] = Object.values(stageEntries)
      .map((entry) => ({
        ...entry,
        semesters: entry.semesters
          .map((semester) => ({
            ...semester,
            percentage: entry.total ? Number(((semester.count / entry.total) * 100).toFixed(2)) : 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      }))
      .sort((a, b) => {
        if (a.order === b.order) {
          return a.name.localeCompare(b.name, 'ar');
        }
        return a.order - b.order;
      });
  });

  const { whereClause, params } = buildFilterClause(filters, {
    departmentNameFromId,
    stageRawFromId,
    semesterRawFromId,
    columnAvailability,
  });

  const baseTable = `FROM student_affairs.students s ${whereClause}`;

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS count ${baseTable}`, params);
  const filteredTotal = Number(totalResult.rows[0]?.count) || 0;

  let newStudentsCount = 0;
  if (columnAvailability.hasPaymentStatus || columnAvailability.hasStatus || columnAvailability.hasAdmissionType) {
    const subParams = [...params];
    const subClauses: string[] = [];

    if (columnAvailability.hasPaymentStatus) {
      subParams.push('registration_pending');
      subClauses.push(`COALESCE(s.payment_status, '') = $${subParams.length}`);
    }

    if (columnAvailability.hasStatus) {
      subParams.push('registration_pending');
      subClauses.push(`COALESCE(s.status, '') = $${subParams.length}`);
    }

    if (columnAvailability.hasAdmissionType) {
      subParams.push('conditional');
      subClauses.push(`COALESCE(s.admission_type, '') = $${subParams.length}`);
    }

    if (subClauses.length) {
      const combinedWhere = whereClause ? `${whereClause} AND (${subClauses.join(' OR ')})` : `WHERE ${subClauses.join(' OR ')}`;
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM student_affairs.students s ${combinedWhere}`,
        subParams
      );
      newStudentsCount = Number(result.rows[0]?.count) || 0;
    }
  }

  const breakdownPromises: Array<Promise<{ rows: unknown[] }>> = [
    pool.query(
      `SELECT
         normalize_arabic(COALESCE(s.major, 'غير محدد')) AS normalized_major,
         MAX(COALESCE(s.major, 'غير محدد')) AS display_major,
         COUNT(*)::int AS count
       ${baseTable}
       GROUP BY normalized_major
       ORDER BY count DESC, display_major ASC`,
      params
    ),
    columnAvailability.hasAdmissionType
      ? pool.query(
          `SELECT
             COALESCE(s.admission_type, '') AS admission_type,
             COUNT(*)::int AS count
           ${baseTable}
           GROUP BY COALESCE(s.admission_type, '')
           ORDER BY count DESC`,
          params
        )
      : Promise.resolve({ rows: [] as unknown[] }),
    columnAvailability.hasAdmissionType && columnAvailability.hasSemester
      ? pool.query(
          `SELECT
             COALESCE(s.admission_type, '') AS admission_type,
             COALESCE(s.semester, '') AS semester,
             COUNT(*)::int AS count
           ${baseTable}
           GROUP BY COALESCE(s.admission_type, ''), COALESCE(s.semester, '')
           ORDER BY count DESC`,
          params
        )
      : Promise.resolve({ rows: [] as unknown[] }),
  ];

  const [departmentBreakdownResult, stageBreakdownResult, semesterBreakdownResult] = await Promise.all(breakdownPromises);

  const departmentBreakdownRows = (departmentBreakdownResult.rows as DepartmentBreakdownRow[]) || [];

  const breakdownDepartments: DepartmentSummaryEntry[] = departmentBreakdownRows.map((row, index) => {
    const slugSource = row.normalized_major || row.display_major || `department-${index}`;
    const slug =
      slugSource
        ?.toString()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\u0600-\u06FF-]+/gi, '')
        .toLowerCase() || `department-${index}`;

    const normalizedKey = row.normalized_major ?? undefined;
    const displayKey = row.display_major ?? undefined;

    const id =
      (normalizedKey ? departmentIdFromNormalized.get(normalizedKey) : undefined) ||
      (displayKey ? departmentIdFromNormalized.get(displayKey) : undefined) ||
      slug ||
      `department-${index}`;

    const count = Number(row.count) || 0;
    return {
      id,
      name: row.display_major || 'قسم غير محدد',
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const stageBreakdownRows = (stageBreakdownResult.rows as StageBreakdownRow[]) || [];

  const breakdownStages: StageBreakdownEntry[] = stageBreakdownRows
    .map((row) => {
      const stageMeta = resolveStageMeta(row.admission_type);
      const count = Number(row.count) || 0;
      return {
        id: stageMeta.id,
        name: stageMeta.name,
        rawAdmissionType: row.admission_type,
        count,
        percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
        order: stageMeta.order,
      };
    })
    .sort((a, b) => {
      if (a.order === b.order) {
        return a.name.localeCompare(b.name, 'ar');
      }
      return a.order - b.order;
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      rawAdmissionType: item.rawAdmissionType,
      count: item.count,
      percentage: item.percentage,
    }));

  const semesterBreakdownRows = (semesterBreakdownResult.rows as SemesterBreakdownRow[]) || [];

  const breakdownSemesters: SemesterBreakdownEntry[] = semesterBreakdownRows
    .map((row) => {
      const stageMeta = resolveStageMeta(row.admission_type);
      const semesterMeta = resolveSemesterMeta(stageMeta.id, row.semester);
      const count = Number(row.count) || 0;
      return {
        id: semesterMeta.id,
        name: semesterMeta.name,
        stageId: stageMeta.id,
        stageName: stageMeta.name,
        raw: semesterMeta.raw,
        count,
        percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
        stageOrder: stageMeta.order,
      };
    })
    .sort((a, b) => {
      if (a.stageOrder === b.stageOrder) {
        return a.name.localeCompare(b.name, 'ar');
      }
      return a.stageOrder - b.stageOrder;
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      stageId: item.stageId,
      stageName: item.stageName,
      raw: item.raw,
      count: item.count,
      percentage: item.percentage,
    }));

  const statsPromises: Array<Promise<{ rows: SimpleStatRow[] }>> = [];

  if (columnAvailability.hasGender) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.gender, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.gender, '') ORDER BY count DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  if (columnAvailability.hasStatus) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.status, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.status, '') ORDER BY count DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  if (columnAvailability.hasAdmissionChannel) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.admission_channel, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.admission_channel, '') ORDER BY count DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  if (columnAvailability.hasStudyType) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.study_type, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.study_type, '') ORDER BY count DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  if (columnAvailability.hasAcademicYear) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.academic_year, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.academic_year, '') ORDER BY key DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  if (columnAvailability.hasPaymentStatus) {
    statsPromises.push(
      pool
        .query(
          `SELECT COALESCE(s.payment_status, '') AS key, COUNT(*)::int AS count ${baseTable} GROUP BY COALESCE(s.payment_status, '') ORDER BY count DESC`,
          params
        )
        .then((result) => ({ rows: result.rows as SimpleStatRow[] }))
    );
  } else {
    statsPromises.push(Promise.resolve({ rows: [] as SimpleStatRow[] }));
  }

  const [genderRows, statusRows, channelRows, studyTypeRows, academicYearRows, paymentStatusRows] = await Promise.all(statsPromises);

  const genders: SimpleStatEntry[] = (genderRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key ? (row.key === 'male' ? 'ذكور' : row.key === 'female' ? 'إناث' : row.key) : 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const statuses: SimpleStatEntry[] = (statusRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key || 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const admissionChannels: SimpleStatEntry[] = (channelRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key || 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const studyTypes: SimpleStatEntry[] = (studyTypeRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key || 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const academicYears: SimpleStatEntry[] = (academicYearRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key || 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const paymentStatuses: SimpleStatEntry[] = (paymentStatusRows.rows || []).map((row) => {
    const count = Number(row.count) || 0;
    const label = row.key || 'غير محدد';
    return {
      key: row.key || '',
      label,
      count,
      percentage: filteredTotal ? Number(((count / filteredTotal) * 100).toFixed(2)) : 0,
    };
  });

  const maleCount = genders.find((item) => item.key === 'male')?.count ?? null;
  const femaleCount = genders.find((item) => item.key === 'female')?.count ?? null;

  return {
    totals: {
      totalStudents: filteredTotal,
      male: maleCount,
      female: femaleCount,
    },
    newStudentsCount,
    filters: {
      departments,
      departmentStages,
      stages,
      semesters,
    },
    breakdown: {
      departments: breakdownDepartments,
      stages: breakdownStages,
      semesters: breakdownSemesters,
      genders,
      statuses,
      admissionChannels,
      studyTypes,
      academicYears,
      paymentStatuses,
    },
  };
}
