import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export const runtime = "nodejs";

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  question_count: number;
  choices_per_question: number;
  python_template_name: string;
  is_active: boolean;
};

export async function GET() {
  try {
    const result = await query(
      `
      SELECT
        id,
        code,
        name,
        question_count,
        choices_per_question,
        python_template_name,
        is_active
      FROM examination_committee.omr_templates
      WHERE is_active = TRUE
      ORDER BY question_count ASC, code ASC
      `
    );

    const templates = (result.rows as TemplateRow[]).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      questionCount: Number(r.question_count),
      choicesPerQuestion: Number(r.choices_per_question),
      pythonTemplateName: r.python_template_name,
      isActive: Boolean(r.is_active),
    }));

    return NextResponse.json({ success: true, templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر تحميل قوالب OMR.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
