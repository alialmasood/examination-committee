import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { pool, query } from "@/src/lib/db";

type SliceBody = {
  department?: string;
  stage?: string;
  studyType?: string;
  students?: unknown[];
};

export async function GET() {
  try {
    const result = await query(
      `
      SELECT
        id,
        export_batch_id,
        subject_name,
        subject_code,
        exam_date::text AS exam_date,
        teacher_name,
        department_filter,
        stage_filter,
        study_type_filter,
        COALESCE(department, department_filter) AS department,
        COALESCE(stage, stage_filter) AS stage,
        COALESCE(study_type, study_type_filter) AS study_type,
        student_count,
        created_at,
        (report_payload IS NOT NULL) AS has_report,
        EXISTS (
          SELECT 1
          FROM examination_committee.omr_answer_keys k
          WHERE k.sheet_export_id = e.id
        ) AS has_answer_key
      FROM examination_committee.correction_sheet_exports e
      ORDER BY created_at DESC
      LIMIT 500
      `
    );
    return NextResponse.json({ success: true, exports: result.rows });
  } catch (error) {
    console.error("sheet-exports GET:", error);
    return NextResponse.json(
      { success: false, error: "تعذر تحميل السجل.", exports: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const subjectName = String(body.subjectName || "").trim();
  const subjectCode = body.subjectCode != null ? String(body.subjectCode).trim() : "";
  const examDate = String(body.examDate || "").trim();
  const teacherName = String(body.teacherName || "").trim();
  const templateCode = String(body.templateCode || "OMR_25").trim().toUpperCase();
  const templateImageName = String(body.templateImageName || "").trim();
  const totalQuestionsRaw = Number(body.totalQuestions);
  const totalQuestions = Number.isFinite(totalQuestionsRaw)
    ? Math.max(1, Math.min(100, Math.floor(totalQuestionsRaw)))
    : 25;
  const exportBatchIdRaw = body.exportBatchId != null ? String(body.exportBatchId).trim() : "";
  const slices = Array.isArray(body.slices) ? (body.slices as SliceBody[]) : [];

  if (!subjectName || !examDate) {
    return NextResponse.json(
      { success: false, error: "اسم المادة وتاريخ الامتحان مطلوبان للحفظ." },
      { status: 400 }
    );
  }
  if (!teacherName) {
    return NextResponse.json(
      { success: false, error: "اسم أستاذ المادة مطلوب." },
      { status: 400 }
    );
  }
  if (!slices.length) {
    return NextResponse.json(
      { success: false, error: "لا توجد شرائح طلبة للحفظ." },
      { status: 400 }
    );
  }

  const exportBatchId = exportBatchIdRaw || randomUUID();

  const client = await pool.connect();
  try {
    const inserted: { id: string; department: string; stage: string; study_type: string; student_count: number }[] = [];

    await client.query("BEGIN");

    for (const slice of slices) {
      const department = String(slice.department || "").trim();
      const stage = String(slice.stage || "").trim();
      const studyType = String(slice.studyType || "").trim();
      const students = Array.isArray(slice.students) ? slice.students : [];

      if (!department || !stage || !studyType) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "كل شريحة يجب أن تحتوي قسمًا ومرحلة ونوع دراسة." },
          { status: 400 }
        );
      }
      if (studyType !== "morning" && studyType !== "evening") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "نوع الدراسة في الشريحة غير صالح." },
          { status: 400 }
        );
      }
      if (!students.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "إحدى الشرائح لا تحتوي طلبة." },
          { status: 400 }
        );
      }

      const savedAt = new Date().toISOString();
      const reportPayload = {
        version: 1,
        exportBatchId,
        subjectName,
        subjectCode,
        examDate,
        teacherName,
        templateCode,
        templateImageName: templateImageName || null,
        totalQuestions,
        department,
        stage,
        studyType,
        studentCount: students.length,
        students,
        savedAt,
      };

      const ins = await client.query(
        `
        INSERT INTO examination_committee.correction_sheet_exports
          (
            subject_name,
            subject_code,
            exam_date,
            teacher_name,
            department_filter,
            stage_filter,
            study_type_filter,
            student_count,
            export_batch_id,
            department,
            stage,
            study_type,
            report_payload
          )
        VALUES (
          $1,
          NULLIF($2, ''),
          $3::date,
          NULLIF($4, ''),
          $5,
          $6,
          $7,
          $8,
          $9::uuid,
          $5,
          $6,
          $7,
          $10::jsonb
        )
        RETURNING id, department, stage, study_type, student_count
        `,
        [
          subjectName,
          subjectCode,
          examDate,
          teacherName,
          department,
          stage,
          studyType,
          students.length,
          exportBatchId,
          JSON.stringify(reportPayload),
        ]
      );

      const row = ins.rows[0];
      inserted.push({
        id: row.id,
        department: row.department,
        stage: row.stage,
        study_type: row.study_type,
        student_count: row.student_count,
      });
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      exportBatchId,
      inserted,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("sheet-exports POST:", error);
    return NextResponse.json(
      { success: false, error: "تعذر حفظ سجلات التصدير." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
