import { NextRequest, NextResponse } from "next/server";
import { query } from "@/src/lib/db";

function normalizeStudyType(value: string): "morning" | "evening" | null {
  const text = String(value || "").trim().toLowerCase();
  if (text === "morning" || text.includes("صباح")) return "morning";
  if (text === "evening" || text.includes("مسائ") || text.includes("مساء")) return "evening";
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const studyType = normalizeStudyType(body.study_type);
    const sequenceNo = body.sequence_no === "" || body.sequence_no === null ? null : Number(body.sequence_no);
    const studentCode = String(body.student_code || "").trim();
    const department = String(body.department || "").trim();
    const studentName = String(body.student_name || "").trim();
    const stage = String(body.stage || "").trim();
    const sheetCode = String(body.sheet_code || "").trim();

    if (!studentCode || !department || !studentName || !stage || !studyType || !/^\d{5}$/.test(sheetCode)) {
      return NextResponse.json({ success: false, error: "تحقق من القيم المدخلة." }, { status: 400 });
    }

    const res = await query(
      `
      UPDATE examination_committee.correction_students
      SET sequence_no=$2, student_code=$3, department=$4, student_name=$5, stage=$6, study_type=$7, sheet_code=$8
      WHERE id=$1
      RETURNING id
      `,
      [id, sequenceNo, studentCode, department, studentName, stage, studyType, sheetCode]
    );
    if (!res.rows.length) {
      return NextResponse.json({ success: false, error: "الطالب غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error && error.message.includes("duplicate")
      ? "كود الورقة موجود مسبقًا."
      : "تعذر تعديل الطالب.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await query(`DELETE FROM examination_committee.correction_students WHERE id=$1 RETURNING id`, [id]);
    if (!res.rows.length) {
      return NextResponse.json({ success: false, error: "الطالب غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر حذف الطالب." }, { status: 500 });
  }
}
