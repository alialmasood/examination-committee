/**
 * المرحلة 2: استخراج من صورة مُطبَّعة بإحداثيات معيّنة 0..1 نسبةً لحجم الصفحة المرجعية + قناع دائري داخلي + عتبات من القالب.
 */

import {
  getDefaultCorrectionOmrTemplate,
  getQ1OptionBubbles,
  mergeQuestionRois,
  type OmrTemplateConfig,
} from "../omr-template-config";
import {
  bubbleInnerDiskFillRatioBinary,
  bubbleInnerDiskFillRatioGray,
  bubbleMarkScoreInnerRing,
} from "./bubble-sampling";
import { mapTemplateNormToPixel, percentile, searchAutoLayoutFromQuestion1Page, type BBox } from "./sheet-geometry";
import type { FillDecisionOptions } from "./decision-rules";
import { decideQuestionFromFillRatios } from "./decision-rules";
import type { NormalizeSheetMeta } from "./types";
import type {
  OmrChoiceLetter,
  OmrQuestionCalibrationDetail,
  QuestionExtractResult,
  StudentCodeDetection,
  StudentCodeDigitDetection,
} from "./types";
import type { NormalizedRaster } from "./normalize-sheet-image";

export type ExtractCalibrationInput = {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  skipAutoBBox?: boolean;
  skipAutoLayout?: boolean;
};

export type ExtractFromSheetOptions = {
  calibration?: ExtractCalibrationInput;
  /** لأعمدة رمز الشيت (نفس المنطق التكيّفي السابق) */
  minFill?: number;
  minGap?: number;
  fillDecision?: FillDecisionOptions;
  /** قالب المعايرة */
  template?: OmrTemplateConfig;
  /** إرجاع مصفوفة تفاصيل لكل سؤال */
  includeCalibrationDebug?: boolean;
};

function pickDigitColumnLocal(scores: number[]): { digit: number | null; conf: number } {
  const ranked = scores.map((s, d) => ({ d, s })).sort((a, b) => b.s - a.s);
  const best = ranked[0]!;
  const second = ranked[1]!;
  const sCol = [...scores].sort((a, b) => a - b);
  const colMed = sCol.length ? (sCol[4]! + sCol[5]!) / 2 : 0;
  const minFill = Math.max(6, colMed + 3);
  const minGap = Math.max(4, 0.12 * (best.s + 10));
  if (best.s < minFill || best.s - second.s < minGap) return { digit: null, conf: 0 };
  return { digit: best.d, conf: Math.min(1, (best.s - second.s) / (minGap + 20)) };
}

function pickDigitAdaptive(
  scores: number[],
  medianGlobal: number,
  p90Global: number,
  fixedMinFill?: number,
  fixedMinGap?: number
): { digit: number | null; conf: number } {
  const ranked = scores.map((s, d) => ({ d, s })).sort((a, b) => b.s - a.s);
  const best = ranked[0]!;
  const second = ranked[1]!;
  if (fixedMinFill == null && fixedMinGap == null && medianGlobal < 5 && p90Global < 28) {
    return pickDigitColumnLocal(scores);
  }
  const spread = p90Global - medianGlobal;
  const minFill =
    fixedMinFill ??
    Math.max(8, medianGlobal * 0.4 + 3, spread > 1 ? medianGlobal + spread * 0.1 : medianGlobal + 5);
  const minGap =
    fixedMinGap ?? Math.max(5, Math.min(20, 4 + 0.2 * best.s), spread > 1 ? spread * 0.07 : 6);
  if (best.s < minFill || best.s - second.s < minGap) return { digit: null, conf: 0 };
  return { digit: best.d, conf: Math.min(1, (best.s - second.s) / (minGap + 25)) };
}

