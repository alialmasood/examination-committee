import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export const runtime = "nodejs";

const OMR_PYTHON_URL = process.env.OMR_PYTHON_URL || "http://127.0.0.1:8001";

type PythonAnswer = {
  questionNumber: number;
  selectedOption: string | null;
  status: "answered" | "blank" | "multiple" | "uncertain";
  confidence: number;
  bubbleScores: Record<string, number>;
  /** أعلى خيار حسب التعبئة عندما يكون فوق عتبة الفراغ (من خدمة Python) */
  bestChoiceLetter?: string | null;
};

type PythonImageResult = {
  success?: boolean;
  studentCode?: string | null;
  answers?: PythonAnswer[];
  errors?: string[];
  debugImages?: Record<string, string>;
};

type PythonPdfResult = {
  success?: boolean;
  error?: string;
  engineTag?: string;
  totalPages?: number;
  processedPages?: number;
  results?: Array<{
    pageIndex?: number;
    studentCode?: string | null;
    answers?: PythonAnswer[];
    errors?: string[];
    debugImages?: Record<string, string> | unknown[];
  }>;
};

function isImage(file: File): boolean {
  return file.type.toLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name || "");
}

/** نص عرضي للأسئلة غير المظللة أو غير القابلة للقراءة بثقة */
const NO_ANSWER_LABEL = "بدون إجابة";

function templateCodeToQuestionCount(code: string): number {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (c === "OMR_50") return 50;
  if (c === "OMR_75") return 75;
  if (c === "OMR_100") return 100;
  return 25;
}

/** يطابق template_config._TEMPLATE_VARIANTS في services/omr-python */
function templateCodeToPythonTemplateName(code: string): string {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (c === "OMR_50") return "correction-exam-a4-50q-v1";
  if (c === "OMR_75") return "correction-exam-a4-75q-v1";
  if (c === "OMR_100") return "correction-exam-a4-100q-v1";
  return "correction-exam-a4-v1";
}

/** يعكس منطق detect_answers.py (تجمّع ضوضاء / ضعف تفوق على المتوسط) — لعرض الاختبار حتى قبل إعادة تشغيل Python */
function bubbleScoresLookLikeEmptyNoise(sc: Record<string, number> | undefined): boolean {
  if (!sc || typeof sc !== "object") return false;
  const vals = Object.values(sc)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => b - a);
  if (vals.length < 4) return false;
  const hi = vals[0]!;
  const second = vals[1]!;
  const lo = vals[3]!;
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  if (hi < 0.205 && hi - lo < 0.078) return true;
  if (hi < 0.36 && hi - mean < 0.1) return true;
  if (hi < 0.095 && hi - second < 0.032) return true;
  if (hi < 0.3 && second > 1e-9 && second / hi >= 0.82) return true;
  return false;
}

/** أعلى حرف من درجات الفقاعات عندما لا يُعاد حرف من Python (uncertain مع درجات واضحة) */
function inferLetterFromBubbleScores(sc: Record<string, number> | undefined): string | null {
  if (!sc || typeof sc !== "object") return null;
  const pairs: { letter: string; v: number }[] = [];
  for (const [k, raw] of Object.entries(sc)) {
    const letter = String(k || "")
      .toUpperCase()
      .trim();
    if (!["A", "B", "C", "D"].includes(letter)) continue;
    const v = Number(raw);
    if (Number.isFinite(v)) pairs.push({ letter, v });
  }
  if (pairs.length < 1) return null;
  pairs.sort((a, b) => b.v - a.v);
  const top = pairs[0]!;
  const second = pairs.length >= 2 ? pairs[1]!.v : 0;
  if (top.v < 0.055) return null;
  if (top.v - second < 0.018) return null;
  return top.letter;
}

