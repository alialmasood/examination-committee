/**
 * توليد ثلاثة مصنفات Excel منفصلة:
 * 1) استخراج من صورة المسح
 * 2) مفتاح إجابة نموذجي (من JSON في DB) كجدول Excel
 * 3) مقارنة وتحليل بين الاثنين
 */

import ExcelJS from "exceljs";
import type { AnswerKeyMap, OmrRecognizeResult, SymbolicGradingResult } from "./services/types";

function outcomeAr(o: string): string {
  if (o === "correct") return "صحيح";
  if (o === "wrong") return "خطأ";
  if (o === "blank") return "فراغ (لا تظليل واضح)";
  if (o === "multiple") return "تظليل متعدد";
  return o;
}

function statusAr(s: string): string {
  if (s === "chosen") return "مظلل";
  if (s === "blank") return "فراغ";
  if (s === "multiple") return "متعدد";
  return s;
}

export type GradeWorkbookExportMeta = {
  id: string;
  subject_name: string;
  exam_date: string;
  department?: string | null;
  stage?: string | null;
  study_type?: string | null;
};

const rtl: Partial<ExcelJS.AddWorksheetOptions> = { views: [{ rightToLeft: true }] };

function addRecordInfoSheet(wb: ExcelJS.Workbook, exportMeta: GradeWorkbookExportMeta, stepNote: string) {
  const ws = wb.addWorksheet("معلومات_السجل", rtl);
  ws.columns = [{ width: 24 }, { width: 46 }];
  ws.addRow(["الخطوة", stepNote]);
  ws.addRow(["معرّف التصدير", exportMeta.id]);
  ws.addRow(["المادة", exportMeta.subject_name]);
  ws.addRow(["تاريخ الامتحان", exportMeta.exam_date]);
  ws.addRow(["القسم", exportMeta.department || "—"]);
  ws.addRow(["المرحلة", exportMeta.stage || "—"]);
  ws.addRow(["نوع الدراسة", exportMeta.study_type || "—"]);
  ws.getColumn(1).font = { bold: true };
}

