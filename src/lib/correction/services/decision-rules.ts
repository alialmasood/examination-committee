import type { ExtractStatus, OmrChoiceLetter } from "./types";

export type FillDecisionOptions = {
  /** أعلى نسبة تعبئة أقل من هذا → فراغ */
  fillThreshold: number;
  /** فرق أقل بين الأول والثاني → تظليل متعدد (يُعبَّأ من multipleMarkDelta في القالب) */
  minDifferenceBetweenTop2: number;
  /** عتبة فراغ بديلة؛ إن وُجدت يُستخدم الأصغر بينها وبين fillThreshold (أشدّ صرامةً = فراغ أسهل) */
  blankThreshold?: number;
  /** ثقة فاصلة: إن كان الفارق بين الأول والثاني ضعيفًا رغم تجاوز multipleMarkDelta → تظليل متعدد */
  minConfidence?: number;
};

/** مواءمة مع detect_answers.py: خياران بقوة متقاربة → متعدد حتى لو كان الفارق المطلق كبيرًا */
const TWIN_SECOND_TO_BEST_RATIO = 0.58;
const TWIN_MIN_BEST_SCORE = 0.072;

export const DEFAULT_FILL_DECISION: FillDecisionOptions = {
  fillThreshold: 0.07,
  minDifferenceBetweenTop2: 0.028,
  minConfidence: 0,
};

export function decideQuestionFromFillRatios(
  ratios: Record<OmrChoiceLetter, number>,
  opts: FillDecisionOptions = DEFAULT_FILL_DECISION
): { status: ExtractStatus; choice: OmrChoiceLetter | null; confidence: number } {
  const entries = (Object.entries(ratios) as [OmrChoiceLetter, number][]).sort((a, b) => b[1] - a[1]);
  const top = entries[0]!;
  const second = entries[1]!;
  const blankCut = Math.min(opts.fillThreshold, opts.blankThreshold ?? opts.fillThreshold);
  if (top[1] < blankCut) return { status: "blank", choice: null, confidence: 0 };
  const twinFloor = Math.max(TWIN_MIN_BEST_SCORE, blankCut * 2.4);
  if (top[1] >= twinFloor && second[1] > 1e-9 && second[1] / top[1] >= TWIN_SECOND_TO_BEST_RATIO) {
    return { status: "multiple", choice: null, confidence: 0 };
  }
  const gap = top[1] - second[1];
  if (gap < opts.minDifferenceBetweenTop2) return { status: "multiple", choice: null, confidence: 0 };
  const denom = Math.max(opts.minDifferenceBetweenTop2, 1e-9);
  const confidence = Math.min(1, gap / denom);
  const minC = opts.minConfidence ?? 0;
  if (minC > 0 && confidence < minC) return { status: "multiple", choice: null, confidence };
  return { status: "chosen", choice: top[0], confidence };
}
