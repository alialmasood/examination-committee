export type OmrOptionLetter = "A" | "B" | "C" | "D" | "E";

export type AnswerDetectionStatus = "answered" | "blank" | "multiple" | "uncertain";

export type DetectedAnswer = {
  questionNumber: number;
  selectedOption: OmrOptionLetter | null;
  status: AnswerDetectionStatus;
  confidence: number;
  bubbleScores: {
    A: number;
    B: number;
    C: number;
    D: number;
    E: number;
  };
};

export type OMRResult = {
  success: boolean;
  error?: string;
  sheetWidth: number;
  sheetHeight: number;
  questions: DetectedAnswer[];
  /** مسارات ملفات أو data URLs حسب وضع التصحيح */
  debugImages?: string[];
};

export type OmrEngineDebugOptions = {
  /** حفظ ملفات PNG في هذا المسار (مطلق أو نسبي لجذر المشروع) */
  outputDir?: string;
  /** إضافة نفس الصور كـ data URL في `debugImages` */
  base64InResult?: boolean;
};

export type OmrEngineOptions = {
  debug?: boolean | OmrEngineDebugOptions;
  calibration?: {
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    skipAutoBBox?: boolean;
    skipAutoLayout?: boolean;
  };
};

export type Raster = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

export type SheetBounds = {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  corners: [[number, number], [number, number], [number, number], [number, number]];
};

export type BubbleRoi = {
  questionNumber: number;
  letter: "A" | "B" | "C" | "D";
  cx: number;
  cy: number;
  radius: number;
};

export type BubbleMap = {
  innerRadius: number;
  layout: {
    offsetX: number;
    offsetY: number;
    scale: number;
    bbox: SheetBounds["bbox"];
    autoLayoutMetric?: number;
  };
  bubbles: BubbleRoi[];
};
