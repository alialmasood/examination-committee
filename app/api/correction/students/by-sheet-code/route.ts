import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

function normalizeSheetCode(raw: string | null): string | null {
  const digits = String(raw || "")
    .trim()
    .replace(/\D/g, "");
  const last5 = digits.slice(-5);
  return /^\d{5}$/.test(last5) ? last5 : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = normalizeSheetCode(searchParams.get("code"));
    if (!code) {
      return NextResponse.json({ success: false, error: "كود الورقة غير صالح." }, { status: 400 });
    }

    const result = await query(
      `
      SELECT student_name, department, stage, study_type, student_code, sheet_code
      FROM examination_committee.correction_students
      WHERE sheet_code = $1
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
      [code]
    );

    if (!result.rows.length) {
      return NextResponse.json({ success: false, error: "لم يُعثر على طالب بهذا الكود." }, { status: 404 });
    }

    const row = result.rows[0] as {
      student_name: string;
      department: string;
      stage: string;
      study_type: string;
      student_code: string;
      sheet_code: string;
    };
    return NextResponse.json({
      success: true,
      student: {
        student_name: row.student_name,
        department: row.department,
        stage: row.stage,
        study_type: row.study_type,
        student_code: row.student_code,
        sheet_code: row.sheet_code,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر جلب بيانات الطالب." }, { status: 500 });
  }
}
