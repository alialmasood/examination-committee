import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@/src/lib/db";
import { buildCanonicalOmSheetSvgString } from "@/src/lib/correction/canonical-omr-sheet-svg";
import { parsePythonTemplateConfigContent } from "@/src/lib/correction/python-template-config-sync";

export const runtime = "nodejs";

type TemplateRow = { code: string; question_count: number };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateCode = String(searchParams.get("templateCode") || "OMR_25").trim().toUpperCase();

    const root = process.cwd();
    const pyCfgPath = join(root, "services", "omr-python", "template_config.py");
    const cfgText = await readFile(pyCfgPath, "utf8");
    const geom = parsePythonTemplateConfigContent(cfgText);
    if (!geom) {
      return NextResponse.json({ success: false, error: "تعذر تحليل template_config.py." }, { status: 500 });
    }

    try {
      const rowQ = await query(
        `
        SELECT code, question_count
        FROM examination_committee.omr_templates
        WHERE code = $1
        LIMIT 1
        `,
        [templateCode]
      );
      const row = rowQ.rows[0] as TemplateRow | undefined;
      if (row?.question_count && Number.isFinite(Number(row.question_count))) {
        geom.totalQuestions = Math.max(1, Math.min(100, Number(row.question_count)));
      }
    } catch {
      // fallback إلى TOTAL_QUESTIONS من الملف
    }

    const logoPath = join(root, "services", "omr-python", "college2-logo.png");
    let logoPngDataUrl: string | undefined;
    try {
      const logoBuf = await readFile(logoPath);
      logoPngDataUrl = `data:image/png;base64,${logoBuf.toString("base64")}`;
    } catch {
      logoPngDataUrl = undefined;
    }

    const svg = buildCanonicalOmSheetSvgString({ templateCode, geom, logoPngDataUrl });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر توليد الشيت الثابت.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
