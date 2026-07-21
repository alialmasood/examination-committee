import type { ExtractStatus, OmrRecognizeResult, RecognizedAnswer } from "@/src/lib/correction/services/types";

export type ExtractedQuestionAnswer = {
  questionNumber: number;
  answer: RecognizedAnswer;
  status: ExtractStatus;
  confidence: number;
};

export type ExtractedStudentSheet = {
  studentIdentifier: string | null;
  answers: Record<number, RecognizedAnswer>;
  byQuestion: ExtractedQuestionAnswer[];
};

export function extractStudentAnswers(result: OmrRecognizeResult, totalQuestions: number): ExtractedStudentSheet {
  const answers: Record<number, RecognizedAnswer> = {};
  const byQuestion: ExtractedQuestionAnswer[] = [];
  for (let q = 1; q <= totalQuestions; q++) {
    const answer = result.answers[q] ?? null;
    const status = result.extractionStatuses?.[q] ?? (answer == null ? "blank" : "chosen");
    const confidence = result.questionConfidence?.[q] ?? 0;
    answers[q] = answer;
    byQuestion.push({
      questionNumber: q,
      answer,
      status,
      confidence,
    });
  }
  return {
    studentIdentifier: result.sheetCode || null,
    answers,
    byQuestion,
  };
}

