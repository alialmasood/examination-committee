import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  try {
    const [
      studentsOverview,
      studentsByDept,
      studentsByStage,
      studentsByDeptStageStudy,
      subjectsRefCount,
      studentsPerSubjectFromExports,
      exportsPerExam,
      exportsByDept,
      exportsBySubject,
      teachersCount,
      batchesCount,
      correctionGradingAgg,
      correctionGradingByDept,
      uploadsCount,
    ] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_students,
          COUNT(*) FILTER (WHERE study_type = 'morning')::int AS morning_students,
          COUNT(*) FILTER (WHERE study_type = 'evening')::int AS evening_students,
          COUNT(DISTINCT department)::int AS distinct_departments,
          COUNT(DISTINCT stage)::int AS distinct_stages
        FROM examination_committee.correction_students
      `),
      query(`
        SELECT department, COUNT(*)::int AS student_count
        FROM examination_committee.correction_students
        GROUP BY department
        ORDER BY student_count DESC, department ASC
      `),
      query(`
        SELECT stage, COUNT(*)::int AS student_count
        FROM examination_committee.correction_students
        GROUP BY stage
        ORDER BY student_count DESC, stage ASC
      `),
      query(`
        SELECT
          department,
          stage,
          study_type,
          COUNT(*)::int AS student_count
        FROM examination_committee.correction_students
        GROUP BY department, stage, study_type
        ORDER BY department ASC, stage ASC, study_type ASC
      `),
      query(`SELECT COUNT(*)::int AS c FROM examination_committee.correction_subjects`),
      query(`
        SELECT
          subject_name,
          NULLIF(TRIM(COALESCE(subject_code, '')), '') AS subject_code,
          SUM(student_count)::int AS export_student_slots,
          COUNT(*)::int AS slice_count
        FROM examination_committee.correction_sheet_exports
        GROUP BY subject_name, NULLIF(TRIM(COALESCE(subject_code, '')), '')
        ORDER BY export_student_slots DESC, subject_name ASC
      `),
      query(`
        SELECT
          subject_name,
          exam_date::text AS exam_date,
          SUM(student_count)::int AS student_slots,
          COUNT(*)::int AS slice_count
        FROM examination_committee.correction_sheet_exports
        GROUP BY subject_name, exam_date
        ORDER BY student_slots DESC, subject_name ASC
        LIMIT 80
      `),
      query(`
        SELECT
          COALESCE(
            NULLIF(TRIM(COALESCE(department, department_filter)), ''),
            'غير محدد'
          ) AS department,
          SUM(student_count)::int AS student_slots,
          COUNT(*)::int AS slice_count
        FROM examination_committee.correction_sheet_exports
        GROUP BY 1
        ORDER BY student_slots DESC, department ASC
      `),
      query(`
        SELECT
          subject_name,
          SUM(student_count)::int AS student_slots,
          COUNT(*)::int AS slice_count
        FROM examination_committee.correction_sheet_exports
        GROUP BY subject_name
        ORDER BY student_slots DESC, subject_name ASC
      `),
      query(`SELECT COUNT(*)::int AS c FROM hr.teachers`),
      query(`SELECT COUNT(*)::int AS c FROM examination_committee.correction_batches`),
      query(`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN correction_payload->'summary'->>'passCount' ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (correction_payload->'summary'->>'passCount')::numeric
              ELSE 0
            END
          ), 0)::bigint AS pass_sum,
          COALESCE(SUM(
            CASE
              WHEN correction_payload->'summary'->>'failCount' ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (correction_payload->'summary'->>'failCount')::numeric
              ELSE 0
            END
          ), 0)::bigint AS fail_sum,
          COALESCE(SUM(
            CASE
              WHEN correction_payload->'summary'->>'studentsCount' ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (correction_payload->'summary'->>'studentsCount')::numeric
              ELSE 0
            END
          ), 0)::bigint AS graded_sum
        FROM examination_committee.correction_batches
        WHERE correction_payload IS NOT NULL
          AND jsonb_typeof(correction_payload->'summary') = 'object'
      `),
      query(`
        SELECT
          COALESCE(
            NULLIF(TRIM(COALESCE(e.department, e.department_filter)), ''),
            'غير محدد'
          ) AS department,
          COALESCE(SUM(
            CASE
              WHEN b.correction_payload->'summary'->>'passCount' ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (b.correction_payload->'summary'->>'passCount')::numeric
              ELSE 0
            END
          ), 0)::bigint AS pass_sum,
          COALESCE(SUM(
            CASE
              WHEN b.correction_payload->'summary'->>'failCount' ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (b.correction_payload->'summary'->>'failCount')::numeric
              ELSE 0
            END
          ), 0)::bigint AS fail_sum
        FROM examination_committee.correction_batches b
        LEFT JOIN examination_committee.correction_sheet_exports e ON e.id = b.sheet_export_id
        WHERE b.correction_payload IS NOT NULL
          AND jsonb_typeof(b.correction_payload->'summary') = 'object'
        GROUP BY 1
        ORDER BY department ASC
      `),
      query(`SELECT COUNT(*)::int AS c FROM examination_committee.correction_uploads`),
    ]);

    const overview = studentsOverview.rows[0] || {};
    const passSum = Number(correctionGradingAgg.rows[0]?.pass_sum ?? 0);
    const failSum = Number(correctionGradingAgg.rows[0]?.fail_sum ?? 0);
    const gradedFromSummary = Number(correctionGradingAgg.rows[0]?.graded_sum ?? 0);
    const totalGraded = gradedFromSummary > 0 ? gradedFromSummary : passSum + failSum;
    const overallPassRate = totalGraded > 0 ? (passSum / totalGraded) * 100 : 0;
    const overallFailRate = totalGraded > 0 ? (failSum / totalGraded) * 100 : 0;

    const deptExportRows = exportsByDept.rows as {
      department: string;
      student_slots: number;
      slice_count: number;
    }[];
    const sortedDeptExports = [...deptExportRows].sort((a, b) => b.student_slots - a.student_slots);
    const mostDeptExport =
      sortedDeptExports.length > 0
        ? { department: sortedDeptExports[0].department, studentSlots: sortedDeptExports[0].student_slots }
        : null;
    const leastDeptExport =
      sortedDeptExports.length > 0
        ? {
            department: sortedDeptExports[sortedDeptExports.length - 1].department,
            studentSlots: sortedDeptExports[sortedDeptExports.length - 1].student_slots,
          }
        : null;

    const subjectExportRows = exportsBySubject.rows as {
      subject_name: string;
      student_slots: number;
      slice_count: number;
    }[];
    const sortedSubjectExports = [...subjectExportRows].sort((a, b) => b.student_slots - a.student_slots);
    const mostSubjectExport =
      sortedSubjectExports.length > 0
        ? { subjectName: sortedSubjectExports[0].subject_name, studentSlots: sortedSubjectExports[0].student_slots }
        : null;
    const leastSubjectExport =
      sortedSubjectExports.length > 0
        ? {
            subjectName: sortedSubjectExports[sortedSubjectExports.length - 1].subject_name,
            studentSlots: sortedSubjectExports[sortedSubjectExports.length - 1].student_slots,
          }
        : null;

    const totalExportSlices = subjectExportRows.reduce((s, r) => s + num(r.slice_count), 0);
    const totalExportStudentSlots = subjectExportRows.reduce((s, r) => s + num(r.student_slots), 0);

    const gradingByDept = (correctionGradingByDept.rows as { department: string; pass_sum: string; fail_sum: string }[]).map(
      (row) => {
        const p = num(row.pass_sum);
        const f = num(row.fail_sum);
        const t = p + f;
        return {
          department: row.department,
          passCount: p,
          failCount: f,
          passRate: t > 0 ? (p / t) * 100 : 0,
          failRate: t > 0 ? (f / t) * 100 : 0,
        };
      }
    );

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      students: {
        total: num(overview.total_students),
        morning: num(overview.morning_students),
        evening: num(overview.evening_students),
        distinctDepartments: num(overview.distinct_departments),
        distinctStages: num(overview.distinct_stages),
        byDepartment: studentsByDept.rows.map((r: { department: string; student_count: number }) => ({
          department: r.department,
          count: num(r.student_count),
        })),
        byStage: studentsByStage.rows.map((r: { stage: string; student_count: number }) => ({
          stage: r.stage,
          count: num(r.student_count),
        })),
        byDepartmentStageStudy: studentsByDeptStageStudy.rows.map(
          (r: { department: string; stage: string; study_type: string; student_count: number }) => ({
            department: r.department,
            stage: r.stage,
            studyType: r.study_type,
            count: num(r.student_count),
          })
        ),
      },
      subjects: {
        referenceCount: num(subjectsRefCount.rows[0]?.c),
        byExportAggregate: studentsPerSubjectFromExports.rows.map(
          (r: { subject_name: string; subject_code: string | null; export_student_slots: number; slice_count: number }) => ({
            subjectName: r.subject_name,
            subjectCode: r.subject_code,
            exportStudentSlots: num(r.export_student_slots),
            sliceCount: num(r.slice_count),
          })
        ),
      },
      sheetExports: {
        totalSlices: totalExportSlices,
        totalStudentSlotsOnSheets: totalExportStudentSlots,
        perExam: exportsPerExam.rows.map(
          (r: { subject_name: string; exam_date: string; student_slots: number; slice_count: number }) => ({
            subjectName: r.subject_name,
            examDate: r.exam_date,
            studentSlots: num(r.student_slots),
            sliceCount: num(r.slice_count),
          })
        ),
        byDepartment: deptExportRows.map((r) => ({
          department: r.department,
          studentSlots: num(r.student_slots),
          sliceCount: num(r.slice_count),
        })),
        mostDepartment: mostDeptExport,
        leastDepartment: leastDeptExport,
        mostSubject: mostSubjectExport,
        leastSubject: leastSubjectExport,
      },
      teachers: { total: num(teachersCount.rows[0]?.c) },
      correction: {
        uploadedBatchesCount: num(batchesCount.rows[0]?.c),
        studentListUploadsCount: num(uploadsCount.rows[0]?.c),
      },
      grading: {
        passCount: passSum,
        failCount: failSum,
        totalGraded,
        overallPassRate,
        overallFailRate,
        byDepartment: gradingByDept,
      },
    });
  } catch (error) {
    console.error("correction dashboard-stats:", error);
    return NextResponse.json(
      { success: false, error: "تعذر تجميع إحصائيات لوحة التصحيح." },
      { status: 500 }
    );
  }
}
