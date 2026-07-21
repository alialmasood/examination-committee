import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export const runtime = "nodejs";

const OMR_PYTHON_URL = process.env.OMR_PYTHON_URL || "http://127.0.0.1:8001";

type PythonAnswer = {
  questionNumber: number;
  selectedOption: string | null;
  status: "answered" | "blank" | "multiple" | "uncertain";
  confidence: number;
};

type PythonAnalyzeResponse = {
  success?: boolean;
  studentCode?: string | null;
  answers?: PythonAnswer[];
  needsReview?: boolean;
  errors?: string[];
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const templateCode = String(form.get("templateCode") || "OMR_25").trim().toUpperCase();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب." }, { status: 400 });
    }
    const isImageFile =
      file.type.toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name || "");
    if (!isImageFile) {
      return NextResponse.json({ success: false, error: "التحقق يدعم الصور فقط حاليًا." }, { status: 400 });
    }

    let questionCount = 25;
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
      const tpl = tplQ.rows[0] as { question_count?: number; python_template_name?: string } | undefined;
      if (tpl?.question_count) questionCount = Math.max(1, Math.min(100, Number(tpl.question_count)));
      if (tpl?.python_template_name) pythonTemplateName = String(tpl.python_template_name);
    } catch {
      // fallback إلى القيم الافتراضية
    }

    const pyForm = new FormData();
    pyForm.set("templateName", pythonTemplateName);
    pyForm.set("debugMode", "0");
    pyForm.set("runLabel", `calib-validate-${Date.now()}`);
    pyForm.set("file", file);

    let pyRes: Response;
    try {
      pyRes = await fetch(`${OMR_PYTHON_URL}/analyze-image`, { method: "POST", body: pyForm });
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

    const py = (await pyRes.json()) as PythonAnalyzeResponse;
    if (!pyRes.ok || !py.success) {
      return NextResponse.json(
        {
          success: false,
          error: (Array.isArray(py.errors) && py.errors[0]) || "فشل فحص المعايرة في خدمة Python.",
        },
        { status: 500 }
      );
    }

    const answers = (Array.isArray(py.answers) ? py.answers : []).slice(0, questionCount);
    const answeredCount = answers.filter((a) => a.status === "answered").length;
    const blankCount = answers.filter((a) => a.status === "blank").length;
    const multipleCount = answers.filter((a) => a.status === "multiple").length;
    const uncertainCount = answers.filter((a) => a.status === "uncertain").length;
    const lowConfidenceCount = answers.filter((a) => Number(a.confidence || 0) < 0.35).length;
    const avgConfidence =
      answers.length > 0
        ? answers.reduce((s, a) => s + Number(a.confidence || 0), 0) / answers.length
        : 0;

    const qualityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 *
            (avgConfidence * 0.55 +
              (answeredCount / Math.max(1, questionCount)) * 0.35 +
              (1 - (uncertainCount + multipleCount) / Math.max(1, questionCount)) * 0.1)
        )
      )
    );

    return NextResponse.json({
      success: true,
      templateCode,
      pythonTemplateName,
      questionCount,
      studentCode: py.studentCode ?? null,
      needsReview: Boolean(py.needsReview),
      stats: {
        answeredCount,
        blankCount,
        multipleCount,
        uncertainCount,
        lowConfidenceCount,
        avgConfidence: Number(avgConfidence.toFixed(4)),
        qualityScore,
      },
      recommendation:
        qualityScore >= 85 && uncertainCount === 0 && multipleCount <= 1
          ? "جيد جدًا: المعايرة مستقرة لهذه العينة."
          : qualityScore >= 70
            ? "مقبول: يُفضّل ضبط بعض الأسئلة/الأعمدة وإعادة الاختبار."
            : "ضعيف: المعايرة تحتاج تعديل واضح قبل الاعتماد.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر تنفيذ فحص المعايرة.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
