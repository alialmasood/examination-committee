import { NextResponse } from "next/server";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@/src/lib/db";
import {
  buildAnswerBubbleFlatPointsFromGeometry,
  buildStudentCodeFlatPointsFromGeometry,
  parsePythonTemplateConfigContent,
} from "@/src/lib/correction/python-template-config-sync";

export const runtime = "nodejs";

type TemplateRow = { code: string; question_count: number };

function templateBaseName(templateCode: string): string {
  const code = String(templateCode || "").trim().toUpperCase();
  if (code === "OMR_50") return "sheet50";
  if (code === "OMR_75") return "sheet75";
  if (code === "OMR_100") return "sheet100";
  return "empetyfofm";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * النماذج الرسمية في المجلد:
 * OMR_25 → empetyfofm.pdf، OMR_50 → sheet50.pdf، OMR_75 → sheet75.pdf، OMR_100 → sheet100.pdf
 * إن وُجد PDF يُعتمد كمصدر أصلي قبل PNG/JPG.
 */
async function resolveTemplateAssetPath(root: string, templateCode: string) {
  const base = templateBaseName(templateCode);
  const dir = join(root, "services", "omr-python");
  const pdfCandidate = `${base}.pdf`;
  const imageCandidates = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`];

  const pdfPath = join(dir, pdfCandidate);
  if (await fileExists(pdfPath)) {
    return { name: pdfCandidate, path: pdfPath, mime: "application/pdf" as const };
  }

  for (const imageName of imageCandidates) {
    const p = join(dir, imageName);
    if (await fileExists(p)) {
      const lower = imageName.toLowerCase();
      const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
      return { name: imageName, path: p, mime };
    }
  }

  return null;
}

function previewGlobalAnswerShift(templateCode: string, answerRowStep: number): { nx: number; ny: number } {
  const code = String(templateCode || "").trim().toUpperCase();
  if (code === "OMR_100") {
    return { nx: 0, ny: -(answerRowStep * 6.0) };
  }
  return { nx: 0, ny: 0 };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateCode = String(searchParams.get("templateCode") || "OMR_25").trim().toUpperCase();
    const metaOnly = String(searchParams.get("metaOnly") || "") === "1";

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
      // إبقاء fallback إلى TOTAL_QUESTIONS داخل Python config إذا تعذر الاستعلام.
    }

    const answerCenters = buildAnswerBubbleFlatPointsFromGeometry(geom);
    const globalShift = previewGlobalAnswerShift(templateCode, geom.answerRowStep);
    const shiftedAnswerCenters = answerCenters.map((p) => ({
      nx: p.nx + globalShift.nx,
      ny: p.ny + globalShift.ny,
    }));
    const studentCenters = buildStudentCodeFlatPointsFromGeometry(geom);

    if (metaOnly) {
      return NextResponse.json(
        {
          success: true,
          metaOnly: true,
          templateAssetName: "canonical.svg",
          previewMime: "image/svg+xml",
          template: {
            templateCode,
            pageWidth: geom.pageWidth,
            pageHeight: geom.pageHeight,
            bubbleRadiusNorm: geom.bubbleRadiusNorm,
            bubbleRadiusPx: Math.round(geom.bubbleRadiusNorm * Math.min(geom.pageWidth, geom.pageHeight)),
            totalQuestions: geom.totalQuestions,
            answerBubbleCount: shiftedAnswerCenters.length,
            studentCodeBubbleCount: studentCenters.length,
          },
          overlays: {
            answers: shiftedAnswerCenters,
            studentCode: studentCenters,
          },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const asset = await resolveTemplateAssetPath(root, templateCode);
    if (!asset) {
      return NextResponse.json(
        { success: false, error: "تعذر العثور على ملف القالب (PNG/JPG/PDF) داخل services/omr-python." },
        { status: 404 }
      );
    }

    const assetBuf = await readFile(asset.path);
    const previewDataUrl = `data:${asset.mime};base64,${assetBuf.toString("base64")}`;

    return NextResponse.json(
      {
        success: true,
        imageDataUrl: asset.mime.startsWith("image/") ? previewDataUrl : undefined,
        templateImageName: asset.name,
        templateAssetName: asset.name,
        previewDataUrl,
        previewMime: asset.mime,
        template: {
          templateCode,
          pageWidth: geom.pageWidth,
          pageHeight: geom.pageHeight,
          bubbleRadiusNorm: geom.bubbleRadiusNorm,
          bubbleRadiusPx: Math.round(geom.bubbleRadiusNorm * Math.min(geom.pageWidth, geom.pageHeight)),
          totalQuestions: geom.totalQuestions,
          answerBubbleCount: shiftedAnswerCenters.length,
          studentCodeBubbleCount: studentCenters.length,
        },
        overlays: {
          answers: shiftedAnswerCenters,
          studentCode: studentCenters,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تجهيز معاينة القالب.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