/** قراءة للصفحة التجريبية: answered كالعادة؛ عند uncertain نعرض bestChoiceLetter أو أفضل حرف من الدرجات. */
function pickDisplayAnswer(ans: PythonAnswer | null): string {
  if (!ans) return NO_ANSWER_LABEL;
  // لا نفرض «ضوضاء فارغ» على answered — كان يُخفي إجابات صحيحة من Python عندما تكون الدرجات متقاربة قليلًا
  if (ans.status !== "answered" && bubbleScoresLookLikeEmptyNoise(ans.bubbleScores)) return NO_ANSWER_LABEL;
  if (ans.status === "answered") {
    const picked = String(ans.selectedOption || "").toUpperCase().trim();
    return ["A", "B", "C", "D"].includes(picked) ? picked : NO_ANSWER_LABEL;
  }
  if (ans.status === "uncertain") {
    const b = String(ans.bestChoiceLetter || "").toUpperCase().trim();
    if (["A", "B", "C", "D"].includes(b)) return b;
    const guess = inferLetterFromBubbleScores(ans.bubbleScores);
    if (guess) return guess;
  }
  return NO_ANSWER_LABEL;
}

function buildQuestionRows(
  answers: PythonAnswer[],
  totalQuestions: number
): Array<{ questionNumber: number; answer: string }> {
  const n = Math.min(100, Math.max(1, Math.floor(totalQuestions)));
  const byQ = new Map<number, PythonAnswer>();
  for (const a of answers) {
    byQ.set(Number(a.questionNumber), a);
  }
  return Array.from({ length: n }, (_, i) => {
    const q = i + 1;
    return {
      questionNumber: q,
      answer: pickDisplayAnswer(byQ.get(q) || null),
    };
  });
}

