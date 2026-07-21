import type {
  AnswerKeyMap,
  OmrChoiceLetter,
  OmrRecognizeResult,
  QuestionExtractResult,
  SymbolicGradingResult,
  SymbolicQuestionOutcome,
} from "./types";

/**
 * المرحلة 4: مقارنة رمزية فقط بين إجابات مُستخرَجة وبين مفتاح JSON.
 * لا يوجد image diff أو مطابقة بكسلات بين صورة مفتاح وصورة طالب؛
 * إن وُجدت صورة مفتاح لاحقًا تُمرَّر بنفس محرك OMR ثم تُحفظ كمفتاح هيكلي.
 */
export function compareAnswersSymbolically(
  extractedByQuestion: Record<number, QuestionExtractResult>,
  answerKey: AnswerKeyMap,
  totalQuestions = 25
): SymbolicGradingResult {
  const byQuestion: Record<number, SymbolicQuestionOutcome> = {};
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let multiple = 0;

  for (let q = 1; q <= totalQuestions; q++) {
    const ex = extractedByQuestion[q];
    const expectedRaw = answerKey[String(q)]?.toUpperCase().trim();
    const expected: OmrChoiceLetter | null =
      expectedRaw === "A" || expectedRaw === "B" || expectedRaw === "C" || expectedRaw === "D"
        ? expectedRaw
        : null;

    if (!ex) {
      byQuestion[q] = "blank";
      blank++;
      continue;
    }

    if (ex.status === "multiple") {
      byQuestion[q] = "multiple";
      multiple++;
      continue;
    }
    if (ex.status === "blank" || ex.choice == null) {
      byQuestion[q] = "blank";
      blank++;
      continue;
    }

    if (!expected) {
      byQuestion[q] = "blank";
      blank++;
      continue;
    }

    if (ex.choice === expected) {
      byQuestion[q] = "correct";
      correct++;
    } else {
      byQuestion[q] = "wrong";
      wrong++;
    }
  }

  const maxScore = totalQuestions;
  const score = correct;
  return { byQuestion, counts: { correct, wrong, blank, multiple }, score, maxScore };
}

/** يعيد بناء نتيجة الاستخراج من استجابة التعرف (للمرحلة 4 دون إعادة مسح الصورة). */
export function extractionSnapshotFromRecognizeResult(result: OmrRecognizeResult): Record<number, QuestionExtractResult> {
  const out: Record<number, QuestionExtractResult> = {};
  for (let q = 1; q <= 25; q++) {
    const st =
      result.extractionStatuses?.[q] ?? (result.answers[q] != null ? ("chosen" as const) : ("blank" as const));
    out[q] = {
      status: st,
      choice: result.answers[q] ?? null,
      fillRatios: { A: 0, B: 0, C: 0, D: 0 },
      markScores: result.answerScores[q] ?? { A: 0, B: 0, C: 0, D: 0 },
      confidence: result.questionConfidence?.[q],
    };
  }
  return out;
}
