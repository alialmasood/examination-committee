/** نفس منطق واجهة المعايرة: قاعدة من API + ملف الإزاحات المحفوظ (بما فيه إزاحة كل حرف A–D) */

import {
  applyUiOverridesToFlatAnswerPoints,
  type QuestionUiOverride,
} from "@/src/lib/correction/apply-ui-overrides-flat-answer";

export type NormPoint = { nx: number; ny: number };

export type QuestionCalibrationRow = { nx: number; ny: number; spread: number };

export function defaultQuestionCalibration(): QuestionCalibrationRow {
  return { nx: 0, ny: 0, spread: 1 };
}

/** صف سؤال كما يعيده GET calibration-overrides (قد يتضمّن letters) */
type ApiQuestionOverride = {
  nx?: number;
  ny?: number;
  spread?: number;
  letters?: Record<string, { nx?: number; ny?: number } | undefined>;
};

function apiOverridesToRecord(
  overrides: Record<string, ApiQuestionOverride> | undefined,
  nQ: number
): Record<number, QuestionUiOverride> {
  const out: Record<number, QuestionUiOverride> = {};
  if (!overrides) return out;
  for (const [ks, v] of Object.entries(overrides)) {
    if (!/^\d+$/.test(ks)) continue;
    const q = Number(ks);
    if (q < 1 || q > nQ) continue;
    const nx = Number(v.nx);
    const ny = Number(v.ny);
    const spread = Number(v.spread);
    const row: QuestionUiOverride = {
      nx: Number.isFinite(nx) ? nx : 0,
      ny: Number.isFinite(ny) ? ny : 0,
      spread: Number.isFinite(spread) && spread > 0 ? spread : 1,
    };
    const rawLetters = v.letters;
    if (rawLetters && typeof rawLetters === "object" && !Array.isArray(rawLetters)) {
      const letters: NonNullable<QuestionUiOverride["letters"]> = {};
      for (const L of ["A", "B", "C", "D"] as const) {
        const ent = rawLetters[L];
        if (!ent || typeof ent !== "object") continue;
        const lnx = Number(ent.nx);
        const lny = Number(ent.ny);
        letters[L] = {
          nx: Number.isFinite(lnx) ? lnx : 0,
          ny: Number.isFinite(lny) ? lny : 0,
        };
      }
      if (Object.keys(letters).length) row.letters = letters;
    }
    out[q] = row;
  }
  return out;
}

/**
 * يطبّق overrides من GET calibration-overrides على نقاط answers من calibration-preview.
 * يطابق منطق `adjustedAnswerPoints` في `CalibrationTemplatePreview` (بما فيه `letters` لكل فقاعة).
 */
export function mergeCalibrationAnswerPoints(
  base: NormPoint[],
  totalQuestions: number,
  overrides: Record<string, ApiQuestionOverride> | undefined
): NormPoint[] {
  const nQ = Math.min(totalQuestions, Math.max(1, Math.floor(base.length / 4)));
  const mapped = apiOverridesToRecord(overrides, nQ);
  if (!Object.keys(mapped).length) {
    return base.map((p) => ({ nx: p.nx, ny: p.ny }));
  }
  return applyUiOverridesToFlatAnswerPoints(base, nQ, mapped);
}
