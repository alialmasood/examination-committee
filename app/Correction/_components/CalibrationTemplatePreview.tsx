"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  applyOneStudentColumnToTenPoints,
  type StudentCodeColumnOverride,
} from "@/src/lib/correction/student-code-column-calibration-apply";
import {
  rasterImageDataUrlToTemplatePixels,
  rasterPdfFirstPageToTemplatePixels,
} from "@/src/lib/correction/omr-template-raster";

type Point = { nx: number; ny: number };
type PreviewResponse = {
  success?: boolean;
  error?: string;
  imageDataUrl?: string;
  templateImageName?: string;
  templateAssetName?: string;
  previewDataUrl?: string;
  previewMime?: string;
  template?: {
    templateCode?: string;
    pageWidth: number;
    pageHeight: number;
    bubbleRadiusNorm: number;
    bubbleRadiusPx: number;
    totalQuestions: number;
    answerBubbleCount: number;
    studentCodeBubbleCount: number;
  };
  overlays?: {
    answers: Point[];
    studentCode: Point[];
  };
};

type OmrTemplateOption = {
  code: string;
  name: string;
  questionCount: number;
};

type ValidationResponse = {
  success?: boolean;
  error?: string;
  templateCode?: string;
  pythonTemplateName?: string;
  questionCount?: number;
  studentCode?: string | null;
  needsReview?: boolean;
  stats?: {
    answeredCount: number;
    blankCount: number;
    multipleCount: number;
    uncertainCount: number;
    lowConfidenceCount: number;
    avgConfidence: number;
    qualityScore: number;
  };
  recommendation?: string;
};

type AnswerLetter = "A" | "B" | "C" | "D";
const ANSWER_LETTERS: AnswerLetter[] = ["A", "B", "C", "D"];

type LetterFineCalibration = { nx: number; ny: number };

/** إزاحة السؤال ككتلة + تباعد؛ وإزاحة دقيقة لكل فقاعة A–D */
type QuestionCalibration = {
  nx: number;
  ny: number;
  spread: number;
  letters: Partial<Record<AnswerLetter, LetterFineCalibration>>;
};

/** عمود من أعمدة كود الورقة الخمسة: إزاحة + تباعد؛ اختياريًا tailFromDigit/tailExtraNy لفصل رأس العمود عن الذيل */
type StudentColumnCalibration = QuestionCalibration & {
  tailFromDigit?: number;
  tailExtraNy?: number;
};

function defaultQuestionCalibration(): QuestionCalibration {
  return { nx: 0, ny: 0, spread: 1, letters: {} };
}

function buildZeroStudentColumnDeltas(): Record<number, StudentColumnCalibration> {
  const out: Record<number, StudentColumnCalibration> = {};
  for (let c = 0; c < 5; c++) out[c] = { ...defaultQuestionCalibration() };
  return out;
}

function studentColCalibrationIsDirty(d: StudentColumnCalibration | undefined): boolean {
  if (!d) return false;
  if (calibrationIsDirty(d)) return true;
  if (typeof d.tailFromDigit === "number") return true;
  return Number.isFinite(d.tailExtraNy) && (d.tailExtraNy ?? 0) !== 0;
}

function buildZeroDeltas(questionCount: number): Record<number, QuestionCalibration> {
  const n = Math.min(100, Math.max(1, Math.floor(questionCount)));
  const out: Record<number, QuestionCalibration> = {};
  for (let q = 1; q <= n; q++) out[q] = defaultQuestionCalibration();
  return out;
}

function letterFineIsDirty(off: LetterFineCalibration | undefined): boolean {
  if (!off) return false;
  return off.nx !== 0 || off.ny !== 0;
}

function calibrationIsDirty(d: QuestionCalibration | undefined): boolean {
  if (!d) return false;
  if (d.nx !== 0 || d.ny !== 0 || d.spread !== 1) return true;
  return ANSWER_LETTERS.some((L) => letterFineIsDirty(d.letters?.[L]));
}

function questionBubbleCenters(adjusted: Point[], q: number): Point[] {
  const start = (q - 1) * 4;
  return adjusted.slice(start, start + 4);
}

function studentColumnBubbleCenters(adjusted: Point[], col: number): Point[] {
  const start = col * 10;
  return adjusted.slice(start, start + 10);
}

/** مدى أشرطة إزاحة أعمدة كود الورقة (أوسع من أسئلة الإجابات عند الحاجة) */
const STUDENT_CODE_COL_SLIDER_EXTENT = 0.12;
const ENABLE_STUDENT_CODE_CALIBRATION = false;
/** مدى أشرطة الإزاحة الدقيقة لكل فقاعة داخل السؤال */
const LETTER_FINE_SLIDER_EXTENT = 0.018;
/** مدى أشرطة إزاحة السؤال ككتلة (الأربع فقاعات معًا) — الرأسي غالبًا يحتاج مدى أكبر من الأفقي */
/** أسئلة أقصى اليمين/اليسار على الورقة قد تحتاج إزاحة أفقية كبيرة (+ ~10 درجات 0.01 عن الحد السابق) */
const QUESTION_BLOCK_SLIDER_EXTENT_NX = 0.72;
/** أسئلة آخر الورقة (مثل 100) قد تحتاج إزاحة رأسية كبيرة جدًا */
const QUESTION_BLOCK_SLIDER_EXTENT_NY = 0.72;

/** خطوة سحب الشريط (أكبر = أقل حساسية عند السحب على نفس المدى) */
const QUESTION_BLOCK_RANGE_STEP_NX = 0.004;
const QUESTION_BLOCK_RANGE_STEP_NY = 0.006;
/** درجة ثابتة بأزرار ± وبجانب الحقل الرقمي */
const QUESTION_BLOCK_NUDGE_STEP_NX = 0.01;
const QUESTION_BLOCK_NUDGE_STEP_NY = 0.01;

const SPREAD_MIN = 0.55;
const SPREAD_MAX = 1.45;
const SPREAD_RANGE_STEP = 0.005;
const SPREAD_NUDGE_STEP = 0.02;

const LETTER_RANGE_STEP = 0.00025;
const LETTER_NUDGE_STEP = 0.0005;

