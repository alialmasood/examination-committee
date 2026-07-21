import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";
import {
  isAnswerKeyQuestionTotal,
  normalizeAnswerKeyQuestionTotal,
  validateAnswersObject,
} from "@/src/lib/correction/answer-key-validation";

type ExamAnswerKey = {
  id: string;
  examId: string;
  totalQuestions: number;
  options: string[];
  answers: Record<number, string>;
  questionScores: Record<number, number>;
  scoreMode: "fixed" | "variable";
  fixedQuestionScore: number | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeOptionsDb(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out = raw
      .map((x) => String(x || "").trim().toUpperCase())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    if (out.length >= 2) return out;
  }
  return ["A", "B", "C", "D"];
}

function mapDbRowToExamAnswerKey(row: Record<string, unknown> | null | undefined): ExamAnswerKey | null {
  if (!row) return null;
  const answersRaw = row.answer_key;
  const answersOut: Record<number, string> = {};
  if (answersRaw && typeof answersRaw === "object") {
    const o = answersRaw as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      const q = Number(k);
      if (!Number.isFinite(q) || q < 1) continue;
      if (typeof v !== "string") continue;
      answersOut[q] = v.toUpperCase().trim();
    }
  }
  const scoreModeRaw = String(row.score_mode || "variable").toLowerCase();
  const scoreMode: "fixed" | "variable" = scoreModeRaw === "fixed" ? "fixed" : "variable";
  const fixedRaw = Number(row.fixed_question_score);
  const fixedQuestionScore = Number.isFinite(fixedRaw) && fixedRaw >= 0 ? fixedRaw : null;
  const scoresRaw = row.question_scores;
  const questionScoresOut: Record<number, number> = {};
  if (scoresRaw && typeof scoresRaw === "object") {
    const o = scoresRaw as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      const q = Number(k);
      if (!Number.isFinite(q) || q < 1) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      questionScoresOut[q] = n;
    }
  }
  const normalizedTotalQ = normalizeAnswerKeyQuestionTotal(Number(row.total_questions ?? 25));
  for (let q = 1; q <= normalizedTotalQ; q++) {
    if (!Number.isFinite(questionScoresOut[q])) questionScoresOut[q] = 1;
  }
  return {
    id: String(row.id || ""),
    examId: String(row.sheet_export_id || ""),
    totalQuestions: normalizedTotalQ,
    options: normalizeOptionsDb(row.options_set),
    answers: answersOut,
    questionScores: questionScoresOut,
    scoreMode,
    fixedQuestionScore,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sheetExportId = url.searchParams.get("sheetExportId")?.trim();

    if (sheetExportId) {
      const r = await query(
        `
        SELECT
          id,
          subject_name,
          subject_code,
          exam_date::text AS exam_date,
          total_questions,
          options_set,
          answer_key,
          question_scores,
          score_mode,
          fixed_question_score,
          created_at,
          updated_at,
          sheet_export_id
        FROM examination_committee.omr_answer_keys
        WHERE sheet_export_id = $1::uuid
        LIMIT 1
        `,
        [sheetExportId]
      );
      return NextResponse.json({
        success: true,
        key: r.rows[0] || null,
        examAnswerKey: mapDbRowToExamAnswerKey((r.rows[0] as Record<string, unknown>) || null),
      });
    }

    const subjectName = url.searchParams.get("subjectName")?.trim();
    const examDate = url.searchParams.get("examDate")?.trim();

    if (subjectName && examDate) {
      const r = await query(
        `
        SELECT id, subject_name, subject_code, exam_date::text AS exam_date, total_questions, options_set, answer_key, question_scores, score_mode, fixed_question_score, created_at, updated_at, sheet_export_id
        FROM examination_committee.omr_answer_keys
        WHERE subject_name = $1 AND exam_date = $2::date
        LIMIT 1
        `,
        [subjectName, examDate]
      );
      return NextResponse.json({
        success: true,
        key: r.rows[0] || null,
        examAnswerKey: mapDbRowToExamAnswerKey((r.rows[0] as Record<string, unknown>) || null),
      });
    }

    const list = await query(`
      SELECT id, subject_name, subject_code, exam_date::text AS exam_date, total_questions, options_set, question_scores, score_mode, fixed_question_score, updated_at, created_at, sheet_export_id
      FROM examination_committee.omr_answer_keys
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    return NextResponse.json({
      success: true,
      keys: list.rows,
      examAnswerKeys: list.rows.map((r) => mapDbRowToExamAnswerKey(r as Record<string, unknown>)),
    });
  } catch (e) {
    console.error("answer-keys GET", e);
    return NextResponse.json({ success: false, error: "تعذر جلب مفاتيح الإجابة." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sheetExportId = String(body.sheetExportId || "").trim();
    const subjectCode = body.subjectCode != null ? String(body.subjectCode).trim() : "";
    const totalQuestionsRaw = Math.floor(Number(body.totalQuestions ?? 25));
    if (!isAnswerKeyQuestionTotal(totalQuestionsRaw)) {
      return NextResponse.json(
        { success: false, error: "عدد الأسئلة يجب أن يكون 25 أو 50 أو 75 أو 100." },
        { status: 400 }
      );
    }
    const totalQuestions = totalQuestionsRaw;
    const options = Array.isArray(body.options)
      ? body.options.map((x: unknown) => String(x || "").trim().toUpperCase()).filter(Boolean)
      : ["A", "B", "C", "D"];

    if (!sheetExportId) {
      return NextResponse.json(
        { success: false, error: "يجب اختيار امتحان مكوّن (من الامتحانات المكونة) قبل الحفظ." },
        { status: 400 }
      );
    }

    const val = validateAnswersObject(body.answers, { totalQuestions, options });
    if (!val.ok) {
      return NextResponse.json({ success: false, error: val.error }, { status: 400 });
    }
    const scoreModeRaw = String(body.scoreMode || "variable").toLowerCase();
    const scoreMode: "fixed" | "variable" = scoreModeRaw === "fixed" ? "fixed" : "variable";
    const fixedRaw = Number(body.fixedQuestionScore);
    const fixedQuestionScore = Number.isFinite(fixedRaw) && fixedRaw >= 0 ? fixedRaw : null;
    if (scoreMode === "fixed" && fixedQuestionScore == null) {
      return NextResponse.json(
        { success: false, error: "أدخل درجة ثابتة صحيحة لكل سؤال (رقم >= 0)." },
        { status: 400 }
      );
    }
    const questionScoresIn = body.questionScores && typeof body.questionScores === "object" ? body.questionScores : {};
    const questionScores: Record<string, number> = {};
    for (let q = 1; q <= totalQuestions; q++) {
      const n =
        scoreMode === "fixed"
          ? Number(fixedQuestionScore)
          : Number((questionScoresIn as Record<string, unknown>)[String(q)]);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { success: false, error: `درجة السؤال ${q} غير صالحة. أدخل رقمًا أكبر أو يساوي صفر.` },
          { status: 400 }
        );
      }
      questionScores[String(q)] = n;
    }

    const ex = await query(
      `
      SELECT id, subject_name, subject_code, exam_date::text AS exam_date
      FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );
    const row = ex.rows[0] as
      | { id: string; subject_name: string; subject_code: string | null; exam_date: string }
      | undefined;
    if (!row) {
      return NextResponse.json({ success: false, error: "لم يُعثَر على سجل الامتحان المكوّن." }, { status: 404 });
    }

    const subjectName = String(row.subject_name || "").trim();
    const subjectCodeFromExport = String(row.subject_code || "").trim();
    const effectiveSubjectCode = subjectCodeFromExport || subjectCode;
    const examDate = String(row.exam_date || "").trim();
    if (!subjectName || !examDate) {
      return NextResponse.json({ success: false, error: "بيانات سجل التصدير غير مكتملة." }, { status: 400 });
    }

    await query(
      `
      INSERT INTO examination_committee.omr_answer_keys
        (subject_name, exam_date, academic_year, total_questions, options_set, answer_key, question_scores, score_mode, fixed_question_score, subject_code, sheet_export_id)
      VALUES ($1, $2::date, '2025-2026', $3::int, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, NULLIF($9, ''), $10::uuid)
      ON CONFLICT (sheet_export_id)
      DO UPDATE SET
        subject_name = EXCLUDED.subject_name,
        exam_date = EXCLUDED.exam_date,
        total_questions = EXCLUDED.total_questions,
        options_set = EXCLUDED.options_set,
        answer_key = EXCLUDED.answer_key,
        question_scores = EXCLUDED.question_scores,
        score_mode = EXCLUDED.score_mode,
        fixed_question_score = EXCLUDED.fixed_question_score,
        subject_code = COALESCE(NULLIF(EXCLUDED.subject_code, ''), examination_committee.omr_answer_keys.subject_code),
        updated_at = NOW()
      `,
      [
        subjectName,
        examDate,
        totalQuestions,
        JSON.stringify(options),
        JSON.stringify(val.answers),
        JSON.stringify(questionScores),
        scoreMode,
        scoreMode === "fixed" ? fixedQuestionScore : null,
        effectiveSubjectCode,
        sheetExportId,
      ]
    );

    const saved = await query(
      `
      SELECT id, sheet_export_id, total_questions, options_set, answer_key, question_scores, score_mode, fixed_question_score, created_at, updated_at
      FROM examination_committee.omr_answer_keys
      WHERE sheet_export_id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );

    return NextResponse.json({
      success: true,
      examAnswerKey: mapDbRowToExamAnswerKey((saved.rows[0] as Record<string, unknown>) || null),
    });
  } catch (e) {
    console.error("answer-keys POST", e);
    return NextResponse.json(
      {
        success: false,
        error:
          "تعذر حفظ مفتاح الإجابة. تأكد من تطبيق هجرة قاعدة البيانات (عمود sheet_export_id وفهرس فريد عليه).",
      },
      { status: 500 }
    );
  }
}
