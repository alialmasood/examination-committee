"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalibrationNormOverlayPanel,
  OmrCalibrationComparePanels,
} from "@/app/Correction/_components/OmrCalibrationComparePanels";
import { mergeCalibrationAnswerPoints } from "@/src/lib/correction/merge-calibration-overlay-points";
import type { NormPoint } from "@/src/lib/correction/merge-calibration-overlay-points";

const SYSTEM_SETTINGS_KEY = "correction_system_settings_v1";
/** جلسة عمل صفحة الاختبار: تبقى بعد التنقل حتى الحفظ الشامل في الوجبة أو المسح اليدوي */
const CORRECTION_TEST_WORK_SESSION_KEY = "correction_test_work_session_v1";
const WORK_SESSION_VERSION = 1;

export default function CorrectionTestPage() {
  type ActiveView = "none" | "analyze" | "correct" | "detailed" | "preview" | "custom";
  type SheetExportRow = {
    id: string;
    subject_name: string;
    exam_date: string;
    department: string | null;
    stage: string | null;
    study_type: string | null;
  };
  const [fileStore, setFileStore] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");

  const [exams, setExams] = useState<SheetExportRow[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  /** يجب أن يطابق نموذج الشيت / المعايرة عند اختبار القراءة */
  const [omrTemplateCode, setOmrTemplateCode] = useState<"OMR_25" | "OMR_50" | "OMR_75" | "OMR_100">("OMR_25");
  const [passPercent, setPassPercent] = useState(50);

  type TestAnalyzePageContext = {
    detectedSheetCode: string | null;
    detectedReadoutRaw: string | null;
    studentName: string | null;
    studentCode: string | null;
    sheetCode: string | null;
    stage: string | null;
    studyType: string | null;
    department: string | null;
    subjectName: string | null;
    subjectCode: string | null;
    examDate: string | null;
    rosterMatched: boolean;
    matchHint: string;
  };
  type PageTable = {
    pageIndex: number;
    results: Array<{ questionNumber: number; answer: string }>;
    context: TestAnalyzePageContext;
  };
  type PdfMeta = { totalPages: number; processedPages: number; engineTag?: string };
  type ExamAnswerKey = {
    totalQuestions: number;
    options: string[];
    answers: Record<number, string>;
    questionScores: Record<number, number>;
  };
  type StudentResult = {
    pageIndex: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    score: number;
    maxScore: number;
    percentage: number;
    status: "pass" | "fail";
  };
  type QuestionStat = {
    questionNumber: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    correctRate: number;
  };
  type CorrectionSummary = {
    studentsCount: number;
    passCount: number;
    failCount: number;
    passRate: number;
    failRate: number;
    avgScore: number;
    avgPercentage: number;
  };
  type DetailedQuestionRow = {
    questionNumber: number;
    studentAnswer: string | null;
    correctAnswer: string;
    questionScore: number;
    earnedScore: number;
    result: "correct" | "wrong" | "blank";
  };
  type DetailedPageResult = {
    pageIndex: number;
    score: number;
    maxScore: number;
    percentage: number;
    status: "pass" | "fail";
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    details: DetailedQuestionRow[];
  };
  type ExportStudent = {
    id?: string;
    student_name?: string;
    sheet_code?: string;
  };
  type SelectedExamMeta = {
    subject_name: string;
    subject_code: string | null;
    exam_date: string;
    teacher_name: string | null;
    department: string | null;
    stage: string | null;
    study_type: string | null;
    student_count: number | null;
    college: string | null;
    students: ExportStudent[];
  };

  const [pageTables, setPageTables] = useState<PageTable[]>([]);
  const [fileMeta, setFileMeta] = useState<PdfMeta | null>(null);
  const [pdfStaleEngine, setPdfStaleEngine] = useState(false);
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);
  const [questionStats, setQuestionStats] = useState<QuestionStat[]>([]);
  const [summary, setSummary] = useState<CorrectionSummary | null>(null);
  const [detailedResults, setDetailedResults] = useState<DetailedPageResult[]>([]);
  const [showDetailed, setShowDetailed] = useState(false);
  const [showUploadedPages, setShowUploadedPages] = useState(false);
  const [uploadedPagesPreview, setUploadedPagesPreview] = useState<string[]>([]);
  const [showCustomCorrection, setShowCustomCorrection] = useState(false);
  const [analyzeSearchTerm, setAnalyzeSearchTerm] = useState("");
  const [analysisSaveBusy, setAnalysisSaveBusy] = useState(false);
  const [analysisExportBusy, setAnalysisExportBusy] = useState<"none" | "pdf" | "excel">("none");
  const [correctionSaveBusy, setCorrectionSaveBusy] = useState(false);
  const [detailedSaveBusy, setDetailedSaveBusy] = useState(false);
  const [correctionExportBusy, setCorrectionExportBusy] = useState<"none" | "pdf" | "excel">("none");
  const [detailedExportBusy, setDetailedExportBusy] = useState<"none" | "pdf" | "excel">("none");
  const [customThumbBusy, setCustomThumbBusy] = useState(false);
  const [selectedPagesMap, setSelectedPagesMap] = useState<Record<number, boolean>>({});
  const [activeView, setActiveView] = useState<ActiveView>("none");
  const [selectedExamMeta, setSelectedExamMeta] = useState<SelectedExamMeta | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [showOmrDebugToggle, setShowOmrDebugToggle] = useState(true);
  const [showCalibrationComparePanel, setShowCalibrationComparePanel] = useState(true);
  /** صفحة الاختبار تستدعي Python فقط — تشخيص المحاذاة (مراكز الفقاعات على الصورة المُصحّحة) */
  const [omrDebugMode, setOmrDebugMode] = useState(false);
  const [analyzeDebugImages, setAnalyzeDebugImages] = useState<Record<string, string> | null>(null);
  /** نموذج المعايرة + نقاط مدمجة لعرض المقارنة بجانب الشيت المستدعى */
  const [compareBundle, setCompareBundle] = useState<{
    calibUrl: string;
    pageW: number;
    pageH: number;
    points: NormPoint[];
    /** قطر فقاعة / ارتفاع الصفحة — لإزاحة دوائر معاينة الملف الخام للأسفل */
    examFallbackNyShift: number;
    /** إزاحة عرض على عمود الملف الممسوح فقط (سلبية = للأعلى) — لا تؤثر على قراءة Python */
    examScanNyNudge: number;
  } | null>(null);
  /** أول صفحة من ملف الاختبار بعد تحجيمها لأبعاد القالب (PDF→PNG داخل المتصفح) — لعمود «ملف الاختبار» مع الدوائر */
  const [examCompareDisplaySrc, setExamCompareDisplaySrc] = useState<string | null>(null);

  type WorkSessionSnapshot = {
    version: number;
    savedAt: string;
    selectedExamId: string;
    passPercent: number;
    uploaded: boolean;
    uploadMsg: string;
    pageTables: PageTable[];
    fileMeta: PdfMeta | null;
    pdfStaleEngine: boolean;
    studentResults: StudentResult[];
    questionStats: QuestionStat[];
    summary: CorrectionSummary | null;
    detailedResults: DetailedPageResult[];
    showDetailed: boolean;
    showCustomCorrection: boolean;
    selectedPagesMap: Record<number, boolean>;
    activeView: ActiveView;
    showUploadedPages: boolean;
    analyzeSearchTerm: string;
    activeBatchId: string | null;
    selectedExamMeta: SelectedExamMeta | null;
    lastFileInfo: { name: string; size: number; mime: string } | null;
  };

  const skipSelectAllAfterHydrate = useRef(false);
  const [workSessionReady, setWorkSessionReady] = useState(false);
  const [fullSaveBusy, setFullSaveBusy] = useState(false);
  /** اسم/حجم الملف الأخير المحفوظ في الجلسة (لا يُعاد إنشاء كائن File) */
  const [sessionFileHint, setSessionFileHint] = useState<{ name: string; size: number; mime: string } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        defaultPassPercent?: number;
        defaultOmrDebugMode?: boolean;
        showOmrDebugToggle?: boolean;
        showCalibrationComparePanel?: boolean;
      };
      if (Number.isFinite(Number(parsed.defaultPassPercent))) {
        setPassPercent(Math.max(0, Math.min(100, Number(parsed.defaultPassPercent))));
      }
      if (typeof parsed.defaultOmrDebugMode === "boolean") {
        setOmrDebugMode(parsed.defaultOmrDebugMode);
      }
      if (typeof parsed.showOmrDebugToggle === "boolean") {
        setShowOmrDebugToggle(parsed.showOmrDebugToggle);
      }
      if (typeof parsed.showCalibrationComparePanel === "boolean") {
        setShowCalibrationComparePanel(parsed.showCalibrationComparePanel);
      }
    } catch {
      // ignore invalid local settings
    }
  }, []);

  useEffect(() => {
    const loadExams = async () => {
      try {
        const res = await fetch("/api/correction/sheet-exports");
        const data = (await res.json()) as { success?: boolean; exports?: SheetExportRow[] };
        if (!res.ok || !data?.success || !Array.isArray(data.exports)) {
          return;
        }
        setExams(data.exports);
      } catch {
        // ignore
      }
    };
    void loadExams();
  }, []);

  /** استعادة جلسة العمل المحلية بعد التنقل أو إعادة تحميل الصفحة */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CORRECTION_TEST_WORK_SESSION_KEY);
      if (!raw) {
        setWorkSessionReady(true);
        return;
      }
      const snap = JSON.parse(raw) as Partial<WorkSessionSnapshot> & { version?: number };
      if (snap.version !== WORK_SESSION_VERSION) {
        setWorkSessionReady(true);
        return;
      }
      skipSelectAllAfterHydrate.current = true;
      if (typeof snap.selectedExamId === "string") setSelectedExamId(snap.selectedExamId);
      if (typeof snap.passPercent === "number" && Number.isFinite(snap.passPercent)) {
        setPassPercent(Math.max(0, Math.min(100, snap.passPercent)));
      }
      setUploaded(Boolean(snap.uploaded));
      setUploadMsg(
        snap.uploadMsg ||
          (Array.isArray(snap.pageTables) && snap.pageTables.length > 0
            ? "استُعيدت جلسة العمل المحلية. أعد اختيار نفس الملف من الحقل أعلاه إن أردت تشغيل «تحليل الملف» مرة أخرى."
            : "")
      );
      setPageTables(Array.isArray(snap.pageTables) ? snap.pageTables : []);
      setFileMeta(snap.fileMeta ?? null);
      setPdfStaleEngine(Boolean(snap.pdfStaleEngine));
      setStudentResults(Array.isArray(snap.studentResults) ? snap.studentResults : []);
      setQuestionStats(Array.isArray(snap.questionStats) ? snap.questionStats : []);
      setSummary(snap.summary ?? null);
      setDetailedResults(Array.isArray(snap.detailedResults) ? snap.detailedResults : []);
      setShowDetailed(Boolean(snap.showDetailed));
      setShowCustomCorrection(Boolean(snap.showCustomCorrection));
      setSelectedPagesMap(
        snap.selectedPagesMap && typeof snap.selectedPagesMap === "object" ? snap.selectedPagesMap : {}
      );
      if (snap.activeView === "none" || snap.activeView === "analyze" || snap.activeView === "correct" || snap.activeView === "detailed" || snap.activeView === "preview" || snap.activeView === "custom") {
        setActiveView(snap.activeView);
      }
      setShowUploadedPages(Boolean(snap.showUploadedPages));
      setAnalyzeSearchTerm(typeof snap.analyzeSearchTerm === "string" ? snap.analyzeSearchTerm : "");
      setActiveBatchId(snap.activeBatchId != null ? String(snap.activeBatchId) : null);
      if (snap.selectedExamMeta && typeof snap.selectedExamMeta === "object") {
        setSelectedExamMeta(snap.selectedExamMeta as SelectedExamMeta);
      }
      if (snap.lastFileInfo && typeof snap.lastFileInfo.name === "string") {
        setSessionFileHint({
          name: snap.lastFileInfo.name,
          size: Number(snap.lastFileInfo.size) || 0,
          mime: String(snap.lastFileInfo.mime || ""),
        });
      } else {
        setSessionFileHint(null);
      }
      setUploadedPagesPreview([]);
      setAnalyzeDebugImages(null);
      setCompareBundle(null);
    } catch {
      // ignore corrupt session
    } finally {
      setWorkSessionReady(true);
    }
  }, []);

  useEffect(() => {
    const loadExamMeta = async () => {
      if (!selectedExamId) {
        setSelectedExamMeta(null);
        return;
      }
      try {
        const res = await fetch(`/api/correction/sheet-exports/${selectedExamId}`);
        const data = (await res.json()) as {
          success?: boolean;
          export?: {
            subject_name?: string;
            subject_code?: string | null;
            exam_date?: string;
            teacher_name?: string | null;
            department?: string | null;
            stage?: string | null;
            study_type?: string | null;
            student_count?: number | null;
            report_payload?: unknown;
          };
        };
        if (!res.ok || !data.success || !data.export) {
          setSelectedExamMeta(null);
          return;
        }
        const payload = data.export.report_payload;
        let students: ExportStudent[] = [];
        let college: string | null = null;
        if (payload && typeof payload === "object") {
          const p = payload as { students?: unknown; college?: unknown };
          if (Array.isArray(p.students)) {
            students = p.students as ExportStudent[];
          }
          const c = p.college != null ? String(p.college).trim() : "";
          college = c || null;
        }
        const sc = data.export.subject_code != null ? String(data.export.subject_code).trim() : "";
        setSelectedExamMeta({
          subject_name: String(data.export.subject_name || ""),
          subject_code: sc || null,
          exam_date: String(data.export.exam_date || ""),
          teacher_name: data.export.teacher_name ?? null,
          department: data.export.department ?? null,
          stage: data.export.stage ?? null,
          study_type: data.export.study_type ?? null,
          student_count: data.export.student_count ?? null,
          college,
          students,
        });
      } catch {
        setSelectedExamMeta(null);
      }
    };
    void loadExamMeta();
  }, [selectedExamId]);

  const onUpload = async () => {
    setError("");
    if (!fileStore) {
      setUploaded(false);
      setUploadMsg("");
      setError("اختر ملف الاختبار أولًا.");
      return;
    }
    const isPdf = fileStore.type === "application/pdf" || /\.pdf$/i.test(fileStore.name || "");
    const isImage = fileStore.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(fileStore.name || "");
    if (!isPdf && !isImage) {
      setUploaded(false);
      setUploadMsg("");
      setError("الملف غير مدعوم. استخدم PDF أو صورة.");
      return;
    }
    setUploaded(true);
    setUploadMsg("نجاح التحميل");
    setSessionFileHint({ name: fileStore.name, size: fileStore.size, mime: fileStore.type || "" });
    setPageTables([]);
    setFileMeta(null);
    setPdfStaleEngine(false);
    setStudentResults([]);
    setQuestionStats([]);
    setSummary(null);
    setDetailedResults([]);
    setShowDetailed(false);
    setShowCustomCorrection(false);
    setAnalyzeSearchTerm("");
    setSelectedPagesMap({});
    setActiveView("none");
    setAnalyzeDebugImages(null);
    setCompareBundle(null);
    await createCorrectionBatchSilently(fileStore);
  };

  const loadCalibrationCompareBundle = useCallback(async () => {
    try {
      const tc = encodeURIComponent(omrTemplateCode);
      const [prevRes, ovRes] = await Promise.all([
        fetch(`/api/correction/omr/calibration-preview?templateCode=${tc}`, { cache: "no-store" }),
        fetch(`/api/correction/omr/calibration-overrides?templateCode=${tc}`, { cache: "no-store" }),
      ]);
      const prev = (await prevRes.json()) as {
        success?: boolean;
        previewDataUrl?: string;
        previewMime?: string;
        imageDataUrl?: string;
        template?: {
          pageWidth?: number;
          pageHeight?: number;
          totalQuestions?: number;
          bubbleRadiusNorm?: number;
        };
        overlays?: { answers?: { nx: number; ny: number }[] };
      };
      const ov = (await ovRes.json()) as {
        success?: boolean;
        overrides?: Record<string, { nx?: number; ny?: number; spread?: number }>;
      };
      if (!prevRes.ok || !prev.success || !prev.overlays?.answers?.length) {
        setCompareBundle(null);
        return;
      }
      const rawUrl = String(prev.previewDataUrl || prev.imageDataUrl || "").trim();
      if (!rawUrl) {
        setCompareBundle(null);
        return;
      }
      const mime = String(prev.previewMime || "").toLowerCase();
      const pageW = Math.max(1, Math.floor(prev.template?.pageWidth ?? 2480));
      const pageH = Math.max(1, Math.floor(prev.template?.pageHeight ?? 3508));
      const { rasterPdfFirstPageToTemplatePixels, rasterImageDataUrlToTemplatePixels } = await import(
        "@/src/lib/correction/omr-template-raster"
      );
      // نفس مسار «ملف الاختبار»: رسم بكسل بكسل بأبعاد القالب حتى تتطابق nx/ny مع object-contain (تجنّب شريط فاضي يرفع الدوائر)
      const calibUrl =
        mime === "application/pdf" || rawUrl.includes("application/pdf")
          ? await rasterPdfFirstPageToTemplatePixels(rawUrl, pageW, pageH)
          : await rasterImageDataUrlToTemplatePixels(rawUrl, pageW, pageH);
      const nQ = Math.min(100, Math.max(1, prev.template?.totalQuestions ?? 25));
      const points = mergeCalibrationAnswerPoints(prev.overlays.answers, nQ, ov.overrides);
      const bubbleRn =
        typeof prev.template?.bubbleRadiusNorm === "number" && Number.isFinite(prev.template.bubbleRadiusNorm)
          ? prev.template.bubbleRadiusNorm
          : 13 / 1700;
      const minSide = Math.min(pageW, pageH);
      const bubbleDiameterPx = 2 * bubbleRn * minSide;
      const bubbleNyDelta = bubbleDiameterPx / pageH;
      /** عدد «أقطر فقاعات» تقريبية على ny: للأسفل (+)، وللأعلى (−). افتراضي (1,0) يُنزّل دوائر المعاينة الخام لتقترب من التظليل؛ (1,1)=صافي صفر */
      const rawOverlayShiftDownUnits = 1;
      const rawOverlayShiftUpUnits = 0;
      const examFallbackNyShift =
        rawOverlayShiftDownUnits * bubbleNyDelta + rawOverlayShiftUpUnits * (-bubbleNyDelta);
      /** للأعلى: 1 + 0.42 + ثلاث زيادات 0.12 (كل زيادة = نفس مقدار «قليلا») */
      const examScanNyNudge = -bubbleNyDelta * (1 + 0.42 + 0.12 + 0.12 + 0.12);
      setCompareBundle({
        calibUrl,
        pageW,
        pageH,
        points,
        examFallbackNyShift,
        examScanNyNudge,
      });
    } catch {
      setCompareBundle(null);
    }
  }, [omrTemplateCode]);

  useEffect(() => {
    void loadCalibrationCompareBundle();
  }, [loadCalibrationCompareBundle]);

  const onAnalyze = async () => {
    if (!fileStore || !uploaded) return;
    setActiveView("analyze");
    setAnalyzeBusy(true);
    setError("");
    setAnalyzeDebugImages(null);
    setCompareBundle(null);
    try {
      const fd = new FormData();
      fd.set("file", fileStore);
      fd.set("debugMode", omrDebugMode ? "1" : "0");
      fd.set("templateCode", omrTemplateCode);
      if (selectedExamId) fd.set("sheetExportId", selectedExamId);
      const res = await fetch("/api/correction/test/analyze", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "فشل تحليل الملف.");
        return;
      }
      const data = (await res.json()) as {
        success?: boolean;
        pages?: PageTable[];
        pdfMeta?: PdfMeta | null;
        pdfStaleEngine?: boolean;
        omrDebug?: { pageIndex?: number; images?: Record<string, string> };
      };
      if (!data?.success || !Array.isArray(data.pages) || data.pages.length === 0) {
        setError("فشل تحليل النتيجة.");
        return;
      }
      const pagesOk = data.pages.every((p) => p && typeof p.pageIndex === "number" && p.context);
      if (!pagesOk) {
        setError("استجابة التحليل غير مكتملة. حدّث الخادم وأعد المحاولة.");
        return;
      }
      const dbg = data.omrDebug?.images;
      setAnalyzeDebugImages(dbg && typeof dbg === "object" ? dbg : null);
      setPageTables(data.pages);
      setFileMeta(data.pdfMeta ?? null);
      setPdfStaleEngine(Boolean(data.pdfStaleEngine));
      setStudentResults([]);
      setQuestionStats([]);
      setSummary(null);
      setDetailedResults([]);
      setShowDetailed(false);
      setShowCustomCorrection(false);
      setAnalyzeSearchTerm("");
      setSelectedPagesMap({});
      setActiveView("analyze");
      await loadCalibrationCompareBundle();
      await updateCorrectionBatchSilently({
        status: "analyzed",
        currentStep: "analyze",
        analyzePayload: {
          pages: data.pages,
          pdfMeta: data.pdfMeta ?? null,
          pdfStaleEngine: Boolean(data.pdfStaleEngine),
        },
        eventType: "analyze",
        eventPayload: {
          pagesCount: data.pages.length,
          hasDebugImages: Boolean(dbg && Object.keys(dbg).length),
        },
      });
    } catch {
      setError("تعذر الاتصال بالخادم أثناء التحليل.");
    } finally {
      setAnalyzeBusy(false);
    }
  };

  useEffect(() => {
    if (skipSelectAllAfterHydrate.current) {
      skipSelectAllAfterHydrate.current = false;
      return;
    }
    if (!pageTables.length) {
      setSelectedPagesMap({});
      return;
    }
    const next: Record<number, boolean> = {};
    for (const p of pageTables) next[p.pageIndex] = true;
    setSelectedPagesMap(next);
  }, [pageTables]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("تعذر قراءة الملف كصورة."));
      reader.readAsDataURL(file);
    });

  const renderPdfPages = async (file: File): Promise<string[]> => {
    const pdfjs = await import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    }
    const buf = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push(canvas.toDataURL("image/png"));
    }
    return pages;
  };

  useEffect(() => {
    if (activeView !== "analyze" || !fileStore || !compareBundle) {
      setExamCompareDisplaySrc(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tw = compareBundle.pageW;
        const th = compareBundle.pageH;
        const raw = await readFileAsDataUrl(fileStore);
        const { rasterPdfFirstPageToTemplatePixels, rasterImageDataUrlToTemplatePixels } = await import(
          "@/src/lib/correction/omr-template-raster"
        );
        const isPdfBlob =
          raw.startsWith("data:application/pdf") || /\.pdf$/i.test(fileStore.name || "");
        const png = isPdfBlob
          ? await rasterPdfFirstPageToTemplatePixels(raw, tw, th)
          : await rasterImageDataUrlToTemplatePixels(raw, tw, th);
        if (!cancelled) setExamCompareDisplaySrc(png);
      } catch {
        if (!cancelled) setExamCompareDisplaySrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView, fileStore, compareBundle]);

  /** معاينة صفحات الملف (PDF أو صورة) لاختيار الأوراق في التصحيح المخصص دون الاعتماد على زر المعاينة فقط */
  const ensurePreviewsForCustomSheets = async () => {
    if (!fileStore || !uploaded || pageTables.length === 0) return;
    const isPdf = fileStore.type === "application/pdf" || /\.pdf$/i.test(fileStore.name || "");
    const isImage =
      fileStore.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(fileStore.name || "");
    const need = Math.max(...pageTables.map((p) => p.pageIndex), -1) + 1;
    if (uploadedPagesPreview.length >= need && uploadedPagesPreview.length > 0) return;
    setCustomThumbBusy(true);
    try {
      if (isPdf) {
        const pages = await renderPdfPages(fileStore);
        setUploadedPagesPreview(pages.length ? pages : []);
      } else if (isImage) {
        const img = await readFileAsDataUrl(fileStore);
        setUploadedPagesPreview([img]);
      }
    } catch {
      // تبقى بطاقة البديل (اسم الطالب / الكود / المرحلة)
    } finally {
      setCustomThumbBusy(false);
    }
  };

  const onPreviewUploadedPages = async () => {
    if (!fileStore || !uploaded) {
      setError("ارفع الملف أولًا ثم اعرض الصفحات.");
      return;
    }
    setPreviewBusy(true);
    setActiveView("preview");
    setError("");
    try {
      const isPdf = fileStore.type === "application/pdf" || /\.pdf$/i.test(fileStore.name || "");
      const isImage = fileStore.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(fileStore.name || "");
      if (isPdf) {
        const pages = await renderPdfPages(fileStore);
        setUploadedPagesPreview(pages);
        setShowUploadedPages(true);
        setActiveView("preview");
        await loadCalibrationCompareBundle();
        await updateCorrectionBatchSilently({
          status: "previewed",
          currentStep: "preview",
          eventType: "preview",
          eventPayload: { previewPagesCount: pages.length, sourceKind: "pdf" },
        });
        return;
      }
      if (isImage) {
        const img = await readFileAsDataUrl(fileStore);
        setUploadedPagesPreview([img]);
        setShowUploadedPages(true);
        setActiveView("preview");
        await loadCalibrationCompareBundle();
        await updateCorrectionBatchSilently({
          status: "previewed",
          currentStep: "preview",
          eventType: "preview",
          eventPayload: { previewPagesCount: 1, sourceKind: "image" },
        });
        return;
      }
      throw new Error("الملف غير مدعوم للمعاينة.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر معاينة الصفحات المرفوعة.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const normalizeAnswer = (v: string): string | null => {
    const s = String(v || "").trim().toUpperCase();
    return ["A", "B", "C", "D", "E", "F"].includes(s) ? s : null;
  };

  const fetchAnswerKey = async (sheetExportId: string): Promise<ExamAnswerKey | null> => {
    const q = new URLSearchParams({ sheetExportId });
    const res = await fetch(`/api/correction/answer-keys?${q.toString()}`);
    const data = (await res.json()) as {
      success?: boolean;
      examAnswerKey?: {
        totalQuestions?: number;
        options?: string[];
        answers?: Record<number, string>;
        questionScores?: Record<number, number>;
      } | null;
      error?: string;
    };
    if (!res.ok || !data.success || !data.examAnswerKey) {
      throw new Error(data.error || "تعذر تحميل المفتاح النموذجي للامتحان.");
    }
    const k = data.examAnswerKey;
    const totalQuestions = Number(k.totalQuestions || 25);
    const answers: Record<number, string> = {};
    const questionScores: Record<number, number> = {};
    for (let qn = 1; qn <= totalQuestions; qn++) {
      const a = String((k.answers || {})[qn] || "").toUpperCase().trim();
      if (a) answers[qn] = a;
      const n = Number((k.questionScores || {})[qn]);
      questionScores[qn] = Number.isFinite(n) && n >= 0 ? n : 1;
    }
    return {
      totalQuestions,
      options: Array.isArray(k.options) ? k.options.map((x) => String(x).toUpperCase()) : ["A", "B", "C", "D"],
      answers,
      questionScores,
    };
  };

  const onCorrect = async (
    openDetailed = false,
    pageIndexes?: number[],
    targetView: ActiveView = openDetailed ? "detailed" : "correct"
  ) => {
    if (!uploaded || pageTables.length === 0) {
      setError("حلّل الملف أولًا قبل التصحيح.");
      return;
    }
    if (!selectedExamId) {
      setError("اختر الامتحان (المفتاح النموذجي) أولًا.");
      return;
    }
    setCorrectBusy(true);
    setActiveView(targetView);
    setError("");
    try {
      const key = await fetchAnswerKey(selectedExamId);
      if (!key) throw new Error("لا يوجد مفتاح نموذجي لهذا الامتحان.");
      const allowed = new Set<number>(pageIndexes && pageIndexes.length ? pageIndexes : pageTables.map((p) => p.pageIndex));
      const targetPages = pageTables.filter((p) => allowed.has(p.pageIndex));
      if (!targetPages.length) {
        throw new Error("لم يتم اختيار أي ورقة للتصحيح.");
      }

      const students: StudentResult[] = [];
      const detailedPages: DetailedPageResult[] = [];
      const qStats: QuestionStat[] = [];
      for (let qn = 1; qn <= key.totalQuestions; qn++) {
        qStats.push({ questionNumber: qn, correctCount: 0, wrongCount: 0, blankCount: 0, correctRate: 0 });
      }

      for (const page of targetPages) {
        const byQ = new Map<number, string>();
        for (const row of page.results) byQ.set(Number(row.questionNumber), String(row.answer || ""));

        let correctCount = 0;
        let wrongCount = 0;
        let blankCount = 0;
        let score = 0;
        let maxScore = 0;
        const details: DetailedQuestionRow[] = [];

        for (let qn = 1; qn <= key.totalQuestions; qn++) {
          const expected = String(key.answers[qn] || "").toUpperCase();
          const actual = normalizeAnswer(byQ.get(qn) || "");
          const qScore = Number(key.questionScores[qn] || 0);
          maxScore += qScore;
          const stat = qStats[qn - 1];
          if (!actual) {
            blankCount++;
            stat.blankCount++;
            details.push({
              questionNumber: qn,
              studentAnswer: null,
              correctAnswer: expected,
              questionScore: qScore,
              earnedScore: 0,
              result: "blank",
            });
          } else if (actual === expected) {
            correctCount++;
            score += qScore;
            stat.correctCount++;
            details.push({
              questionNumber: qn,
              studentAnswer: actual,
              correctAnswer: expected,
              questionScore: qScore,
              earnedScore: qScore,
              result: "correct",
            });
          } else {
            wrongCount++;
            stat.wrongCount++;
            details.push({
              questionNumber: qn,
              studentAnswer: actual,
              correctAnswer: expected,
              questionScore: qScore,
              earnedScore: 0,
              result: "wrong",
            });
          }
        }

        const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
        students.push({
          pageIndex: page.pageIndex,
          correctCount,
          wrongCount,
          blankCount,
          score,
          maxScore,
          percentage,
          status: percentage >= passPercent ? "pass" : "fail",
        });
        detailedPages.push({
          pageIndex: page.pageIndex,
          score,
          maxScore,
          percentage,
          status: percentage >= passPercent ? "pass" : "fail",
          correctCount,
          wrongCount,
          blankCount,
          details,
        });
      }

      const studentsCount = students.length;
      const passCount = students.filter((s) => s.status === "pass").length;
      const failCount = Math.max(0, studentsCount - passCount);
      const sumScore = students.reduce((a, b) => a + b.score, 0);
      const sumPct = students.reduce((a, b) => a + b.percentage, 0);
      for (const st of qStats) {
        st.correctRate = studentsCount > 0 ? (st.correctCount / studentsCount) * 100 : 0;
      }

      setStudentResults(students);
      setDetailedResults(detailedPages);
      setQuestionStats(qStats);
      setSummary({
        studentsCount,
        passCount,
        failCount,
        passRate: studentsCount > 0 ? (passCount / studentsCount) * 100 : 0,
        failRate: studentsCount > 0 ? (failCount / studentsCount) * 100 : 0,
        avgScore: studentsCount > 0 ? sumScore / studentsCount : 0,
        avgPercentage: studentsCount > 0 ? sumPct / studentsCount : 0,
      });
      setShowDetailed(openDetailed);
      setActiveView(targetView);
      await updateCorrectionBatchSilently({
        status:
          targetView === "detailed"
            ? "detailed_corrected"
            : targetView === "custom"
            ? "custom_corrected"
            : "corrected",
        currentStep: targetView === "detailed" ? "detailed" : targetView === "custom" ? "custom" : "correct",
        passPercent,
        correctionPayload: {
          summary: {
            studentsCount,
            passCount,
            failCount,
            passRate: studentsCount > 0 ? (passCount / studentsCount) * 100 : 0,
            failRate: studentsCount > 0 ? (failCount / studentsCount) * 100 : 0,
            avgScore: studentsCount > 0 ? sumScore / studentsCount : 0,
            avgPercentage: studentsCount > 0 ? sumPct / studentsCount : 0,
          },
          studentResults: students,
          questionStats: qStats,
          detailedResults: detailedPages,
        },
        detailedPayload: targetView === "detailed" ? { detailedResults: detailedPages } : null,
        customPayload: targetView === "custom" ? { selectedPageIndexes: Array.from(allowed) } : null,
        eventType: targetView === "detailed" ? "detailed" : targetView === "custom" ? "custom" : "correct",
        eventPayload: {
          targetView,
          correctedPagesCount: targetPages.length,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء التصحيح.");
    } finally {
      setCorrectBusy(false);
    }
  };

  const hasCorrection = useMemo(() => summary !== null && studentResults.length > 0, [summary, studentResults.length]);
  const filteredAnalyzePages = useMemo(() => {
    const q = analyzeSearchTerm.trim().toLowerCase();
    if (!q) return pageTables;
    return pageTables.filter((block) => {
      const c = block.context;
      const pageText = String(block.pageIndex + 1);
      return (
        String(c.studentName || "").toLowerCase().includes(q) ||
        String(c.studentCode || "").toLowerCase().includes(q) ||
        String(c.sheetCode || c.detectedSheetCode || "").toLowerCase().includes(q) ||
        String(c.department || "").toLowerCase().includes(q) ||
        String(c.stage || "").toLowerCase().includes(q) ||
        pageText.includes(q)
      );
    });
  }, [pageTables, analyzeSearchTerm]);
  const selectedPageIndexes = useMemo(
    () =>
      pageTables
        .map((p) => p.pageIndex)
        .filter((idx) => Boolean(selectedPagesMap[idx])),
    [pageTables, selectedPagesMap]
  );

  /** حفظ تلقائي للجلسة في المتصفح (مع إعادة المحاولة عند امتلاء التخزين) */
  useEffect(() => {
    if (!workSessionReady) return;
    const lastFileInfo =
      fileStore != null
        ? { name: fileStore.name, size: fileStore.size, mime: fileStore.type || "" }
        : sessionFileHint;
    const t = window.setTimeout(() => {
      try {
        const snap: WorkSessionSnapshot = {
          version: WORK_SESSION_VERSION,
          savedAt: new Date().toISOString(),
          selectedExamId,
          passPercent,
          uploaded,
          uploadMsg,
          pageTables,
          fileMeta,
          pdfStaleEngine,
          studentResults,
          questionStats,
          summary,
          detailedResults,
          showDetailed,
          showCustomCorrection,
          selectedPagesMap,
          activeView,
          showUploadedPages,
          analyzeSearchTerm,
          activeBatchId,
          selectedExamMeta,
          lastFileInfo,
        };
        localStorage.setItem(CORRECTION_TEST_WORK_SESSION_KEY, JSON.stringify(snap));
      } catch (e) {
        if (e instanceof DOMException && e.name === "QuotaExceededError") {
          try {
            const snapLite: WorkSessionSnapshot = {
              version: WORK_SESSION_VERSION,
              savedAt: new Date().toISOString(),
              selectedExamId,
              passPercent,
              uploaded,
              uploadMsg: "تعذر حفظ التفاصيل الكاملة محليًا (سعة التخزين). احفظ في الوجبة من زر «حفظ كل البيانات».",
              pageTables,
              fileMeta,
              pdfStaleEngine,
              studentResults,
              questionStats,
              summary,
              detailedResults: [],
              showDetailed,
              showCustomCorrection,
              selectedPagesMap,
              activeView,
              showUploadedPages,
              analyzeSearchTerm,
              activeBatchId,
              selectedExamMeta,
              lastFileInfo,
            };
            localStorage.setItem(CORRECTION_TEST_WORK_SESSION_KEY, JSON.stringify(snapLite));
          } catch {
            // ignore
          }
        }
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [
    workSessionReady,
    selectedExamId,
    passPercent,
    uploaded,
    uploadMsg,
    pageTables,
    fileMeta,
    pdfStaleEngine,
    studentResults,
    questionStats,
    summary,
    detailedResults,
    showDetailed,
    showCustomCorrection,
    selectedPagesMap,
    activeView,
    showUploadedPages,
    analyzeSearchTerm,
    activeBatchId,
    selectedExamMeta,
    fileStore,
    sessionFileHint,
  ]);

  const onCustomCorrect = async () => {
    await onCorrect(false, selectedPageIndexes, "custom");
  };

  const formatStudyType = (v: string | null | undefined): string => {
    if (v === "evening") return "مسائي";
    if (v === "morning") return "صباحي";
    return String(v || "غير محدد");
  };

  const sanitizeFileName = (v: string): string => {
    return v.replace(/[\\/:*?"<>|]/g, "-").trim();
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const arr = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(arr);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...part);
    }
    return btoa(binary);
  };

  const arrayBufferToBase64 = (input: ArrayBuffer | Uint8Array): string => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...part);
    }
    return btoa(binary);
  };

  const normalizeDigitsToLatin = (value: string): string => {
    return value
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  };

  const parseQuestionNumber = (value: unknown): number | null => {
    const raw = normalizeDigitsToLatin(String(value ?? "")).trim();
    if (!raw) return null;
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const containsArabicChars = (value: unknown): boolean => {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(value ?? ""));
  };

  const sha256Hex = async (file: File): Promise<string | null> => {
    try {
      const arr = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", arr);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return null;
    }
  };

  const createCorrectionBatchSilently = async (file: File) => {
    try {
      const [base64, hash] = await Promise.all([fileToBase64(file), sha256Hex(file)]);
      const batchName = selectedExamMeta?.subject_name?.trim()
        ? `${selectedExamMeta.subject_name}${selectedExamMeta.exam_date ? ` - ${selectedExamMeta.exam_date}` : ""}`
        : "";
      const res = await fetch("/api/correction/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetExportId: selectedExamId || null,
          batchName: batchName || null,
          sourceFileName: file.name,
          sourceFileMime: file.type || null,
          sourceFileSizeBytes: file.size,
          sourceFileSha256: hash,
          sourceFileBase64: base64,
          passPercent,
          status: "uploaded",
          currentStep: "upload",
          eventPayload: { source: "Correction/test", note: "upload completed" },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; batch?: { id?: string } };
      if (res.ok && data.success && data.batch?.id) {
        setActiveBatchId(String(data.batch.id));
      }
    } catch {
      // حفظ صامت: لا نكسر أي سلوك في صفحة الاختبار.
    }
  };

  const updateCorrectionBatchSilently = async (payload: Record<string, unknown>) => {
    if (!activeBatchId) return;
    try {
      await fetch(`/api/correction/batches/${activeBatchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // حفظ صامت: لا نكسر أي سلوك في صفحة الاختبار.
    }
  };

  /** حفظ كل بيانات الصفحة الحالية في وجبة التصحيح المرتبطة، ثم مسح الجلسة المحلية */
  const saveFullPageStateToBatch = async () => {
    if (!activeBatchId) {
      setError("لا توجد وجبة تصحيح نشطة. ارفع الملف أولًا ثم استخدم «رفع ملف الاختبار».");
      return;
    }
    if (!pageTables.length && !hasCorrection) {
      setError("لا توجد بيانات لحفظها. نفّذ التحليل أو التصحيح أولًا.");
      return;
    }
    setFullSaveBusy(true);
    setError("");
    const savedAt = new Date().toISOString();
    try {
      const status = hasCorrection ? "corrected" : pageTables.length ? "analyzed" : "uploaded";
      const currentStep = hasCorrection ? "correct" : pageTables.length ? "analyze" : "upload";
      const body: Record<string, unknown> = {
        status,
        currentStep,
        passPercent,
        eventType: "status",
        eventPayload: { action: "full_save_correction_test_page", savedAt },
      };
      if (pageTables.length) {
        body.analyzePayload = {
          pages: pageTables,
          pdfMeta: fileMeta,
          pdfStaleEngine,
          savedAt,
        };
      }
      if (hasCorrection && summary) {
        body.correctionPayload = {
          summary,
          studentResults,
          questionStats,
          detailedResults,
          savedAt,
        };
        if (showDetailed && detailedResults.length) {
          body.detailedPayload = { detailedResults, passPercent, savedAt };
        }
        if (showCustomCorrection) {
          body.customPayload = {
            selectedPageIndexes: pageTables.map((p) => p.pageIndex).filter((idx) => Boolean(selectedPagesMap[idx])),
            savedAt,
          };
        }
      }
      const res = await fetch(`/api/correction/batches/${activeBatchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error || "تعذر حفظ كل البيانات في الوجبة.");
        return;
      }
      setUploadMsg("تم حفظ كل بيانات الصفحة في الوجبة المرتبطة بالمادة. تبقى الجلسة المحلية للمتابعة؛ استخدم «مسح الجلسة المحلية» لإزالة المسودة من المتصفح.");
    } catch {
      setError("تعذر الاتصال بالخادم أثناء الحفظ الشامل.");
    } finally {
      setFullSaveBusy(false);
    }
  };

  const clearWorkSessionAndReset = () => {
    try {
      localStorage.removeItem(CORRECTION_TEST_WORK_SESSION_KEY);
    } catch {
      // ignore
    }
    setFileStore(null);
    setSessionFileHint(null);
    setUploaded(false);
    setUploadMsg("");
    setError("");
    setPageTables([]);
    setFileMeta(null);
    setPdfStaleEngine(false);
    setStudentResults([]);
    setQuestionStats([]);
    setSummary(null);
    setDetailedResults([]);
    setShowDetailed(false);
    setShowCustomCorrection(false);
    setAnalyzeSearchTerm("");
    setSelectedPagesMap({});
    setUploadedPagesPreview([]);
    setShowUploadedPages(false);
    setActiveView("none");
    setAnalyzeDebugImages(null);
    setCompareBundle(null);
    setActiveBatchId(null);
    setSelectedExamId("");
    setSelectedExamMeta(null);
    setPassPercent(50);
  };

  const binaryStringFromArrayBuffer = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let out = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.subarray(i, i + chunk);
      out += String.fromCharCode(...part);
    }
    return out;
  };

  const ensureArabicPdfFont = async (
    docUnknown: unknown
  ): Promise<{ fontName: string; format: (v: string) => string } | null> => {
    const doc = docUnknown as {
      addFileToVFS: (fileName: string, data: string) => void;
      addFont: (fileName: string, fontName: string, fontStyle: string) => void;
      setFont: (fontName: string, fontStyle?: string) => void;
      setLanguage?: (lang: string) => unknown;
      processArabic?: (text: string) => string;
    };
    try {
      const fontUrl =
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf";
      const res = await fetch(fontUrl, { cache: "force-cache" });
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      const binary = binaryStringFromArrayBuffer(arr);
      const fontFile = "NotoNaskhArabic-Regular.ttf";
      const fontName = "NotoNaskhArabic";
      doc.addFileToVFS(fontFile, binary);
      doc.addFont(fontFile, fontName, "normal");
      doc.setFont(fontName, "normal");
      if (typeof doc.setLanguage === "function") {
        doc.setLanguage("ar");
      }
      const format = (v: string) => {
        const text = String(v || "");
        const hasArabic = /[\u0600-\u06FF]/.test(text);
        if (!hasArabic) return text;
        return typeof doc.processArabic === "function" ? doc.processArabic(text) : text;
      };
      return { fontName, format };
    } catch {
      return null;
    }
  };

  const buildAnalysisPdfBuffer = async (): Promise<ArrayBuffer> => {
    const jsPDFModule = await import("jspdf");
    const autoTableModule = await import("jspdf-autotable");
    const JsPDFCtor = jsPDFModule.default;
    const autoTable = autoTableModule.default;
    const doc = new JsPDFCtor({ orientation: "landscape", unit: "mm", format: "a4" });
    const arabicFont = await ensureArabicPdfFont(doc);
    const arabicFormatter = arabicFont?.format ?? null;
    const activeFont = arabicFont?.fontName;
    const normalizeAnalysisAnswer = (raw: string): string => {
      const v = String(raw || "").trim();
      if (!v) return "-";
      return v;
    };
    pageTables.forEach((p, idx) => {
      if (idx > 0) doc.addPage("a4", "portrait");
      const title = arabicFormatter
        ? arabicFormatter(`تقرير التحليل — صفحة ${p.pageIndex + 1}`)
        : `Analysis Report - Page ${p.pageIndex + 1}`;
      doc.setFontSize(12);
      doc.text(title, 14, 14);

      autoTable(doc, {
        startY: 18,
        pageBreak: "avoid",
        head: [[arabicFormatter ? arabicFormatter("الحقل") : "Field", arabicFormatter ? arabicFormatter("القيمة") : "Value"]],
        body: [
          [arabicFormatter ? arabicFormatter("اسم الطالب") : "Student", arabicFormatter ? arabicFormatter(p.context.studentName || "") : p.context.studentName || ""],
          [arabicFormatter ? arabicFormatter("كود الطالب") : "Student Code", String(p.context.studentCode || "-")],
          [arabicFormatter ? arabicFormatter("كود الورقة") : "Sheet Code", p.context.sheetCode || p.context.detectedSheetCode || ""],
          [arabicFormatter ? arabicFormatter("القسم") : "Department", arabicFormatter ? arabicFormatter(p.context.department || "") : p.context.department || ""],
          [arabicFormatter ? arabicFormatter("المرحلة") : "Stage", arabicFormatter ? arabicFormatter(p.context.stage || "") : p.context.stage || ""],
          [arabicFormatter ? arabicFormatter("نوع الدراسة") : "Study", arabicFormatter ? arabicFormatter(formatStudyType(p.context.studyType)) : formatStudyType(p.context.studyType)],
        ],
        theme: "grid",
        styles: {
          fontSize: 8,
          cellPadding: 1.2,
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        headStyles: {
          fillColor: [15, 118, 110],
          textColor: [255, 255, 255],
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        bodyStyles: activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : undefined,
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 145 },
        },
        didParseCell: (hookData) => {
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          if (!containsArabicChars(rawText)) {
            hookData.cell.styles.font = "helvetica";
            hookData.cell.styles.fontStyle = "normal";
          } else if (activeFont) {
            hookData.cell.styles.font = activeFont;
            hookData.cell.styles.fontStyle = "normal";
          }
        },
      });

      const byQ = new Map<number, string>();
      for (const r of p.results) {
        const qn = parseQuestionNumber(r.questionNumber);
        if (qn == null) continue;
        byQ.set(qn, String(r.answer || ""));
      }
      const rowsAll = Array.from({ length: 25 }, (_, i) => {
        const qn = i + 1;
        return { questionNumber: qn, answer: byQ.get(qn) || "بدون إجابة" };
      });
      const splitIndex = Math.ceil(rowsAll.length / 2);
      const left = rowsAll.slice(0, splitIndex);
      const right = rowsAll.slice(splitIndex);
      const tableY = 78;
      const head = [[arabicFormatter ? arabicFormatter("رقم السؤال") : "Q", arabicFormatter ? arabicFormatter("الإجابة") : "Answer"]];
      const commonStyles = {
        fontSize: 8,
        cellPadding: 1.1,
        ...(activeFont ? { font: activeFont, fontStyle: "normal" as const, halign: "right" as const } : {}),
      };

      autoTable(doc, {
        startY: tableY,
        margin: { left: 14, right: 110 },
        pageBreak: "avoid",
        head,
        body: left.map((r) => {
          const ans = normalizeAnalysisAnswer(String(r.answer || ""));
          return [String(r.questionNumber), arabicFormatter ? arabicFormatter(ans) : ans];
        }),
        theme: "grid",
        styles: commonStyles as never,
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: [255, 255, 255],
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        bodyStyles: activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : undefined,
        columnStyles: {
          0: { cellWidth: 24, halign: "center" },
          1: { cellWidth: 48, halign: "center" },
        },
        didParseCell: (hookData) => {
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          if (!containsArabicChars(rawText)) {
            hookData.cell.styles.font = "helvetica";
            hookData.cell.styles.fontStyle = "normal";
          } else if (activeFont) {
            hookData.cell.styles.font = activeFont;
            hookData.cell.styles.fontStyle = "normal";
          }
        },
      });

      autoTable(doc, {
        startY: tableY,
        margin: { left: 108, right: 14 },
        pageBreak: "avoid",
        head,
        body: right.map((r) => {
          const ans = normalizeAnalysisAnswer(String(r.answer || ""));
          return [String(r.questionNumber), arabicFormatter ? arabicFormatter(ans) : ans];
        }),
        theme: "grid",
        styles: commonStyles as never,
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: [255, 255, 255],
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        bodyStyles: activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : undefined,
        columnStyles: {
          0: { cellWidth: 24, halign: "center" },
          1: { cellWidth: 48, halign: "center" },
        },
        didParseCell: (hookData) => {
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          if (!containsArabicChars(rawText)) {
            hookData.cell.styles.font = "helvetica";
            hookData.cell.styles.fontStyle = "normal";
          } else if (activeFont) {
            hookData.cell.styles.font = activeFont;
            hookData.cell.styles.fontStyle = "normal";
          }
        },
      });
    });
    return doc.output("arraybuffer");
  };

  const saveAnalysisToBatch = async () => {
    if (!activeBatchId) {
      setError("لا توجد وجبة تصحيح نشطة لحفظ التحليل.");
      return;
    }
    if (!pageTables.length) {
      setError("لا توجد نتائج تحليل لحفظها.");
      return;
    }
    setAnalysisSaveBusy(true);
    setError("");
    try {
      const pdfBuffer = await buildAnalysisPdfBuffer();
      const analysisFileName = `analysis-${new Date().toISOString().slice(0, 10)}.pdf`;
      await updateCorrectionBatchSilently({
        status: "analyzed",
        currentStep: "analyze",
        analyzePayload: {
          pages: pageTables,
          pdfMeta: fileMeta,
          savedAt: new Date().toISOString(),
        },
        eventType: "analyze",
        eventPayload: {
          action: "manual_save_analysis",
          pagesCount: pageTables.length,
        },
        analysisReportFileName: analysisFileName,
        analysisReportFileMime: "application/pdf",
        analysisReportFileBase64: arrayBufferToBase64(pdfBuffer),
      });
      setUploadMsg("تم حفظ التحليل وتقرير التحليل (PDF) داخل وجبة التصحيح بنجاح.");
    } catch {
      setError("تعذر حفظ التحليل في الوجبة.");
    } finally {
      setAnalysisSaveBusy(false);
    }
  };

  const exportAnalyzeExcel = async () => {
    if (!pageTables.length) {
      setError("لا توجد نتائج تحليل للتصدير.");
      return;
    }
    setAnalysisExportBusy("excel");
    setError("");
    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "systimit";
      wb.created = new Date();

      const infoSheet = wb.addWorksheet("ملخص التحليل", { views: [{ rightToLeft: true }] });
      infoSheet.mergeCells("A1:B1");
      const title = infoSheet.getCell("A1");
      title.value = "تقرير تحليل أوراق الامتحان";
      title.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      title.alignment = { horizontal: "center", vertical: "middle" };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
      infoSheet.getRow(1).height = 26;
      const summaryRows = [
        ["المادة", selectedExamMeta?.subject_name || "غير محدد"],
        ["تاريخ الامتحان", selectedExamMeta?.exam_date || "غير محدد"],
        ["عدد الصفحات المحللة", String(pageTables.length)],
        ["تاريخ التحليل", new Date().toLocaleString("ar-IQ")],
      ];
      let idx = 3;
      for (const [k, v] of summaryRows) {
        const row = infoSheet.getRow(idx);
        row.getCell(1).value = k;
        row.getCell(2).value = v;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFCBD5E1" } },
            left: { style: "thin", color: { argb: "FFCBD5E1" } },
            bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
            right: { style: "thin", color: { argb: "FFCBD5E1" } },
          };
          cell.alignment = { horizontal: "right", vertical: "middle" };
        });
        row.getCell(1).font = { bold: true };
        idx++;
      }
      infoSheet.columns = [{ width: 28 }, { width: 48 }];

      const rowsSheet = wb.addWorksheet("تفاصيل التحليل", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });
      const maxQuestions = Math.max(...pageTables.map((p) => p.results.length), 0);
      const headers = [
        "صفحة التحليل",
        "اسم الطالب",
        "كود الطالب",
        "كود الورقة",
        "القسم",
        "المرحلة",
        "نوع الدراسة",
      ];
      for (let q = 1; q <= maxQuestions; q++) headers.push(`س${q}`);
      rowsSheet.addRow(headers);

      for (const page of pageTables) {
        const byQ = new Map<number, string>();
        for (const row of page.results) {
          const qn = parseQuestionNumber(row.questionNumber);
          if (qn == null) continue;
          byQ.set(qn, String(row.answer || ""));
        }
        const baseCols = [
          page.pageIndex + 1,
          page.context.studentName || "",
          page.context.studentCode || "",
          page.context.sheetCode || page.context.detectedSheetCode || "",
          page.context.department || "",
          page.context.stage || "",
          formatStudyType(page.context.studyType),
        ];
        const answerCols: string[] = [];
        for (let q = 1; q <= maxQuestions; q++) {
          answerCols.push(byQ.get(q) || "");
        }
        rowsSheet.addRow([...baseCols, ...answerCols]);
      }
      const header = rowsSheet.getRow(1);
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      rowsSheet.columns = headers.map((_, idx) => ({
        width: idx < 2 ? 24 : idx < 7 ? 16 : 10,
      }));

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const fileName = `analysis-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير Excel للتحليل.");
    } finally {
      setAnalysisExportBusy("none");
    }
  };

  const exportAnalyzePdf = async () => {
    if (!pageTables.length) {
      setError("لا توجد نتائج تحليل للتصدير.");
      return;
    }
    setAnalysisExportBusy("pdf");
    setError("");
    try {
      const pdfBuffer = await buildAnalysisPdfBuffer();
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const fileName = `analysis-${new Date().toISOString().slice(0, 10)}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير PDF للتحليل.");
    } finally {
      setAnalysisExportBusy("none");
    }
  };

  const onExportCorrectionReport = async () => {
    if (!hasCorrection || !summary || !studentResults.length) {
      setError("لا توجد نتائج تصحيح لتصديرها.");
      return;
    }
    setCorrectionExportBusy("excel");
    setError("");
    const meta = selectedExamMeta;
    const correctionDate = new Date();

    const summaryRows = [
      ["الكلية", "كلية الشرق التقنية التخصصية"],
      ["المادة الامتحانية", meta?.subject_name || "غير محدد"],
      ["رمز المادة الامتحانية (مرجع)", meta?.subject_code || "غير محدد"],
      ["اسم أستاذ المادة", meta?.teacher_name || "غير محدد"],
      ["القسم", meta?.department || "غير محدد"],
      ["المرحلة", meta?.stage || "غير محدد"],
      ["نوع الدراسة", formatStudyType(meta?.study_type)],
      ["عدد الأوراق المصححة", String(summary.studentsCount)],
      ["تاريخ الامتحان", meta?.exam_date || "غير محدد"],
      ["تاريخ التصحيح", correctionDate.toLocaleDateString("ar-IQ") + " " + correctionDate.toLocaleTimeString("ar-IQ")],
      ["نسبة النجاح", `${Math.round(summary.passRate)}%`],
      ["نسبة الرسوب", `${Math.round(summary.failRate)}%`],
      ["متوسط الدرجة", summary.avgScore.toFixed(2)],
      ["متوسط النسبة", `${summary.avgPercentage.toFixed(2)}%`],
    ];

    const detailHeaders = [
      "الصفحة",
      "اسم الطالب",
      "كود الطالب (جامعة)",
      "كود ورقة الامتحان",
      "القسم",
      "المرحلة",
      "نوع الدراسة",
      "رمز المادة",
      "عدد الصحيحة",
      "عدد الخاطئة",
      "عدد الفارغة",
      "الدرجة النهائية",
      "الدرجة الكلية",
      "النسبة",
      "الحالة",
    ];
    const maxQuestions = Math.max(...detailedResults.map((d) => d.details.length), 0);
    for (let q = 1; q <= maxQuestions; q++) {
      detailHeaders.push(`س${q} (درجة مكتسبة)`);
    }

    const detailsRows = detailedResults.map((r) => {
      const ctx = pageTables.find((p) => p.pageIndex === r.pageIndex)?.context;
      const base = [
        String(r.pageIndex + 1),
        String(ctx?.studentName || `غير معروف (صفحة ${r.pageIndex + 1})`),
        String(ctx?.studentCode || ""),
        String(ctx?.sheetCode || ctx?.detectedSheetCode || ""),
        String(ctx?.department || meta?.department || ""),
        String(ctx?.stage || meta?.stage || ""),
        formatStudyType(ctx?.studyType || meta?.study_type),
        String(ctx?.subjectCode || meta?.subject_code || ""),
        String(r.correctCount),
        String(r.wrongCount),
        String(r.blankCount),
        String(Math.round(r.score)),
        String(Math.round(r.maxScore)),
        `${Math.round(r.percentage)}%`,
        r.status === "pass" ? "ناجح" : "راسب",
      ];
      const perQ: string[] = [];
      for (let q = 1; q <= maxQuestions; q++) {
        const d = r.details.find((x) => x.questionNumber === q);
        perQ.push(d ? String(Math.round(d.earnedScore)) : "");
      }
      return [...base, ...perQ];
    });

    const qStatsRows = questionStats.map((q) => [
      String(q.questionNumber),
      String(q.correctCount),
      String(q.wrongCount),
      String(q.blankCount),
      `${q.correctRate.toFixed(2)}%`,
    ]);

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "systimit";
      wb.created = correctionDate;

      const summarySheet = wb.addWorksheet("ملخص", {
        views: [{ rightToLeft: true }],
      });
      summarySheet.mergeCells("A1:B1");
      const title = summarySheet.getCell("A1");
      title.value = "تقرير التصحيح";
      title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      title.alignment = { horizontal: "center", vertical: "middle" };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
      summarySheet.getRow(1).height = 26;

      let rowIdx = 3;
      for (const [k, v] of summaryRows) {
        const row = summarySheet.getRow(rowIdx);
        row.getCell(1).value = k;
        row.getCell(2).value = v;
        row.getCell(1).font = { bold: true, color: { argb: "FF0F172A" } };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        row.getCell(2).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowIdx % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF" },
        };
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFCBD5E1" } },
            left: { style: "thin", color: { argb: "FFCBD5E1" } },
            bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
            right: { style: "thin", color: { argb: "FFCBD5E1" } },
          };
          cell.alignment = { horizontal: "right", vertical: "middle" };
        });
        rowIdx++;
      }
      summarySheet.columns = [{ width: 34 }, { width: 42 }];

      const detailsSheet = wb.addWorksheet("نتائج الطلبة", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });
      detailsSheet.addRow(detailHeaders);
      for (const row of detailsRows) detailsSheet.addRow(row);
      const detailsHeader = detailsSheet.getRow(1);
      detailsHeader.height = 22;
      detailsHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FF0F766E" } },
          left: { style: "thin", color: { argb: "FF0F766E" } },
          bottom: { style: "thin", color: { argb: "FF0F766E" } },
          right: { style: "thin", color: { argb: "FF0F766E" } },
        };
      });
      for (let i = 2; i <= detailsSheet.rowCount; i++) {
        const row = detailsSheet.getRow(i);
        const isEven = i % 2 === 0;
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isEven ? "FFF0FDFA" : "FFFFFFFF" },
          };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        });
      }
      detailsSheet.columns = detailHeaders.map((h, idx) => ({
        width: idx < 4 ? 22 : idx < 12 ? 14 : 16,
        style: { alignment: { horizontal: "center", vertical: "middle" } },
        header: h,
      }));

      const qSheet = wb.addWorksheet("إحصائية الأسئلة", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });
      qSheet.addRow(["السؤال", "صحيحة", "خاطئة", "فارغة", "نسبة الإجابة الصحيحة"]);
      for (const r of qStatsRows) qSheet.addRow(r);
      const qHeader = qSheet.getRow(1);
      qHeader.height = 22;
      qHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin", color: { argb: "FF7C3AED" } },
          left: { style: "thin", color: { argb: "FF7C3AED" } },
          bottom: { style: "thin", color: { argb: "FF7C3AED" } },
          right: { style: "thin", color: { argb: "FF7C3AED" } },
        };
      });
      for (let i = 2; i <= qSheet.rowCount; i++) {
        const row = qSheet.getRow(i);
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: i % 2 === 0 ? "FFF5F3FF" : "FFFFFFFF" },
          };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        });
      }
      qSheet.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 24 }];

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const subject = sanitizeFileName(meta?.subject_name || "تقرير-التصحيح");
      const examDate = sanitizeFileName(meta?.exam_date || correctionDate.toISOString().slice(0, 10));
      const fileName = `${subject}-${examDate}-تقرير-التصحيح.xlsx`;
      await updateCorrectionBatchSilently({
        status: "report_ready",
        currentStep: "report",
        reportFileName: fileName,
        reportFileMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        reportFileBase64: arrayBufferToBase64(buffer as ArrayBuffer),
        reportPayload: {
          summaryRows,
          detailsRowsCount: detailsRows.length,
          questionStatsRowsCount: qStatsRows.length,
        },
        eventType: "report",
        eventPayload: {
          fileName,
          detailsRowsCount: detailsRows.length,
          questionStatsRowsCount: qStatsRows.length,
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر إنشاء ملف Excel المنسق.");
    } finally {
      setCorrectionExportBusy("none");
    }
  };

  const saveCorrectionToBatch = async () => {
    if (!activeBatchId) {
      setError("لا توجد وجبة تصحيح نشطة لحفظ نتائج التصحيح.");
      return;
    }
    if (!hasCorrection || !summary || !studentResults.length) {
      setError("لا توجد نتائج تصحيح لحفظها.");
      return;
    }
    setCorrectionSaveBusy(true);
    setError("");
    try {
      await updateCorrectionBatchSilently({
        status: "corrected",
        currentStep: "correct",
        correctionPayload: {
          summary,
          studentResults,
          questionStats,
          detailedResults,
          savedAt: new Date().toISOString(),
        },
        eventType: "correct",
        eventPayload: {
          action: "manual_save_correction",
          studentsCount: summary.studentsCount,
        },
      });
      setUploadMsg("تم حفظ التصحيح داخل وجبة التصحيح بنجاح.");
    } catch {
      setError("تعذر حفظ التصحيح في الوجبة.");
    } finally {
      setCorrectionSaveBusy(false);
    }
  };

  const saveDetailedCorrectionToBatch = async () => {
    if (!activeBatchId) {
      setError("لا توجد وجبة تصحيح نشطة لحفظ التصحيح التفصيلي.");
      return;
    }
    if (!hasCorrection || !summary || !detailedResults.length) {
      setError("لا يوجد تصحيح تفصيلي لحفظه. نفّذ «تصحيح تفصيلي» أولًا.");
      return;
    }
    setDetailedSaveBusy(true);
    setError("");
    const savedAt = new Date().toISOString();
    try {
      await updateCorrectionBatchSilently({
        status: "detailed_corrected",
        currentStep: "detailed",
        passPercent,
        correctionPayload: {
          summary,
          studentResults,
          questionStats,
          detailedResults,
          savedAt,
        },
        detailedPayload: {
          detailedResults,
          passPercent,
          savedAt,
          sheetExportId: selectedExamId || null,
        },
        eventType: "detailed",
        eventPayload: {
          action: "manual_save_detailed_correction",
          pagesCount: detailedResults.length,
        },
      });
      setUploadMsg("تم حفظ التصحيح التفصيلي في وجبة التصحيح المرتبطة بالملف/المادة بنجاح.");
    } catch {
      setError("تعذر حفظ التصحيح التفصيلي في الوجبة.");
    } finally {
      setDetailedSaveBusy(false);
    }
  };

  const buildDetailedOfficialPdfBuffer = async (): Promise<ArrayBuffer> => {
    const jsPDFModule = await import("jspdf");
    const autoTableModule = await import("jspdf-autotable");
    const JsPDFCtor = jsPDFModule.default;
    const autoTable = autoTableModule.default;
    const doc = new JsPDFCtor({ orientation: "portrait", unit: "mm", format: "a4" });
    const arabicFont = await ensureArabicPdfFont(doc);
    const arabicFormatter = arabicFont?.format ?? null;
    const activeFont = arabicFont?.fontName;
    const meta = selectedExamMeta;
    const collegeName = (meta?.college && String(meta.college).trim()) || "كلية الشرق التقنية التخصصية";
    const subjectLabel = meta?.subject_name || "—";
    const examDateStr = String(meta?.exam_date || "").trim() || "—";
    const correctionDt = new Date();
    /** أرقام لاتينية فقط — لا تمرّر عبر processArabic حتى لا تنكسر التواريخ والأوقات */
    const correctionDateLatin = `${correctionDt.getFullYear()}-${String(correctionDt.getMonth() + 1).padStart(2, "0")}-${String(correctionDt.getDate()).padStart(2, "0")} ${String(correctionDt.getHours()).padStart(2, "0")}:${String(correctionDt.getMinutes()).padStart(2, "0")}`;

    const fmt = (s: string) => (arabicFormatter ? arabicFormatter(s) : s);
    /** نص عربي للعرض فقط؛ القيم الرقمية/اللاتينية تُرسم بخط helvetica */
    const ar = (s: string) => fmt(String(s || ""));

    const pickPdfFont = (cellText: string, preferArabic: boolean): { font: string; style: "normal" | "bold" } => {
      const t = String(cellText ?? "");
      if (preferArabic && activeFont && containsArabicChars(t)) {
        return { font: activeFont, style: "normal" };
      }
      if (activeFont && containsArabicChars(t)) {
        return { font: activeFont, style: "normal" };
      }
      return { font: "helvetica", style: "normal" };
    };

    /** هيدر مضغوط (~22mm) */
    const headerH = 22;
    const contentTop = headerH + 6;

    for (let i = 0; i < detailedResults.length; i++) {
      const p = detailedResults[i]!;
      if (i > 0) doc.addPage("a4", "portrait");
      const ctx = pageTables.find((x) => x.pageIndex === p.pageIndex)?.context;
      const studentName =
        ctx?.studentName?.trim() || `ورقة رقم ${p.pageIndex + 1}`;
      const department = String(ctx?.department || meta?.department || "—").trim() || "—";
      const stage = String(ctx?.stage || meta?.stage || "—").trim() || "—";
      const study = formatStudyType(ctx?.studyType || meta?.study_type);
      const sheetCode = String(ctx?.sheetCode || ctx?.detectedSheetCode || "—").trim() || "—";
      const studentCode = String(ctx?.studentCode || "—").trim() || "—";
      const statusAr = p.status === "pass" ? "ناجح" : "راسب";
      const questionsPass = p.correctCount;
      const questionsFail = p.wrongCount + p.blankCount;

      doc.setFillColor(15, 76, 117);
      doc.rect(0, 0, 210, headerH, "F");
      doc.setFillColor(26, 115, 140);
      doc.rect(0, 0, 48, headerH, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      if (activeFont) doc.setFont(activeFont, "normal");
      doc.text(ar("تقرير تصحيح رسمي — ورقة امتحان"), 202, 9, { align: "right" });
      doc.setFontSize(7.5);
      doc.text(ar(collegeName), 202, 16, { align: "right" });
      if (activeFont) doc.setFont(activeFont, "normal");
      doc.setFontSize(7);
      doc.setTextColor(226, 232, 240);
      doc.text(ar(`صفحة الملف: ${p.pageIndex + 1}`), 8, 11, { align: "left" });

      /** صفّان من المعلومات في كل صف: [بيان، قيمة، بيان، قيمة] — 15 حقلًا = 8 صفوف (الصف الأخير خلية واحدة للنسبة) */
      const scoreStr = `${Math.round(p.score)} / ${Math.round(p.maxScore)}`;
      const pctStr = `${p.percentage.toFixed(1)}%`;
      const infoBody: string[][] = [
        [ar("اسم الطالب"), ar(studentName), ar("الكلية"), ar(collegeName)],
        [ar("المادة الامتحانية"), ar(subjectLabel), ar("القسم"), ar(department)],
        [ar("المرحلة الدراسية"), ar(stage), ar("نوع الدراسة"), ar(study)],
        [ar("كود ورقة الامتحان"), sheetCode, ar("كود الطالب"), studentCode],
        [ar("تاريخ إجراء الامتحان"), examDateStr, ar("تاريخ التصحيح"), correctionDateLatin],
        [ar("النتيجة العامة"), ar(statusAr), ar("عدد الأسئلة الناجحة"), String(questionsPass)],
        [ar("عدد الأسئلة الراسبة"), String(questionsFail), ar("الدرجة"), scoreStr],
        [ar("النسبة المئوية"), pctStr, "", ""],
      ];

      autoTable(doc, {
        startY: contentTop,
        margin: { left: 10, right: 10 },
        head: [[ar("البيان"), ar("القيمة"), ar("البيان"), ar("القيمة")]],
        body: infoBody,
        theme: "plain",
        styles: {
          fontSize: 8,
          cellPadding: 1.15,
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
          minCellHeight: 5.5,
          valign: "middle",
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        headStyles: {
          fillColor: [30, 64, 175],
          textColor: [255, 255, 255],
          fontStyle: "normal",
          ...(activeFont ? { font: activeFont, halign: "right" as const } : {}),
        },
        columnStyles: {
          0: { cellWidth: 34, fontStyle: "normal" },
          1: { cellWidth: 58 },
          2: { cellWidth: 34, fontStyle: "normal" },
          3: { cellWidth: 58 },
        },
        didParseCell: (hookData) => {
          hookData.cell.styles.fontStyle = "normal";
          const col = hookData.column.index;
          const isLabelCol = col === 0 || col === 2;
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          const picked = pickPdfFont(rawText, isLabelCol || hookData.section === "head");
          hookData.cell.styles.font = picked.font;
        },
      });

      const yAfter = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? contentTop + 50;
      const tableStart = yAfter + 5;

      autoTable(doc, {
        startY: tableStart,
        margin: { left: 10, right: 10, bottom: 12 },
        pageBreak: "auto",
        head: [[ar("السؤال"), ar("إجابة الطالب"), ar("النموذجية"), ar("درجة السؤال"), ar("المكتسبة"), ar("الحالة")]],
        body: p.details.map((d) => {
          const st = d.result === "correct" ? ar("صحيح") : d.result === "wrong" ? ar("خاطئ") : ar("فارغ");
          const blankLabel = ar("بدون إجابة");
          return [
            String(d.questionNumber),
            d.studentAnswer ? String(d.studentAnswer) : blankLabel,
            String(d.correctAnswer || "—"),
            String(Math.round(d.questionScore)),
            String(Math.round(d.earnedScore)),
            st,
          ];
        }),
        theme: "grid",
        styles: {
          fontSize: 7,
          cellPadding: 0.95,
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        headStyles: {
          fillColor: [15, 118, 110],
          textColor: [255, 255, 255],
          fontStyle: "normal",
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        columnStyles: {
          0: { cellWidth: 14, halign: "center" },
          1: { cellWidth: 22 },
          2: { cellWidth: 16 },
          3: { cellWidth: 22 },
          4: { cellWidth: 22 },
          5: { cellWidth: 20 },
        },
        didParseCell: (hookData) => {
          hookData.cell.styles.fontStyle = "normal";
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          const isHead = hookData.section === "head";
          const picked = pickPdfFont(rawText, isHead);
          hookData.cell.styles.font = picked.font;
        },
      });

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("Systimit — Correction", 105, 288, { align: "center" });
    }

    return doc.output("arraybuffer");
  };

  const exportDetailedOfficialPdf = async () => {
    if (!detailedResults.length) {
      setError("لا يوجد تصحيح تفصيلي للتصدير.");
      return;
    }
    setDetailedExportBusy("pdf");
    setError("");
    try {
      const buf = await buildDetailedOfficialPdfBuffer();
      const blob = new Blob([buf], { type: "application/pdf" });
      const subject = sanitizeFileName(selectedExamMeta?.subject_name || "تقرير-تفصيلي");
      const fileName = `${subject}-تقرير-رسمي-للأوراق-${new Date().toISOString().slice(0, 10)}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير PDF التقرير الرسمي.");
    } finally {
      setDetailedExportBusy("none");
    }
  };

  const exportDetailedOfficialExcel = async () => {
    if (!detailedResults.length) {
      setError("لا يوجد تصحيح تفصيلي للتصدير.");
      return;
    }
    setDetailedExportBusy("excel");
    setError("");
    const meta = selectedExamMeta;
    const collegeName = (meta?.college && String(meta.college).trim()) || "كلية الشرق التقنية التخصصية";
    const examDateStr = String(meta?.exam_date || "").trim() || "—";
    const correctionDt = new Date();
    const correctionDateStr = correctionDt.toLocaleString("ar-IQ");

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "systimit";
      wb.created = correctionDt;

      const summarySheet = wb.addWorksheet("ملخص كل ورقة", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });
      const summaryHeaders = [
        "صفحة الملف",
        "اسم الطالب",
        "الكلية",
        "المادة الامتحانية",
        "القسم",
        "المرحلة",
        "نوع الدراسة",
        "كود ورقة الامتحان",
        "كود الطالب",
        "النتيجة",
        "عدد الأسئلة الناجحة",
        "عدد الأسئلة الراسبة",
        "صحيحة",
        "خاطئة",
        "فارغة",
        "الدرجة",
        "الدرجة الكلية",
        "النسبة %",
        "تاريخ الامتحان",
        "تاريخ التصحيح",
      ];
      summarySheet.addRow(summaryHeaders);
      for (const p of detailedResults) {
        const ctx = pageTables.find((x) => x.pageIndex === p.pageIndex)?.context;
        const studentName =
          ctx?.studentName?.trim() || `ورقة رقم ${p.pageIndex + 1}`;
        summarySheet.addRow([
          p.pageIndex + 1,
          studentName,
          collegeName,
          meta?.subject_name || "—",
          String(ctx?.department || meta?.department || "—"),
          String(ctx?.stage || meta?.stage || "—"),
          formatStudyType(ctx?.studyType || meta?.study_type),
          String(ctx?.sheetCode || ctx?.detectedSheetCode || "—"),
          String(ctx?.studentCode || "—"),
          p.status === "pass" ? "ناجح" : "راسب",
          p.correctCount,
          p.wrongCount + p.blankCount,
          p.correctCount,
          p.wrongCount,
          p.blankCount,
          Math.round(p.score),
          Math.round(p.maxScore),
          Math.round(p.percentage),
          examDateStr,
          correctionDateStr,
        ]);
      }
      const sh = summarySheet.getRow(1);
      sh.height = 22;
      sh.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C75" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      summarySheet.columns = summaryHeaders.map(() => ({ width: 18 }));

      for (const p of detailedResults) {
        const ctx = pageTables.find((x) => x.pageIndex === p.pageIndex)?.context;
        const title =
          ctx?.studentName?.trim() ||
          (ctx?.sheetCode || ctx?.detectedSheetCode
            ? `ورقة ${ctx.sheetCode || ctx.detectedSheetCode}`
            : `صفحة_${p.pageIndex + 1}`);
        const ws = wb.addWorksheet(sanitizeFileName(title).slice(0, 28) || `صفحة_${p.pageIndex + 1}`, {
          views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }],
        });
        ws.mergeCells("A1:F1");
        const h = ws.getCell("A1");
        h.value = "تقرير تصحيح رسمي — تفاصيل الأسئلة";
        h.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        h.alignment = { horizontal: "center", vertical: "middle" };
        h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
        ws.getRow(1).height = 26;

        const metaRows: [string, string][] = [
          ["الكلية", collegeName],
          ["اسم الطالب", ctx?.studentName?.trim() || "—"],
          ["القسم", String(ctx?.department || meta?.department || "—")],
          ["المرحلة", String(ctx?.stage || meta?.stage || "—")],
          ["نوع الدراسة", formatStudyType(ctx?.studyType || meta?.study_type)],
          ["كود الورقة", String(ctx?.sheetCode || ctx?.detectedSheetCode || "—")],
          ["كود الطالب", String(ctx?.studentCode || "—")],
          ["النتيجة", p.status === "pass" ? "ناجح" : "راسب"],
          ["عدد الأسئلة الناجحة", String(p.correctCount)],
          ["عدد الأسئلة الراسبة", String(p.wrongCount + p.blankCount)],
          ["تاريخ الامتحان", examDateStr],
          ["تاريخ التصحيح", correctionDateStr],
          ["الدرجة", `${Math.round(p.score)} / ${Math.round(p.maxScore)}`],
          ["النسبة", `${p.percentage.toFixed(1)}%`],
        ];
        let r = 3;
        for (const [k, v] of metaRows) {
          const row = ws.getRow(r);
          row.getCell(1).value = k;
          row.getCell(2).value = v;
          row.getCell(1).font = { bold: true };
          row.eachCell((cell) => {
            cell.border = {
              top: { style: "thin", color: { argb: "FFCBD5E1" } },
              left: { style: "thin", color: { argb: "FFCBD5E1" } },
              bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
              right: { style: "thin", color: { argb: "FFCBD5E1" } },
            };
            cell.alignment = { horizontal: "right", vertical: "middle" };
          });
          r++;
        }
        r += 1;
        const hdr = ["السؤال", "إجابة الطالب", "النموذجية", "درجة السؤال", "المكتسبة", "الحالة"];
        const hr = ws.getRow(r);
        hdr.forEach((text, i) => {
          const c = hr.getCell(i + 1);
          c.value = text;
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
          c.alignment = { horizontal: "center", vertical: "middle" };
        });
        r++;
        for (const d of p.details) {
          const row = ws.getRow(r);
          row.getCell(1).value = d.questionNumber;
          row.getCell(2).value = d.studentAnswer || "بدون إجابة";
          row.getCell(3).value = d.correctAnswer;
          row.getCell(4).value = Math.round(d.questionScore);
          row.getCell(5).value = Math.round(d.earnedScore);
          row.getCell(6).value = d.result === "correct" ? "صحيح" : d.result === "wrong" ? "خاطئ" : "فارغ";
          row.eachCell((cell) => {
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
              top: { style: "thin", color: { argb: "FFE2E8F0" } },
              left: { style: "thin", color: { argb: "FFE2E8F0" } },
              bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
              right: { style: "thin", color: { argb: "FFE2E8F0" } },
            };
          });
          r++;
        }
        ws.columns = [{ width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const subject = sanitizeFileName(meta?.subject_name || "تقرير-تفصيلي");
      const fileName = `${subject}-تقرير-رسمي-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير Excel التقرير الرسمي.");
    } finally {
      setDetailedExportBusy("none");
    }
  };

  const exportCorrectionPdf = async () => {
    if (!hasCorrection || !summary || !studentResults.length) {
      setError("لا توجد نتائج تصحيح لتصديرها.");
      return;
    }
    setCorrectionExportBusy("pdf");
    setError("");
    try {
      const jsPDFModule = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const JsPDFCtor = jsPDFModule.default;
      const autoTable = autoTableModule.default;
      const doc = new JsPDFCtor({ orientation: "portrait", unit: "mm", format: "a4" });
      const arabicFont = await ensureArabicPdfFont(doc);
      const arabicFormatter = arabicFont?.format ?? null;
      const activeFont = arabicFont?.fontName;
      if (activeFont) doc.setFont(activeFont, "normal");
      const collegeName = selectedExamMeta?.college || "كلية الشرق التقنية التخصصية";
      const departmentName = selectedExamMeta?.department || "غير محدد";
      const stageName = selectedExamMeta?.stage || "غير محدد";
      const studyName = formatStudyType(selectedExamMeta?.study_type);
      const subjectName = selectedExamMeta?.subject_name || "غير محدد";
      const examDate = String(selectedExamMeta?.exam_date || "").slice(0, 10) || "-";
      const correctionDate = new Date().toISOString().slice(0, 10);

      // Header
      doc.setFillColor(15, 23, 42);
      doc.rect(10, 10, 190, 16, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15);
      doc.text(arabicFormatter ? arabicFormatter("تقرير التصحيح الرسمي") : "Correction Report", 195, 20, { align: "right" });
      // ضع التاريخين في نفس سطر الهيدر بدون معالجة عربية مختلطة لتجنب انقلاب الاتجاه.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Exam: ${examDate} | Correction: ${correctionDate}`, 14, 20, { align: "left" });
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      if (activeFont) doc.setFont(activeFont, "normal");

      // Meta section
      const metaRows = [
        `الكلية: ${collegeName}`,
        `القسم: ${departmentName}`,
        `المرحلة الدراسية: ${stageName}`,
        `نوع الدراسة: ${studyName}`,
        `المادة الامتحانية: ${subjectName}`,
      ];
      let metaY = 34;
      for (const line of metaRows) {
        doc.text(arabicFormatter ? arabicFormatter(line) : line, 195, metaY, { align: "right" });
        metaY += 6;
      }

      // KPI cards
      const cardY = metaY + 2;
      const cards: Array<{ label: string; value: string; color: [number, number, number] }> = [
        { label: "عدد الطلاب", value: String(summary.studentsCount), color: [30, 64, 175] },
        { label: "نسبة النجاح", value: `${summary.passRate.toFixed(1)}%`, color: [5, 150, 105] },
        { label: "عدد الناجحين", value: String(summary.passCount), color: [22, 163, 74] },
        { label: "عدد الراسبين", value: String(summary.failCount), color: [220, 38, 38] },
      ];
      const cardW = 45;
      const gap = 3;
      cards.forEach((card, i) => {
        const x = 10 + i * (cardW + gap);
        doc.setFillColor(card.color[0], card.color[1], card.color[2]);
        doc.rect(x, cardY, cardW, 18, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.text(arabicFormatter ? arabicFormatter(card.label) : card.label, x + cardW - 2, cardY + 6, { align: "right" });
        doc.setFontSize(11);
        doc.text(card.value, x + cardW - 2, cardY + 14, { align: "right" });
      });
      doc.setTextColor(15, 23, 42);

      autoTable(doc, {
        startY: cardY + 24,
        head: [[
          arabicFormatter ? arabicFormatter("الطالب") : "Student",
          arabicFormatter ? arabicFormatter("الكود") : "Code",
          arabicFormatter ? arabicFormatter("الورقة") : "Sheet",
          arabicFormatter ? arabicFormatter("صحيح") : "Correct",
          arabicFormatter ? arabicFormatter("خطأ") : "Wrong",
          arabicFormatter ? arabicFormatter("فارغ") : "Blank",
          arabicFormatter ? arabicFormatter("الدرجة") : "Score",
          arabicFormatter ? arabicFormatter("النسبة") : "Percent",
          arabicFormatter ? arabicFormatter("الحالة") : "Status",
        ]],
        body: studentResults.map((r) => {
          const rc = pageTables.find((p) => p.pageIndex === r.pageIndex)?.context;
          return [
            arabicFormatter
              ? arabicFormatter(rc?.studentName?.trim() || `صفحة ${r.pageIndex + 1}`)
              : rc?.studentName?.trim() || `Page ${r.pageIndex + 1}`,
            rc?.studentCode || "",
            rc?.sheetCode || rc?.detectedSheetCode || "",
            String(r.correctCount),
            String(r.wrongCount),
            String(r.blankCount),
            `${Math.round(r.score)} / ${Math.round(r.maxScore)}`,
            `${r.percentage.toFixed(1)}%`,
            arabicFormatter ? arabicFormatter(r.status === "pass" ? "ناجح" : "راسب") : r.status === "pass" ? "PASS" : "FAIL",
          ];
        }),
        theme: "grid",
        styles: {
          fontSize: 8,
          ...(activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : {}),
        },
        headStyles: { fillColor: [15, 23, 42] },
        bodyStyles: activeFont ? { font: activeFont, fontStyle: "normal", halign: "right" as const } : undefined,
        didParseCell: (hookData) => {
          const rawText =
            hookData.cell.raw != null
              ? String(hookData.cell.raw)
              : Array.isArray(hookData.cell.text)
              ? hookData.cell.text.join(" ")
              : String(hookData.cell.text ?? "");
          if (!containsArabicChars(rawText)) {
            hookData.cell.styles.font = "helvetica";
            hookData.cell.styles.fontStyle = "normal";
          } else if (activeFont) {
            hookData.cell.styles.font = activeFont;
            hookData.cell.styles.fontStyle = "normal";
          }
        },
      });
      doc.save(`correction-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      setError("تعذر تصدير PDF للتصحيح.");
    } finally {
      setCorrectionExportBusy("none");
    }
  };

  return (
    <main dir="rtl" className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <h1 className="text-lg font-bold text-slate-800">اختبار</h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveFullPageStateToBatch()}
                disabled={
                  fullSaveBusy ||
                  !activeBatchId ||
                  (!pageTables.length && !hasCorrection) ||
                  analyzeBusy ||
                  correctBusy
                }
                className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-60"
              >
                {fullSaveBusy ? "جاري الحفظ في الوجبة…" : "حفظ كل البيانات في الوجبة"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined" && !window.confirm("مسح الجلسة المحلية؟ ستُفقد البيانات غير المحفوظة في الوجبة.")) {
                    return;
                  }
                  clearWorkSessionAndReset();
                  setUploadMsg("تم مسح الجلسة المحلية.");
                }}
                disabled={analyzeBusy || correctBusy || fullSaveBusy}
                className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
              >
                مسح الجلسة المحلية
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">الامتحان (المفتاح النموذجي)</label>
              <select
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="h-10 w-full rounded-lg border px-3 text-sm"
              >
                <option value="">— اختر امتحانًا —</option>
                {exams.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.subject_name} — {r.exam_date} — {(r.department || "").trim()} / {(r.stage || "").trim()} /{" "}
                    {r.study_type === "evening" ? "مسائي" : "صباحي"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">نسبة النجاح (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={passPercent}
                onChange={(e) => setPassPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="h-10 w-full rounded-lg border px-3 text-sm"
              />
            </div>
          </div>
          <div className="mt-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3">
            <label className="mb-2 block text-sm font-semibold text-slate-700">ارفع ملف الاختبار</label>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                type="file"
                accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/bmp,image/tiff"
                disabled={!selectedExamId}
                onChange={(e) => {
                  try {
                    localStorage.removeItem(CORRECTION_TEST_WORK_SESSION_KEY);
                  } catch {
                    // ignore
                  }
                  setFileStore(e.target.files?.[0] || null);
                  setSessionFileHint(null);
                  setActiveBatchId(null);
                  setAnalyzeSearchTerm("");
                  setUploaded(false);
                  setUploadMsg("");
                  setError("");
                  setPageTables([]);
                  setFileMeta(null);
                  setPdfStaleEngine(false);
                  setStudentResults([]);
                  setQuestionStats([]);
                  setSummary(null);
                  setDetailedResults([]);
                  setShowDetailed(false);
                  setShowCustomCorrection(false);
                  setSelectedPagesMap({});
                  setUploadedPagesPreview([]);
                  setShowUploadedPages(false);
                  setActiveView("none");
                  setAnalyzeDebugImages(null);
                  setCompareBundle(null);
                }}
                className="block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
              <button
                type="button"
                onClick={onUpload}
                disabled={!fileStore || analyzeBusy || correctBusy}
                className="whitespace-nowrap rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                رفع ملف الاختبار
              </button>
              <button
                type="button"
                onClick={() => void onPreviewUploadedPages()}
                disabled={!uploaded || previewBusy || analyzeBusy || correctBusy}
                className="whitespace-nowrap rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {previewBusy ? "جاري تجهيز الصفحات..." : "معاينة الصفحات المرفوعة"}
              </button>
            </div>
            {sessionFileHint && !fileStore ? (
              <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-950">
                <strong>ملف الجلسة المحفوظة:</strong> {sessionFileHint.name} ({Math.round(sessionFileHint.size / 1024)}{" "}
                ك.ب) — أعد اختيار نفس الملف في الحقل أعلاه لتشغيل «تحليل الملف» من جديد؛ بقية النتائج معروضة من الجلسة.
              </p>
            ) : null}
          </div>
          {showOmrDebugToggle ? (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={omrDebugMode}
                onChange={(e) => setOmrDebugMode(e.target.checked)}
                className="rounded border-slate-400"
              />
              طلب صور تشخيص OMR من Python (بطيء قليلًا) — للتحقق من محاذاة الفقاعات مع الشيت بعد «تحليل الملف»
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-800">
            <label className="font-semibold">
              نموذج OMR (معاينة الدوائر + ملفات المعايرة):
              <select
                value={omrTemplateCode}
                onChange={(e) => {
                  const v = e.target.value as typeof omrTemplateCode;
                  setOmrTemplateCode(v);
                }}
                className="ms-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="OMR_25">OMR_25 (25 سؤال)</option>
                <option value="OMR_50">OMR_50 (50 سؤال)</option>
                <option value="OMR_75">OMR_75 (75 سؤال)</option>
                <option value="OMR_100">OMR_100 (100 سؤال)</option>
              </select>
            </label>
            <span className="text-xs text-slate-500">
              يجب أن يطابق نفس القالب في{" "}
              <code className="rounded bg-slate-100 px-0.5">/Correction/calibration</code> وملفات PDF داخل{" "}
              <code className="rounded bg-slate-100 px-0.5">services/omr-python</code>.
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onAnalyze()}
              disabled={!uploaded || analyzeBusy || correctBusy}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {analyzeBusy ? "جاري التحليل..." : "تحليل الملف"}
            </button>
            <button
              type="button"
              onClick={() => void onCorrect()}
              disabled={!uploaded || analyzeBusy || correctBusy || pageTables.length === 0}
              className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {correctBusy ? "جاري التصحيح..." : "تصحيح الأوراق"}
            </button>
            <button
              type="button"
              onClick={() => void onCorrect(true, undefined, "detailed")}
              disabled={!uploaded || analyzeBusy || correctBusy || pageTables.length === 0 || !selectedExamId}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {correctBusy ? "جاري التصحيح التفصيلي..." : "تصحيح تفصيلي"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustomCorrection(true);
                setActiveView("custom");
                void ensurePreviewsForCustomSheets();
              }}
              disabled={analyzeBusy || correctBusy || pageTables.length === 0}
              className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              تصحيح مخصص
            </button>
            <button
              type="button"
              onClick={() => void onExportCorrectionReport()}
              disabled={!hasCorrection || correctBusy || analyzeBusy}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              تصدير التصحيح Excel
            </button>
          </div>
          {uploadMsg ? <p className="mt-3 text-sm font-semibold text-emerald-700">{uploadMsg}</p> : null}
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

          {activeView === "custom" && showCustomCorrection && pageTables.length > 0 ? (
            <div className="mt-6 space-y-4 rounded-xl border border-orange-200 bg-orange-50/40 p-4 sm:p-5">
              <h2 className="text-lg font-bold text-slate-900">التصحيح المخصص (تحديد/استبعاد الأوراق)</h2>
              <p className="text-sm text-slate-600">
                تظهر هنا فقط صفحات الملف التي تم تحليلها. حدّد الأوراق المراد تصحيحها ثم اضغط «تصحيح المحدد». يتم توليد معاينة PDF تلقائيًا عند فتح هذه الشاشة؛ إن تعذّرت المعاينة تُعرض بيانات الطالب (الاسم، الكود، المرحلة).
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<number, boolean> = {};
                    for (const p of pageTables) next[p.pageIndex] = true;
                    setSelectedPagesMap(next);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
                >
                  تحديد الكل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<number, boolean> = {};
                    for (const p of pageTables) next[p.pageIndex] = false;
                    setSelectedPagesMap(next);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
                >
                  إلغاء تحديد الكل
                </button>
                <button
                  type="button"
                  onClick={() => void onCustomCorrect()}
                  disabled={correctBusy || selectedPageIndexes.length === 0}
                  className="rounded-md bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {correctBusy ? "جاري التصحيح..." : `تصحيح المحدد (${selectedPageIndexes.length})`}
                </button>
              </div>

              {customThumbBusy ? (
                <p className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-center text-sm text-slate-600">
                  جاري تجهيز معاينة الصفحات من الملف (PDF أو صورة)…
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {pageTables.map((p, idx) => {
                  const checked = Boolean(selectedPagesMap[p.pageIndex]);
                  const previewSrc =
                    uploadedPagesPreview[p.pageIndex] ?? uploadedPagesPreview[idx] ?? "";
                  const cc = p.context;
                  const stageShow =
                    String(cc?.stage || selectedExamMeta?.stage || "").trim() || "—";
                  const customLabel =
                    cc?.studentName?.trim() ||
                    (cc?.sheetCode || cc?.detectedSheetCode
                      ? `كود ورقة ${cc.sheetCode || cc.detectedSheetCode}`
                      : `صفحة ${p.pageIndex + 1}`);
                  return (
                    <div
                      key={`custom-page-${p.pageIndex}`}
                      className={`rounded-xl border p-3 ${checked ? "border-emerald-300 bg-emerald-50/40" : "border-slate-300 bg-white"}`}
                    >
                      <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedPagesMap((prev) => ({
                              ...prev,
                              [p.pageIndex]: e.target.checked,
                            }))
                          }
                        />
                        {customLabel}{" "}
                        <span className="text-xs font-normal text-slate-500">(صفحة ملف {p.pageIndex + 1})</span>{" "}
                        {checked ? "(سيتم تصحيحها)" : "(مستبعدة)"}
                      </label>
                      {!customThumbBusy && previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={`custom-preview-${p.pageIndex + 1}`}
                          className="max-h-80 w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
                        />
                      ) : !customThumbBusy ? (
                        <dl className="grid gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-700 sm:grid-cols-2">
                          <div>
                            <dt className="font-semibold text-slate-800">اسم الطالب</dt>
                            <dd className="mt-0.5">{cc?.studentName?.trim() || "—"}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-slate-800">كود الطالب</dt>
                            <dd className="mt-0.5 font-mono">{cc?.studentCode?.trim() || "—"}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-slate-800">المرحلة</dt>
                            <dd className="mt-0.5">{stageShow}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-slate-800">كود الورقة</dt>
                            <dd className="mt-0.5 font-mono">
                              {cc?.sheetCode || cc?.detectedSheetCode || "—"}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {correctBusy && activeView === "custom" ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-950">
                  جاري تصحيح الأوراق المحددة…
                </p>
              ) : null}

              {hasCorrection && summary && activeView === "custom" && studentResults.length > 0 ? (
                <div className="mt-6 space-y-3 border-t border-orange-300 pt-4">
                  <h3 className="text-base font-bold text-slate-900">نتيجة التصحيح للأوراق المحددة</h3>
                  <p className="text-xs text-slate-600">
                    {selectedExamMeta?.subject_name ? (
                      <span>
                        المادة: <strong>{selectedExamMeta.subject_name}</strong>
                      </span>
                    ) : null}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="border border-slate-300 px-3 py-2 text-right">الصفحة / الطالب</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">صحيحة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">خاطئة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">فارغة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">الدرجة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">النسبة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentResults.map((r) => {
                          const rc = pageTables.find((pt) => pt.pageIndex === r.pageIndex)?.context;
                          const who =
                            rc?.studentName?.trim() ||
                            (rc?.sheetCode || rc?.detectedSheetCode
                              ? `كود ورقة ${rc.sheetCode || rc.detectedSheetCode}`
                              : null);
                          const dept = String(rc?.department || selectedExamMeta?.department || "").trim();
                          const stage = String(rc?.stage || selectedExamMeta?.stage || "").trim();
                          const study = formatStudyType(rc?.studyType || selectedExamMeta?.study_type);
                          return (
                            <tr key={`custom-correct-res-${r.pageIndex}`}>
                              <td className="border border-slate-300 px-3 py-2">
                                {who ? (
                                  <span>
                                    {who}
                                    <span className="mt-0.5 block text-xs text-slate-500">
                                      صفحة الملف {r.pageIndex + 1} — {dept || "—"} | {stage || "—"} | {study}
                                    </span>
                                  </span>
                                ) : (
                                  <span>
                                    صفحة الملف {r.pageIndex + 1}
                                    <span className="mt-0.5 block text-xs text-slate-500">
                                      {dept || "—"} | {stage || "—"} | {study}
                                    </span>
                                  </span>
                                )}
                              </td>
                              <td className="border border-slate-300 px-3 py-2">{r.correctCount}</td>
                              <td className="border border-slate-300 px-3 py-2">{r.wrongCount}</td>
                              <td className="border border-slate-300 px-3 py-2">{r.blankCount}</td>
                              <td className="border border-slate-300 px-3 py-2">
                                {Math.round(r.score)} / {Math.round(r.maxScore)}
                              </td>
                              <td className="border border-slate-300 px-3 py-2">{r.percentage.toFixed(1)}%</td>
                              <td
                                className={`border border-slate-300 px-3 py-2 font-semibold ${
                                  r.status === "pass" ? "text-emerald-700" : "text-rose-700"
                                }`}
                              >
                                {r.status === "pass" ? "ناجح" : "راسب"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {detailedResults.length > 0 ? (
                    <div className="space-y-6 pt-2">
                      <h3 className="text-base font-bold text-slate-900">تفاصيل التصحيح لكل ورقة</h3>
                      {detailedResults.map((p) => {
                        const dc = pageTables.find((x) => x.pageIndex === p.pageIndex)?.context;
                        const dtitle =
                          dc?.studentName?.trim() ||
                          (dc?.sheetCode || dc?.detectedSheetCode
                            ? `كود ورقة ${dc.sheetCode || dc.detectedSheetCode}`
                            : `صفحة ${p.pageIndex + 1}`);
                        return (
                          <div
                            key={`custom-detail-${p.pageIndex}`}
                            className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm"
                          >
                            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                              <span className="font-bold text-slate-800">{dtitle}</span>
                              <span className="text-xs text-slate-500">صفحة الملف {p.pageIndex + 1}</span>
                              <span className="text-slate-600">
                                الدرجة: {Math.round(p.score)} / {Math.round(p.maxScore)}
                              </span>
                              <span className="text-slate-600">النسبة: {p.percentage.toFixed(1)}%</span>
                              <span
                                className={
                                  p.status === "pass" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"
                                }
                              >
                                {p.status === "pass" ? "ناجح" : "راسب"}
                              </span>
                              <span className="text-slate-600">
                                صحيحة: {p.correctCount} | خاطئة: {p.wrongCount} | فارغة: {p.blankCount}
                              </span>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-300">
                              <table className="w-full border-collapse text-sm">
                                <thead className="bg-slate-100">
                                  <tr>
                                    <th className="border border-slate-300 px-3 py-2 text-right">السؤال</th>
                                    <th className="border border-slate-300 px-3 py-2 text-right">إجابة الطالب</th>
                                    <th className="border border-slate-300 px-3 py-2 text-right">النموذجية</th>
                                    <th className="border border-slate-300 px-3 py-2 text-right">درجة السؤال</th>
                                    <th className="border border-slate-300 px-3 py-2 text-right">المكتسبة</th>
                                    <th className="border border-slate-300 px-3 py-2 text-right">النتيجة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.details.map((d) => (
                                    <tr key={`custom-detail-${p.pageIndex}-q-${d.questionNumber}`}>
                                      <td className="border border-slate-300 px-3 py-2">{d.questionNumber}</td>
                                      <td className="border border-slate-300 px-3 py-2">
                                        {d.studentAnswer || "بدون إجابة"}
                                      </td>
                                      <td className="border border-slate-300 px-3 py-2">{d.correctAnswer}</td>
                                      <td className="border border-slate-300 px-3 py-2">
                                        {Math.round(d.questionScore)}
                                      </td>
                                      <td className="border border-slate-300 px-3 py-2">
                                        {Math.round(d.earnedScore)}
                                      </td>
                                      <td
                                        className={`border border-slate-300 px-3 py-2 font-semibold ${
                                          d.result === "correct"
                                            ? "text-emerald-700"
                                            : d.result === "wrong"
                                            ? "text-rose-700"
                                            : "text-amber-700"
                                        }`}
                                      >
                                        {d.result === "correct" ? "صحيح" : d.result === "wrong" ? "خاطئ" : "فارغ"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {hasCorrection && activeView === "custom" ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-orange-200 pt-4">
                  <p className="w-full text-sm font-semibold text-slate-800">حفظ أو تصدير نتائج التصحيح:</p>
                  <button
                    type="button"
                    onClick={() => void saveCorrectionToBatch()}
                    disabled={correctionSaveBusy || !activeBatchId}
                    className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {correctionSaveBusy ? "جاري الحفظ..." : "حفظ التصحيح"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportCorrectionPdf()}
                    disabled={correctionExportBusy !== "none"}
                    className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {correctionExportBusy === "pdf" ? "جاري التصدير..." : "تصدير التصحيح PDF (A4)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onExportCorrectionReport()}
                    disabled={correctionExportBusy !== "none"}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {correctionExportBusy === "excel" ? "جاري التصدير..." : "تصدير التصحيح Excel"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeView === "analyze" && pdfStaleEngine ? (
            <div
              className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              role="status"
            >
              يبدو أن ملف PDF يحتوي صفحات أكثر ({fileMeta?.totalPages ?? "؟"}) مما عُرض في الجداول (
              {pageTables.length}). غالبًا خدمة Python ما زالت تشغّل نسخة قديمة من الكود.
              <span className="mt-1 block font-semibold">
                أوقف عملية uvicorn ثم شغّلها من جديد من مجلد <code className="rounded bg-amber-100 px-1">services/omr-python</code>.
              </span>
            </div>
          ) : null}

          {activeView === "analyze" && analyzeDebugImages && Object.keys(analyzeDebugImages).length > 0 ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-sm font-bold text-slate-800">تشخيص OMR (Python)</p>
              <p className="mb-3 text-xs text-slate-600">
                إن كانت دوائر <code className="rounded bg-white px-1">roiOverlay</code> غير متمركزة على الفقاعات
                المظلّلة، فالمشكلة هندسية (استخراج حدود الصفحة أو القالب) وليست المعايرة فقط. جرّب تعديل{" "}
                <code className="rounded bg-white px-1">ANSWER_GLOBAL_NX_SHIFT</code> /{" "}
                <code className="rounded bg-white px-1">ANSWER_GLOBAL_NY_SHIFT</code> في{" "}
                <code className="rounded bg-white px-1">services/omr-python/template_config.py</code> ثم أعد تشغيل
                uvicorn.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(analyzeDebugImages).map(([key, dataUrl]) => (
                  <div key={key} className="rounded-lg border bg-white p-2 shadow-sm">
                    <p className="mb-1 truncate text-xs font-semibold text-slate-700">{key}</p>
                    <img
                      src={dataUrl.startsWith("data:") ? dataUrl : `data:image/png;base64,${dataUrl}`}
                      alt={key}
                      className="max-h-64 w-full object-contain"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeView === "analyze" && showCalibrationComparePanel && compareBundle && pageTables.length > 0 ? (
            <OmrCalibrationComparePanels
              calibrationImageSrc={compareBundle.calibUrl}
              pageWidth={compareBundle.pageW}
              pageHeight={compareBundle.pageH}
              overlayPoints={compareBundle.points}
              examWarpedSrc={
                analyzeDebugImages?.warped
                  ? analyzeDebugImages.warped.startsWith("data:")
                    ? analyzeDebugImages.warped
                    : `data:image/png;base64,${analyzeDebugImages.warped}`
                  : null
              }
              examFallbackSrc={examCompareDisplaySrc ?? uploadedPagesPreview[0] ?? null}
              examFallbackNyShift={compareBundle.examFallbackNyShift}
              examScanNyNudge={compareBundle.examScanNyNudge}
            />
          ) : null}

          {activeView === "analyze" && fileMeta && pageTables.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              صفحات الملف (حسب القراءة): <strong>{fileMeta.totalPages}</strong> — تم عرض جداول لعدد:{" "}
              <strong>{pageTables.length}</strong>
            </p>
          ) : null}

          {activeView === "analyze" && pageTables.length > 0 ? (
            <div className="mt-6 space-y-10">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveAnalysisToBatch()}
                  disabled={analysisSaveBusy || !activeBatchId}
                  className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {analysisSaveBusy ? "جاري الحفظ..." : "حفظ التحليل"}
                </button>
                <button
                  type="button"
                  onClick={() => void exportAnalyzePdf()}
                  disabled={analysisExportBusy !== "none"}
                  className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {analysisExportBusy === "pdf" ? "جاري التصدير..." : "تصدير PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => void exportAnalyzeExcel()}
                  disabled={analysisExportBusy !== "none"}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {analysisExportBusy === "excel" ? "جاري التصدير..." : "تصدير Excel"}
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input
                  value={analyzeSearchTerm}
                  onChange={(e) => setAnalyzeSearchTerm(e.target.value)}
                  placeholder="ابحث عن الطالب (الاسم/كود الطالب/كود الورقة/القسم/المرحلة/رقم الصفحة)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  نتائج البحث: {filteredAnalyzePages.length} من أصل {pageTables.length} صفحة.
                </p>
              </div>
              {filteredAnalyzePages.map((block, blockIdx) => {
                const c = block.context;
                const primaryTitle =
                  c.studentName?.trim() ||
                  (c.sheetCode || c.detectedSheetCode
                    ? `ورقة غير مطابقة في القائمة (كود ${c.sheetCode || c.detectedSheetCode})`
                    : `صفحة ${block.pageIndex + 1}`);
                return (
                <article key={`page-${blockIdx}-${block.pageIndex}`} className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-bold text-slate-900">{primaryTitle}</h2>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-900">
                        صفحة التحليل {block.pageIndex + 1}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">ترقيم الملف: الصفحة {block.pageIndex + 1}</p>
                    <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm text-slate-700 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <dt className="inline font-semibold text-slate-800">المادة الامتحانية: </dt>
                        <dd className="inline">{c.subjectName?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">رمز المادة: </dt>
                        <dd className="inline font-mono">{c.subjectCode?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">تاريخ الامتحان: </dt>
                        <dd className="inline">{c.examDate?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">المرحلة: </dt>
                        <dd className="inline">{c.stage?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">نوع الدراسة: </dt>
                        <dd className="inline">{formatStudyType(c.studyType)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">القسم: </dt>
                        <dd className="inline">{c.department?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">كود الطالب (جامعة): </dt>
                        <dd className="inline font-mono">{c.studentCode?.trim() || "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-slate-800">كود ورقة الامتحان: </dt>
                        <dd className="inline font-mono">
                          {c.sheetCode || c.detectedSheetCode || "—"}
                          {c.detectedReadoutRaw && c.detectedReadoutRaw !== (c.sheetCode || c.detectedSheetCode) ? (
                            <span className="mr-2 text-xs text-slate-500">(من المسح: {c.detectedReadoutRaw})</span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="p-4">
                    {c.matchHint ? (
                      <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        {c.matchHint}
                      </p>
                    ) : null}
                    <div className="overflow-x-auto">
                    <table className="w-full border-collapse rounded-lg border border-slate-300 text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="border border-slate-300 px-3 py-2 text-right">رقم السؤال</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">الإجابة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.results.map((row) => (
                          <tr key={row.questionNumber}>
                            <td className="border border-slate-300 px-3 py-2">{row.questionNumber}</td>
                            <td className="border border-slate-300 px-3 py-2">{row.answer}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </div>
                </article>
              );
              })}
            </div>
          ) : null}

          {hasCorrection && summary && activeView === "correct" ? (
            <div className="mt-8 space-y-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveCorrectionToBatch()}
                  disabled={correctionSaveBusy || !activeBatchId}
                  className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {correctionSaveBusy ? "جاري الحفظ..." : "حفظ التصحيح"}
                </button>
                <button
                  type="button"
                  onClick={() => void exportCorrectionPdf()}
                  disabled={correctionExportBusy !== "none"}
                  className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {correctionExportBusy === "pdf" ? "جاري التصدير..." : "تصدير التصحيح PDF (A4)"}
                </button>
                <button
                  type="button"
                  onClick={() => void onExportCorrectionReport()}
                  disabled={correctionExportBusy !== "none"}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {correctionExportBusy === "excel" ? "جاري التصدير..." : "تصدير التصحيح Excel"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <article className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">عدد الطلاب</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{summary.studentsCount}</p>
                </article>
                <article className="rounded-lg border bg-emerald-50 p-3">
                  <p className="text-xs text-slate-500">نسبة النجاح</p>
                  <p className="mt-1 text-xl font-bold text-emerald-800">{summary.passRate.toFixed(1)}%</p>
                </article>
                <article className="rounded-lg border bg-rose-50 p-3">
                  <p className="text-xs text-slate-500">نسبة الرسوب</p>
                  <p className="mt-1 text-xl font-bold text-rose-800">{summary.failRate.toFixed(1)}%</p>
                </article>
                <article className="rounded-lg border bg-blue-50 p-3">
                  <p className="text-xs text-slate-500">متوسط الدرجة</p>
                  <p className="mt-1 text-xl font-bold text-blue-800">
                    {summary.avgScore.toFixed(2)} ({summary.avgPercentage.toFixed(1)}%)
                  </p>
                </article>
              </div>

              <div>
                <h2 className="mb-2 text-base font-bold text-slate-800">
                  نتائج الطلاب
                  {selectedExamMeta?.subject_name ? (
                    <span className="mr-2 text-sm font-medium text-slate-600">
                      — المادة: {selectedExamMeta.subject_name}
                    </span>
                  ) : null}
                </h2>
                <div className="overflow-x-auto rounded-lg border border-slate-300">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="border border-slate-300 px-3 py-2 text-right">الصفحة/الطالب</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">صحيحة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">خاطئة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">فارغة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">الدرجة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">النسبة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentResults.map((r) => {
                        const rc = pageTables.find((p) => p.pageIndex === r.pageIndex)?.context;
                        const who =
                          rc?.studentName?.trim() ||
                          (rc?.sheetCode || rc?.detectedSheetCode
                            ? `كود ورقة ${rc.sheetCode || rc.detectedSheetCode}`
                            : null);
                        const dept = String(rc?.department || selectedExamMeta?.department || "").trim();
                        const stage = String(rc?.stage || selectedExamMeta?.stage || "").trim();
                        const study = formatStudyType(rc?.studyType || selectedExamMeta?.study_type);
                        return (
                          <tr key={`student-res-${r.pageIndex}`}>
                            <td className="border border-slate-300 px-3 py-2">
                              {who ? (
                                <span>
                                  {who}
                                  <span className="mt-0.5 block text-xs text-slate-500">
                                    {dept || "—"} | {stage || "—"} | {study}
                                  </span>
                                </span>
                              ) : (
                                `صفحة ${r.pageIndex + 1}`
                              )}
                            </td>
                            <td className="border border-slate-300 px-3 py-2">{r.correctCount}</td>
                            <td className="border border-slate-300 px-3 py-2">{r.wrongCount}</td>
                            <td className="border border-slate-300 px-3 py-2">{r.blankCount}</td>
                            <td className="border border-slate-300 px-3 py-2">
                              {Math.round(r.score)} / {Math.round(r.maxScore)}
                            </td>
                            <td className="border border-slate-300 px-3 py-2">{r.percentage.toFixed(1)}%</td>
                            <td
                              className={`border border-slate-300 px-3 py-2 font-semibold ${
                                r.status === "pass" ? "text-emerald-700" : "text-rose-700"
                              }`}
                            >
                              {r.status === "pass" ? "ناجح" : "راسب"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-base font-bold text-slate-800">إحصائية كل سؤال</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-300">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="border border-slate-300 px-3 py-2 text-right">السؤال</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">صحيحة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">خاطئة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">فارغة</th>
                        <th className="border border-slate-300 px-3 py-2 text-right">نسبة الإجابة الصحيحة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionStats.map((q) => (
                        <tr key={`q-stat-${q.questionNumber}`}>
                          <td className="border border-slate-300 px-3 py-2">{q.questionNumber}</td>
                          <td className="border border-slate-300 px-3 py-2">{q.correctCount}</td>
                          <td className="border border-slate-300 px-3 py-2">{q.wrongCount}</td>
                          <td className="border border-slate-300 px-3 py-2">{q.blankCount}</td>
                          <td className="border border-slate-300 px-3 py-2">{q.correctRate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {hasCorrection && showDetailed && activeView === "detailed" ? (
            <div className="mt-10 space-y-8">
              <div className="flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold text-slate-900">التصحيح التفصيلي لكل ورقة</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveDetailedCorrectionToBatch()}
                    disabled={detailedSaveBusy || !activeBatchId}
                    className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {detailedSaveBusy ? "جاري الحفظ..." : "حفظ التصحيح التفصيلي"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportDetailedOfficialPdf()}
                    disabled={detailedExportBusy !== "none"}
                    className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {detailedExportBusy === "pdf" ? "جاري التصدير..." : "تصدير PDF (تقرير رسمي لكل ورقة)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportDetailedOfficialExcel()}
                    disabled={detailedExportBusy !== "none"}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {detailedExportBusy === "excel" ? "جاري التصدير..." : "تصدير Excel (نفس تفاصيل PDF)"}
                  </button>
                </div>
              </div>
              {detailedResults.map((p) => {
                const dc = pageTables.find((x) => x.pageIndex === p.pageIndex)?.context;
                const dtitle =
                  dc?.studentName?.trim() ||
                  (dc?.sheetCode || dc?.detectedSheetCode
                    ? `كود ورقة ${dc.sheetCode || dc.detectedSheetCode}`
                    : `صفحة ${p.pageIndex + 1}`);
                return (
                <div key={`detail-${p.pageIndex}`} className="rounded-xl border border-slate-300 bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-bold text-slate-800">{dtitle}</span>
                    <span className="text-xs text-slate-500">صفحة الملف {p.pageIndex + 1}</span>
                    <span className="text-slate-600">
                      الدرجة: {p.score.toFixed(2)} / {p.maxScore.toFixed(2)}
                    </span>
                    <span className="text-slate-600">النسبة: {p.percentage.toFixed(1)}%</span>
                    <span className={p.status === "pass" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                      {p.status === "pass" ? "ناجح" : "راسب"}
                    </span>
                    <span className="text-slate-600">
                      صحيحة: {p.correctCount} | خاطئة: {p.wrongCount} | فارغة: {p.blankCount}
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-300">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="border border-slate-300 px-3 py-2 text-right">السؤال</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">إجابة الطالب</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">النموذجية</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">درجة السؤال</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">المكتسبة</th>
                          <th className="border border-slate-300 px-3 py-2 text-right">النتيجة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.details.map((d) => (
                          <tr key={`detail-${p.pageIndex}-${d.questionNumber}`}>
                            <td className="border border-slate-300 px-3 py-2">{d.questionNumber}</td>
                            <td className="border border-slate-300 px-3 py-2">{d.studentAnswer || "بدون إجابة"}</td>
                            <td className="border border-slate-300 px-3 py-2">{d.correctAnswer}</td>
                            <td className="border border-slate-300 px-3 py-2">{Math.round(d.questionScore)}</td>
                            <td className="border border-slate-300 px-3 py-2">{Math.round(d.earnedScore)}</td>
                            <td
                              className={`border border-slate-300 px-3 py-2 font-semibold ${
                                d.result === "correct"
                                  ? "text-emerald-700"
                                  : d.result === "wrong"
                                  ? "text-rose-700"
                                  : "text-amber-700"
                              }`}
                            >
                              {d.result === "correct" ? "صحيح" : d.result === "wrong" ? "خاطئ" : "فارغ"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
              })}
            </div>
          ) : null}

          {activeView === "preview" && showUploadedPages && uploadedPagesPreview.length > 0 ? (
            <div className="mt-10 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">معاينة الصفحات المرفوعة</h2>
              <p className="text-sm text-slate-600">
                استخدم هذه المعاينة لاكتشاف الصفحات غير الواضحة أو المنحرفة قبل اعتماد نتيجة التصحيح.
              </p>
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs leading-relaxed text-slate-800">
                <strong>الدوائر الحمراء:</strong> نفس مراكز الفقاعات المحفوظة من صفحة المعايرة (nx/ny بعد ملف{" "}
                <code className="rounded bg-white px-0.5">question_calibration_ui_overrides…</code>) للقالب{" "}
                <strong>{omrTemplateCode}</strong>. المعاينة هنا من الملف الأصلي — إذا لم تتمركز الدوائر على التظليل، جرّب
                بعد «تحليل الملف» مقارنة لوحة «ملف الاختبار» مع صورة <code className="rounded bg-white px-0.5">warped</code>{" "}
                في التشخيص؛ القراءة الفعلية تتم على الصورة المُصحّحة هندسيًا وليس على هذه المعاينة الخام.
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {uploadedPagesPreview.map((src, idx) => (
                  <div key={`uploaded-preview-${idx}`} className="rounded-xl border border-slate-300 bg-white p-3">
                    <CalibrationNormOverlayPanel
                      title={`صفحة الملف ${idx + 1}`}
                      subtitle={`معاينة خام — قالب الإسقاط ${compareBundle ? `${compareBundle.pageW}×${compareBundle.pageH}` : "…"} بكسل (${omrTemplateCode})`}
                      imageSrc={src}
                      aspectW={compareBundle?.pageW ?? 2480}
                      aspectH={compareBundle?.pageH ?? 3508}
                      points={compareBundle?.points ?? []}
                      empty={false}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
