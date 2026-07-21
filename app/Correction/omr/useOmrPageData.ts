"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnswerKeyFetchResponse,
  ExamAnswerKeyInfo,
  ExportsResponse,
  ProcessResponse,
  ReviewQueueItem,
  ReviewQueueListResponse,
  ReviewRecordDetail,
  ReviewRecordFetchResponse,
  ReviewSaveResponse,
  SheetExportRow,
} from "./_types";

export function useOmrPageData() {
  const [rows, setRows] = useState<SheetExportRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ProcessResponse | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyInfo, setKeyInfo] = useState<ExamAnswerKeyInfo | null>(null);
  const [keyError, setKeyError] = useState("");
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [reviewDetail, setReviewDetail] = useState<ReviewRecordDetail | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualAnswers, setManualAnswers] = useState<Record<number, string>>({});
  const [debugMode, setDebugMode] = useState(true);

  const loadExams = useCallback(async () => {
    setLoadingRows(true);
    setError("");
    try {
      const res = await fetch("/api/correction/sheet-exports");
      const d = (await res.json()) as ExportsResponse;
      if (!res.ok || !d.success) {
        setRows([]);
        setError(d.error || "تعذر تحميل الامتحانات.");
        return;
      }
      setRows(d.exports || []);
    } catch {
      setRows([]);
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const selectedExam = useMemo(() => rows.find((r) => r.id === selectedExamId) || null, [rows, selectedExamId]);
  const keyReady = Boolean(keyInfo && keyInfo.totalQuestions > 0 && keyInfo.options.length >= 2);

  const templateCodeFromQuestionCount = useCallback((n: number): string => {
    if (n >= 100) return "OMR_100";
    if (n >= 75) return "OMR_75";
    if (n >= 50) return "OMR_50";
    return "OMR_25";
  }, []);

  const loadAnswerKey = useCallback(async () => {
    if (!selectedExamId) {
      setKeyInfo(null);
      setKeyError("");
      return;
    }
    setKeyLoading(true);
    setKeyError("");
    try {
      const q = new URLSearchParams({ sheetExportId: selectedExamId });
      const res = await fetch(`/api/correction/answer-keys?${q.toString()}`);
      const d = (await res.json()) as AnswerKeyFetchResponse;
      if (!res.ok || !d.success) {
        setKeyInfo(null);
        setKeyError(d.error || "تعذر جلب مفتاح الإجابة.");
        return;
      }
      setKeyInfo(d.examAnswerKey || null);
    } catch {
      setKeyInfo(null);
      setKeyError("تعذر الاتصال بالخادم أثناء التحقق من مفتاح الإجابة.");
    } finally {
      setKeyLoading(false);
    }
  }, [selectedExamId]);

  useEffect(() => {
    void loadAnswerKey();
  }, [loadAnswerKey]);

  const loadQueue = useCallback(async (examId: string) => {
    if (!examId) {
      setQueue([]);
      return;
    }
    setQueueLoading(true);
    try {
      const q = new URLSearchParams({ examId });
      const res = await fetch(`/api/correction/omr/review-queue?${q.toString()}`);
      const d = (await res.json()) as ReviewQueueListResponse;
      setQueue(res.ok && d.success ? d.queue || [] : []);
    } catch {
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue(selectedExamId);
    setSelectedReviewId("");
    setReviewDetail(null);
  }, [selectedExamId, loadQueue]);

  const loadReviewDetail = useCallback(async (id: string) => {
    if (!id) {
      setReviewDetail(null);
      return;
    }
    setReviewBusy(true);
    try {
      const res = await fetch(`/api/correction/omr/review-queue/${encodeURIComponent(id)}`);
      const d = (await res.json()) as ReviewRecordFetchResponse;
      const rec = res.ok && d.success ? d.record || null : null;
      setReviewDetail(rec);
      setManualCode(rec?.student_code || "");
      const next: Record<number, string> = {};
      for (const a of rec?.detected_answers || []) {
        if (a.selectedOption) next[a.questionNumber] = a.selectedOption;
      }
      setManualAnswers(next);
    } finally {
      setReviewBusy(false);
    }
  }, []);

  const processPdf = useCallback(async () => {
    if (!selectedExamId) {
      setError("اختر الامتحان أولًا.");
      return;
    }
    if (!pdfFile) {
      setError("اختر صورة الشيت أولًا.");
      return;
    }
    const isImageFile =
      pdfFile.type.toLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(pdfFile.name || "");
    if (!isImageFile) {
      setError("النسخة الحالية تدعم رفع صورة فقط (PNG/JPG/JPEG/WEBP/BMP/TIFF).");
      return;
    }
    if (!keyReady) {
      setError("لا يمكن بدء التحليل بدون مفتاح إجابة محفوظ وجاهز لهذا الامتحان.");
      return;
    }
    setBusy(true);
    setError("");
    setData(null);
    try {
      const fd = new FormData();
      fd.set("sheetExportId", selectedExamId);
      fd.set("file", pdfFile);
      fd.set("debugMode", debugMode ? "1" : "0");
      fd.set("templateCode", templateCodeFromQuestionCount(Number(keyInfo?.totalQuestions || 25)));
      const res = await fetch("/api/correction/omr/process-pdf", { method: "POST", body: fd });
      const d = (await res.json()) as ProcessResponse;
      if (!res.ok || !d.success) {
        setError(d.error || "فشل معالجة الصورة.");
        return;
      }
      setData(d);
      await loadQueue(selectedExamId);
    } catch {
      setError("تعذر الاتصال بالخادم أثناء المعالجة.");
    } finally {
      setBusy(false);
    }
  }, [selectedExamId, pdfFile, keyReady, debugMode, loadQueue, templateCodeFromQuestionCount, keyInfo?.totalQuestions]);

  const saveReview = useCallback(
    async (status: "reviewed" | "approved") => {
      if (!selectedReviewId || !reviewDetail) return;
      setReviewBusy(true);
      setError("");
      try {
        const payload: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(manualAnswers)) {
          payload[String(k)] = v || null;
        }
        const res = await fetch(`/api/correction/omr/review-queue/${encodeURIComponent(selectedReviewId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentCode: manualCode,
            manualAnswers: payload,
            reviewStatus: status,
          }),
        });
        const d = (await res.json()) as ReviewSaveResponse;
        if (!res.ok || !d.success || !d.record) {
          setError(d.error || "تعذر حفظ المراجعة.");
          return;
        }
        setReviewDetail(d.record);
        await loadQueue(selectedExamId);
        setData(null);
      } catch {
        setError("تعذر الاتصال بالخادم أثناء حفظ المراجعة.");
      } finally {
        setReviewBusy(false);
      }
    },
    [selectedReviewId, reviewDetail, manualAnswers, manualCode, selectedExamId, loadQueue]
  );

  return {
    rows,
    loadingRows,
    selectedExamId,
    setSelectedExamId,
    pdfFile,
    setPdfFile,
    busy,
    error,
    data,
    keyLoading,
    keyInfo,
    keyError,
    queue,
    queueLoading,
    selectedReviewId,
    setSelectedReviewId,
    reviewDetail,
    reviewBusy,
    manualCode,
    setManualCode,
    manualAnswers,
    setManualAnswers,
    debugMode,
    setDebugMode,
    selectedExam,
    keyReady,
    loadReviewDetail,
    processPdf,
    saveReview,
  };
}
