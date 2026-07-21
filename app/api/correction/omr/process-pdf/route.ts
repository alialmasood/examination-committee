import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";
import { compareStudentAnswersToAnswerKey } from "@/src/lib/omr/compare";

export const runtime = "nodejs";

const OMR_PYTHON_URL = process.env.OMR_PYTHON_URL || "http://127.0.0.1:8001";

type PythonAnswer = {
  questionNumber: number;
  selectedOption: string | null;
  status: "answered" | "blank" | "multiple" | "uncertain";
  confidence: number;
  bubbleScores: Record<string, number>;
};

type PythonPageResult = {
  pageIndex: number;
  studentCode: string | null;
  studentCodeConfidence?: number;
  studentCodeDetection?: {
    studentCode: string | null;
    digits: {
      columnIndex: number;
      detectedDigit: number | null;
      confidence: number;
      scores: Record<number, number>;
      status: "ok" | "blank" | "multiple" | "uncertain";
    }[];
    confidence: number;
  };
  answers: PythonAnswer[];
  needsReview: boolean;
  errors: string[];
  debugImages?: Record<string, string>;
};

type PythonImageResult = {
  success?: boolean;
  studentCode?: string | null;
  answers?: PythonAnswer[];
  needsReview?: boolean;
  errors?: string[];
  debugImages?: Record<string, string>;
};

