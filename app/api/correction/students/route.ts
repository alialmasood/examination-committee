import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export async function GET() {
  try {
    const [studentsResult, statsResult, uploadsResult, stagesResult] = await Promise.all([
      query(`
      SELECT id, sequence_no, student_code, department, student_name, stage, study_type, sheet_code, source_file, created_at
      FROM examination_committee.correction_students
      ORDER BY created_at DESC, sequence_no ASC NULLS LAST
    `),
      query(`
      SELECT
        COUNT(*)::int AS total_students,
        COUNT(*) FILTER (WHERE study_type = 'morning')::int AS morning_students,
        COUNT(*) FILTER (WHERE study_type = 'evening')::int AS evening_students,
        COUNT(DISTINCT department)::int AS departments_count
      FROM examination_committee.correction_students
    `),
      query(`
      SELECT id, file_name, inserted_count, created_at
      FROM examination_committee.correction_uploads
      ORDER BY created_at DESC
    `),
      query(`
      SELECT DISTINCT trim_stage AS stage
      FROM (
        SELECT NULLIF(TRIM(stage), '') AS trim_stage
        FROM examination_committee.correction_students
        UNION
        SELECT NULLIF(TRIM(COALESCE(stage, stage_filter, '')), '') AS trim_stage
        FROM examination_committee.correction_sheet_exports
      ) t
      WHERE trim_stage IS NOT NULL
      ORDER BY stage
    `),
    ]);

    const knownStages = (stagesResult.rows as { stage: string }[]).map((r) => r.stage).filter(Boolean);

    return NextResponse.json({
      success: true,
      students: studentsResult.rows,
      stats: statsResult.rows[0] || {
        total_students: 0,
        morning_students: 0,
        evening_students: 0,
        departments_count: 0,
      },
      uploads: uploadsResult.rows,
      knownStages,
    });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر جلب بيانات الطلبة." }, { status: 500 });
  }
}