/** الخطوة 1: ملف Excel من استخراج المسح الضوئي فقط */
export async function buildScanExtractWorkbookBuffer(
  exportMeta: GradeWorkbookExportMeta,
  scan: OmrRecognizeResult
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "systimit-omr";
  wb.created = new Date();

  addRecordInfoSheet(
    wb,
    exportMeta,
    "1 — تحويل صورة المسح إلى بيانات (استخراج دوائر مظللة؛ الفراغ = لا تظليل واضح)"
  );

  const meta = wb.addWorksheet("ملخص_المسح", rtl);
  meta.columns = [{ width: 22 }, { width: 44 }];
  meta.addRow(["رمز الشيت", scan.sheetCode || "—"]);
  meta.addRow(["ثقة قراءة الرمز", String(scan.sheetCodeConfidence)]);
  meta.addRow([
    "مطابقة القائمة",
    scan.rosterMatch ? `${scan.rosterMatch.student_name} (${scan.rosterMatch.sheet_code})` : "—",
  ]);
  meta.addRow(["إصدار قالب OMR", scan.layoutVersion]);
  meta.addRow(["يحتاج مراجعة", scan.needsReview ? "نعم" : "لا"]);
  if (scan.reviewReasons?.length) {
    meta.addRow(["أسباب المراجعة", scan.reviewReasons.join(" | ")]);
  }
  meta.getColumn(1).font = { bold: true };

  const scanSheet = wb.addWorksheet("استخراج_المسح", rtl);
  scanSheet.columns = [
    { header: "السؤال", key: "q", width: 10 },
    { header: "القراءة", key: "ans", width: 8 },
    { header: "حالة الاستخراج", key: "st", width: 18 },
    { header: "درجة A", key: "a", width: 10 },
    { header: "درجة B", key: "b", width: 10 },
    { header: "درجة C", key: "c", width: 10 },
    { header: "درجة D", key: "d", width: 10 },
  ];
  scanSheet.getRow(1).font = { bold: true };
  for (let q = 1; q <= 25; q++) {
    const st = scan.extractionStatuses?.[q] ?? "blank";
    const ans = scan.answers[q];
    const sc = scan.answerScores[q] ?? { A: 0, B: 0, C: 0, D: 0 };
    scanSheet.addRow({
      q,
      ans: ans ?? "",
      st: statusAr(st),
      a: Number(sc.A.toFixed(2)),
      b: Number(sc.B.toFixed(2)),
      c: Number(sc.C.toFixed(2)),
      d: Number(sc.D.toFixed(2)),
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** الخطوة 2: ملف Excel من مفتاح الإجابة النموذجي (البيانات المحفوظة كما في صفحة مفتاح الإجابة) */
export async function buildAnswerKeyWorkbookBuffer(
  exportMeta: GradeWorkbookExportMeta,
  answerKey: AnswerKeyMap
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "systimit-omr";
  wb.created = new Date();

  addRecordInfoSheet(
    wb,
    exportMeta,
    "2 — مفتاح الإجابة النموذجي مُصدَّر إلى Excel (من قاعدة البيانات / نفس سجل صفحة مفتاح الإجابة)"
  );

  const keySheet = wb.addWorksheet("مفتاح_الإجابة_النموذجي", rtl);
  keySheet.columns = [
    { header: "السؤال", key: "q", width: 10 },
    { header: "الإجابة النموذجية", key: "k", width: 16 },
  ];
  keySheet.getRow(1).font = { bold: true };
  for (let q = 1; q <= 25; q++) {
    const raw = answerKey[String(q)]?.toUpperCase().trim() || "";
    keySheet.addRow({ q, k: raw || "—" });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** الخطوة 3: تحليل ومقارنة (نتيجة المطابقة بين استخراج المسح والمفتاح) */
export async function buildAnalysisComparisonWorkbookBuffer(
  exportMeta: GradeWorkbookExportMeta,
  scan: OmrRecognizeResult,
  answerKey: AnswerKeyMap,
  grading: SymbolicGradingResult
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "systimit-omr";
  wb.created = new Date();

  addRecordInfoSheet(
    wb,
    exportMeta,
    "3 — تحليل ومقارنة: ملف المسح (مستخرج) مقابل ملف المفتاح النموذجي"
  );

  const summary = wb.addWorksheet("ملخص_النتيجة", rtl);
  summary.columns = [{ width: 26 }, { width: 36 }];
  summary.addRow(["الدرجة (صحيح / الإجمالي)", `${grading.score} / ${grading.maxScore}`]);
  summary.addRow(["صحيح", String(grading.counts.correct)]);
  summary.addRow(["خطأ", String(grading.counts.wrong)]);
  summary.addRow(["فراغ", String(grading.counts.blank)]);
  summary.addRow(["تظليل متعدد", String(grading.counts.multiple)]);
  summary.addRow(["رمز الشيت (من المسح)", scan.sheetCode || "—"]);
  summary.addRow([
    "ملاحظة",
    "الفراغ = لا يوجد تظليل واضح على أي خيار؛ لا يُحسب كإجابة مختارة في المقارنة.",
  ]);
  summary.getColumn(1).font = { bold: true };

  const cmp = wb.addWorksheet("مقارنة_سؤال_بسؤال", rtl);
  cmp.columns = [
    { header: "السؤال", key: "q", width: 10 },
    { header: "المفتاح النموذجي", key: "exp", width: 16 },
    { header: "قراءة المسح", key: "got", width: 14 },
    { header: "نتيجة المقارنة", key: "out", width: 22 },
  ];
  cmp.getRow(1).font = { bold: true };
  for (let q = 1; q <= 25; q++) {
    const exp = answerKey[String(q)]?.toUpperCase().trim() || "";
    const got = scan.answers[q] ?? "";
    const st = scan.extractionStatuses?.[q];
    const out = grading.byQuestion[q];
    const gotDisp =
      st === "blank" || got === null || got === ""
        ? "فراغ"
        : st === "multiple"
          ? "متعدد"
          : String(got);
    cmp.addRow({
      q,
      exp: exp || "—",
      got: gotDisp,
      out: out ? outcomeAr(out) : "—",
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