function isPdf(file: File): boolean {
  return file.type.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

function debugImagesFromRecord(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 80) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

type RosterStudentRow = {
  id?: string;
  student_name?: string;
  student_code?: string;
  studentCode?: string;
  sheet_code?: string;
  stage?: string;
  study_type?: string;
  department?: string;
};

type CorrectionStudentRow = {
  id: string;
  student_name: string | null;
  student_code: string | null;
  sheet_code: string | null;
  stage: string | null;
  study_type: string | null;
  department: string | null;
};

type ExamExportContext = {
  subjectName: string | null;
  subjectCode: string | null;
  examDate: string | null;
  roster: RosterStudentRow[];
};

/** بيانات تربط صفحة المسح بالطالب والمادة (للعرض والتصدير لاحقًا) */
type TestAnalyzePageContext = {
  detectedSheetCode: string | null;
  detectedReadoutRaw: string | null;
  studentName: string | null;
  /** كود الطالب الجامعي من جدول الطلبة عند المطابقة */
  studentCode: string | null;
  /** كود ورقة الامتحان (5 أرقام) — من المسح أو من القائمة بعد المطابقة */
  sheetCode: string | null;
  stage: string | null;
  studyType: string | null;
  department: string | null;
  subjectName: string | null;
  /** رمز المادة الامتحانية الفريد (يربط النتيجة بالمادة) */
  subjectCode: string | null;
  examDate: string | null;
  rosterMatched: boolean;
  matchHint: string;
};

function omrStudentCodeRawFromPython(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeFiveDigitSheetCode(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 5) return digits;
  if (digits.length > 5) return digits.slice(-5);
  return null;
}

function rosterEntryBySheetCode(roster: RosterStudentRow[], code: string): RosterStudentRow | null {
  const c = code.trim();
  for (const s of roster) {
    const raw = String(s.sheet_code ?? "").trim();
    const sc = raw.replace(/\D/g, "");
    if (sc === c || raw === c) return s;
  }
  return null;
}

async function loadExamExportContext(sheetExportId: string): Promise<ExamExportContext | null> {
  try {
    const r = await query(
      `
      SELECT
        subject_name,
        NULLIF(TRIM(COALESCE(subject_code::text, '')), '') AS subject_code,
        exam_date::text AS exam_date,
        report_payload
      FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0] as {
      subject_name?: string | null;
      subject_code?: string | null;
      exam_date?: string | null;
      report_payload?: unknown;
    };
    let roster: RosterStudentRow[] = [];
    const payload = row.report_payload;
    if (typeof payload === "string") {
      try {
        const p = JSON.parse(payload) as { students?: RosterStudentRow[] };
        roster = Array.isArray(p.students) ? p.students : [];
      } catch {
        roster = [];
      }
    } else if (payload && typeof payload === "object") {
      const p = payload as { students?: RosterStudentRow[] };
      roster = Array.isArray(p.students) ? p.students : [];
    }
    return {
      subjectName: row.subject_name != null ? String(row.subject_name) : null,
      subjectCode: row.subject_code != null ? String(row.subject_code) : null,
      examDate: row.exam_date != null ? String(row.exam_date) : null,
      roster,
    };
  } catch {
    return null;
  }
}

async function fetchStudentDbCodesByIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uuids = [...new Set(ids)].filter((x) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
  );
  if (!uuids.length) return out;
  const r = await query(
    `SELECT id::text AS id, student_code FROM examination_committee.correction_students WHERE id = ANY($1::uuid[])`,
    [uuids]
  );
  for (const row of r.rows as { id: string; student_code: string }[]) {
    out.set(String(row.id), String(row.student_code ?? ""));
  }
  return out;
}

async function fetchCorrectionStudentsBySheetCodes(
  sheetCodes: string[]
): Promise<Map<string, CorrectionStudentRow>> {
  const out = new Map<string, CorrectionStudentRow>();
  const normalized = [...new Set(sheetCodes.map((c) => c.trim()).filter((c) => /^\d{5}$/.test(c)))];
  if (!normalized.length) return out;
  const r = await query(
    `
    SELECT
      id::text AS id,
      student_name,
      student_code,
      sheet_code,
      stage,
      study_type,
      department
    FROM examination_committee.correction_students
    WHERE sheet_code = ANY($1::text[])
    `,
    [normalized]
  );
  for (const row of r.rows as CorrectionStudentRow[]) {
    const key = String(row.sheet_code || "").trim().replace(/\D/g, "").slice(-5);
    if (!/^\d{5}$/.test(key)) continue;
    out.set(key, row);
  }
  return out;
}

type DraftAnalyzePage = {
  pageIndex: number;
  omrStudentCodeRaw: string | null;
  results: Array<{ questionNumber: number; answer: string }>;
};

async function buildPageContexts(
  drafts: DraftAnalyzePage[],
  sheetExportId: string | null
): Promise<TestAnalyzePageContext[]> {
  let ctx: ExamExportContext | null = null;
  if (sheetExportId) {
    ctx = await loadExamExportContext(sheetExportId);
  }

  const detectedSheetCodes = drafts
    .map((p) => normalizeFiveDigitSheetCode(p.omrStudentCodeRaw))
    .filter((v): v is string => Boolean(v));
  const dbStudentsBySheetCode = await fetchCorrectionStudentsBySheetCodes(detectedSheetCodes);

  type Row = TestAnalyzePageContext & { _matchedStudentId: string | null };
  const preliminary: Row[] = drafts.map((p) => {
    const detectedReadoutRaw = p.omrStudentCodeRaw;
    const detectedSheetCode = normalizeFiveDigitSheetCode(p.omrStudentCodeRaw);
    const base: Row = {
      detectedSheetCode,
      detectedReadoutRaw,
      studentName: null,
      studentCode: null,
      sheetCode: null,
      stage: null,
      studyType: null,
      department: null,
      subjectName: ctx?.subjectName ?? null,
      subjectCode: ctx?.subjectCode ?? null,
      examDate: ctx?.examDate ?? null,
      rosterMatched: false,
      matchHint: "",
      _matchedStudentId: null,
    };

    const dbHit = detectedSheetCode ? dbStudentsBySheetCode.get(detectedSheetCode) : null;
    if (dbHit) {
      base.rosterMatched = true;
      base.studentName = dbHit.student_name != null ? String(dbHit.student_name).trim() || null : null;
      base.studentCode = dbHit.student_code != null ? String(dbHit.student_code).trim() || null : null;
      base.sheetCode = detectedSheetCode;
      base.stage = dbHit.stage != null ? String(dbHit.stage).trim() || null : null;
      base.studyType = dbHit.study_type != null ? String(dbHit.study_type).trim() || null : null;
      base.department = dbHit.department != null ? String(dbHit.department).trim() || null : null;
      base._matchedStudentId = dbHit.id != null ? String(dbHit.id).trim() || null : null;
      if (!sheetExportId) {
        base.matchHint = "تمت مطابقة الطالب من جدول طلبة التصحيح باستخدام كود الورقة.";
      }
      return base;
    }

    if (!sheetExportId) {
      base.matchHint = detectedSheetCode
        ? `الكود ${detectedSheetCode} غير موجود في جدول طلبة التصحيح.`
        : "لم تُقرأ دوائر كود الورقة من هذه الصفحة.";
      return base;
    }
    if (!ctx) {
      base.matchHint = "تعذر تحميل سجل التصدير المختار.";
      return base;
    }
    if (!detectedSheetCode) {
      base.matchHint =
        detectedReadoutRaw && /\d/.test(detectedReadoutRaw)
          ? `قراءة كود الورقة غير مكتملة (${detectedReadoutRaw}). تحقق من وضوح دوائر الأرقام الخمسة.`
          : "لم تُقرأ دوائر كود الورقة من هذه الصفحة.";
      return base;
    }

    const hit = rosterEntryBySheetCode(ctx.roster, detectedSheetCode);
    if (!hit) {
      base.matchHint = `الكود ${detectedSheetCode} غير موجود في قائمة طلبة هذا التصدير.`;
      base.sheetCode = detectedSheetCode;
      return base;
    }

    base.rosterMatched = true;
    base.studentName = hit.student_name != null ? String(hit.student_name).trim() || null : null;
    const rosterCodeRaw =
      hit.student_code != null
        ? String(hit.student_code)
        : hit.studentCode != null
        ? String(hit.studentCode)
        : "";
    base.studentCode = rosterCodeRaw.trim() || null;
    base.sheetCode = detectedSheetCode;
    base.stage = hit.stage != null ? String(hit.stage).trim() || null : null;
    base.studyType = hit.study_type != null ? String(hit.study_type).trim() || null : null;
    base.department = hit.department != null ? String(hit.department).trim() || null : null;
    base._matchedStudentId = hit.id != null ? String(hit.id).trim() || null : null;
    return base;
  });

  const matchedIds = preliminary.map((r) => r._matchedStudentId).filter((x): x is string => Boolean(x));
  const codeMap = await fetchStudentDbCodesByIds(matchedIds);

  return preliminary.map((row) => {
    const { _matchedStudentId, ...rest } = row;
    if (!row.rosterMatched || !_matchedStudentId) return rest;
    if (rest.studentCode && rest.studentCode.trim().length > 0) return rest;
    const dbCode = codeMap.get(_matchedStudentId);
    return {
      ...rest,
      studentCode: dbCode && dbCode.length > 0 ? dbCode : null,
    };
  });
}

export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "أرسل multipart/form-data مع الحقل file." }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب." }, { status: 400 });
    }

    const debugMode =
      String(form.get("debugMode") || "").toLowerCase() === "1" ||
      String(form.get("debugMode") || "").toLowerCase() === "true";

    const sheetExportIdRaw = String(form.get("sheetExportId") || "").trim();
    const sheetExportId = sheetExportIdRaw.length > 0 ? sheetExportIdRaw : null;

    const templateCodeRaw = String(form.get("templateCode") || "OMR_25").trim();
    const questionCount = templateCodeToQuestionCount(templateCodeRaw);
    const pythonTemplateName = templateCodeToPythonTemplateName(templateCodeRaw);

    const pyForm = new FormData();
    pyForm.set("templateName", pythonTemplateName);
    pyForm.set("debugMode", debugMode ? "1" : "0");
    pyForm.set("file", file);

    let drafts: DraftAnalyzePage[] = [];
    let pdfMeta: { totalPages: number; processedPages: number; engineTag?: string } | null = null;
    let isPdfUpload = false;
    let omrDebug: { pageIndex: number; images: Record<string, string> } | null = null;

    if (isPdf(file)) {
      isPdfUpload = true;
      pyForm.set("examId", "test-upload");
      const pyRes = await fetch(`${OMR_PYTHON_URL}/analyze-pdf`, { method: "POST", body: pyForm });
      const pyJson = (await pyRes.json()) as PythonPdfResult;
      if (!pyRes.ok || !pyJson.success || !Array.isArray(pyJson.results) || pyJson.results.length === 0) {
        return NextResponse.json(
          { success: false, error: pyJson.error || "فشل تحليل ملف PDF من خدمة Python." },
          { status: 500 }
        );
      }
      const totalFromPy = Number(pyJson.totalPages);
      const processedFromPy = Number(pyJson.processedPages);
      pdfMeta = {
        totalPages: Number.isFinite(totalFromPy) ? totalFromPy : pyJson.results.length,
        processedPages: Number.isFinite(processedFromPy) ? processedFromPy : pyJson.results.length,
        engineTag: typeof pyJson.engineTag === "string" ? pyJson.engineTag : undefined,
      };
      drafts = pyJson.results.map((page, idx) => {
        const pageIndex = typeof page.pageIndex === "number" ? page.pageIndex : idx;
        const answers = Array.isArray(page.answers) ? page.answers : [];
        return {
          pageIndex,
          omrStudentCodeRaw: omrStudentCodeRawFromPython(page.studentCode),
          results: buildQuestionRows(answers, questionCount),
        };
      });
      if (debugMode && pyJson.results[0]) {
        const imgs = debugImagesFromRecord(pyJson.results[0].debugImages);
        if (imgs) omrDebug = { pageIndex: typeof pyJson.results[0].pageIndex === "number" ? pyJson.results[0].pageIndex! : 0, images: imgs };
      }
    } else if (isImage(file)) {
      pyForm.set("runLabel", `test-${Date.now()}`);
      const pyRes = await fetch(`${OMR_PYTHON_URL}/analyze-image`, { method: "POST", body: pyForm });
      const pyJson = (await pyRes.json()) as PythonImageResult;
      if (!pyRes.ok || !pyJson.success) {
        return NextResponse.json(
          { success: false, error: (pyJson.errors && pyJson.errors[0]) || "فشل تحليل الصورة من خدمة Python." },
          { status: 500 }
        );
      }
      const answers = Array.isArray(pyJson.answers) ? pyJson.answers : [];
      drafts = [
        {
          pageIndex: 0,
          omrStudentCodeRaw: omrStudentCodeRawFromPython(pyJson.studentCode),
          results: buildQuestionRows(answers, questionCount),
        },
      ];
      pdfMeta = { totalPages: 1, processedPages: 1 };
      if (debugMode) {
        const imgs = debugImagesFromRecord(pyJson.debugImages);
        if (imgs) omrDebug = { pageIndex: 0, images: imgs };
      }
    } else {
      return NextResponse.json(
        { success: false, error: "صيغة غير مدعومة. ارفع PDF أو صورة (PNG/JPG/JPEG/WEBP/BMP/TIFF)." },
        { status: 400 }
      );
    }

    drafts.sort((a, b) => a.pageIndex - b.pageIndex);
    const contexts = await buildPageContexts(drafts, sheetExportId);
    const pages = drafts.map((d, i) => ({
      pageIndex: d.pageIndex,
      results: d.results,
      context: contexts[i]!,
    }));

    const pdfStaleEngine =
      isPdfUpload && pdfMeta !== null && pdfMeta.totalPages > pages.length;

    return NextResponse.json({
      success: true,
      pdfMeta,
      pdfStaleEngine,
      pages,
      ...(omrDebug ? { omrDebug } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر تحليل الملف.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
