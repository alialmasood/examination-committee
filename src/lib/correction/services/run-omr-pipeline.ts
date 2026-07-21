/**
 * تنسيق المراحل: تطبيع (حسب قالب المعايرة) → استخراج → تجميع نتيجة التعرف (مقارنة رمزية مع المفتاح تتم في API عند الحاجة).
 */

import { resolveCorrectionOmrTemplate } from "../resolve-correction-omr-template";
import { normalizeSheetImageForCorrection } from "./normalize-sheet-image";
import { extractFromNormalizedSheet } from "./extract-from-normalized-sheet";
import type { OmrRecognizeOptions, OmrRecognizeResult, RecognizedAnswer } from "./types";

export async function runOmrRecognitionPipeline(
  input: Buffer,
  options?: OmrRecognizeOptions
): Promise<OmrRecognizeResult> {
  const cal = options?.calibration ?? {};
  const template = resolveCorrectionOmrTemplate(options?.omrTemplate);

  const normalized = await normalizeSheetImageForCorrection(input, {
    forceFullContentBBox: Boolean(cal.skipAutoBBox),
    templatePreprocess: {
      pageWidth: template.pageWidth,
      pageHeight: template.pageHeight,
      blurKernel: template.blurKernel,
      adaptiveThresholdBlockSize: template.adaptiveThresholdBlockSize,
      adaptiveThresholdC: template.adaptiveThresholdC,
    },
  });

  const extracted = extractFromNormalizedSheet(normalized, {
    calibration: options?.calibration,
    minFill: options?.minFill,
    minGap: options?.minGap,
    template,
    includeCalibrationDebug: options?.includeCalibrationDebug,
  });

  const nQ = template.questionsPerTemplate;
  const answers: Record<number, RecognizedAnswer> = {};
  const extractionStatuses = extracted.byQuestion;
  const statusMap: OmrRecognizeResult["extractionStatuses"] = {};
  const questionConfidence: Record<number, number> = {};

  for (let q = 1; q <= nQ; q++) {
    const r = extracted.byQuestion[q]!;
    statusMap[q] = r.status;
    answers[q] = r.status === "chosen" ? r.choice : null;
    if (typeof r.confidence === "number") questionConfidence[q] = r.confidence;
  }

  const answerScores = extracted.answerScoresLegacy;

  const reviewReasons: string[] = [];
  if (!extracted.sheetCode) reviewReasons.push("رمز الشيت غير مقروء بثقة كافية.");

  const unclearQs: number[] = [];
  for (let q = 1; q <= nQ; q++) {
    const st = extracted.byQuestion[q]?.status;
    if (st !== "chosen") unclearQs.push(q);
  }
  if (unclearQs.length > 0) {
    const list = unclearQs.join("، ");
    reviewReasons.push(
      `${unclearQs.length} سؤالًا: فراغ أو تظليل متعدد حسب قواعد fill ratio (الأسئلة: ${list}).`
    );
  }

  let rosterMatch: OmrRecognizeResult["rosterMatch"] = null;
  if (extracted.sheetCode && options?.roster?.length) {
    const hit = options.roster.find((s) => String(s.sheet_code || "").trim() === extracted.sheetCode);
    if (hit && hit.student_name) {
      rosterMatch = {
        id: String(hit.id || ""),
        student_name: String(hit.student_name),
        sheet_code: extracted.sheetCode,
      };
    } else {
      reviewReasons.push("رمز الشيت غير موجود في قائمة التصدير المختارة.");
    }
  }

  const needsReview = reviewReasons.length > 0;

  return {
    layoutVersion: template.layoutVersion,
    sheetCode: extracted.sheetCode,
    studentCodeDetection: extracted.studentCodeDetection,
    sheetCodeDigits: extracted.sheetCodeDigits,
    sheetCodeConfidence: extracted.sheetCodeConfidence,
    answers,
    answerScores,
    needsReview,
    reviewReasons,
    rosterMatch,
    extractionStatuses: statusMap,
    questionConfidence,
    calibrationQuestionDetails: extracted.calibrationQuestionDetails,
    calibration: {
      bbox: extracted.meta.contentBBox,
      fullWidth: extracted.meta.width,
      fullHeight: extracted.meta.height,
      channels: extracted.meta.channels,
      pipeline: extracted.layout.rasterPipeline,
      skipAutoBBox: extracted.layout.skipAutoBBox,
      autoLayoutSkipped: extracted.layout.autoLayoutSkipped,
      autoLayoutMetric: extracted.layout.autoLayoutMetric,
      autoOffsetX: extracted.layout.autoOffsetX,
      autoOffsetY: extracted.layout.autoOffsetY,
      autoScale: extracted.layout.autoScale,
      portraitCorrected: extracted.meta.portraitCorrected,
      offsetX: extracted.layout.offsetX,
      offsetY: extracted.layout.offsetY,
      scale: extracted.layout.scale,
      medianAnswerScore: extracted.layout.medianAnswerScore,
      p90AnswerScore: extracted.layout.p90AnswerScore,
      correctionPipelineVersion: extracted.meta.pipelineVersion,
      deskewDegrees: extracted.meta.deskewDegrees,
      perspectiveCorrected: extracted.meta.perspectiveCorrected,
    },
  };
}
