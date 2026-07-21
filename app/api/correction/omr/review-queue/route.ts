import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const examId = String(url.searchParams.get("examId") || "").trim();
    if (!examId) {
      return NextResponse.json({ success: false, error: "examId مطلوب." }, { status: 400 });
    }
    const res = await query(
      `
      SELECT
        id,
        exam_id,
        student_code,
        page_index,
        source_pdf_name,
        comparison,
        review_status,
        normalized_image_url,
        suspicious_crops,
        created_at,
        updated_at
      FROM examination_committee.omr_result_records
      WHERE exam_id = $1::uuid
      ORDER BY page_index ASC, created_at DESC
      `,
      [examId]
    );
    return NextResponse.json({ success: true, queue: res.rows });
  } catch (e) {
    console.error("review-queue GET", e);
    return NextResponse.json({ success: false, error: "تعذر جلب قائمة المراجعة." }, { status: 500 });
  }
}

