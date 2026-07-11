"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ExcelJS from "exceljs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  ANSWER_KEY_QUESTION_TOTALS,
  isAnswerKeyQuestionTotal,
  normalizeAnswerKeyQuestionTotal,
  type AnswerKeyQuestionTotal,
} from "@/src/lib/correction/answer-key-validation";

type SheetExportRow = {
  id: string;
  subject_name: string;
  subject_code: string | null;
  exam_date: string;
  teacher_name: string | null;
  department: string | null;
  stage: string | null;
  study_type: string | null;
  student_count: number;
  has_answer_key?: boolean;
};

type ExportsResponse = { success: boolean; exports?: SheetExportRow[]; error?: string };

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

function uniqueUpper(values: string[]): string[] {
  const out: string[] = [];
  for (const v0 of values) {
    const v = String(v0 || "").trim().toUpperCase();
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function AnswerKeyPageInner() {
  const search = useSearchParams();
  const exportIdParam = search.get("exportId")?.trim() || "";

  const [rows, setRows] = useState<SheetExportRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState("");

  const [totalQuestions, setTotalQuestions] = useState<AnswerKeyQuestionTotal>(25);
  const [optionsPreset, setOptionsPreset] = useState<"ABCD" | "ABCDE" | "CUSTOM">("ABCD");
  const [customOptions, setCustomOptions] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [questionScores, setQuestionScores] = useState<Record<number, number>>({});
  const [scoreMode, setScoreMode] = useState<"fixed" | "variable">("variable");
  const [fixedQuestionScore, setFixedQuestionScore] = useState(1);

  const [loadingKey, setLoadingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentKey, setCurrentKey] = useState<ExamAnswerKey | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoadingRows(true);
      try {
        const res = await fetch("/api/correction/sheet-exports");
        const data = (await res.json()) as ExportsResponse;
        if (!res.ok || !data.success) {
          setRows([]);
          setError(data.error || "تعذر تحميل الامتحانات.");
          return;
        }
        setRows(data.exports || []);
      } catch {
        setRows([]);
        setError("تعذر الاتصال بالخادم.");
      } finally {
        setLoadingRows(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!exportIdParam) return;
    setSelectedExamId(exportIdParam);
  }, [exportIdParam]);

  const selectedExam = useMemo(() => rows.find((r) => r.id === selectedExamId) || null, [rows, selectedExamId]);

  const options = useMemo(() => {
    if (optionsPreset === "ABCD") return ["A", "B", "C", "D"];
    if (optionsPreset === "ABCDE") return ["A", "B", "C", "D", "E"];
    return uniqueUpper(customOptions.split(/[,\s]+/g)).filter((x) => x.length <= 4);
  }, [optionsPreset, customOptions]);

  const rowsQ = useMemo(() => Array.from({ length: totalQuestions }, (_, i) => i + 1), [totalQuestions]);
  const splitIndex = useMemo(() => Math.ceil(totalQuestions / 2), [totalQuestions]);
  const pairedRows = useMemo(
    () =>
      Array.from({ length: splitIndex }, (_, i) => ({
        left: i + 1,
        right: i + 1 + splitIndex <= totalQuestions ? i + 1 + splitIndex : null,
      })),
    [splitIndex, totalQuestions]
  );

  const allAnswered = useMemo(() => {
    if (!options.length || totalQuestions < 1) return false;
    for (let q = 1; q <= totalQuestions; q++) {
      const v = answers[q];
      if (!v || !options.includes(v)) return false;
    }
    return true;
  }, [answers, options, totalQuestions]);

  const allScoresValid = useMemo(() => {
    if (scoreMode === "fixed") return Number.isFinite(fixedQuestionScore) && fixedQuestionScore >= 0;
    for (let q = 1; q <= totalQuestions; q++) {
      const n = Number(questionScores[q]);
      if (!Number.isFinite(n) || n < 0) return false;
    }
    return true;
  }, [fixedQuestionScore, questionScores, scoreMode, totalQuestions]);

  const examTotalScore = useMemo(() => {
    let sum = 0;
    for (let q = 1; q <= totalQuestions; q++) {
      const n = Number(questionScores[q]);
      sum += Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return sum;
  }, [questionScores, totalQuestions]);

  const loadCurrent = async (examId: string) => {
    if (!examId) {
      setCurrentKey(null);
      return;
    }
    setLoadingKey(true);
    setError("");
    try {
      const q = new URLSearchParams({ sheetExportId: examId });
      const res = await fetch(`/api/correction/answer-keys?${q.toString()}`);
      const data = (await res.json()) as { success?: boolean; examAnswerKey?: ExamAnswerKey | null; error?: string };
      if (!res.ok || !data.success) {
        setCurrentKey(null);
        setError(data.error || "تعذر تحميل المفتاح الحالي.");
        return;
      }
      const key = data.examAnswerKey || null;
      setCurrentKey(key);
      if (!key) {
        setAnswers({});
        const defaultScores: Record<number, number> = {};
        for (let q = 1; q <= totalQuestions; q++) defaultScores[q] = 1;
        setQuestionScores(defaultScores);
        setScoreMode("variable");
        setFixedQuestionScore(1);
        return;
      }
      const nq = normalizeAnswerKeyQuestionTotal(key.totalQuestions || 25);
      setTotalQuestions(nq);
      const keyOptions = uniqueUpper(key.options || []);
      if (keyOptions.join(",") === "A,B,C,D") setOptionsPreset("ABCD");
      else if (keyOptions.join(",") === "A,B,C,D,E") setOptionsPreset("ABCDE");
      else {
        setOptionsPreset("CUSTOM");
        setCustomOptions(keyOptions.join(","));
      }
      const next: Record<number, string> = {};
      for (let q = 1; q <= nq; q++) {
        const v = key.answers[q];
        if (v) next[q] = String(v).toUpperCase().trim();
      }
      setAnswers(next);
      const nextScores: Record<number, number> = {};
      for (let q = 1; q <= nq; q++) {
        const n = Number(key.questionScores?.[q]);
        nextScores[q] = Number.isFinite(n) && n >= 0 ? n : 1;
      }
      setQuestionScores(nextScores);
      setScoreMode(key.scoreMode === "fixed" ? "fixed" : "variable");
      setFixedQuestionScore(
        Number.isFinite(Number(key.fixedQuestionScore)) && Number(key.fixedQuestionScore) >= 0
          ? Number(key.fixedQuestionScore)
          : 1
      );
    } catch {
      setCurrentKey(null);
      setError("تعذر الاتصال أثناء تحميل المفتاح.");
    } finally {
      setLoadingKey(false);
    }
  };

  useEffect(() => {
    void loadCurrent(selectedExamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamId]);

  const setAnswer = (q: number, v: string) => {
    setAnswers((prev) => ({ ...prev, [q]: v }));
  };

  const setQuestionScore = (q: number, v: number) => {
    setQuestionScores((prev) => ({ ...prev, [q]: v }));
  };

  useEffect(() => {
    setAnswers((prev) => {
      const next: Record<number, string> = {};
      for (let q = 1; q <= totalQuestions; q++) {
        const v = prev[q];
        if (v) next[q] = v;
      }
      return next;
    });
  }, [totalQuestions]);

  useEffect(() => {
    if (scoreMode === "fixed") {
      setQuestionScores(() => {
        const next: Record<number, number> = {};
        for (let q = 1; q <= totalQuestions; q++) {
          next[q] = Number.isFinite(fixedQuestionScore) && fixedQuestionScore >= 0 ? fixedQuestionScore : 0;
        }
        return next;
      });
      return;
    }
    setQuestionScores((prev) => {
      const next: Record<number, number> = {};
      for (let q = 1; q <= totalQuestions; q++) {
        const n = Number(prev[q]);
        next[q] = Number.isFinite(n) && n >= 0 ? n : 1;
      }
      return next;
    });
  }, [fixedQuestionScore, scoreMode, totalQuestions]);

  const validateBeforeSave = (): string | null => {
    if (!selectedExamId) return "اختر الامتحان أولًا.";
    if (!isAnswerKeyQuestionTotal(totalQuestions)) {
      return "عدد الأسئلة يجب أن يكون 25 أو 50 أو 75 أو 100.";
    }
    if (options.length < 2) return "يجب توفير خيارين على الأقل.";
    if (!allAnswered) return "أكمل الإجابات لكل الأسئلة قبل الحفظ.";
    if (!allScoresValid) return "تحقق من درجات الأسئلة (أرقام >= 0).";
    return null;
  };

  const handleSave = async () => {
    const vErr = validateBeforeSave();
    if (vErr) {
      setError(vErr);
      setMessage("");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload: Record<string, string> = {};
      for (let q = 1; q <= totalQuestions; q++) {
        payload[String(q)] = String(answers[q] || "").toUpperCase();
      }
      const scoresPayload: Record<string, number> = {};
      for (let q = 1; q <= totalQuestions; q++) {
        scoresPayload[String(q)] = Number(questionScores[q]);
      }
      const res = await fetch("/api/correction/answer-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetExportId: selectedExamId,
          subjectCode: selectedExam?.subject_code || "",
          totalQuestions,
          options,
          answers: payload,
          questionScores: scoresPayload,
          scoreMode,
          fixedQuestionScore: scoreMode === "fixed" ? fixedQuestionScore : null,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; examAnswerKey?: ExamAnswerKey | null };
      if (!res.ok || !data.success) throw new Error(data.error || "فشل حفظ المفتاح.");
      setCurrentKey(data.examAnswerKey || null);
      setMessage("تم حفظ المفتاح بنجاح.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    if (!selectedExamId) {
      setError("اختر الامتحان قبل الاستيراد.");
      return;
    }
    if (options.length < 2) {
      setError("حدد الخيارات المسموحة أولًا.");
      return;
    }
    setImportBusy(true);
    setError("");
    setMessage("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("sheetExportId", selectedExamId);
      fd.set("totalQuestions", String(totalQuestions));
      fd.set("options", options.join(","));
      const res = await fetch("/api/correction/answer-keys/import", { method: "POST", body: fd });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "فشل الاستيراد.");
      setMessage("تم استيراد المفتاح وحفظه بنجاح.");
      await loadCurrent(selectedExamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل الاستيراد.");
    } finally {
      setImportBusy(false);
    }
  };

  const buildExportRows = () => {
    return rowsQ.map((q) => ({
      question: q,
      answer: answers[q] || "",
      score:
        scoreMode === "fixed"
          ? Number.isFinite(fixedQuestionScore) && fixedQuestionScore >= 0
            ? fixedQuestionScore
            : 0
          : Number.isFinite(questionScores[q]) && questionScores[q] >= 0
            ? questionScores[q]
            : 0,
    }));
  };

  const handleExportExcel = async () => {
    if (!selectedExamId) {
      setError("اختر الامتحان أولًا قبل التصدير.");
      setMessage("");
      return;
    }
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Systimit";
      workbook.created = new Date();
      const ws = workbook.addWorksheet("Answer Key");

      const examTitle = selectedExam ? selectedExam.subject_name : "امتحان";
      ws.mergeCells("A1:C1");
      ws.getCell("A1").value = `تصدير مفتاح الإجابة - ${examTitle}`;
      ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell("A1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E3A8A" },
      };
      ws.getRow(1).height = 24;

      ws.mergeCells("A2:C2");
      ws.getCell("A2").value = `التاريخ: ${selectedExam?.exam_date || "—"}   |   عدد الأسئلة: ${totalQuestions}   |   الدرجة الكلية: ${examTotalScore}`;
      ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell("A2").font = { size: 11, bold: true, color: { argb: "FF0F172A" } };
      ws.getCell("A2").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
      ws.getRow(2).height = 20;

      ws.columns = [
        { header: "السؤال", key: "question", width: 16 },
        { header: "الإجابة النموذجية", key: "answer", width: 26 },
        { header: "درجة السؤال", key: "score", width: 18 },
      ];

      const headerRow = ws.getRow(4);
      headerRow.values = ["السؤال", "الإجابة النموذجية", "درجة السؤال"];
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0F766E" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FF0F172A" } },
          bottom: { style: "thin", color: { argb: "FF0F172A" } },
          left: { style: "thin", color: { argb: "FF0F172A" } },
          right: { style: "thin", color: { argb: "FF0F172A" } },
        };
      });

      const dataRows = buildExportRows();
      dataRows.forEach((row, idx) => {
        const r = ws.addRow({
          question: row.question,
          answer: row.answer || "—",
          score: row.score,
        });
        const isEven = idx % 2 === 0;
        r.height = 21;
        r.eachCell((cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFCBD5E1" } },
            bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
            left: { style: "thin", color: { argb: "FFCBD5E1" } },
            right: { style: "thin", color: { argb: "FFCBD5E1" } },
          };
        });
      });

      ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
      const safeSubject = (selectedExam?.subject_name || "answer-key").replace(/[\\/:*?"<>|]/g, "-");
      const buf = await workbook.xlsx.writeBuffer();
      triggerDownload(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `answer-key-${safeSubject}-${selectedExam?.exam_date || "date"}.xlsx`
      );
      setMessage("تم تصدير ملف Excel بنجاح.");
      setError("");
    } catch {
      setError("تعذر تصدير ملف Excel.");
      setMessage("");
    }
  };

  const handleExportPdf = async () => {
    if (!selectedExamId) {
      setError("اختر الامتحان أولًا قبل التصدير.");
      setMessage("");
      return;
    }
    try {
      const host = document.createElement("div");
      host.dir = "rtl";
      host.style.position = "fixed";
      host.style.top = "0";
      host.style.left = "-100000px";
      host.style.width = "1122px";
      host.style.background = "#ffffff";
      host.style.padding = "24px";
      host.style.fontFamily = "Tahoma, Arial, sans-serif";

      const bodyRows = buildExportRows()
        .map(
          (row, idx) => `
            <tr style="background:${idx % 2 === 0 ? "#f8fafc" : "#ffffff"};">
              <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${row.question}</td>
              <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${row.answer || "—"}</td>
              <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${row.score}</td>
            </tr>
          `
        )
        .join("");

      host.innerHTML = `
        <div style="text-align:center; margin-bottom:14px;">
          <h1 style="margin:0; font-size:24px; color:#0f172a;">تقرير مفتاح الإجابة النموذجي</h1>
          <p style="margin:8px 0 0; font-size:14px; color:#334155;">
            المادة: ${selectedExam?.subject_name || "—"} | التاريخ: ${selectedExam?.exam_date || "—"} | عدد الأسئلة: ${totalQuestions} | الدرجة الكلية: ${examTotalScore}
          </p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#1e3a8a; color:#fff;">
              <th style="border:1px solid #94a3b8; padding:8px;">السؤال</th>
              <th style="border:1px solid #94a3b8; padding:8px;">الإجابة النموذجية</th>
              <th style="border:1px solid #94a3b8; padding:8px;">درجة السؤال</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      `;

      document.body.appendChild(host);
      await document.fonts?.ready;
      const canvas = await html2canvas(host, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      if (host.parentNode) host.parentNode.removeChild(host);

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 8;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;

      let remaining = imgH;
      let sourceY = 0;
      while (remaining > 0) {
        const available = pageH - margin * 2;
        const drawH = Math.min(available, remaining);
        const sourceHeight = (drawH * canvas.width) / imgW;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.max(1, Math.round(sourceHeight));
        const sliceCtx = sliceCanvas.getContext("2d");
        if (!sliceCtx) throw new Error("تعذر تجهيز شريحة الصفحة للـ PDF");
        sliceCtx.drawImage(
          canvas,
          0,
          sourceY,
          canvas.width,
          sourceHeight,
          0,
          0,
          canvas.width,
          sliceCanvas.height
        );
        doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin, imgW, drawH, undefined, "FAST");
        remaining -= drawH;
        sourceY += sourceHeight;
        if (remaining > 0) doc.addPage("a4", "portrait");
      }

      const safeSubject = (selectedExam?.subject_name || "answer-key").replace(/[\\/:*?"<>|]/g, "-");
      doc.save(`answer-key-${safeSubject}-${selectedExam?.exam_date || "date"}.pdf`);
      setMessage("تم تصدير ملف PDF (A4) بنجاح.");
      setError("");
    } catch {
      setError("تعذر تصدير ملف PDF.");
      setMessage("");
    }
  };

  return (
    <main dir="rtl" className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto w-full max-w-7xl space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">إدارة مفتاح الإجابة النموذجي</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid items-end gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <label className="mb-1 block text-xs font-semibold text-slate-600">الامتحان</label>
              <select
                value={selectedExamId}
                disabled={loadingRows}
                onChange={(e) => {
                  setSelectedExamId(e.target.value);
                  setMessage("");
                  setError("");
                }}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
              >
                <option value="">— اختر امتحانًا —</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.subject_name}
                    {r.subject_code ? ` [${r.subject_code}]` : ""}
                    {" — "}
                    {r.exam_date} — {(r.department || "").trim()} / {(r.stage || "").trim()} /{" "}
                    {r.study_type === "evening" ? "مسائي" : "صباحي"}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6 space-y-3">
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">عدد الأسئلة (نموذج الشيت)</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ANSWER_KEY_QUESTION_TOTALS.map((n) => {
                    const active = totalQuestions === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTotalQuestions(n)}
                        className={`rounded-lg border px-2 py-2 text-center text-sm font-semibold transition sm:px-3 ${
                          active
                            ? "border-blue-700 bg-blue-700 text-white"
                            : "border-slate-300 bg-white text-slate-800 hover:border-slate-400"
                        }`}
                      >
                        {n} سؤالًا
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">مجموعة الخيارات</label>
                  <select
                    value={optionsPreset}
                    onChange={(e) => setOptionsPreset(e.target.value as "ABCD" | "ABCDE" | "CUSTOM")}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="ABCD">A/B/C/D</option>
                    <option value="ABCDE">A/B/C/D/E</option>
                    <option value="CUSTOM">مخصصة</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">درجة الامتحان</label>
                  <input
                    type="number"
                    value={examTotalScore}
                    readOnly
                    className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-700"
                  />
                </div>
              </div>
            </div>

            <div className="md:col-span-4">
              <label className="mb-1 block text-xs font-semibold text-slate-600">سلوك درجات الامتحان</label>
              <select
                value={scoreMode}
                onChange={(e) => setScoreMode(e.target.value === "fixed" ? "fixed" : "variable")}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="fixed">درجات الامتحان ثابتة</option>
                <option value="variable">درجات الامتحان متغيرة</option>
              </select>
            </div>

            {scoreMode === "fixed" ? (
              <div className="md:col-span-4 md:justify-self-start">
                <label className="mb-1 block text-xs font-semibold text-slate-600">درجة كل سؤال (ثابتة)</label>
                <input
                  type="number"
                  min={0}
                  step="0.25"
                  value={fixedQuestionScore}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setFixedQuestionScore(Number.isFinite(n) && n >= 0 ? n : 0);
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
            ) : null}
          </div>

          {optionsPreset === "CUSTOM" ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                خيارات مخصصة (مثال: A,B,C,D,E)
              </label>
              <input
                value={customOptions}
                onChange={(e) => setCustomOptions(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          <p className="mt-2 text-xs text-slate-600">
            الخيارات الحالية:{" "}
            <span className="font-mono font-semibold text-slate-800">
              {options.length ? options.join(" / ") : "— غير صالحة —"}
            </span>
          </p>

          {selectedExam ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold">{selectedExam.subject_name}</span> — {selectedExam.exam_date} —{" "}
              {selectedExam.teacher_name || "—"} — {selectedExam.student_count} طالب
              {selectedExam.subject_code ? (
                <>
                  {" — "}
                  <span className="font-mono font-semibold text-slate-800">{selectedExam.subject_code}</span>
                </>
              ) : null}
            </div>
          ) : null}

          {currentKey ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              المفتاح الحالي محفوظ (آخر تحديث: {new Date(currentKey.updatedAt).toLocaleString("ar-IQ")}).
            </div>
          ) : null}
          {loadingKey ? <p className="mt-2 text-xs text-slate-500">جاري تحميل المفتاح الحالي…</p> : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="px-4 pt-4 text-lg font-bold text-slate-900">جدول المفتاح</h2>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
              <button
                type="button"
                onClick={() => void handleExportExcel()}
                className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                تصدير Excel
              </button>
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                className="rounded-lg border border-red-700 bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
              >
                تصدير PDF (A4)
              </button>
            </div>
          </div>
          <div className="max-h-[min(60vh,36rem)] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">السؤال</th>
                  <th className="px-4 py-3 text-right font-semibold">الإجابة النموذجية</th>
                  <th className="px-4 py-3 text-right font-semibold">درجة السؤال</th>
                  <th className="px-4 py-3 text-right font-semibold">السؤال</th>
                  <th className="px-4 py-3 text-right font-semibold">الإجابة النموذجية</th>
                  <th className="px-4 py-3 text-right font-semibold">درجة السؤال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pairedRows.map(({ left, right }) => (
                  <tr key={`row-${left}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold">{left}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {options.map((opt) => (
                          <button
                            key={`${left}-${opt}`}
                            type="button"
                            onClick={() => setAnswer(left, opt)}
                            className={`rounded-md border px-2 py-1 text-xs font-bold ${
                              answers[left] === opt
                                ? "border-blue-900 bg-blue-900 text-white"
                                : "border-slate-300 bg-white text-slate-800"
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        step="0.25"
                        value={Number.isFinite(questionScores[left]) ? questionScores[left] : 1}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setQuestionScore(left, Number.isFinite(n) && n >= 0 ? n : 0);
                        }}
                        disabled={scoreMode === "fixed"}
                        className="w-24 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </td>

                    {right ? (
                      <>
                        <td className="px-4 py-3 font-semibold">{right}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {options.map((opt) => (
                              <button
                                key={`${right}-${opt}`}
                                type="button"
                                onClick={() => setAnswer(right, opt)}
                                className={`rounded-md border px-2 py-1 text-xs font-bold ${
                                  answers[right] === opt
                                    ? "border-blue-900 bg-blue-900 text-white"
                                    : "border-slate-300 bg-white text-slate-800"
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            step="0.25"
                            value={Number.isFinite(questionScores[right]) ? questionScores[right] : 1}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setQuestionScore(right, Number.isFinite(n) && n >= 0 ? n : 0);
                            }}
                            disabled={scoreMode === "fixed"}
                            className="w-24 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-slate-300">—</td>
                        <td className="px-4 py-3 text-slate-300">—</td>
                        <td className="px-4 py-3 text-slate-300">—</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "جاري الحفظ…" : "حفظ / تحديث المفتاح"}
            </button>
            <span className={`text-xs ${allAnswered ? "text-emerald-700" : "text-amber-700"}`}>
              {allAnswered && allScoresValid ? "المفتاح مكتمل" : "المفتاح غير مكتمل"}
            </span>
          </div>
          {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}

export default function AnswerKeyPage() {
  return (
    <Suspense
      fallback={
        <main dir="rtl" className="p-8 text-center text-slate-600">
          جاري التحميل…
        </main>
      }
    >
      <AnswerKeyPageInner />
    </Suspense>
  );
}

