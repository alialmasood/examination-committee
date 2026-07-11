"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type SheetExportRow = {
  id: string;
  export_batch_id: string | null;
  subject_name: string;
  subject_code: string | null;
  exam_date: string;
  teacher_name: string | null;
  department: string | null;
  stage: string | null;
  study_type: string | null;
  student_count: number;
  created_at: string;
  has_report?: boolean;
  has_answer_key?: boolean;
};

type ApiResponse = { success: boolean; exports?: SheetExportRow[]; error?: string };

function studyLabel(v: string | null | undefined) {
  if (!v || v === "—") return "—";
  if (v === "morning") return "صباحي";
  if (v === "evening") return "مسائي";
  return v;
}

function studyRank(v: string) {
  if (v === "morning") return 0;
  if (v === "evening") return 1;
  return 2;
}

function groupByDepartment(rows: SheetExportRow[]) {
  const m = new Map<string, SheetExportRow[]>();
  for (const r of rows) {
    const d = (r.department || "").trim() || "—";
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(r);
  }
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "ar"));
}

function groupByStudyType(rows: SheetExportRow[]) {
  const m = new Map<string, SheetExportRow[]>();
  for (const r of rows) {
    const st = r.study_type || "—";
    if (!m.has(st)) m.set(st, []);
    m.get(st)!.push(r);
  }
  return Array.from(m.entries()).sort(
    ([a], [b]) => studyRank(a) - studyRank(b) || a.localeCompare(b, "ar")
  );
}

function groupByStage(rows: SheetExportRow[]) {
  const m = new Map<string, SheetExportRow[]>();
  for (const r of rows) {
    const stg = (r.stage || "").trim() || "—";
    if (!m.has(stg)) m.set(stg, []);
    m.get(stg)!.push(r);
  }
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "ar"));
}

function studyTypeLabel(v: string | null | undefined) {
  if (v === "morning") return "صباحي";
  if (v === "evening") return "مسائي";
  return "—";
}

