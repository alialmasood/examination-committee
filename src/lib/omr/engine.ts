import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { recognizeOmrSheetImage } from "@/src/lib/correction/omr-recognize";
import type { AnswerKeyMap, OmrRecognizeResult, RosterStudent } from "@/src/lib/correction/services/types";
import { compareWithAnswerKey, produceResult } from "./compare";
import { extractStudentAnswers } from "./extract";
import { detectSheetBounds, extractStudentCode, normalizeToCanonicalSize, perspectiveCorrection, preprocessImage } from "./preprocess";
import type { OmrTemplate } from "./templates";

const execFileAsync = promisify(execFile);

export async function loadPdf(pdfBuffer: Buffer): Promise<Buffer> {
  return pdfBuffer;
}

export async function convertPdfPagesToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const baseDir = await mkdtemp(join(tmpdir(), "omr-pdf-"));
  const pdfPath = join(baseDir, "input.pdf");
  const prefix = join(baseDir, "page");
  try {
    await writeFile(pdfPath, pdfBuffer);
    // يعتمد على أداة poppler (pdftoppm) المتوفرة في النظام.
    await execFileAsync("pdftoppm", ["-png", "-r", "300", pdfPath, prefix], { windowsHide: true });
    const files = (await readdir(baseDir))
      .filter((f) => /^page-\d+\.png$/i.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/\d+/)?.[0] || 0);
        const nb = Number(b.match(/\d+/)?.[0] || 0);
        return na - nb;
      });
    const pages: Buffer[] = [];
    for (const f of files) {
      pages.push(await readFile(join(baseDir, f)));
    }
    if (!pages.length) {
      throw new Error("لم يتم استخراج صفحات من PDF.");
    }
    return pages;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "فشل تحويل PDF.";
    if (msg.toLowerCase().includes("pdftoppm")) {
      throw new Error(
        "تعذر تحويل PDF. يلزم تثبيت أداة pdftoppm (Poppler) على الخادم لتحويل الصفحات إلى صور."
      );
    }
    throw e;
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

export async function analyzeSinglePageImage(
  pageImage: Buffer,
  roster: RosterStudent[] | undefined,
  template: OmrTemplate
): Promise<OmrRecognizeResult> {
  const p0 = preprocessImage(pageImage);
  const p1 = detectSheetBounds(p0);
  const p2 = perspectiveCorrection(p1);
  const p3 = normalizeToCanonicalSize(p2);
  return recognizeOmrSheetImage(p3.image, {
    roster,
    omrTemplate: template.templateConfig,
  });
}

export async function processPdfOmrPipeline(input: {
  pdfBuffer: Buffer;
  answerKey: AnswerKeyMap;
  template: OmrTemplate;
  roster?: RosterStudent[];
}) {
  const { pdfBuffer, answerKey, template, roster } = input;
  const loaded = await loadPdf(pdfBuffer);
  const pages = await convertPdfPagesToImages(loaded);
  const results: Array<
    | { pageIndex: number; success: true; data: ReturnType<typeof produceResult> }
    | { pageIndex: number; success: false; errors: string[] }
  > = [];
  for (let i = 0; i < pages.length; i++) {
    const pageIndex = i + 1;
    try {
      const recognized = await analyzeSinglePageImage(pages[i]!, roster, template);
      const extracted = extractStudentAnswers(recognized, template.totalQuestions);
      const studentIdentifier = extractStudentCode(recognized) || extracted.studentIdentifier;
      const grading = compareWithAnswerKey(recognized, answerKey, template.totalQuestions);
      results.push({
        pageIndex,
        success: true,
        data: produceResult({
          pageIndex,
          studentIdentifier,
          result: recognized,
          grading,
          totalQuestions: template.totalQuestions,
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذر تحليل الصفحة.";
      results.push({ pageIndex, success: false, errors: [msg] });
    }
  }
  return {
    totalPages: pages.length,
    pageImages: pages,
    results,
  };
}

