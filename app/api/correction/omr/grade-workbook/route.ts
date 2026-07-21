import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  buildAnalysisComparisonWorkbookBuffer,
  buildAnswerKeyWorkbookBuffer,
  buildScanExtractWorkbookBuffer,
} from "@/src/lib/correction/build-omr-grade-workbook";
import { recognizeOmrSheetImage } from "@/src/lib/correction/omr-recognize";
import {
  compareAnswersSymbolically,
  extractionSnapshotFromRecognizeResult,
} from "@/src/lib/correction/services/compare-answers-symbolic";
import type { AnswerKeyMap } from "@/src/lib/correction/services/types";
import { query } from "@/src/lib/db";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;
const SHARP_SUPPORTED = new Set(["jpeg", "jpg", "png", "webp", "tif", "tiff", "gif", "avif"]);

async function isSupportedRaster(buf: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buf).metadata();
    const fmt = (meta.format || "").toLowerCase();
    return SHARP_SUPPORTED.has(fmt);
  } catch {
    return false;
  }
}

type ReportPayload = {
  students?: Array<{ id?: string; student_name?: string; sheet_code?: string }>;
};

export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { success: false, error: "أرسل multipart/form-data مع الحقل file و sheetExportId." },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const sheetExportId = String(form.get("sheetExportId") || "").trim();

    if (!sheetExportId) {
      return NextResponse.json({ success: false, error: "معرّف التصدير (الامتحان) مطلوب." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب (صورة)." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!(await isSupportedRaster(buf))) {
      return NextResponse.json(
        {
          success: false,
          error: "تعذر قراءة الصورة. استخدم PNG أو JPEG أو WebP.",
        },
        { status: 400 }
      );
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "حجم الملف كبير جدًا (الحد 12 ميجابايت)." }, { status: 400 });
    }

    const ex = await query(
      `
      SELECT
        id,
        subject_name,
        exam_date::text AS exam_date,
        department,
        stage,
        study_type,
        report_payload
      FROM examination_committee.correction_sheet_exports
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [sheetExportId]
    );
    const exportRow = ex.rows[0] as
      | {
          id: string;
          subject_name: string;
          exam_date: string;
          department: string | null;
          stage: string | null;
          study_type: string | null;
          report_payload?: ReportPayload | string | null;
        }
      | undefined;
    if (!exportRow) {
      return NextResponse.json({ success: false, error: "سجل التصدير غير موجود." }, { status: 404 });
    }

    const exportMeta = {
      id: exportRow.id,
      subject_name: exportRow.subject_name,
      exam_date: exportRow.exam_date,
      department: exportRow.department,
      stage: exportRow.stage,
      study_type: exportRow.study_type,
    };

    let roster: Array<{ id?: string; student_name?: string; sheet_code?: string }> | undefined;
    const payload = exportRow.report_payload;
    if (typeof payload === "string") {
      try {
        const parsed = JSON.parse(payload) as ReportPayload;
        roster = parsed.students;
      } catch {
        roster = undefined;
      }
    } else if (payload && typeof payload === "object") {
      roster = (payload as ReportPayload).students;
    }

    /** الخطوة 1: قراءة المسح وتحويله إلى بيانات ثم Excel */
    const result = await recognizeOmrSheetImage(buf, { roster });
    const scanBuf = await buildScanExtractWorkbookBuffer(exportMeta, result);

    const kr = await query(
      `SELECT answer_key FROM examination_committee.omr_answer_keys WHERE sheet_export_id = $1::uuid LIMIT 1`,
      [sheetExportId]
    );
    const keyRow = kr.rows[0] as { answer_key?: unknown } | undefined;
    const raw = keyRow?.answer_key;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json(
        {
          success: false,
          error:
            "لا يوجد مفتاح إجابة مربوط بهذا الامتحان. افتح صفحة «مفتاح الإجابة النموذجية» واحفظ المفتاح لنفس السجل ثم أعد المحاولة.",
        },
        { status: 400 }
      );
    }

    const answerKey = raw as AnswerKeyMap;

    /** الخطوة 2: مفتاح الإجابة النموذجي → Excel */
    const keyBuf = await buildAnswerKeyWorkbookBuffer(exportMeta, answerKey);

    /** الخطوة 3: مقارنة وتحليل → Excel */
    const snap = extractionSnapshotFromRecognizeResult(result);
    const grading = compareAnswersSymbolically(snap, answerKey, 25);
    const analysisBuf = await buildAnalysisComparisonWorkbookBuffer(exportMeta, result, answerKey, grading);

    const uid = randomUUID();
    const relDir = join("public", "uploads", "correction-omr-workbooks", sheetExportId);
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    const scanName = `1-scan-${uid}.xlsx`;
    const keyName = `2-answer-key-${uid}.xlsx`;
    const analysisName = `3-analysis-${uid}.xlsx`;

    await writeFile(join(absDir, scanName), scanBuf);
    await writeFile(join(absDir, keyName), keyBuf);
    await writeFile(join(absDir, analysisName), analysisBuf);

    const base = `/uploads/correction-omr-workbooks/${sheetExportId}`;

    return NextResponse.json({
      success: true,
      steps: {
        scan: {
          step: 1,
          title: "تحويل المسح إلى Excel وحفظه",
          url: `${base}/${scanName}`,
          filename: scanName,
        },
        answerKey: {
          step: 2,
          title: "تحويل مفتاح الإجابة النموذجي إلى Excel وحفظه",
          url: `${base}/${keyName}`,
          filename: keyName,
        },
        analysis: {
          step: 3,
          title: "تحليل الملفين ومقارنة النتيجة",
          url: `${base}/${analysisName}`,
          filename: analysisName,
        },
      },
      grading,
      scan: {
        sheetCode: result.sheetCode,
        sheetCodeConfidence: result.sheetCodeConfidence,
        rosterMatch: result.rosterMatch,
        answers: result.answers,
        extractionStatuses: result.extractionStatuses,
        needsReview: result.needsReview,
        reviewReasons: result.reviewReasons,
      },
      export: {
        id: exportRow.id,
        subject_name: exportRow.subject_name,
        exam_date: exportRow.exam_date,
      },
    });
  } catch (e) {
    console.error("grade-workbook", e);
    return NextResponse.json({ success: false, error: "تعذر إكمال التصحيح أو حفظ الملفات." }, { status: 500 });
  }
}