export default function ComposedExamsPage() {
  const [rows, setRows] = useState<SheetExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/correction/sheet-exports");
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.success) {
        setError(data.error || "تعذر تحميل القائمة.");
        setRows([]);
        return;
      }
      setRows(data.exports || []);
    } catch {
      setError("تعذر الاتصال بالخادم.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  useEffect(() => {
    if (!openActionsId) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-actions-menu-root='true']")) return;
      setOpenActionsId(null);
      setActionsMenuPos(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openActionsId]);

  const downloadReportJson = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/correction/sheet-exports/${encodeURIComponent(id)}`);
      const data = (await res.json()) as {
        success?: boolean;
        export?: SheetExportRow & { report_payload?: unknown; subject_name?: string; exam_date?: string };
        error?: string;
      };
      if (!res.ok || !data.success || !data.export?.report_payload) {
        setError(data.error || "لا يوجد تقرير محفوظ للتحميل.");
        return;
      }
      const subject = String(data.export.subject_name || "exam");
      const examDate = String(data.export.exam_date || "date");
      const name = `composed-exam-${subject}-${examDate}-${id.slice(0, 8)}.json`
        .replace(/[^\w\u0600-\u06FF.-]+/g, "_")
        .slice(0, 180);
      const blob = new Blob([JSON.stringify(data.export.report_payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تحميل التقرير.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteExport = async (id: string, subjectName: string) => {
    const ok = window.confirm(`تأكيد حذف الامتحان "${subjectName}"؟ سيتم حذف التقرير ومفتاح الإجابة المرتبط.`);
    if (!ok) return;
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/correction/sheet-exports/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error || "تعذر حذف السجل.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("تعذر الاتصال بالخادم أثناء الحذف.");
    } finally {
      setBusyId(null);
    }
  };

  const exportRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          a.department!.localeCompare(b.department || "—", "ar") ||
          studyRank(a.study_type || "—") - studyRank(b.study_type || "—") ||
          (a.stage || "—").localeCompare(b.stage || "—", "ar") ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [rows]
  );

  const handleExportExcel = async () => {
    if (!rows.length) {
      setError("لا توجد بيانات لتصديرها.");
      return;
    }
    setExportingExcel(true);
    setError("");
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Systimit";
      wb.created = new Date();
      const ws = wb.addWorksheet("Composed Exams");

      ws.mergeCells("A1:J1");
      ws.getCell("A1").value = "تقرير جميع الامتحانات المكونة";
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
      ws.getRow(1).height = 25;

      ws.mergeCells("A2:J2");
      ws.getCell("A2").value = `تاريخ التصدير: ${new Date().toLocaleString("ar-IQ")} — إجمالي السجلات: ${rows.length}`;
      ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell("A2").font = { bold: true, size: 11 };
      ws.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

      ws.columns = [
        { header: "المادة", key: "subject_name", width: 24 },
        { header: "رمز المادة", key: "subject_code", width: 16 },
        { header: "القسم", key: "department", width: 18 },
        { header: "المرحلة", key: "stage", width: 14 },
        { header: "نوع الدراسة", key: "study_type", width: 14 },
        { header: "تاريخ الامتحان", key: "exam_date", width: 16 },
        { header: "أستاذ المادة", key: "teacher_name", width: 22 },
        { header: "عدد الطلبة", key: "student_count", width: 14 },
        { header: "مفتاح الإجابة", key: "has_answer_key", width: 16 },
        { header: "تاريخ التسجيل", key: "created_at", width: 24 },
      ];

      const headerRow = ws.getRow(4);
      headerRow.values = ws.columns.map((c) => c.header as string);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FF0F172A" } },
          bottom: { style: "thin", color: { argb: "FF0F172A" } },
          left: { style: "thin", color: { argb: "FF0F172A" } },
          right: { style: "thin", color: { argb: "FF0F172A" } },
        };
      });

      exportRows.forEach((r, i) => {
        const row = ws.addRow({
          subject_name: r.subject_name,
          subject_code: r.subject_code || "—",
          department: r.department || "—",
          stage: r.stage || "—",
          study_type: studyTypeLabel(r.study_type),
          exam_date: r.exam_date,
          teacher_name: r.teacher_name || "—",
          student_count: r.student_count,
          has_answer_key: r.has_answer_key ? "تم الحفظ" : "غير موجود",
          created_at: r.created_at ? new Date(r.created_at).toLocaleString("ar-IQ") : "—",
        });
        row.height = 21;
        row.eachCell((cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: i % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF" },
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
      const buff = await wb.xlsx.writeBuffer();
      const blob = new Blob([buff], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `composed-exams-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير ملف Excel.");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (!rows.length) {
      setError("لا توجد بيانات لتصديرها.");
      return;
    }
    setExportingPdf(true);
    setError("");
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
      host.innerHTML = `
        <div style="text-align:center; margin-bottom:14px;">
          <h1 style="margin:0; font-size:24px; color:#0f172a;">تقرير الامتحانات المكوّنة</h1>
          <p style="margin:8px 0 0; font-size:14px; color:#334155;">
            تاريخ التصدير: ${new Date().toLocaleString("ar-IQ")} | عدد السجلات: ${rows.length}
          </p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#1e3a8a; color:#fff;">
              <th style="border:1px solid #94a3b8; padding:8px;">المادة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">رمز المادة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">القسم</th>
              <th style="border:1px solid #94a3b8; padding:8px;">المرحلة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">الدراسة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">تاريخ الامتحان</th>
              <th style="border:1px solid #94a3b8; padding:8px;">أستاذ المادة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">عدد الطلبة</th>
              <th style="border:1px solid #94a3b8; padding:8px;">المفتاح</th>
            </tr>
          </thead>
          <tbody>
            ${exportRows
              .map(
                (r, i) => `
                  <tr style="background:${i % 2 === 0 ? "#f8fafc" : "#ffffff"};">
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.subject_name}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.subject_code || "—"}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.department || "—"}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.stage || "—"}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${studyTypeLabel(r.study_type)}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.exam_date}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.teacher_name || "—"}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.student_count}</td>
                    <td style="border:1px solid #cbd5e1; padding:7px; text-align:center;">${r.has_answer_key ? "تم الحفظ" : "غير موجود"}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      `;
      document.body.appendChild(host);

      await document.fonts?.ready;
      const canvas = await html2canvas(host, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      document.body.removeChild(host);

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 8;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;

      let y = margin;
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
        doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, y, imgW, drawH, undefined, "FAST");
        remaining -= drawH;
        sourceY += sourceHeight;
        if (remaining > 0) doc.addPage("a4", "portrait");
      }

      doc.save(`composed-exams-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      setError("تعذر تصدير ملف PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const tree = useMemo(() => {
    return groupByDepartment(rows).map(([department, deptRows]) => ({
      department,
      studyBlocks: groupByStudyType(deptRows).map(([studyKey, studyRows]) => ({
        studyKey,
        studyLabel: studyLabel(studyKey === "—" ? null : studyKey),
        stageBlocks: groupByStage(studyRows).map(([stage, exams]) => ({
          stage,
          exams: exams.sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
              a.subject_name.localeCompare(b.subject_name, "ar")
          ),
        })),
      })),
    }));
  }, [rows]);

  return (
    <main dir="rtl" className="bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">الامتحانات المكونة</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportExcel()}
              disabled={exportingExcel || loading || rows.length === 0}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {exportingExcel ? "جاري تصدير Excel..." : "تصدير Excel (كل الامتحانات)"}
            </button>
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf || loading || rows.length === 0}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {exportingPdf ? "جاري تصدير PDF..." : "تصدير PDF A4 (كل الامتحانات)"}
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          ترتيب حسب القسم، ثم نوع الدراسة، ثم المرحلة؛ لكل خانة تُحفظ المادة الامتحانية مع تقرير وقائمة طلبة الشيتات
          (ملف JSON قابل للتحميل من صفحة التقرير).
        </p>

        {loading ? (
          <p className="text-sm text-slate-600">جاري التحميل…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">لا توجد امتحانات مسجلة بعد. استخدم «تصدير شيت امتحان» لإضافة سجل.</p>
        ) : (
          <div className="space-y-8">
            {tree.map(({ department, studyBlocks }) => (
              <section key={department} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h3 className="mb-4 border-b border-slate-200 pb-2 text-base font-bold text-slate-900">
                  القسم: <span className="text-blue-900">{department}</span>
                </h3>
                <div className="space-y-6">
                  {studyBlocks.map(({ studyKey, studyLabel: stLabel, stageBlocks }) => (
                    <div key={`${department}-${studyKey}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <h4 className="mb-3 text-sm font-semibold text-slate-800">
                        نوع الدراسة: <span className="text-slate-900">{stLabel}</span>
                      </h4>
                      <div className="space-y-4 ps-2 sm:ps-4">
                        {stageBlocks.map(({ stage, exams }) => (
                          <div key={`${department}-${studyKey}-${stage}`} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                            <h5 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm">
                              المرحلة: <span className="text-slate-800">{stage}</span>
                            </h5>
                            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                              <table className="min-w-full divide-y divide-slate-200 text-right text-sm">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="px-3 py-2 font-semibold text-slate-700">المادة</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">رمز المادة</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">تاريخ الامتحان</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">أستاذ المادة</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">عدد الطلبة</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">تاريخ التسجيل</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">مفتاح الإجابة</th>
                                    <th className="px-3 py-2 font-semibold text-slate-700">إجراءات</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {exams.map((r) => (
                                    <tr key={r.id} className="hover:bg-slate-50">
                                      <td className="px-3 py-2 font-medium text-slate-900">{r.subject_name}</td>
                                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                                        {r.subject_code || "—"}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.exam_date}</td>
                                      <td className="px-3 py-2 text-slate-700">{r.teacher_name || "—"}</td>
                                      <td className="px-3 py-2 text-slate-700">{r.student_count}</td>
                                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                                        {r.created_at ? new Date(r.created_at).toLocaleString("ar-IQ") : "—"}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                                          {r.has_answer_key ? (
                                            <span className="text-xs font-semibold text-emerald-700">تم حفظ مفتاح الإجابة</span>
                                          ) : (
                                            <span className="text-xs text-slate-500">لا يوجد مفتاح بعد</span>
                                          )}
                                          <Link
                                            href={`/Correction/answer-key?exportId=${encodeURIComponent(r.id)}`}
                                            className="font-medium text-emerald-800 underline hover:text-emerald-950"
                                          >
                                            {r.has_answer_key ? "تعديل المفتاح" : "إدخال المفتاح"}
                                          </Link>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2">
                                        <button
                                          type="button"
                                          data-actions-menu-root="true"
                                          onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const nextTop = rect.bottom + 8;
                                            const nextRight = Math.max(8, window.innerWidth - rect.right);
                                            if (openActionsId === r.id) {
                                              setOpenActionsId(null);
                                              setActionsMenuPos(null);
                                              return;
                                            }
                                            setOpenActionsId(r.id);
                                            setActionsMenuPos({ top: nextTop, right: nextRight });
                                          }}
                                          className="inline-flex h-8 w-8 items-center justify-center text-lg text-slate-700 hover:text-slate-900"
                                          aria-label="فتح قائمة الإجراءات"
                                          title="إجراءات"
                                        >
                                          ⋮
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {openActionsId && actionsMenuPos ? (
          <div
            data-actions-menu-root="true"
            className="fixed z-[1000] min-w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            style={{ top: actionsMenuPos.top, right: actionsMenuPos.right }}
          >
            <Link
              href={`/Correction/composed-exams/${openActionsId}`}
              onClick={() => {
                setOpenActionsId(null);
                setActionsMenuPos(null);
              }}
              className="block rounded-md px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
            >
              عرض
            </Link>
            {(() => {
              const selected = rows.find((x) => x.id === openActionsId);
              if (!selected?.has_report) {
                return <span className="block px-3 py-2 text-xs text-slate-500">بدون تقرير</span>;
              }
              return (
                <button
                  type="button"
                  disabled={busyId === openActionsId}
                  onClick={() => {
                    void downloadReportJson(openActionsId);
                    setOpenActionsId(null);
                    setActionsMenuPos(null);
                  }}
                  className="block w-full rounded-md px-3 py-2 text-right text-sm text-indigo-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  تحميل
                </button>
              );
            })()}
            <button
              type="button"
              disabled={busyId === openActionsId}
              onClick={() => {
                const selected = rows.find((x) => x.id === openActionsId);
                if (!selected) return;
                void deleteExport(selected.id, selected.subject_name);
                setOpenActionsId(null);
                setActionsMenuPos(null);
              }}
              className="block w-full rounded-md px-3 py-2 text-right text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              حذف
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
