import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";
import { compareStudentAnswersToAnswerKey } from "@/src/lib/omr/compare";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const id = String(rawId || "").trim();
    if (!id) return NextResponse.json({ success: false, error: "id مطلوب." }, { status: 400 });
    const res = await query(
      `
      SELECT *
      FROM examination_committee.omr_result_records
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [id]
    );
    if (!res.rows.length) {
      return NextResponse.json({ success: false, error: "السجل غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ success: true, record: res.rows[0] });
  } catch (e) {
    console.error("review-queue/[id] GET", e);
    return NextResponse.json({ success: false, error: "تعذر جلب السجل." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const id = String(rawId || "").trim();
    if (!id) return NextResponse.json({ success: false, error: "id مطلوب." }, { status: 400 });
    const body = await request.json();
    const studentCode = body.studentCode != null ? String(body.studentCode).trim() : "";
    const reviewStatus = String(body.reviewStatus || "reviewed").trim();

    const recQ = await query(
      `
      SELECT id, exam_id, detected_answers
      FROM examination_committee.omr_result_records
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [id]
    );
    if (!recQ.rows.length) {
      return NextResponse.json({ success: false, error: "السجل غير موجود." }, { status: 404 });
    }
    type DetectedAnswerRow = {
      questionNumber: number;
      selectedOption: string | null;
      status: string;
      confidence: number;
      bubbleScores?: Record<string, number>;
    };
    const rec = recQ.rows[0] as { id: string; exam_id: string; detected_answers: unknown };
    const detected: DetectedAnswerRow[] = Array.isArray(rec.detected_answers)
      ? (rec.detected_answers as DetectedAnswerRow[])
      : [];
    const manualAnswers = body.manualAnswers && typeof body.manualAnswers === "object" ? (body.manualAnswers as Record<string, string | null>) : {};

    const merged = detected.map((q) => {
      const n = Number(q.questionNumber);
      const key = String(n);
      const manual = manualAnswers[key];
      if (manual == null || String(manual).trim() === "") {
        return q;
      }
      return {
        ...q,
        selectedOption: String(manual).toUpperCase().trim(),
        status: "answered",
        confidence: Math.max(0.75, Number(q.confidence || 0)),
      };
    });

    const keyQ = await query(
      `
      SELECT answer_key
      FROM examination_committee.omr_answer_keys
      WHERE sheet_export_id = $1::uuid
      LIMIT 1
      `,
      [rec.exam_id]
    );
    if (!keyQ.rows.length || !keyQ.rows[0]?.answer_key || typeof keyQ.rows[0].answer_key !== "object") {
      return NextResponse.json({ success: false, error: "لا يوجد مفتاح إجابة مرتبط بهذا الامتحان." }, { status: 400 });
    }
    const keyObj = keyQ.rows[0].answer_key as Record<string, string>;
    const answerKey: Record<number, string> = {};
    for (const [k, v] of Object.entries(keyObj)) {
      const q = Number(k);
      if (Number.isFinite(q) && q > 0) answerKey[q] = String(v).toUpperCase().trim();
    }

    const cmp = compareStudentAnswersToAnswerKey(
      merged.map((x) => ({
        questionNumber: Number(x.questionNumber),
        selectedOption: x.selectedOption ?? null,
        status: String(x.status || "blank"),
        confidence: Number(x.confidence || 0),
      })),
      answerKey
    );

    await query(
      `
      UPDATE examination_committee.omr_result_records
      SET
        student_code = NULLIF($2, ''),
        detected_answers = $3::jsonb,
        comparison = $4::jsonb,
        review_status = $5,
        updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [id, studentCode, JSON.stringify(merged), JSON.stringify(cmp), reviewStatus]
    );

    const out = await query(`SELECT * FROM examination_committee.omr_result_records WHERE id = $1::uuid LIMIT 1`, [id]);
    return NextResponse.json({ success: true, record: out.rows[0] || null });
  } catch (e) {
    console.error("review-queue/[id] PATCH", e);
    return NextResponse.json({ success: false, error: "تعذر تحديث نتيجة المراجعة." }, { status: 500 });
  }
}

