import { NextResponse } from "next/server";
import { buildOmrTemplateJson } from "@/src/lib/correction/omr-sheet-template";
import { resolveCorrectionOmrTemplate } from "@/src/lib/correction/resolve-correction-omr-template";

export const runtime = "nodejs";

/** قالب دوائر OMR (JSON) + إعداد معايرة كامل (إحداثيات 0..1، عتبات، تمهيد صورة) */
export async function GET() {
  const bubbles = buildOmrTemplateJson();
  const calibration = resolveCorrectionOmrTemplate();
  return NextResponse.json({ ...bubbles, calibration }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
