/** أنواع مراحل التصحيح (معمارية منفصلة عن واجهة الصفحة) */

import type { OmrTemplateConfig } from "../omr-template-config";

export type OmrChoiceLetter = "A" | "B" | "C" | "D";
export type RecognizedAnswer = OmrChoiceLetter | null;

export type NormalizeSheetMeta = {
  pipelineVersion: string;
  /** أبعاد الصورة بعد التطبيع (مرجع A4) */
  width: number;
  height: number;
  channels: number;
  rasterPipeline: "trim-fill" | "contain-fallback";
  portraitCorrected: boolean;
  deskewDegrees: number;
  perspectiveCorrected: boolean;
  contentBBox: { x0: number; y0: number; x1: number; y1: number };
};

export type ExtractStatus = "chosen" | "blank" | "multiple";

export type QuestionExtractResult = {
  status: ExtractStatus;
  /** عند status === chosen */
  choice: OmrChoiceLetter | null;
  /** نسبة «حبر» تقريبية 0..1 لكل خيار (مرحلة استخراج فقط) */
  fillRatios: Record<OmrChoiceLetter, number>;
  /** درجة تباين قديمة للتوافق مع الواجهة */
  markScores: Record<OmrChoiceLetter, number>;
  /** ثقة فصل الخيارين (0..1) حسب multipleMarkDelta */
  confidence?: number;
};

/** صف واحد لتصحيح معايرة السؤال في الواجهة / API */
export type OmrQuestionCalibrationDetail = {
  question: number;
  roiNorm: { nx0: number; ny0: number; nx1: number; ny1: number };
  bubbles: Record<
    OmrChoiceLetter,
    { fillRatio: number; markScore: number; cx: number; cy: number; outerRadiusPx: number; innerRadiusPx: number }
  >;
  decision: { status: ExtractStatus; choice: OmrChoiceLetter | null; confidence: number };
};

export type SymbolicQuestionOutcome = "correct" | "wrong" | "blank" | "multiple";

export type SymbolicGradingResult = {
  byQuestion: Record<number, SymbolicQuestionOutcome>;
  counts: { correct: number; wrong: number; blank: number; multiple: number };
  score: number;
  maxScore: number;
};

export type AnswerKeyMap = Record<string, OmrChoiceLetter>;

export type OmrCalibrationDebug = {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  fullWidth: number;
  fullHeight: number;
  channels: number;
  pipeline: "trim-fill" | "contain-fallback";
  skipAutoBBox: boolean;
  autoLayoutSkipped?: boolean;
  autoLayoutMetric?: number;
  autoOffsetX?: number;
  autoOffsetY?: number;
  autoScale?: number;
  portraitCorrected?: boolean;
  offsetX: number;
  offsetY: number;
  scale: number;
  medianAnswerScore: number;
  p90AnswerScore: number;
  /** من مرحلة التطبيع */
  correctionPipelineVersion?: string;
  deskewDegrees?: number;
  perspectiveCorrected?: boolean;
};

export type StudentCodeDigitDetection = {
  columnIndex: number;
  detectedDigit: number | null;
  confidence: number;
  scores: Record<number, number>;
  status: "ok" | "blank" | "multiple" | "uncertain";
};

export type StudentCodeDetection = {
  studentCode: string | null;
  digits: StudentCodeDigitDetection[];
  confidence: number;
};

export type RosterStudent = { id?: string; student_name?: string; sheet_code?: string };

export type OmrRecognizeOptions = {
  roster?: RosterStudent[];
  minFill?: number;
  minGap?: number;
  /** قالب معايرة؛ عند الغياب يُستخدم القالب الافتراضي للتصحيح */
  omrTemplate?: OmrTemplateConfig;
  /** إرجاع تفاصيل ROI/درجات/قرار لكل سؤال (حجم أكبر) */
  includeCalibrationDebug?: boolean;
  calibration?: {
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    skipAutoBBox?: boolean;
    skipAutoLayout?: boolean;
  };
};

export type OmrRecognizeResult = {
  layoutVersion: string;
  sheetCode: string | null;
  studentCodeDetection?: StudentCodeDetection;
  sheetCodeDigits: (number | null)[];
  sheetCodeConfidence: number;
  answers: Record<number, RecognizedAnswer>;
  answerScores: Record<number, { A: number; B: number; C: number; D: number }>;
  needsReview: boolean;
  reviewReasons: string[];
  rosterMatch: { id: string; student_name: string; sheet_code: string } | null;
  calibration?: OmrCalibrationDebug;
  /** حالة استخراج لكل سؤال (مرحلة 2) */
  extractionStatuses?: Record<number, ExtractStatus>;
  /** ثقة القرار لكل سؤال (0..1) */
  questionConfidence?: Record<number, number>;
  /** عند طلب includeCalibrationDebug */
  calibrationQuestionDetails?: OmrQuestionCalibrationDetail[];
};