function decodeSheetCodeAdaptive(
  gray: Buffer,
  width: number,
  height: number,
  channels: number,
  template: OmrTemplateConfig,
  outerRadiusPx: number,
  innerFrac: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  medianG: number,
  p90G: number,
  digitMinConfidence = 0.35,
  fixedMinFill?: number,
  fixedMinGap?: number
): { code: string | null; digits: (number | null)[]; confidence: number; detection: StudentCodeDetection } {
  const scoresByCol: number[][] = Array.from({ length: 5 }, () => Array(10).fill(0));
  for (const b of template.sheetCodeBubbles) {
    if (b.sheetCol == null || b.sheetDigit == null) continue;
    const { nx, ny } = b.center;
    const { cx, cy } = mapTemplateNormToPixel(nx, ny, width, height, offsetX, offsetY, scale);
    scoresByCol[b.sheetCol]![b.sheetDigit] = bubbleMarkScoreInnerRing(
      gray,
      width,
      height,
      channels,
      cx,
      cy,
      outerRadiusPx,
      innerFrac
    );
  }

  const digits: (number | null)[] = [];
  const detectionDigits: StudentCodeDigitDetection[] = [];
  let minConf = 1;
  for (let col = 0; col < 5; col++) {
    const colScores = scoresByCol[col]!;
    const ranked = colScores.map((s, d) => ({ d, s })).sort((a, b) => b.s - a.s);
    const best = ranked[0]!;
    const second = ranked[1]!;
    const spread = p90G - medianG;
    const minFill =
      fixedMinFill ??
      Math.max(8, medianG * 0.4 + 3, spread > 1 ? medianG + spread * 0.1 : medianG + 5);
    const minGap =
      fixedMinGap ?? Math.max(5, Math.min(20, 4 + 0.2 * best.s), spread > 1 ? spread * 0.07 : 6);
    let digit: number | null = best.d;
    let status: StudentCodeDigitDetection["status"] = "ok";
    const conf = Math.min(1, Math.max(0, (best.s - second.s) / (minGap + 25)));
    if (best.s < minFill) {
      digit = null;
      status = "blank";
    } else if (best.s - second.s < minGap) {
      digit = null;
      status = "multiple";
    } else if (conf < digitMinConfidence) {
      digit = null;
      status = "uncertain";
    }
    digits.push(digit);
    minConf = Math.min(minConf, conf);
    const scores: Record<number, number> = {};
    for (let d = 0; d <= 9; d++) scores[d] = colScores[d] ?? 0;
    detectionDigits.push({
      columnIndex: col,
      detectedDigit: digit,
      confidence: conf,
      scores,
      status,
    });
  }

  const code = digits.every((d) => d != null) ? digits.join("") : null;
  const overallConf = digits.every((d) => d != null) ? Math.min(1, minConf) : 0;
  const detection: StudentCodeDetection = {
    studentCode: code,
    digits: detectionDigits,
    confidence: overallConf,
  };
  if (digits.every((d) => d != null)) {
    return { code, digits, confidence: overallConf, detection };
  }
  return { code: null, digits, confidence: 0, detection };
}

export type SheetExtractionResult = {
  meta: NormalizeSheetMeta;
  sheetCode: string | null;
  studentCodeDetection: StudentCodeDetection;
  sheetCodeDigits: (number | null)[];
  sheetCodeConfidence: number;
  byQuestion: Record<number, QuestionExtractResult>;
  answerScoresLegacy: Record<number, { A: number; B: number; C: number; D: number }>;
  layout: {
    offsetX: number;
    offsetY: number;
    scale: number;
    autoLayoutSkipped: boolean;
    autoLayoutMetric?: number;
    autoOffsetX?: number;
    autoOffsetY?: number;
    autoScale?: number;
    medianAnswerScore: number;
    p90AnswerScore: number;
    skipAutoBBox: boolean;
    rasterPipeline: NormalizeSheetMeta["rasterPipeline"];
  };
  template: OmrTemplateConfig;
  calibrationQuestionDetails?: OmrQuestionCalibrationDetail[];
};

function bubbleFillForTemplate(
  gray: Buffer,
  binary: Buffer | undefined,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  outerR: number,
  innerFrac: number
): number {
  if (binary && binary.length === width * height) {
    return bubbleInnerDiskFillRatioBinary(binary, width, height, cx, cy, outerR, innerFrac);
  }
  return bubbleInnerDiskFillRatioGray(gray, width, height, channels, cx, cy, outerR, innerFrac, 200);
}

