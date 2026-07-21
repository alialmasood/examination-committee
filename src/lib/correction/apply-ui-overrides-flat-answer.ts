/**
 * تطبيق إزاحات المعايرة على قائمة نقاط الإجابات المسطّحة — بدون fs (آمن للمتصفح والعميل).
 * يُستورد من صفحة الاختبار ومن دمج المعايرة؛ يعاد تصديره من question-calibration-ui-overrides للخادم.
 */

import type { OmrAnswerLetter } from "./omr-sheet-template";

export type BubbleLetterOffset = { nx: number; ny: number };

/** إزاحة السؤال ككتلة + تباعد؛ واختياريًا إزاحة دقيقة لكل حرف A–D */
export type QuestionUiOverride = {
  nx: number;
  ny: number;
  spread: number;
  letters?: Partial<Record<OmrAnswerLetter, BubbleLetterOffset>>;
};

const LETTERS: OmrAnswerLetter[] = ["A", "B", "C", "D"];

/** ترتيب (س1 A-D، س2 A-D، …) كما في buildAnswerBubbleFlatPoints */
export function applyUiOverridesToFlatAnswerPoints(
  base: { nx: number; ny: number }[],
  totalQuestions: number,
  overrides: Record<number, QuestionUiOverride>
): { nx: number; ny: number }[] {
  if (!Object.keys(overrides).length) return base;
  const nQ = Math.min(totalQuestions, Math.floor(base.length / 4));
  const out = base.map((p) => ({ nx: p.nx, ny: p.ny }));
  for (let q = 1; q <= nQ; q++) {
    const d = overrides[q];
    if (!d) continue;
    const spread = d.spread > 0 ? d.spread : 1;
    const start = (q - 1) * 4;
    if (start + 3 >= base.length) break;
    const group = [0, 1, 2, 3].map((j) => ({
      nx: base[start + j]!.nx + d.nx,
      ny: base[start + j]!.ny + d.ny,
    }));
    const cx = (group[0]!.nx + group[1]!.nx + group[2]!.nx + group[3]!.nx) / 4;
    for (let j = 0; j < 4; j++) {
      out[start + j] = {
        nx: cx + (group[j]!.nx - cx) * spread,
        ny: group[j]!.ny,
      };
    }
    const letters = d.letters;
    if (letters) {
      for (let j = 0; j < 4; j++) {
        const L = LETTERS[j]!;
        const off = letters[L];
        if (!off) continue;
        const cur = out[start + j]!;
        out[start + j] = { nx: cur.nx + off.nx, ny: cur.ny + off.ny };
      }
    }
  }
  return out;
}
