import { compareAnswersSymbolically } from "@/src/lib/correction/services/compare-answers-symbolic";
import type { AnswerKeyMap, OmrRecognizeResult, SymbolicGradingResult } from "@/src/lib/correction/services/types";

export type ComparedQuestion = {
  questionNumber: number;
  studentOption: string | null;
  correctOption: string;
  result: "correct" | "wrong" | "blank" | "multiple";
  confidence: number;
};

export type CompareResult = {
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  multipleCount: number;
  score: number;
  percentage: number;
  questions: ComparedQuestion[];
};

export function compareStudentAnswersToAnswerKey(
  studentAnswers: { questionNumber: number; selectedOption: string | null; status: string; confidence: number }[],
  answerKey: Record<number, string>
): CompareResult {
  const byQuestion = new Map<number, { selectedOption: string | null; status: string; confidence: number }>();
  for (const a of studentAnswers) {
    byQuestion.set(a.questionNumber, {
      selectedOption: a.selectedOption ? String(a.selectedOption).toUpperCase().trim() : null,
      status: String(a.status || "").toLowerCase(),
      confidence: Number.isFinite(a.confidence) ? a.confidence : 0,
    });
  }

  const questionNumbers = Object.keys(answerKey)
    .map((k) => Number(k))
    .filter((q) => Number.isFinite(q) && q > 0)
    .sort((a, b) => a - b);

  const questions: ComparedQuestion[] = [];
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  let multipleCount = 0;

  for (const q of questionNumbers) {
    const correctOption = String(answerKey[q] || "").toUpperCase().trim();
    const st = byQuestion.get(q);
    const studentOption = st?.selectedOption ?? null;
    const status = st?.status || "blank";
    const confidence = st?.confidence ?? 0;

    let result: ComparedQuestion["result"];
    if (status === "blank") {
      result = "blank";
      blankCount++;
    } else if (status === "multiple") {
      result = "multiple";
      multipleCount++;
    } else if (studentOption === correctOption) {
      result = "correct";
      correctCount++;
    } else {
      result = "wrong";
      wrongCount++;
    }

    questions.push({
      questionNumber: q,
      studentOption,
      correctOption,
      result,
      confidence,
    });
  }

  const totalQuestions = questionNumbers.length;
  const score = correctCount;
  const percentage = totalQuestions > 0 ? (score / totalQuestions) * 100 : 0;

  return {
    totalQuestions,
    correctCount,
    wrongCount,
    blankCount,
    multipleCount,
    score,
    percentage,
    questions,
  };
}

export function compareWithAnswerKey(
  result: OmrRecognizeResult,
  answerKey: AnswerKeyMap,
  totalQuestions: number
): SymbolicGradingResult {
  const extracted = {} as Record<
    number,
    {
      status: "chosen" | "blank" | "multiple";
      choice: "A" | "B" | "C" | "D" | null;
      fillRatios: { A: number; B: number; C: number; D: number };
      markScores: { A: number; B: number; C: number; D: number };
      confidence?: number;
    }
  >;

  for (let q = 1; q <= totalQuestions; q++) {
    const a = result.answers[q];
    const st = result.extractionStatuses?.[q] ?? (a == null ? "blank" : "chosen");
    extracted[q] = {
      status: st,
      choice: a as "A" | "B" | "C" | "D" | null,
      fillRatios: { A: 0, B: 0, C: 0, D: 0 },
      markScores: result.answerScores[q] ?? { A: 0, B: 0, C: 0, D: 0 },
      confidence: result.questionConfidence?.[q],
    };
  }

  return compareAnswersSymbolically(extracted, answerKey, totalQuestions);
}

export function produceResult(input: {
  pageIndex: number;
  studentIdentifier: string | null;
  result: OmrRecognizeResult;
  grading: SymbolicGradingResult;
  totalQuestions: number;
}) {
  const { pageIndex, studentIdentifier, result, grading, totalQuestions } = input;
  const suspiciousQuestions: number[] = [];
  for (let q = 1; q <= totalQuestions; q++) {
    const st = result.extractionStatuses?.[q] ?? (result.answers[q] == null ? "blank" : "chosen");
    const conf = result.questionConfidence?.[q] ?? 0;
    if (st !== "chosen" || conf < 0.35) suspiciousQuestions.push(q);
  }
  return {
    pageIndex,
    studentIdentifier,
    studentCodeDetection: result.studentCodeDetection,
    rosterMatch: result.rosterMatch,
    answers: result.answers,
    answerScores: result.answerScores,
    extractionStatuses: result.extractionStatuses || {},
    questionConfidence: result.questionConfidence || {},
    grading,
    needsManualReview: result.needsReview || suspiciousQuestions.length > 0,
    suspiciousQuestions,
    reviewReasons: result.reviewReasons || [],
  };
}

