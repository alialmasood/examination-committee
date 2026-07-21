export type SheetExportRow = {
  id: string;
  subject_name: string;
  exam_date: string;
  teacher_name: string | null;
  department: string | null;
  stage: string | null;
  study_type: string | null;
  student_count: number;
  has_answer_key?: boolean;
};

export type ExportsResponse = { success: boolean; exports?: SheetExportRow[]; error?: string };

export type OMRPageResult = {
  pageIndex: number;
  success: boolean;
  studentCode: string | null;
  studentCodeConfidence?: number;
  studentCodeDetection?: {
    studentCode: string | null;
    digits: {
      columnIndex: number;
      detectedDigit: number | null;
      confidence: number;
      scores: Record<number, number>;
      status: "ok" | "blank" | "multiple" | "uncertain";
    }[];
  };
  studentName?: string | null;
  detectedAnswers: {
    questionNumber: number;
    selectedOption: string | null;
    status: "answered" | "blank" | "multiple" | "uncertain";
    confidence: number;
    bubbleScores: Record<string, number>;
  }[];
  comparison?: {
    totalQuestions: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    multipleCount: number;
    score: number;
    percentage: number;
  };
  errors?: string[];
  debugImages?: string[];
  debug?: {
    original?: string;
    grayscale?: string;
    thresholded?: string;
    detectedSheetContour?: string;
    warpedSheet?: string;
    roiOverlay?: string;
    markedBubbles?: string;
  };
};

export type ProcessResponse = {
  success: boolean;
  error?: string;
  exam?: { id: string; subject_name: string; exam_date: string };
  totalPages?: number;
  successPages?: number;
  failedPages?: number;
  manualReviewPages?: number;
  results?: OMRPageResult[];
};

export type ExamAnswerKeyInfo = {
  id: string;
  examId: string;
  totalQuestions: number;
  options: string[];
  answers: Record<number, string>;
  createdAt: string;
  updatedAt: string;
};

export type AnswerKeyFetchResponse = {
  success?: boolean;
  examAnswerKey?: ExamAnswerKeyInfo | null;
  error?: string;
};

export type ReviewQueueItem = {
  id: string;
  exam_id: string;
  student_code: string | null;
  page_index: number;
  source_pdf_name: string;
  comparison: {
    totalQuestions: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    multipleCount: number;
    score: number;
    percentage: number;
  };
  review_status: "pending" | "reviewed" | "approved";
  normalized_image_url?: string | null;
  suspicious_crops?: Record<number, string>;
  created_at: string;
  updated_at: string;
};

export type ReviewRecordDetail = ReviewQueueItem & {
  detected_answers: {
    questionNumber: number;
    selectedOption: string | null;
    status: "answered" | "blank" | "multiple" | "uncertain";
    confidence: number;
    bubbleScores: Record<string, number>;
  }[];
};

export type ReviewQueueListResponse = { success?: boolean; queue?: ReviewQueueItem[] };

export type ReviewRecordFetchResponse = { success?: boolean; record?: ReviewRecordDetail };

export type ReviewSaveResponse = { success?: boolean; error?: string; record?: ReviewRecordDetail };