export function extractFromNormalizedSheet(
  normalized: NormalizedRaster,
  options?: ExtractFromSheetOptions
): SheetExtractionResult {
  const template = options?.template ?? getDefaultCorrectionOmrTemplate();
  const buf = normalized.data;
  const binary = normalized.binaryData;
  const { width, height, channels } = normalized;
  const meta = normalized.meta;
  const outerRadiusPx = Math.max(4, template.bubbleRadiusNorm * Math.min(width, height));
  const innerFrac = template.innerMaskRadiusFraction;
  const cal = options?.calibration ?? {};
  const userOffsetX = Number(cal.offsetX) || 0;
  const userOffsetY = Number(cal.offsetY) || 0;
  const userScale = cal.scale != null && cal.scale > 0.3 && cal.scale < 1.7 ? cal.scale : 1;
  const skipAutoLayout = Boolean(cal.skipAutoLayout);

  let autoOx = 0;
  let autoOy = 0;
  let autoSc = 1;
  let autoMetric = 0;
  if (!skipAutoLayout) {
    const q1Bubbles = getQ1OptionBubbles(template).map((b) => ({
      letter: b.letter!,
      nx: b.center.nx,
      ny: b.center.ny,
    }));
    const found = searchAutoLayoutFromQuestion1Page(
      buf,
      width,
      height,
      channels,
      outerRadiusPx,
      innerFrac,
      q1Bubbles
    );
    autoOx = found.ox;
    autoOy = found.oy;
    autoSc = found.sc;
    autoMetric = found.metric;
  }

  const offsetX = autoOx + userOffsetX;
  const offsetY = autoOy + userOffsetY;
  const scale = autoSc * userScale;

  const allAnswerScores: number[] = [];
  for (const def of template.answerBubbles) {
    if (def.question == null || def.letter == null) continue;
    const { cx, cy } = mapTemplateNormToPixel(
      def.center.nx,
      def.center.ny,
      width,
      height,
      offsetX,
      offsetY,
      scale
    );
    allAnswerScores.push(
      bubbleMarkScoreInnerRing(buf, width, height, channels, cx, cy, outerRadiusPx, innerFrac)
    );
  }
  const sorted = [...allAnswerScores].sort((a, b) => a - b);
  const medianGlobal = percentile(sorted, 0.5);
  const p90Global = percentile(sorted, 0.9);

  const {
    code: sheetCode,
    digits: sheetCodeDigits,
    confidence: sheetCodeConfidence,
    detection: studentCodeDetection,
  } = decodeSheetCodeAdaptive(
    buf,
    width,
    height,
    channels,
    template,
    outerRadiusPx,
    innerFrac,
    offsetX,
    offsetY,
    scale,
    medianGlobal,
    p90Global,
    template.minConfidence,
    options?.minFill,
    options?.minGap
  );

  const fd = options?.fillDecision;
  const fillOpts: FillDecisionOptions = {
    fillThreshold: fd?.fillThreshold ?? template.fillThreshold,
    minDifferenceBetweenTop2: fd?.minDifferenceBetweenTop2 ?? template.multipleMarkDelta,
    blankThreshold: fd?.blankThreshold ?? template.blankThreshold,
    minConfidence: fd?.minConfidence ?? template.minConfidence,
  };
  const nQ = template.questionsPerTemplate;
  const letters: OmrChoiceLetter[] = ["A", "B", "C", "D"];
  const byQuestion: Record<number, QuestionExtractResult> = {};
  const answerScoresLegacy: Record<number, { A: number; B: number; C: number; D: number }> = {};
  const rois = mergeQuestionRois(template);
  const calibrationQuestionDetails: OmrQuestionCalibrationDetail[] = [];

  for (let q = 1; q <= nQ; q++) {
    const ratios: Record<OmrChoiceLetter, number> = { A: 0, B: 0, C: 0, D: 0 };
    const marks: Record<OmrChoiceLetter, number> = { A: 0, B: 0, C: 0, D: 0 };
    const bubbleMeta: OmrQuestionCalibrationDetail["bubbles"] = {
      A: { fillRatio: 0, markScore: 0, cx: 0, cy: 0, outerRadiusPx: 0, innerRadiusPx: 0 },
      B: { fillRatio: 0, markScore: 0, cx: 0, cy: 0, outerRadiusPx: 0, innerRadiusPx: 0 },
      C: { fillRatio: 0, markScore: 0, cx: 0, cy: 0, outerRadiusPx: 0, innerRadiusPx: 0 },
      D: { fillRatio: 0, markScore: 0, cx: 0, cy: 0, outerRadiusPx: 0, innerRadiusPx: 0 },
    };
    const innerRpx = Math.max(1, outerRadiusPx * innerFrac);

    for (const letter of letters) {
      const def = template.answerBubbles.find((d) => d.question === q && d.letter === letter);
      if (!def) continue;
      const { cx, cy } = mapTemplateNormToPixel(
        def.center.nx,
        def.center.ny,
        width,
        height,
        offsetX,
        offsetY,
        scale
      );
      ratios[letter] = bubbleFillForTemplate(buf, binary, width, height, channels, cx, cy, outerRadiusPx, innerFrac);
      marks[letter] = bubbleMarkScoreInnerRing(buf, width, height, channels, cx, cy, outerRadiusPx, innerFrac);
      bubbleMeta[letter] = {
        fillRatio: ratios[letter],
        markScore: marks[letter],
        cx,
        cy,
        outerRadiusPx,
        innerRadiusPx: innerRpx,
      };
    }
    answerScoresLegacy[q] = marks;
    const { status, choice, confidence } = decideQuestionFromFillRatios(ratios, fillOpts);
    byQuestion[q] = {
      status,
      choice,
      fillRatios: ratios,
      markScores: marks,
      confidence,
    };

    if (options?.includeCalibrationDebug) {
      const roiNorm = rois[q] ?? { nx0: 0, ny0: 0, nx1: 1, ny1: 1 };
      calibrationQuestionDetails.push({
        question: q,
        roiNorm,
        bubbles: { ...bubbleMeta },
        decision: { status, choice, confidence },
      });
    }
  }

  return {
    meta,
    sheetCode,
    studentCodeDetection,
    sheetCodeDigits,
    sheetCodeConfidence,
    byQuestion,
    answerScoresLegacy,
    layout: {
      offsetX,
      offsetY,
      scale,
      autoLayoutSkipped: skipAutoLayout,
      autoLayoutMetric: skipAutoLayout ? undefined : autoMetric,
      autoOffsetX: skipAutoLayout ? undefined : autoOx,
      autoOffsetY: skipAutoLayout ? undefined : autoOy,
      autoScale: skipAutoLayout ? undefined : autoSc,
      medianAnswerScore: medianGlobal,
      p90AnswerScore: p90Global,
      skipAutoBBox: Boolean(cal.skipAutoBBox),
      rasterPipeline: meta.rasterPipeline,
    },
    template,
    calibrationQuestionDetails: options?.includeCalibrationDebug ? calibrationQuestionDetails : undefined,
  };
}
