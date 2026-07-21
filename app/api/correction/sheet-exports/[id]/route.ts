import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف غير صالح." }, { status: 400 });
    }
    const result = await query(
      `
      SELECT
        id,
        export_batch_id,
        subject_name,
        subject_code,
        exam_date::text AS exam_date,
        teacher_name,
        COALESCE(department, department_filter) AS department,
        COALESCE(stage, stage_filter) AS stage,
        COALESCE(study_type, study_type_filter) AS study_type,
        student_count,
        created_at,
        report_payload
      FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [id]
    );
    if (!result.rows.length) {
      return NextResponse.json({ success: false, error: "السجل غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ success: true, export: result.rows[0] });
  } catch (error) {
    console.error("sheet-exports [id] GET:", error);
    return NextResponse.json({ success: false, error: "تعذر تحميل التقرير." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف غير صالح." }, { status: 400 });
    }

    await query(
      `
      DELETE FROM examination_committee.omr_result_records
      WHERE exam_id = $1::uuid
      `,
      [id]
    );

    await query(
      `
      DELETE FROM examination_committee.omr_answer_keys
      WHERE sheet_export_id = $1::uuid
      `,
      [id]
    );

    const del = await query(
      `
      DELETE FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      RETURNING id
      `,
      [id]
    );

    if (!del.rows.length) {
      return NextResponse.json({ success: false, error: "السجل غير موجود." }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: del.rows[0]?.id || id });
  } catch (error) {
    console.error("sheet-exports [id] DELETE:", error);
    return NextResponse.json({ success: false, error: "تعذر حذف السجل." }, { status: 500 });
  }
}
