import { NextResponse } from "next/server";
import sharp from "sharp";
import { query } from "@/src/lib/db";
import { recognizeOmrSheetImage } from "@/src/lib/correction/omr-recognize";
import {
  compareAnswersSymbolically,
  extractionSnapshotFromRecognizeResult,
} from "@/src/lib/correction/services/compare-answers-symbolic";
import type { AnswerKeyMap } from "@/src/lib/correction/services/types";

// التعرف على صورة الطالب فقط؛ الدرجة الرمزية = استخراج هيكلي × answer_key من DB — لا مقارنة صورتين (image diff).
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

function parseNum(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { success: false, error: "أرسل multipart/form-data مع الحقل file." },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const sheetExportId = String(form.get("sheetExportId") || "").trim();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "الحقل file مطلوب (صورة PNG أو JPEG)." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!(await isSupportedRaster(buf))) {
      return NextResponse.json(
        {
          success: false,
          error:
            "تعذر قراءة الصورة. استخدم PNG أو JPEG أو WebP (يفضّل أن يكون امتداد الملف .png أو .jpg). إن كان النوع صحيحًا وما زال يرفض، قد يكون الملف تالفًا أو PDF.",
        },
        { status: 400 }
      );
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "حجم الملف كبير جدًا (الحد 12 ميجابايت)." }, { status: 400 });
    }

    let roster: Array<{ id?: string; student_name?: string; sheet_code?: string }> | undefined;
    if (sheetExportId) {
      const r = await query(
        `SELECT report_payload FROM examination_committee.correction_sheet_exports WHERE id = $1::uuid LIMIT 1`,
        [sheetExportId]
      );
      if (!r.rows.length) {
        return NextResponse.json({ success: false, error: "سجل التصدير غير موجود." }, { status: 404 });
      }
      const row = r.rows[0] as { report_payload?: ReportPayload | string } | undefined;
      const payload = row?.report_payload;
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
    }

    const offsetX = parseNum(form.get("offsetX"));
    const offsetY = parseNum(form.get("offsetY"));
    const scale = parseNum(form.get("scale"));
    const minFill = parseNum(form.get("minFill"));
    const minGap = parseNum(form.get("minGap"));
    const skipAutoBBox =
      String(form.get("skipAutoBBox") || "").toLowerCase() === "1" ||
      String(form.get("skipAutoBBox") || "").toLowerCase() === "true";
    const skipAutoLayout =
      String(form.get("skipAutoLayout") || "").toLowerCase() === "1" ||
      String(form.get("skipAutoLayout") || "").toLowerCase() === "true";
    const includeCalibrationDebug =
      String(form.get("calibrationDebug") || "").toLowerCase() === "1" ||
      String(form.get("calibrationDebug") || "").toLowerCase() === "true";

    const result = await recognizeOmrSheetImage(buf, {
      roster,
      minFill,
      minGap,
      includeCalibrationDebug,
      calibration: {
        offsetX,
        offsetY,
        scale,
        skipAutoBBox,
        skipAutoLayout,
      },
    });

    let symbolicGrading: ReturnType<typeof compareAnswersSymbolically> | undefined;
    if (sheetExportId) {
      const kr = await query(
        `
        SELECT answer_key
        FROM examination_committee.omr_answer_keys
        WHERE sheet_export_id = $1::uuid
        LIMIT 1
        `,
        [sheetExportId]
      );
      const keyRow = kr.rows[0] as { answer_key?: unknown } | undefined;
      const raw = keyRow?.answer_key;
      if (raw && typeof raw === "object") {
        const key = raw as AnswerKeyMap;
        const snap = extractionSnapshotFromRecognizeResult(result);
        symbolicGrading = compareAnswersSymbolically(snap, key, 25);
      }
    }

    return NextResponse.json({
      success: true,
      result,
      symbolicGrading,
    });
  } catch (e) {
    console.error("omr recognize", e);
    return NextResponse.json({ success: false, error: "تعذر تحليل الصورة." }, { status: 500 });
  }
}