function toDataUrl(b64: string): string {
  if (!b64) return "";
  return `data:image/png;base64,${b64}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sheetExportId = String(form.get("sheetExportId") || "").trim();
    const debugMode = String(form.get("debugMode") || "").trim() === "1";
    const templateCode = String(form.get("templateCode") || "OMR_25").trim().toUpperCase();

    if (!sheetExportId) {
      return NextResponse.json({ success: false, error: "sheetExportId مطلوب." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب (صورة)." }, { status: 400 });
    }
    const isImageFile =
      file.type.toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name || "");
    if (!isImageFile) {
      return NextResponse.json(
        {
          success: false,
          error: "النسخة الحالية تدعم رفع صورة فقط (PNG/JPG/JPEG/WEBP/BMP/TIFF).",
        },
        { status: 400 }
      );
    }

    const exportQ = await query(
      `
      SELECT id, subject_name, exam_date::text AS exam_date
      FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );
    const exportRow = exportQ.rows[0] as { id: string; subject_name: string; exam_date: string } | undefined;
    if (!exportRow) {
      return NextResponse.json({ success: false, error: "الامتحان غير موجود." }, { status: 404 });
    }

    const keyQ = await query(
      `
      SELECT total_questions, answer_key
      FROM examination_committee.omr_answer_keys
      WHERE sheet_export_id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );
    const keyRow = keyQ.rows[0] as { total_questions?: number; answer_key?: unknown } | undefined;
    if (!keyRow?.answer_key || typeof keyRow.answer_key !== "object") {
      return NextResponse.json(
        { success: false, error: "لا يوجد مفتاح إجابة لهذا الامتحان. احفظه أولًا من صفحة مفتاح الإجابة." },
        { status: 400 }
      );
    }
    const answerKey: Record<number, string> = {};
    for (const [k, v] of Object.entries(keyRow.answer_key as Record<string, unknown>)) {
      const q = Number(k);
      if (!Number.isFinite(q) || q < 1) continue;
      answerKey[q] = String(v || "").toUpperCase().trim();
    }
    let templateQuestionCount = 25;
    let pythonTemplateName = "correction-exam-a4-v1";
    try {
      const tplQ = await query(
        `
        SELECT question_count, python_template_name
        FROM examination_committee.omr_templates
        WHERE code = $1 AND is_active = TRUE
        LIMIT 1
        `,
        [templateCode]
      );
      const tplRow = tplQ.rows[0] as { question_count?: number; python_template_name?: string } | undefined;
      if (tplRow?.question_count && Number.isFinite(Number(tplRow.question_count))) {
        templateQuestionCount = Number(tplRow.question_count);
      }
      if (tplRow?.python_template_name) {
        pythonTemplateName = String(tplRow.python_template_name);
      }
    } catch {
      // fallback على القالب الافتراضي إذا فشل استعلام القوالب.
    }

    const totalQuestions = Number(keyRow.total_questions || Object.keys(answerKey).length || templateQuestionCount || 25);

    // النسخة الحالية: تفويض تحليل صورة واحدة لخدمة Python.
    const pyForm = new FormData();
    pyForm.set("templateName", pythonTemplateName);
    pyForm.set("debugMode", debugMode ? "1" : "0");
    pyForm.set("runLabel", `exam-${sheetExportId}`);
    pyForm.set("file", file);
    let pyRes: Response;
    try {
      pyRes = await fetch(`${OMR_PYTHON_URL}/analyze-image`, {
        method: "POST",
        body: pyForm,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "");
      if (msg.includes("ECONNREFUSED") || msg.toLowerCase().includes("fetch failed")) {
        return NextResponse.json(
          {
            success: false,
            error:
              `تعذر الاتصال بخدمة OMR Python على ${OMR_PYTHON_URL}. شغّل الخدمة أولًا: ` +
              `cd services/omr-python && python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload`,
          },
          { status: 503 }
        );
      }
      throw err;
    }
    const pyJson = (await pyRes.json()) as PythonImageResult;
    if (!pyRes.ok || !pyJson.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            (Array.isArray(pyJson.errors) && pyJson.errors[0]) ||
            "فشل تحليل الصورة من خدمة Python. تأكد أن الخدمة تعمل على OMR_PYTHON_URL.",
        },
        { status: 500 }
      );
    }

    const page: PythonPageResult = {
      pageIndex: 0,
      studentCode: pyJson.studentCode ?? null,
      answers: Array.isArray(pyJson.answers) ? pyJson.answers : [],
      needsReview: Boolean(pyJson.needsReview),
      errors: Array.isArray(pyJson.errors) ? pyJson.errors : [],
      debugImages: pyJson.debugImages || {},
    };

    const detectedAnswers = Array.from({ length: totalQuestions }, (_, i) => i + 1).map((q) => {
      const row = page.answers.find((a) => a.questionNumber === q);
      return {
        questionNumber: q,
        selectedOption: row?.selectedOption ?? null,
        status: row?.status ?? "blank",
        confidence: Number(row?.confidence ?? 0),
        bubbleScores: row?.bubbleScores ?? {},
      };
    });

    const comparison = compareStudentAnswersToAnswerKey(
      detectedAnswers.map((a) => ({
        questionNumber: a.questionNumber,
        selectedOption: a.selectedOption,
        status: a.status,
        confidence: a.confidence,
      })),
      answerKey
    );

    const needsReview =
      !page.studentCode ||
      detectedAnswers.some((a) => a.status === "uncertain" || a.status === "multiple" || a.confidence < 0.35);
    const reviewStatus = needsReview ? "pending" : "approved";

    await query(
      `
      INSERT INTO examination_committee.omr_result_records
        (
          exam_id,
          student_code,
          page_index,
          source_pdf_name,
          detected_answers,
          comparison,
          review_status
        )
      VALUES
        ($1::uuid, $2, $3::int, $4, $5::jsonb, $6::jsonb, $7)
      `,
      [
        sheetExportId,
        page.studentCode || null,
        page.pageIndex + 1,
        file.name || "uploaded-image",
        JSON.stringify(detectedAnswers),
        JSON.stringify(comparison),
        reviewStatus,
      ]
    );

    const debug = page.debugImages
      ? {
          original: toDataUrl(page.debugImages["original page image"] || page.debugImages.original || ""),
          grayscale: toDataUrl(page.debugImages.grayscale || ""),
          thresholded: toDataUrl(page.debugImages.thresholded || ""),
          detectedSheetContour: toDataUrl(page.debugImages["detected sheet contour"] || page.debugImages.contour || ""),
          warpedSheet: toDataUrl(page.debugImages["warped sheet"] || page.debugImages.warped || ""),
          roiOverlay: toDataUrl(page.debugImages["roi overlay"] || page.debugImages.roiOverlay || ""),
          markedBubbles: toDataUrl(page.debugImages["marked bubbles"] || page.debugImages.markedBubbles || ""),
        }
      : undefined;

    const finalPage = {
      pageIndex: page.pageIndex + 1,
      success: true,
      studentCode: page.studentCode,
      studentCodeConfidence: page.studentCodeConfidence ?? page.studentCodeDetection?.confidence ?? 0,
      studentCodeDetection: page.studentCodeDetection,
      studentName: null,
      detectedAnswers,
      comparison,
      errors: page.errors || [],
      debugImages: debug ? Object.values(debug).filter(Boolean) : [],
      debug,
    };

    return NextResponse.json({
      success: true,
      mode: "python-fastapi-prototype-single-page",
      templateCode,
      pythonTemplateName,
      exam: {
        id: exportRow.id,
        subject_name: exportRow.subject_name,
        exam_date: exportRow.exam_date,
      },
      totalPages: 1,
      successPages: 1,
      failedPages: 0,
      manualReviewPages: needsReview ? 1 : 0,
      results: [finalPage],
      note: "نسخة تجريبية: تمت معالجة صورة واحدة عبر خدمة Python.",
    });
  } catch (e) {
    console.error("omr process pdf python proxy", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "تعذر معالجة PDF عبر خدمة Python." },
      { status: 500 }
    );
  }
}