function clampDelta(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function CalibrationTemplatePreview() {
  const [templates, setTemplates] = useState<OmrTemplateOption[]>([]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("OMR_25");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [showAnswers, setShowAnswers] = useState(true);
  const [showStudentCode, setShowStudentCode] = useState(true);
  const [ringScale, setRingScale] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.95);
  /** إزاحات معيّنة 0..1 لكل سؤال — مستقلة لكل سؤال (معاينة فقط) */
  const [rowDeltas, setRowDeltas] = useState<Record<number, QuestionCalibration>>(() => buildZeroDeltas(25));
  /** السؤال الذي لوحته مفتوحة للمعايرة — لتمييز الفقاعات وتمرير الشيت إلى العرض */
  const [openCalibrationQuestion, setOpenCalibrationQuestion] = useState<number | null>(null);
  const [openCalibrationStudentCol, setOpenCalibrationStudentCol] = useState<number | null>(null);
  const sheetPreviewRef = useRef<HTMLDivElement>(null);
  const [savingQuestion, setSavingQuestion] = useState<number | null>(null);
  const [saveHint, setSaveHint] = useState<{ q: number; text: string; ok: boolean } | null>(null);
  const [studentColDeltas, setStudentColDeltas] = useState<Record<number, StudentColumnCalibration>>(() =>
    buildZeroStudentColumnDeltas()
  );
  const [savingStudentCol, setSavingStudentCol] = useState<number | null>(null);
  const [saveHintCol, setSaveHintCol] = useState<{ col: number; text: string; ok: boolean } | null>(null);
  const [validationFile, setValidationFile] = useState<File | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null);
  const [validationError, setValidationError] = useState("");
  const [renderedPreviewDataUrl, setRenderedPreviewDataUrl] = useState("");
  const [sheetBackgroundSource, setSheetBackgroundSource] = useState<"canonical" | "folder">("folder");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (sheetBackgroundSource === "canonical") {
        const [metaRes, svgRes] = await Promise.all([
          fetch(
            `/api/correction/omr/calibration-preview?templateCode=${encodeURIComponent(selectedTemplateCode)}&metaOnly=1`,
            { cache: "no-store" }
          ),
          fetch(`/api/correction/omr/canonical-sheet?templateCode=${encodeURIComponent(selectedTemplateCode)}`, {
            cache: "no-store",
          }),
        ]);
        const meta = (await metaRes.json()) as PreviewResponse;
        if (!metaRes.ok || !meta.success) {
          setData(null);
          setError(meta.error || "تعذر تحميل بيانات القالب.");
          return;
        }
        const svgText = await svgRes.text();
        if (!svgRes.ok || !svgText.trim().startsWith("<")) {
          setData(null);
          setError("تعذر توليد الشيت الرسمي (SVG).");
          return;
        }
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        setData({
          ...meta,
          previewDataUrl: dataUrl,
          previewMime: "image/svg+xml",
          imageDataUrl: dataUrl,
          templateAssetName: "canonical.svg",
        });
        return;
      }

      const res = await fetch(
        `/api/correction/omr/calibration-preview?templateCode=${encodeURIComponent(selectedTemplateCode)}`,
        { cache: "no-store" }
      );
      const d = (await res.json()) as PreviewResponse;
      if (!res.ok || !d.success) {
        setData(null);
        setError(d.error || "تعذر تحميل صورة القالب القياسية.");
        return;
      }
      setData(d);
    } catch {
      setData(null);
      setError("تعذر الاتصال بالخادم أثناء تحميل معاينة المعايرة.");
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateCode, sheetBackgroundSource]);

  useEffect(() => {
    const src = String(data?.previewDataUrl || data?.imageDataUrl || "");
    const mime = String(data?.previewMime || "").toLowerCase();
    const w = Math.max(1, Math.floor(data?.template?.pageWidth ?? 2480));
    const h = Math.max(1, Math.floor(data?.template?.pageHeight ?? 3508));
    if (!src) {
      setRenderedPreviewDataUrl("");
      return;
    }
    let cancelled = false;
    setRenderedPreviewDataUrl("");
    void (async () => {
      try {
        if (mime === "application/pdf") {
          const png = await rasterPdfFirstPageToTemplatePixels(src, w, h);
          if (!cancelled) setRenderedPreviewDataUrl(png);
          return;
        }
        if (mime === "image/svg+xml" || src.includes("image/svg+xml")) {
          if (!cancelled) setRenderedPreviewDataUrl(src);
          return;
        }
        if (mime.startsWith("image/") || src.startsWith("data:image/")) {
          const png = await rasterImageDataUrlToTemplatePixels(src, w, h);
          if (!cancelled) setRenderedPreviewDataUrl(png);
          return;
        }
        if (!cancelled) setRenderedPreviewDataUrl("");
      } catch {
        if (!cancelled) setRenderedPreviewDataUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.previewDataUrl, data?.previewMime, data?.imageDataUrl, data?.template?.pageWidth, data?.template?.pageHeight]);

  useEffect(() => {
    void load();
  }, [load, selectedTemplateCode]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/correction/omr/templates", { cache: "no-store" });
        const j = (await res.json()) as { success?: boolean; templates?: OmrTemplateOption[] };
        if (!res.ok || !j.success || !Array.isArray(j.templates)) return;
        const sorted = [...j.templates].sort((a, b) => a.questionCount - b.questionCount);
        setTemplates(sorted);
        if (!sorted.some((t) => t.code === selectedTemplateCode)) {
          setSelectedTemplateCode(sorted[0]?.code || "OMR_25");
        }
      } catch {
        // fallback على OMR_25
      }
    })();
  }, []);

  useEffect(() => {
    const n = data?.template?.totalQuestions;
    if (!n || n < 1) return;
    setRowDeltas((prev) => {
      const next: Record<number, QuestionCalibration> = {};
      for (let q = 1; q <= n; q++) {
        const p = prev[q];
        const letters: Partial<Record<AnswerLetter, LetterFineCalibration>> = {};
        for (const L of ANSWER_LETTERS) {
          const cur = p?.letters?.[L];
          letters[L] = {
            nx: Number.isFinite(Number(cur?.nx)) ? Number(cur?.nx) : 0,
            ny: Number.isFinite(Number(cur?.ny)) ? Number(cur?.ny) : 0,
          };
        }
        next[q] = {
          nx: p?.nx ?? 0,
          ny: p?.ny ?? 0,
          spread: typeof p?.spread === "number" && Number.isFinite(p.spread) ? p.spread : 1,
          letters,
        };
      }
      return next;
    });
  }, [data?.template?.totalQuestions]);

  /** تحميل القيم المحفوظة من الملف بعد جاهزية القالب */
  useEffect(() => {
    if (!data?.template?.totalQuestions) return;
    const n = Math.min(100, Math.max(1, data.template.totalQuestions));
    void (async () => {
      try {
        const res = await fetch(
          `/api/correction/omr/calibration-overrides?templateCode=${encodeURIComponent(selectedTemplateCode)}`,
          { cache: "no-store" }
        );
        const j = (await res.json()) as {
          success?: boolean;
          overrides?: Record<
            string,
            {
              nx?: number;
              ny?: number;
              spread?: number;
              letters?: Record<string, { nx?: number; ny?: number }>;
            }
          >;
          studentCodeColumns?: Record<string, { nx?: number; ny?: number; spread?: number }>;
        };
        if (!res.ok || !j.success) return;
        const questionOv = j.overrides ?? {};
        setRowDeltas((prev) => {
          const next = { ...prev };
          for (const [ks, v] of Object.entries(questionOv)) {
            const q = Number(ks);
            if (!Number.isInteger(q) || q < 1 || q > n) continue;
            const letters: Partial<Record<AnswerLetter, LetterFineCalibration>> = { ...(next[q]?.letters ?? {}) };
            const rawLetters = v.letters;
            if (rawLetters && typeof rawLetters === "object" && !Array.isArray(rawLetters)) {
              for (const L of ANSWER_LETTERS) {
                const ent = rawLetters[L];
                if (!ent || typeof ent !== "object") continue;
                letters[L] = {
                  nx: Number.isFinite(Number(ent.nx)) ? Number(ent.nx) : 0,
                  ny: Number.isFinite(Number(ent.ny)) ? Number(ent.ny) : 0,
                };
              }
            }
            next[q] = {
              nx: Number.isFinite(Number(v.nx)) ? Number(v.nx) : next[q]?.nx ?? 0,
              ny: Number.isFinite(Number(v.ny)) ? Number(v.ny) : next[q]?.ny ?? 0,
              spread:
                Number.isFinite(Number(v.spread)) && Number(v.spread) > 0 ? Number(v.spread) : next[q]?.spread ?? 1,
              letters,
            };
          }
          return next;
        });
        const scCols = j.studentCodeColumns;
        if (scCols && typeof scCols === "object" && !Array.isArray(scCols)) {
          setStudentColDeltas((prev) => {
            const next = { ...prev };
            for (const [ks, v] of Object.entries(scCols)) {
              const c = Number(ks);
              if (!Number.isInteger(c) || c < 0 || c > 4) continue;
              const row: StudentColumnCalibration = {
                nx: Number.isFinite(Number(v.nx)) ? Number(v.nx) : 0,
                ny: Number.isFinite(Number(v.ny)) ? Number(v.ny) : 0,
                spread:
                  Number.isFinite(Number(v.spread)) && Number(v.spread) > 0 ? Number(v.spread) : 1,
                letters: {},
              };
              const tf = Number((v as { tailFromDigit?: unknown }).tailFromDigit);
              if (Number.isInteger(tf) && tf >= 0 && tf <= 9) {
                row.tailFromDigit = tf;
                const te = Number((v as { tailExtraNy?: unknown }).tailExtraNy);
                row.tailExtraNy = Number.isFinite(te) ? te : 0;
              }
              next[c] = row;
            }
            return next;
          });
        }
      } catch {
        /* تجاهل إن لم يوجد الملف بعد */
      }
    })();
  }, [data?.template?.totalQuestions, selectedTemplateCode]);

  const W = data?.template?.pageWidth ?? 2480;
  const H = data?.template?.pageHeight ?? 3508;

  /** معاينة بنفس نسبة القالب؛ عرضًا لا يتجاوز 210 مم (استعراض A4) */
  const sheetPreviewBoxStyle = useMemo((): CSSProperties => {
    return {
      width: "min(210mm, 100%)",
      aspectRatio: `${W} / ${H}`,
      height: "auto",
      boxSizing: "border-box",
      overflow: "hidden",
      marginLeft: "auto",
      marginRight: "auto",
    };
  }, [W, H]);

  const baseNorm = data?.template?.bubbleRadiusNorm ?? 13 / 1700;

  const geometry = useMemo(() => {
    const minSide = Math.min(W, H);
    const r = Math.max(4, baseNorm * minSide * ringScale);
    const strokeAnswers = Math.max(2, minSide * 0.001);
    const strokeCode = Math.max(1.8, minSide * 0.0009);
    return { r, strokeAnswers, strokeCode };
  }, [W, H, baseNorm, ringScale]);

  const questionCount = Math.min(100, Math.max(1, data?.template?.totalQuestions ?? 25));

  const adjustedAnswerPoints = useMemo(() => {
    const base = data?.overlays?.answers;
    if (!base?.length) return [];
    const nQ = questionCount;
    const out = base.map((p) => ({ nx: p.nx, ny: p.ny }));

    for (let q = 1; q <= nQ; q++) {
      const d = rowDeltas[q] ?? defaultQuestionCalibration();
      const start = (q - 1) * 4;
      const spread = typeof d.spread === "number" && Number.isFinite(d.spread) && d.spread > 0 ? d.spread : 1;
      const group = [0, 1, 2, 3].map((j) => ({
        nx: base[start + j]!.nx + d.nx,
        ny: base[start + j]!.ny + d.ny,
      }));
      const cx = (group[0].nx + group[1].nx + group[2].nx + group[3].nx) / 4;
      for (let j = 0; j < 4; j++) {
        out[start + j] = {
          nx: cx + (group[j].nx - cx) * spread,
          ny: group[j].ny,
        };
      }
      for (let j = 0; j < 4; j++) {
        const L = ANSWER_LETTERS[j]!;
        const off = d.letters?.[L];
        if (!off) continue;
        const cur = out[start + j]!;
        out[start + j] = { nx: cur.nx + off.nx, ny: cur.ny + off.ny };
      }
    }
    return out;
  }, [data?.overlays?.answers, rowDeltas, questionCount]);

  const adjustedStudentCodePoints = useMemo(() => {
    const base = data?.overlays?.studentCode;
    if (!base?.length) return [];
    const perCol = 10;
    const out = base.map((p) => ({ nx: p.nx, ny: p.ny }));
    const nCol = Math.min(5, Math.floor(base.length / perCol));
    for (let col = 0; col < nCol; col++) {
      const d = studentColDeltas[col] ?? defaultQuestionCalibration();
      const start = col * perCol;
      const slice = base.slice(start, start + perCol);
      const o: StudentCodeColumnOverride = {
        nx: d.nx,
        ny: d.ny,
        spread: typeof d.spread === "number" && Number.isFinite(d.spread) && d.spread > 0 ? d.spread : 1,
        ...(typeof d.tailFromDigit === "number"
          ? { tailFromDigit: d.tailFromDigit, tailExtraNy: d.tailExtraNy ?? 0 }
          : {}),
      };
      const adj = applyOneStudentColumnToTenPoints(slice, o);
      for (let j = 0; j < perCol; j++) out[start + j] = adj[j]!;
    }
    return out;
  }, [data?.overlays?.studentCode, studentColDeltas]);

  const setCalibrationField = (q: number, key: "nx" | "ny" | "spread", value: number) => {
    setRowDeltas((prev) => ({
      ...prev,
      [q]: { ...(prev[q] ?? defaultQuestionCalibration()), [key]: value },
    }));
  };

  const setLetterFineField = (q: number, letter: AnswerLetter, key: "nx" | "ny", value: number) => {
    setRowDeltas((prev) => {
      const cur = prev[q] ?? defaultQuestionCalibration();
      const letters = { ...(cur.letters ?? {}) };
      const prevL = letters[letter] ?? { nx: 0, ny: 0 };
      const nextL = { ...prevL, [key]: value };
      if (nextL.nx === 0 && nextL.ny === 0) delete letters[letter];
      else letters[letter] = nextL;
      return { ...prev, [q]: { ...cur, letters } };
    });
  };

  const setStudentColField = (col: number, key: keyof QuestionCalibration, value: number) => {
    setStudentColDeltas((prev) => {
      const cur = prev[col] ?? { ...defaultQuestionCalibration() };
      return { ...prev, [col]: { ...cur, [key]: value } };
    });
  };

  const resetRowDeltas = () => {
    setRowDeltas(buildZeroDeltas(questionCount));
    setStudentColDeltas(buildZeroStudentColumnDeltas());
  };

  const adjustedQuestionCount = useMemo(() => {
    let c = 0;
    for (let q = 1; q <= questionCount; q++) {
      if (calibrationIsDirty(rowDeltas[q])) c++;
    }
    return c;
  }, [rowDeltas, questionCount]);

  const adjustedStudentColCount = useMemo(() => {
    let c = 0;
    for (let col = 0; col < 5; col++) {
      if (studentColCalibrationIsDirty(studentColDeltas[col])) c++;
    }
    return c;
  }, [studentColDeltas]);

  const scrollSheetPreviewIntoView = useCallback(() => {
    const el = sheetPreviewRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    });
  }, []);

  const handleQuestionAccordionToggle = useCallback(
    (q: number, open: boolean) => {
      if (open) {
        setOpenCalibrationQuestion(q);
        setOpenCalibrationStudentCol(null);
        scrollSheetPreviewIntoView();
      } else {
        setOpenCalibrationQuestion((prev) => (prev === q ? null : prev));
      }
    },
    [scrollSheetPreviewIntoView]
  );

  const handleStudentColAccordionToggle = useCallback(
    (col: number, open: boolean) => {
      if (open) {
        setOpenCalibrationStudentCol(col);
        setOpenCalibrationQuestion(null);
        scrollSheetPreviewIntoView();
      } else {
        setOpenCalibrationStudentCol((prev) => (prev === col ? null : prev));
      }
    },
    [scrollSheetPreviewIntoView]
  );

  const saveQuestionCalibration = useCallback(async (q: number) => {
    const d = rowDeltas[q] ?? defaultQuestionCalibration();
    setSavingQuestion(q);
    setSaveHint((h) => (h?.q === q ? null : h));
    try {
      const lettersPayload: Record<string, { nx: number; ny: number }> = {};
      for (const L of ANSWER_LETTERS) {
        const off = d.letters?.[L];
        lettersPayload[L] = { nx: off?.nx ?? 0, ny: off?.ny ?? 0 };
      }
      const res = await fetch("/api/correction/omr/calibration-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode: selectedTemplateCode,
          question: q,
          nx: d.nx,
          ny: d.ny,
          spread: d.spread,
          letters: lettersPayload,
        }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) throw new Error(j.error || "فشل الحفظ");
      setSaveHint({ q, text: "تم حفظ معايرة السؤال لهذا القالب.", ok: true });
      window.setTimeout(() => {
        setSaveHint((h) => (h?.q === q && h.ok ? null : h));
      }, 4000);
    } catch (e) {
      setSaveHint({
        q,
        text: e instanceof Error ? e.message : "تعذر الحفظ",
        ok: false,
      });
    } finally {
      setSavingQuestion(null);
    }
  }, [rowDeltas, selectedTemplateCode]);

  const saveStudentColumnCalibration = useCallback(async (col: number) => {
    const d = studentColDeltas[col] ?? defaultQuestionCalibration();
    setSavingStudentCol(col);
    setSaveHintCol((h) => (h?.col === col ? null : h));
    try {
      const res = await fetch("/api/correction/omr/calibration-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentCodeColumn: col,
          templateCode: selectedTemplateCode,
          nx: d.nx,
          ny: d.ny,
          spread: d.spread,
          ...(typeof d.tailFromDigit === "number"
            ? { tailFromDigit: d.tailFromDigit, tailExtraNy: d.tailExtraNy ?? 0 }
            : {}),
        }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) throw new Error(j.error || "فشل الحفظ");
      setSaveHintCol({
        col,
        text: "تم حفظ معايرة عمود كود الورقة لهذا القالب.",
        ok: true,
      });
      window.setTimeout(() => {
        setSaveHintCol((h) => (h?.col === col && h.ok ? null : h));
      }, 4000);
    } catch (e) {
      setSaveHintCol({
        col,
        text: e instanceof Error ? e.message : "تعذر الحفظ",
        ok: false,
      });
    } finally {
      setSavingStudentCol(null);
    }
  }, [studentColDeltas, selectedTemplateCode]);

  const runValidation = useCallback(async () => {
    if (!validationFile) {
      setValidationError("اختر صورة عينة أولًا.");
      return;
    }
    setValidationBusy(true);
    setValidationError("");
    setValidationResult(null);
    try {
      const fd = new FormData();
      fd.set("templateCode", selectedTemplateCode);
      fd.set("file", validationFile);
      const res = await fetch("/api/correction/omr/calibration-validate", { method: "POST", body: fd });
      const j = (await res.json()) as ValidationResponse;
      if (!res.ok || !j.success) {
        setValidationError(j.error || "فشل فحص المعايرة.");
        return;
      }
      setValidationResult(j);
    } catch {
      setValidationError("تعذر الاتصال بالخادم أثناء فحص المعايرة.");
    } finally {
      setValidationBusy(false);
    }
  }, [selectedTemplateCode, validationFile]);

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">المعايرة على الورقة القياسية</p>
          <p className="text-xs text-slate-600">
            {sheetBackgroundSource === "canonical" ? (
              <>
                الشيت المعروض:{" "}
                <strong className="text-slate-800">مُولَّد من النظام (SVG رسمي)</strong> بأبعاد{" "}
                <code className="rounded bg-slate-100 px-1">template_config.py</code> ومراكز فقاعات مطابقة للتصحيح.
              </>
            ) : (
              <>
                الملف:{" "}
                <code className="rounded bg-slate-100 px-1">
                  services/omr-python/{data?.templateAssetName || data?.templateImageName || "empetyfofm.pdf"}
                </code>
              </>
            )}{" "}
            — الفقاعات من{" "}
            <code className="rounded bg-slate-100 px-1">template_config.py</code>. المعايرة هنا مخصصة لفقاعات الإجابات،
            ولكل قالب ملف حفظ مستقل.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-700">
            القالب
            <select
              className="ms-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
              value={selectedTemplateCode}
              onChange={(e) => setSelectedTemplateCode(e.target.value)}
            >
              {(templates.length ? templates : [{ code: "OMR_25", name: "تصحيح OMR - 25 سؤال", questionCount: 25 }]).map(
                (t) => (
                  <option key={t.code} value={t.code}>
                    {t.name} ({t.questionCount})
                  </option>
                )
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            تحديث العرض
          </button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="calib-sheet-src"
            className="mt-0.5"
            checked={sheetBackgroundSource === "folder"}
            onChange={() => setSheetBackgroundSource("folder")}
          />
          <span>
            <strong className="text-slate-900">PDF الأصلي من المجلد</strong>
            <span className="mt-0.5 block text-[11px] text-slate-500">
              empetyfofm.pdf، sheet50.pdf، sheet75.pdf، sheet100.pdf — الافتراضي.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="calib-sheet-src"
            className="mt-0.5"
            checked={sheetBackgroundSource === "canonical"}
            onChange={() => setSheetBackgroundSource("canonical")}
          />
          <span>
            <strong className="text-slate-900">شيت مُولَّد (SVG)</strong>
            <span className="mt-0.5 block text-[11px] text-slate-500">بديل بدون ملف PDF من المجلد</span>
          </span>
        </label>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
          فقاعات الإجابات
        </label>
        {ENABLE_STUDENT_CODE_CALIBRATION ? (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={showStudentCode} onChange={(e) => setShowStudentCode(e.target.checked)} />
            فقاعات رمز الطالب
          </label>
        ) : null}
        <label className="text-xs font-semibold text-slate-700">
          تكبير وتصغير الفقاعات
          <input
            type="range"
            min={0.45}
            max={2.4}
            step={0.05}
            value={ringScale}
            onChange={(e) => setRingScale(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          وضوح الطبقة
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={overlayOpacity}
            onChange={(e) => setOverlayOpacity(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
      </div>

      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold text-slate-800">فحص جودة المعايرة على عينة فعلية</p>
        <p className="mb-2 text-[11px] text-slate-600">
          ارفع صورة ممسوحة، ثم نفّذ فحصًا سريعًا لهذا القالب للحصول على جودة تقديرية قبل الاعتماد.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
            onChange={(e) => setValidationFile(e.target.files?.[0] || null)}
            className="block text-xs"
          />
          <button
            type="button"
            onClick={() => void runValidation()}
            disabled={validationBusy}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {validationBusy ? "جاري الفحص…" : "تشغيل الفحص"}
          </button>
        </div>
        {validationError ? <p className="mt-2 text-xs font-medium text-red-700">{validationError}</p> : null}
        {validationResult?.success && validationResult.stats ? (
          <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
            <p className="rounded border bg-white px-2 py-1">
              جودة تقديرية: <span className="font-bold">{validationResult.stats.qualityScore}%</span>
            </p>
            <p className="rounded border bg-white px-2 py-1">
              متوسط الثقة: <span className="font-bold">{(validationResult.stats.avgConfidence * 100).toFixed(1)}%</span>
            </p>
            <p className="rounded border bg-white px-2 py-1">
              مؤكد: <span className="font-bold">{validationResult.stats.answeredCount}</span> /{" "}
              {validationResult.questionCount}
            </p>
            <p className="rounded border bg-white px-2 py-1">
              غامض/متعدد:{" "}
              <span className="font-bold">
                {validationResult.stats.uncertainCount + validationResult.stats.multipleCount}
              </span>
            </p>
            <p className="rounded border bg-white px-2 py-1">
              كود الطالب: <span className="font-bold">{validationResult.studentCode || "غير مقروء"}</span>
            </p>
            <p className="rounded border bg-white px-2 py-1">
              حالات منخفضة الثقة: <span className="font-bold">{validationResult.stats.lowConfidenceCount}</span>
            </p>
            <p className="rounded border bg-white px-2 py-1 sm:col-span-2 lg:col-span-2">
              التوصية: <span className="font-semibold">{validationResult.recommendation}</span>
            </p>
          </div>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-600">جاري تحميل معاينة القالب…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {!loading && !error && renderedPreviewDataUrl && data?.template && data?.overlays ? (
        <>
          {/*
            على الشاشات الضيقة: بدون sticky حتى لا تبقى المعاينة فوق أشرطة الضبط.
            من lg فما فوق: عمودان (الشيت | القائمة) + sticky للشيت داخل عموده فقط.
          */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            <div className="mx-auto w-full max-w-[920px] shrink-0 lg:mx-0 lg:w-[min(48%,440px)] lg:max-w-[480px] lg:sticky lg:top-3 lg:self-start">
              <div
                ref={sheetPreviewRef}
                className="relative scroll-mt-4 rounded-lg border border-slate-300 bg-slate-100 shadow-md ring-1 ring-slate-200/80"
                style={sheetPreviewBoxStyle}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={renderedPreviewDataUrl}
                  alt="ورقة المعايرة القياسية"
                  className="pointer-events-none absolute inset-0 h-full w-full object-fill"
                />
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{ opacity: overlayOpacity }}
                >
                  {showAnswers
                    ? adjustedAnswerPoints.map((p, i) => {
                        const qn = Math.floor(i / 4) + 1;
                        const active = openCalibrationQuestion != null && openCalibrationQuestion === qn;
                        return (
                          <circle
                            key={`a-${i}`}
                            cx={p.nx * W}
                            cy={p.ny * H}
                            r={active ? geometry.r * 1.22 : geometry.r}
                            fill="none"
                            stroke={active ? "#0284c7" : "#ef4444"}
                            strokeWidth={active ? geometry.strokeAnswers * 2.1 : geometry.strokeAnswers}
                          />
                        );
                      })
                    : null}
                  {ENABLE_STUDENT_CODE_CALIBRATION && showStudentCode
                    ? adjustedStudentCodePoints.map((p, i) => {
                        const col = Math.floor(i / 10);
                        const active = openCalibrationStudentCol != null && openCalibrationStudentCol === col;
                        return (
                          <circle
                            key={`s-${i}`}
                            cx={p.nx * W}
                            cy={p.ny * H}
                            r={active ? geometry.r * 1.18 : geometry.r}
                            fill="none"
                            stroke={active ? "#c2410c" : "#f97316"}
                            strokeWidth={active ? geometry.strokeCode * 2.2 : geometry.strokeCode}
                          />
                        );
                      })
                    : null}
                </svg>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                <p className="rounded border bg-slate-50 px-2 py-1">
                  أبعاد القالب: {data.template.pageWidth}×{data.template.pageHeight}
                </p>
                <p className="rounded border bg-slate-50 px-2 py-1">
                  نصف القطر (مع التكبير): ~{Math.round(geometry.r)}px
                </p>
                <p className="rounded border bg-slate-50 px-2 py-1">فقاعات الإجابات: {data.template.answerBubbleCount}</p>
                {ENABLE_STUDENT_CODE_CALIBRATION ? (
                  <p className="rounded border bg-slate-50 px-2 py-1">فقاعات الرمز: {data.template.studentCodeBubbleCount}</p>
                ) : null}
              </div>
            </div>

            <div className="relative z-10 min-h-0 min-w-0 flex-1 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:rounded-xl lg:border lg:border-slate-200 lg:bg-slate-50/95 lg:p-1 lg:shadow-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:border-0 lg:bg-transparent">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">ضبط مواقع الفقاعات حسب السؤال</p>
                <p className="text-xs text-slate-600">
                  {questionCount} سؤالًا — قائمة منطوية: افتح سؤالًا واحدًا في كل مرة. على الشاشات العريضة تظهر القائمة
                  بجانب الشيت؛ على الشاشات الصغيرة تمرّر لأسفل بعد المعاينة. عند الفتح تُمرَّر معاينة الشيت للعرض
                  ويظهر مقتطب للسؤال داخل اللوحة. يتضمن كل سؤال ضبطًا جماعيًا (إزاحة/تباعد) ثم ضبطًا دقيقًا لحركة كل
                  فقاعة A–D على حدة. القيم نسبية (معاينة) حتى تضغط «حفظ».
                  {adjustedQuestionCount > 0 ? (
                    <span className="me-1 font-semibold text-amber-800"> — أسئلة مُعدَّلة: {adjustedQuestionCount}</span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={resetRowDeltas}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                تصفير الكل
              </button>
                </div>
                <div className="max-h-[min(28rem,70vh)] space-y-1 overflow-y-auto overscroll-contain pe-1 lg:max-h-none lg:overflow-visible">
              {Array.from({ length: questionCount }, (_, idx) => {
                const q = idx + 1;
                const d = rowDeltas[q] ?? defaultQuestionCalibration();
                const dirty = calibrationIsDirty(d);
                const fineDirty = ANSWER_LETTERS.some((L) => letterFineIsDirty(d.letters?.[L]));
                return (
                  <details
                    key={q}
                    name="omr-calibration-question"
                    className="rounded-lg border border-slate-200 bg-white shadow-sm open:border-slate-300 open:shadow"
                    onToggle={(e) => {
                      const el = e.currentTarget as HTMLDetailsElement;
                      handleQuestionAccordionToggle(q, el.open);
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
                      <span className="flex flex-wrap items-center gap-2">
                        <span>السؤال {q}</span>
                        {dirty ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                            مُعدَّل
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] font-mono font-normal text-slate-500">
                        Δnx {d.nx.toFixed(4)} · Δny {d.ny.toFixed(4)} · تباعد ×{d.spread.toFixed(3)}
                        {fineDirty ? <span className="ms-1 font-sans text-sky-700">· دقيق</span> : null}
                      </span>
                    </summary>
                    <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                      {openCalibrationQuestion === q
                        ? (() => {
                            const pts = questionBubbleCenters(adjustedAnswerPoints, q);
                            if (pts.length < 4) return null;
                            const padN = 0.014;
                            const minNx = Math.min(...pts.map((p) => p.nx)) - padN;
                            const maxNx = Math.max(...pts.map((p) => p.nx)) + padN;
                            const minNy = Math.min(...pts.map((p) => p.ny)) - padN;
                            const maxNy = Math.max(...pts.map((p) => p.ny)) + padN;
                            const vbX = minNx * W;
                            const vbY = minNy * H;
                            const vbW = (maxNx - minNx) * W;
                            const vbH = (maxNy - minNy) * H;
                            return (
                              <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <p className="border-b border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
                                  مقتطب السؤال {q} (بجانب أشرطة الضبط)
                                </p>
                                <svg
                                  viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
                                  className="h-40 w-full bg-white"
                                  preserveAspectRatio="none"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <image href={renderedPreviewDataUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
                                  {pts.map((p, j) => (
                                    <circle
                                      key={j}
                                      cx={p.nx * W}
                                      cy={p.ny * H}
                                      r={geometry.r * 1.1}
                                      fill="none"
                                      stroke="#0284c7"
                                      strokeWidth={geometry.strokeAnswers * 2}
                                    />
                                  ))}
                                </svg>
                              </div>
                            );
                          })()
                        : null}
                      <div dir="ltr" className="mb-3">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          أفقي (يمين / يسار){" "}
                          <span className="font-mono font-normal text-slate-500">Δnx = {d.nx.toFixed(5)}</span>
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            title={`نقص درجة (${QUESTION_BLOCK_NUDGE_STEP_NX})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "nx",
                                clampDelta(
                                  d.nx - QUESTION_BLOCK_NUDGE_STEP_NX,
                                  -QUESTION_BLOCK_SLIDER_EXTENT_NX,
                                  QUESTION_BLOCK_SLIDER_EXTENT_NX
                                )
                              )
                            }
                          >
                            −
                          </button>
                          <input
                            type="number"
                            title="قيمة Δnx"
                            step={0.0001}
                            min={-QUESTION_BLOCK_SLIDER_EXTENT_NX}
                            max={QUESTION_BLOCK_SLIDER_EXTENT_NX}
                            value={d.nx}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isFinite(v)) return;
                              setCalibrationField(
                                q,
                                "nx",
                                clampDelta(v, -QUESTION_BLOCK_SLIDER_EXTENT_NX, QUESTION_BLOCK_SLIDER_EXTENT_NX)
                              );
                            }}
                            className="w-[6.5rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-center text-xs font-mono text-slate-800"
                          />
                          <button
                            type="button"
                            title={`زيادة درجة (${QUESTION_BLOCK_NUDGE_STEP_NX})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "nx",
                                clampDelta(
                                  d.nx + QUESTION_BLOCK_NUDGE_STEP_NX,
                                  -QUESTION_BLOCK_SLIDER_EXTENT_NX,
                                  QUESTION_BLOCK_SLIDER_EXTENT_NX
                                )
                              )
                            }
                          >
                            +
                          </button>
                          <span className="text-[10px] text-slate-500">درجة ±{QUESTION_BLOCK_NUDGE_STEP_NX}</span>
                        </div>
                        <input
                          type="range"
                          min={-QUESTION_BLOCK_SLIDER_EXTENT_NX}
                          max={QUESTION_BLOCK_SLIDER_EXTENT_NX}
                          step={QUESTION_BLOCK_RANGE_STEP_NX}
                          value={d.nx}
                          onChange={(e) => setCalibrationField(q, "nx", Number(e.target.value))}
                          className="mt-2 w-full"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                          <span>يسار</span>
                          <span>يمين</span>
                        </div>
                      </div>
                      <div dir="ltr">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          رأسي (أعلى / أسفل){" "}
                          <span className="font-mono font-normal text-slate-500">Δny = {d.ny.toFixed(5)}</span>
                        </label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            title={`نقص درجة (${QUESTION_BLOCK_NUDGE_STEP_NY})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "ny",
                                clampDelta(
                                  d.ny - QUESTION_BLOCK_NUDGE_STEP_NY,
                                  -QUESTION_BLOCK_SLIDER_EXTENT_NY,
                                  QUESTION_BLOCK_SLIDER_EXTENT_NY
                                )
                              )
                            }
                          >
                            −
                          </button>
                          <input
                            type="number"
                            title="قيمة Δny"
                            step={0.0001}
                            min={-QUESTION_BLOCK_SLIDER_EXTENT_NY}
                            max={QUESTION_BLOCK_SLIDER_EXTENT_NY}
                            value={d.ny}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isFinite(v)) return;
                              setCalibrationField(
                                q,
                                "ny",
                                clampDelta(v, -QUESTION_BLOCK_SLIDER_EXTENT_NY, QUESTION_BLOCK_SLIDER_EXTENT_NY)
                              );
                            }}
                            className="w-[6.5rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-center text-xs font-mono text-slate-800"
                          />
                          <button
                            type="button"
                            title={`زيادة درجة (${QUESTION_BLOCK_NUDGE_STEP_NY})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "ny",
                                clampDelta(
                                  d.ny + QUESTION_BLOCK_NUDGE_STEP_NY,
                                  -QUESTION_BLOCK_SLIDER_EXTENT_NY,
                                  QUESTION_BLOCK_SLIDER_EXTENT_NY
                                )
                              )
                            }
                          >
                            +
                          </button>
                          <span className="text-[10px] text-slate-500">درجة ±{QUESTION_BLOCK_NUDGE_STEP_NY}</span>
                        </div>
                        <input
                          type="range"
                          min={-QUESTION_BLOCK_SLIDER_EXTENT_NY}
                          max={QUESTION_BLOCK_SLIDER_EXTENT_NY}
                          step={QUESTION_BLOCK_RANGE_STEP_NY}
                          value={d.ny}
                          onChange={(e) => setCalibrationField(q, "ny", Number(e.target.value))}
                          className="mt-2 w-full"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                          <span>أعلى</span>
                          <span>أسفل</span>
                        </div>
                      </div>
                      <div dir="ltr" className="border-t border-slate-100 pt-3">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          تباعد الفقاعات أفقيًا (تقارب / تباعد){" "}
                          <span className="font-mono font-normal text-slate-500">
                            ×{d.spread.toFixed(3)} <span className="font-sans text-slate-400">(1 = افتراضي)</span>
                          </span>
                        </label>
                        <p className="mb-1 text-[10px] leading-snug text-slate-500">
                          يوسّع أو يضيّق المسافة بين A و B و C و D حول منتصف السؤال على المحور الأفقي، دون تحريك
                          المجموعة كاملة (استخدم أشرطة الإزاحة أعلاه لذلك).
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2" dir="ltr">
                          <button
                            type="button"
                            title={`تقارب درجة (${SPREAD_NUDGE_STEP})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "spread",
                                clampDelta(d.spread - SPREAD_NUDGE_STEP, SPREAD_MIN, SPREAD_MAX)
                              )
                            }
                          >
                            −
                          </button>
                          <input
                            type="number"
                            title="قيمة التباعد"
                            step={0.001}
                            min={SPREAD_MIN}
                            max={SPREAD_MAX}
                            value={d.spread}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isFinite(v)) return;
                              setCalibrationField(q, "spread", clampDelta(v, SPREAD_MIN, SPREAD_MAX));
                            }}
                            className="w-[5.5rem] shrink-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-center text-xs font-mono text-slate-800"
                          />
                          <button
                            type="button"
                            title={`تباعد درجة (${SPREAD_NUDGE_STEP})`}
                            className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setCalibrationField(
                                q,
                                "spread",
                                clampDelta(d.spread + SPREAD_NUDGE_STEP, SPREAD_MIN, SPREAD_MAX)
                              )
                            }
                          >
                            +
                          </button>
                          <span className="text-[10px] text-slate-500">درجة ±{SPREAD_NUDGE_STEP}</span>
                        </div>
                        <input
                          type="range"
                          min={SPREAD_MIN}
                          max={SPREAD_MAX}
                          step={SPREAD_RANGE_STEP}
                          value={d.spread}
                          onChange={(e) => setCalibrationField(q, "spread", Number(e.target.value))}
                          className="mt-2 w-full"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                          <span>تقارب (أضيق)</span>
                          <span>تباعد (أوسع)</span>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="mb-2 text-[11px] font-bold text-slate-800">ضبط دقيق: حركة كل فقاعة على حدة</p>
                        <p className="mb-2 text-[10px] leading-snug text-slate-500">
                          بعد ضبط السؤال ككتلة، استخدم الإزاحات هنا لكل حرف A–D بشكل منفصل (أدق من التباعد الجماعي
                          وحده).
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {ANSWER_LETTERS.map((L) => {
                            const off = d.letters?.[L] ?? { nx: 0, ny: 0 };
                            return (
                              <div key={L} className="rounded-lg border border-slate-200 bg-slate-50/80 p-2">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-slate-800">الفقاعة {L}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRowDeltas((prev) => {
                                        const cur = prev[q] ?? defaultQuestionCalibration();
                                        const letters = { ...(cur.letters ?? {}) };
                                        delete letters[L];
                                        return { ...prev, [q]: { ...cur, letters } };
                                      })
                                    }
                                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                                  >
                                    تصفير {L}
                                  </button>
                                </div>
                                <div dir="ltr" className="mb-2">
                                  <label className="block text-[10px] font-semibold text-slate-700">
                                    أفقي <span className="font-mono font-normal text-slate-500">Δnx={off.nx.toFixed(5)}</span>
                                  </label>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-bold text-slate-700"
                                      onClick={() =>
                                        setLetterFineField(
                                          q,
                                          L,
                                          "nx",
                                          clampDelta(
                                            off.nx - LETTER_NUDGE_STEP,
                                            -LETTER_FINE_SLIDER_EXTENT,
                                            LETTER_FINE_SLIDER_EXTENT
                                          )
                                        )
                                      }
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      step={0.0001}
                                      min={-LETTER_FINE_SLIDER_EXTENT}
                                      max={LETTER_FINE_SLIDER_EXTENT}
                                      value={off.nx}
                                      onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!Number.isFinite(v)) return;
                                        setLetterFineField(
                                          q,
                                          L,
                                          "nx",
                                          clampDelta(v, -LETTER_FINE_SLIDER_EXTENT, LETTER_FINE_SLIDER_EXTENT)
                                        );
                                      }}
                                      className="w-20 rounded border border-slate-300 bg-white px-1 py-0.5 text-center text-[10px] font-mono"
                                    />
                                    <button
                                      type="button"
                                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-bold text-slate-700"
                                      onClick={() =>
                                        setLetterFineField(
                                          q,
                                          L,
                                          "nx",
                                          clampDelta(
                                            off.nx + LETTER_NUDGE_STEP,
                                            -LETTER_FINE_SLIDER_EXTENT,
                                            LETTER_FINE_SLIDER_EXTENT
                                          )
                                        )
                                      }
                                    >
                                      +
                                    </button>
                                  </div>
                                  <input
                                    type="range"
                                    min={-LETTER_FINE_SLIDER_EXTENT}
                                    max={LETTER_FINE_SLIDER_EXTENT}
                                    step={LETTER_RANGE_STEP}
                                    value={off.nx}
                                    onChange={(e) => setLetterFineField(q, L, "nx", Number(e.target.value))}
                                    className="mt-1 w-full"
                                  />
                                </div>
                                <div dir="ltr">
                                  <label className="block text-[10px] font-semibold text-slate-700">
                                    رأسي <span className="font-mono font-normal text-slate-500">Δny={off.ny.toFixed(5)}</span>
                                  </label>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-bold text-slate-700"
                                      onClick={() =>
                                        setLetterFineField(
                                          q,
                                          L,
                                          "ny",
                                          clampDelta(
                                            off.ny - LETTER_NUDGE_STEP,
                                            -LETTER_FINE_SLIDER_EXTENT,
                                            LETTER_FINE_SLIDER_EXTENT
                                          )
                                        )
                                      }
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      step={0.0001}
                                      min={-LETTER_FINE_SLIDER_EXTENT}
                                      max={LETTER_FINE_SLIDER_EXTENT}
                                      value={off.ny}
                                      onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!Number.isFinite(v)) return;
                                        setLetterFineField(
                                          q,
                                          L,
                                          "ny",
                                          clampDelta(v, -LETTER_FINE_SLIDER_EXTENT, LETTER_FINE_SLIDER_EXTENT)
                                        );
                                      }}
                                      className="w-20 rounded border border-slate-300 bg-white px-1 py-0.5 text-center text-[10px] font-mono"
                                    />
                                    <button
                                      type="button"
                                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-bold text-slate-700"
                                      onClick={() =>
                                        setLetterFineField(
                                          q,
                                          L,
                                          "ny",
                                          clampDelta(
                                            off.ny + LETTER_NUDGE_STEP,
                                            -LETTER_FINE_SLIDER_EXTENT,
                                            LETTER_FINE_SLIDER_EXTENT
                                          )
                                        )
                                      }
                                    >
                                      +
                                    </button>
                                  </div>
                                  <input
                                    type="range"
                                    min={-LETTER_FINE_SLIDER_EXTENT}
                                    max={LETTER_FINE_SLIDER_EXTENT}
                                    step={LETTER_RANGE_STEP}
                                    value={off.ny}
                                    onChange={(e) => setLetterFineField(q, L, "ny", Number(e.target.value))}
                                    className="mt-1 w-full"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          onClick={() => setRowDeltas((prev) => ({ ...prev, [q]: defaultQuestionCalibration() }))}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          تصفير
                        </button>
                        <button
                          type="button"
                          disabled={savingQuestion === q}
                          onClick={() => void saveQuestionCalibration(q)}
                          className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {savingQuestion === q ? "جاري الحفظ…" : "حفظ"}
                        </button>
                      </div>
                      {saveHint && saveHint.q === q ? (
                        <p
                          className={`mt-2 text-center text-[11px] font-medium ${
                            saveHint.ok ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {saveHint.text}
                        </p>
                      ) : null}
                    </div>
                  </details>
                );
              })}

                {ENABLE_STUDENT_CODE_CALIBRATION ? <div className="mt-5 border-t border-slate-200 pt-4">
                  <p className="mb-2 text-sm font-bold text-slate-900">ضبط فقاعات كود الورقة (5 أعمدة)</p>
                  <p className="mb-3 text-xs text-slate-600">
                    كل عمود = عشر فقاعات للأرقام 0–9 (من الأعلى للأسفل). الإزاحة الأفقية/الرأسية تحرّك العمود كاملًا؛
                    «التباعد» يضيّق أو يوسّع المسافة الرأسية بين الفقاعات حول منتصف العمود — بنفس فكرة تباعد خيارات
                    الإجابة أفقيًا. يمكن تفعيل «فصل الرأس والذيل»: الفقاعات من الرقم 0 حتى قبل الرقم المحدد تبقى ثابتة
                    عموديًا (إزاحة فقط)، ومن ذلك الرقم فصاعدًا يُطبَّق التباعد الجماعي مع إزاحة إضافية اختيارية لأسفل
                    (الفقاعة الثالثة = الرقم 2). يُحفظ في الملف تحت المفتاح{" "}
                    <code className="rounded bg-white px-1">studentCodeColumns</code> ويُقرأه Python عند قراءة كود
                    الورقة.
                  </p>
                  <div className="space-y-1">
                    {Array.from({ length: 5 }, (_, col) => {
                      const d = studentColDeltas[col] ?? defaultQuestionCalibration();
                      const dirty = studentColCalibrationIsDirty(d);
                      return (
                        <details
                          key={`sc-${col}`}
                          name="omr-calibration-student-col"
                          className="rounded-lg border border-orange-200 bg-white shadow-sm open:border-orange-300 open:shadow"
                          onToggle={(e) => {
                            const el = e.currentTarget as HTMLDetailsElement;
                            handleStudentColAccordionToggle(col, el.open);
                          }}
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
                            <span className="flex flex-wrap items-center gap-2">
                              <span>
                                خانة كود الورقة {col + 1}{" "}
                                <span className="text-[11px] font-normal text-slate-500">(عمود {col + 1}/5)</span>
                              </span>
                              {dirty ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                                  مُعدَّل
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-[11px] font-mono font-normal text-slate-500">
                              Δnx {d.nx.toFixed(4)} · Δny {d.ny.toFixed(4)} · تباعد ×{d.spread.toFixed(3)}
                              {typeof d.tailFromDigit === "number"
                                ? ` · ذيل من ${d.tailFromDigit}+Δny${(d.tailExtraNy ?? 0).toFixed(4)}`
                                : ""}
                            </span>
                          </summary>
                          <div className="border-t border-orange-50 px-3 pb-3 pt-2">
                            {openCalibrationStudentCol === col
                              ? (() => {
                                  const pts = studentColumnBubbleCenters(adjustedStudentCodePoints, col);
                                  if (pts.length < 10) return null;
                                  const padN = 0.012;
                                  const minNx = Math.min(...pts.map((p) => p.nx)) - padN;
                                  const maxNx = Math.max(...pts.map((p) => p.nx)) + padN;
                                  const minNy = Math.min(...pts.map((p) => p.ny)) - padN;
                                  const maxNy = Math.max(...pts.map((p) => p.ny)) + padN;
                                  const vbX = minNx * W;
                                  const vbY = minNy * H;
                                  const vbW = (maxNx - minNx) * W;
                                  const vbH = (maxNy - minNy) * H;
                                  return (
                                    <div className="mb-3 overflow-hidden rounded-lg border border-orange-200 bg-white">
                                      <p className="border-b border-orange-50 bg-orange-50/80 px-2 py-1 text-[10px] font-semibold text-slate-700">
                                        مقتطب عمود كود الورقة {col + 1}
                                      </p>
                                      <svg
                                        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
                                        className="h-44 w-full bg-white"
                                        preserveAspectRatio="xMidYMid meet"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <image
                                          href={renderedPreviewDataUrl}
                                          x={0}
                                          y={0}
                                          width={W}
                                          height={H}
                                          preserveAspectRatio="none"
                                        />
                                        {pts.map((p, j) => (
                                          <circle
                                            key={j}
                                            cx={p.nx * W}
                                            cy={p.ny * H}
                                            r={geometry.r * 1.08}
                                            fill="none"
                                            stroke="#c2410c"
                                            strokeWidth={geometry.strokeCode * 2}
                                          />
                                        ))}
                                      </svg>
                                    </div>
                                  );
                                })()
                              : null}
                            <div dir="ltr" className="mb-3">
                              <label className="block text-[11px] font-semibold text-slate-700">
                                أفقي (يمين / يسار){" "}
                                <span className="font-mono font-normal text-slate-500">Δnx = {d.nx.toFixed(5)}</span>
                              </label>
                              <input
                                type="range"
                                min={-STUDENT_CODE_COL_SLIDER_EXTENT}
                                max={STUDENT_CODE_COL_SLIDER_EXTENT}
                                step={0.00025}
                                value={d.nx}
                                onChange={(e) => setStudentColField(col, "nx", Number(e.target.value))}
                                className="mt-1 w-full"
                              />
                              <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                                <span>يسار</span>
                                <span>يمين</span>
                              </div>
                            </div>
                            <div dir="ltr">
                              <label className="block text-[11px] font-semibold text-slate-700">
                                رأسي (أعلى / أسفل){" "}
                                <span className="font-mono font-normal text-slate-500">Δny = {d.ny.toFixed(5)}</span>
                              </label>
                              <input
                                type="range"
                                min={-STUDENT_CODE_COL_SLIDER_EXTENT}
                                max={STUDENT_CODE_COL_SLIDER_EXTENT}
                                step={0.00025}
                                value={d.ny}
                                onChange={(e) => setStudentColField(col, "ny", Number(e.target.value))}
                                className="mt-1 w-full"
                              />
                              <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                                <span>أعلى</span>
                                <span>أسفل</span>
                              </div>
                            </div>
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <label className="flex cursor-pointer items-start gap-2 text-[11px] font-semibold text-slate-800">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={typeof d.tailFromDigit === "number"}
                                  onChange={(e) => {
                                    setStudentColDeltas((prev) => {
                                      const cur = prev[col] ?? { ...defaultQuestionCalibration() };
                                      if (e.target.checked) {
                                        return {
                                          ...prev,
                                          [col]: {
                                            ...cur,
                                            tailFromDigit: 2,
                                            tailExtraNy: cur.tailExtraNy ?? 0,
                                          },
                                        };
                                      }
                                      const { tailFromDigit: _t, tailExtraNy: _e, ...rest } = cur;
                                      return { ...prev, [col]: { ...rest } };
                                    });
                                  }}
                                />
                                <span>
                                  فصل الرأس والذيل: الفقاعات 0…حتى قبل «أول رقم الذيل» إزاحة فقط؛ من ذلك الرقم فصاعدًا
                                  تباعد جماعي + إزاحة إضافية للذيل.
                                </span>
                              </label>
                              {typeof d.tailFromDigit === "number" ? (
                                <div className="mt-2 space-y-2" dir="ltr">
                                  <div>
                                    <label className="block text-[11px] text-slate-700">
                                      أول رقم يبدأ منه الذيل (0–9). الفقاعة الثالثة من الأعلى ={" "}
                                      <span className="font-mono">2</span>
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={9}
                                      step={1}
                                      value={d.tailFromDigit}
                                      onChange={(e) => {
                                        const raw = Math.floor(Number(e.target.value));
                                        const v = Number.isFinite(raw) ? Math.max(0, Math.min(9, raw)) : 2;
                                        setStudentColDeltas((prev) => {
                                          const cur = prev[col] ?? { ...defaultQuestionCalibration() };
                                          return {
                                            ...prev,
                                            [col]: {
                                              ...cur,
                                              tailFromDigit: v,
                                              tailExtraNy: cur.tailExtraNy ?? 0,
                                            },
                                          };
                                        });
                                      }}
                                      className="mt-1 w-full max-w-[8rem] rounded border border-slate-200 px-2 py-1 text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-700">
                                      إزاحة إضافية للذيل لأسفل (normalized){" "}
                                      <span className="font-mono font-normal text-slate-500">
                                        {(d.tailExtraNy ?? 0).toFixed(5)}
                                      </span>
                                    </label>
                                    <input
                                      type="range"
                                      min={-0.04}
                                      max={0.06}
                                      step={0.00025}
                                      value={d.tailExtraNy ?? 0}
                                      onChange={(e) =>
                                        setStudentColDeltas((prev) => {
                                          const cur = prev[col] ?? { ...defaultQuestionCalibration() };
                                          return {
                                            ...prev,
                                            [col]: {
                                              ...cur,
                                              tailFromDigit: cur.tailFromDigit ?? 2,
                                              tailExtraNy: Number(e.target.value),
                                            },
                                          };
                                        })
                                      }
                                      className="mt-1 w-full"
                                    />
                                    <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                                      <span>أعلى</span>
                                      <span>أسفل</span>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div dir="ltr" className="border-t border-slate-100 pt-3">
                              <label className="block text-[11px] font-semibold text-slate-700">
                                تباعد الفقاعات رأسيًا (تقارب / تباعد){" "}
                                <span className="font-mono font-normal text-slate-500">
                                  ×{d.spread.toFixed(3)}{" "}
                                  <span className="font-sans text-slate-400">(1 = افتراضي)</span>
                                </span>
                              </label>
                              <p className="mb-1 text-[10px] leading-snug text-slate-500">
                                يضيّق أو يوسّع المسافة بين فقاعات 0…9 حول منتصف العمود على المحور الرأسي.
                              </p>
                              <input
                                type="range"
                                min={0.55}
                                max={1.45}
                                step={0.002}
                                value={d.spread}
                                onChange={(e) => setStudentColField(col, "spread", Number(e.target.value))}
                                className="mt-1 w-full"
                              />
                              <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                                <span>تقارب (أضيق)</span>
                                <span>تباعد (أوسع)</span>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setStudentColDeltas((prev) => ({ ...prev, [col]: defaultQuestionCalibration() }))
                                }
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                تصفير
                              </button>
                              <button
                                type="button"
                                disabled={savingStudentCol === col}
                                onClick={() => void saveStudentColumnCalibration(col)}
                                className="rounded-lg bg-orange-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                {savingStudentCol === col ? "جاري الحفظ…" : "حفظ"}
                              </button>
                            </div>
                            {saveHintCol && saveHintCol.col === col ? (
                              <p
                                className={`mt-2 text-center text-[11px] font-medium ${
                                  saveHintCol.ok ? "text-emerald-700" : "text-red-700"
                                }`}
                              >
                                {saveHintCol.text}
                              </p>
                            ) : null}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div> : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
