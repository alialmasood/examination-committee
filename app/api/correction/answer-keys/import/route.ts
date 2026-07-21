import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/src/lib/db";
import { isAnswerKeyQuestionTotal, validateAnswersObject } from "@/src/lib/correction/answer-key-validation";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

/** يحوّل الصفوف إلى خريطة إجابات مع فحص التكرار */
function rowsToAnswerMap(rows: unknown[][], totalQuestions: number, options: string[]): { ok: true; answers: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const c0 = row[0];
    const c1 = row[1];
    const s0 = c0 != null ? String(c0).trim() : "";
    const s1 = c1 != null ? String(c1).trim() : "";
    if (!s0 || !s1) continue;
    const head = s0.toLowerCase();
    if (head === "question" || head === "questionnumber" || head === "سؤال" || head === "q" || head === "#") continue;
    const qn = Number(s0.replace(/[^\d]/g, ""));
    if (!Number.isFinite(qn) || qn < 1 || qn > totalQuestions) continue;
    if (seen.has(qn)) {
      return { ok: false, error: `السؤال ${qn} مكرر في الملف.` };
    }
    const letter = s1.toUpperCase();
    if (!options.includes(letter)) continue;
    seen.add(qn);
    out[String(qn)] = letter;
  }
  const val = validateAnswersObject(out, { totalQuestions, options });
  if (!val.ok) return { ok: false, error: val.error };
  return { ok: true, answers: val.answers };
}

function buildDefaultQuestionScores(totalQuestions: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let q = 1; q <= totalQuestions; q++) out[String(q)] = 1;
  return out;
}

export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { success: false, error: "أرسل multipart/form-data مع الحقل file و sheetExportId." },
        { status: 400 }
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    const sheetExportId = String(form.get("sheetExportId") || "").trim();
    const totalQuestionsRaw = Math.floor(Number(form.get("totalQuestions") || 25));
    if (!isAnswerKeyQuestionTotal(totalQuestionsRaw)) {
      return NextResponse.json(
        { success: false, error: "عدد الأسئلة يجب أن يكون 25 أو 50 أو 75 أو 100." },
        { status: 400 }
      );
    }
    const totalQuestions = totalQuestionsRaw;
    const optionsRaw = String(form.get("options") || "A,B,C,D")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    const options = optionsRaw.length >= 2 ? optionsRaw : ["A", "B", "C", "D"];
    if (!sheetExportId) {
      return NextResponse.json({ success: false, error: "sheetExportId مطلوب." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب (.xlsx)." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "الملف كبير جدًا (الحد 4 ميجابايت)." }, { status: 400 });
    }

    const wb = XLSX.read(buf, { type: "buffer" });
    const name = wb.SheetNames[0];
    if (!name) {
      return NextResponse.json({ success: false, error: "الملف لا يحتوي أوراقًا." }, { status: 400 });
    }
    const ws = wb.Sheets[name];
    if (!ws) {
      return NextResponse.json({ success: false, error: "تعذر قراءة الورقة الأولى." }, { status: 400 });
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    const parsed = rowsToAnswerMap(rows, totalQuestions, options);
    if (!parsed.ok) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error,
        },
        { status: 400 }
      );
    }
    const answers = parsed.answers;
    const questionScores = buildDefaultQuestionScores(totalQuestions);

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
      return NextResponse.json({ success: false, error: "سجل التصدير غير موجود." }, { status: 404 });
    }
    const subjectName = String(row.subject_name || "").trim();
    const subjectCode = String(row.subject_code || "").trim();
    const examDate = String(row.exam_date || "").trim();
    if (!subjectName || !examDate) {
      return NextResponse.json({ success: false, error: "بيانات سجل التصدير غير مكتملة." }, { status: 400 });
    }

    await query(
      `
      INSERT INTO examination_committee.omr_answer_keys
        (subject_name, exam_date, academic_year, total_questions, options_set, answer_key, question_scores, score_mode, fixed_question_score, subject_code, sheet_export_id)
      VALUES ($1, $2::date, '2025-2026', $3::int, $4::jsonb, $5::jsonb, $6::jsonb, 'variable', NULL, NULLIF($7, ''), $8::uuid)
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
        JSON.stringify(answers),
        JSON.stringify(questionScores),
        subjectCode,
        sheetExportId,
      ]
    );

    return NextResponse.json({ success: true, imported: true });
  } catch (e) {
    console.error("answer-keys import", e);
    return NextResponse.json({ success: false, error: "تعذر استيراد الملف." }, { status: 500 });
  }
}
