/**
 * يصدّر بيانات شيت OMR (مستخرجة من قراءة بصرية للصورة) إلى Excel.
 * لتوليد ملف من صورة أخرى: عدّل الكائن parsed أو اربطه بمسار OMR في المشروع لاحقًا.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";

const parsed = {
  institution: "وزارة التعليم العالي والبحث العلمي — كلية الشرق التقنية التخصصية",
  examTitle: "الامتحان النهائي 2025-2026",
  studentName: "حسن حسين مزهر",
  stage: "الأولى",
  studyType: "صباحي",
  department: "قسم تقنيات الفيزياء الصحية",
  college: "كلية الشرق التقنية التخصصية",
  subjectName: "مادة الفيزياء",
  examDate: "2026-04-23",
  sheetCode: "10002",
  answers: {
    1: "A",
    2: "B",
    3: "C",
    4: "C",
    5: "A",
    6: "B",
    7: "C",
    8: "D",
    9: "C",
    10: "D",
    11: "D",
    12: "D",
    13: "D",
    14: "C",
    15: "B",
    16: "D",
    17: "B",
    18: "B",
    19: "C",
    20: "C",
    21: "B",
    22: "B",
    23: "B",
    24: "D",
    25: "C",
  } as Record<number, string>,
};

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "systimit";
  wb.created = new Date();

  const info = wb.addWorksheet("معلومات الطالب والامتحان", {
    views: [{ rightToLeft: true }],
  });
  info.columns = [{ width: 28 }, { width: 42 }];
  const rows: [string, string][] = [
    ["الجهة / العنوان", parsed.institution],
    ["عنوان الامتحان", parsed.examTitle],
    ["اسم الطالب", parsed.studentName],
    ["المرحلة", parsed.stage],
    ["نوع الدراسة", parsed.studyType],
    ["القسم", parsed.department],
    ["الكلية", parsed.college],
    ["اسم المادة", parsed.subjectName],
    ["تاريخ الامتحان", parsed.examDate],
    ["رمز الشيت (الرقم المظلل)", parsed.sheetCode],
  ];
  for (const [k, v] of rows) {
    info.addRow([k, v]);
  }
  info.getRow(1).font = { bold: true };
  info.eachRow((row, i) => {
    if (i === 1) return;
    row.getCell(1).font = { bold: true };
  });

  const ans = wb.addWorksheet("الإجابات", { views: [{ rightToLeft: true }] });
  ans.columns = [
    { header: "رقم السؤال", key: "q", width: 14 },
    { header: "الإجابة المظللة", key: "a", width: 18 },
  ];
  ans.getRow(1).font = { bold: true };
  for (let q = 1; q <= 25; q++) {
    ans.addRow({ q, a: parsed.answers[q] ?? "" });
  }

  const outDir = join(process.cwd(), "exports");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "omr-sheet-parsed-from-scan.xlsx");
  await wb.xlsx.writeFile(outPath);
  // eslint-disable-next-line no-console
  console.log("Wrote:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
