/**
 * إعداد قالب OMR للمعايرة: إحداثيات معيّنة 0..1 بالنسبة لحجم الصفحة المرجعية بعد التطبيع (warp/resize)،
 * وليس بكسلات ثابتة قبل التطبيع.
 */

import {
  OMR_LAYOUT_VERSION,
  OMR_REF_HEIGHT,
  OMR_REF_WIDTH,
  buildAnswerBubbles,
  buildSheetCodeBubbles,
  type OmrAnswerLetter,
} from "./omr-sheet-template";

/** مركز فقاعة في مساحة الصفحة 0..1 (حواف الشيت = 0 و 1) */
export type NormPoint = { nx: number; ny: number };

export type OmrBubbleTemplateDef = {
  /** مثل q1_A أو code_c0_d3 */
  id: string;
  question?: number;
  letter?: OmrAnswerLetter;
  /** لرمز الشيت */
  sheetCol?: number;
  sheetDigit?: number;
  center: NormPoint;
};

/** مستطيل سؤال في مساحة معيّنة (للعرض / التصحيح) */
export type NormRect = { nx0: number; ny0: number; nx1: number; ny1: number };

export type OmrTemplateConfig = {
  templateId: string;
  layoutVersion: string;
  pageWidth: number;
  pageHeight: number;
  questionsPerTemplate: number;
  columnsLayout: number;
  optionsPerQuestion: number;
  /** نصف قطر الفقاعة كنسبة من min(pageWidth, pageHeight) — يُحسب على الصورة المطبّعة */
  bubbleRadiusNorm: number;
  /** نسبة من نصف القطر الخارجي للعيّنة: المنطقة الداخلية فقط (تجاهل حلقة الحافة) */
  innerMaskRadiusFraction: number;
  answerBubbles: OmrBubbleTemplateDef[];
  sheetCodeBubbles: OmrBubbleTemplateDef[];
  /** مستطيلات اختيارية لكل سؤال (0..1). إن غابت تُشتق من مراكز الفقاعات */
  questionRoisNorm?: Record<number, NormRect>;
  fillThreshold: number;
  /** أقصى تعبئة للأعلى تُعدّ فراغًا (افتراضيًا = fillThreshold) */
  blankThreshold: number;
  multipleMarkDelta: number;
  minConfidence: number;
  blurKernel: number;
  adaptiveThresholdBlockSize: number;
  adaptiveThresholdC: number;
};

const LETTERS: OmrAnswerLetter[] = ["A", "B", "C", "D"];

function padNormRect(r: NormRect, pad: number): NormRect {
  return {
    nx0: Math.max(0, r.nx0 - pad),
    ny0: Math.max(0, r.ny0 - pad),
    nx1: Math.min(1, r.nx1 + pad),
    ny1: Math.min(1, r.ny1 + pad),
  };
}

/** يشتق ROI لكل سؤال من مراكز الفقاعات + نصف قطر معيّن */
export function deriveQuestionRoisFromBubbles(
  cfg: Pick<OmrTemplateConfig, "answerBubbles" | "bubbleRadiusNorm" | "pageWidth" | "pageHeight">
): Record<number, NormRect> {
  const padNorm = cfg.bubbleRadiusNorm * 2.2 + 0.02;
  const byQ: Record<number, { xs: number[]; ys: number[] }> = {};
  for (const b of cfg.answerBubbles) {
    const q = b.question;
    if (q == null) continue;
    if (!byQ[q]) byQ[q] = { xs: [], ys: [] };
    byQ[q]!.xs.push(b.center.nx);
    byQ[q]!.ys.push(b.center.ny);
  }
  const out: Record<number, NormRect> = {};
  for (const [qs, g] of Object.entries(byQ)) {
    const q = Number(qs);
    const nx0 = Math.min(...g.xs);
    const nx1 = Math.max(...g.xs);
    const ny0 = Math.min(...g.ys);
    const ny1 = Math.max(...g.ys);
    out[q] = padNormRect({ nx0, ny0, nx1, ny1 }, padNorm);
  }
  return out;
}

export function getDefaultCorrectionOmrTemplate(): OmrTemplateConfig {
  const pageWidth = OMR_REF_WIDTH;
  const pageHeight = OMR_REF_HEIGHT;
  const answerBubbles: OmrBubbleTemplateDef[] = buildAnswerBubbles().map((b) => ({
    id: `q${b.q}_${b.letter}`,
    question: b.q,
    letter: b.letter,
    center: { nx: b.nx, ny: b.ny },
  }));
  const sheetCodeBubbles: OmrBubbleTemplateDef[] = buildSheetCodeBubbles().map((b) => ({
    id: `code_c${b.col}_d${b.digit}`,
    sheetCol: b.col,
    sheetDigit: b.digit,
    center: { nx: b.nx, ny: b.ny },
  }));

  const base: OmrTemplateConfig = {
    templateId: "correction-exam-a4-v1",
    layoutVersion: OMR_LAYOUT_VERSION,
    pageWidth,
    pageHeight,
    questionsPerTemplate: 25,
    columnsLayout: 4,
    optionsPerQuestion: 4,
    bubbleRadiusNorm: 9 / Math.min(OMR_REF_WIDTH, OMR_REF_HEIGHT),
    innerMaskRadiusFraction: 0.68,
    answerBubbles,
    sheetCodeBubbles,
    fillThreshold: 0.07,
    blankThreshold: 0.07,
    multipleMarkDelta: 0.028,
    minConfidence: 0.35,
    blurKernel: 0.35,
    adaptiveThresholdBlockSize: 0,
    adaptiveThresholdC: 7,
  };

  return {
    ...base,
    questionRoisNorm: deriveQuestionRoisFromBubbles(base),
  };
}

export function mergeQuestionRois(
  cfg: OmrTemplateConfig,
  override?: Record<number, NormRect>
): Record<number, NormRect> {
  const derived = cfg.questionRoisNorm ?? deriveQuestionRoisFromBubbles(cfg);
  if (!override) return derived;
  return { ...derived, ...override };
}

export function getBubblesForQuestion(cfg: OmrTemplateConfig, q: number): OmrBubbleTemplateDef[] {
  return cfg.answerBubbles.filter((b) => b.question === q);
}

export function getQ1OptionBubbles(cfg: OmrTemplateConfig): OmrBubbleTemplateDef[] {
  return getBubblesForQuestion(cfg, 1).filter((b) => b.letter && LETTERS.includes(b.letter));
}
