/**
 * قالب OMR يطابق تخطيط CorrectionExamSheet (نفس الشيت المطبوع).
 * عند تغيير الشيت يجب رفع LAYOUT_VERSION وضبط الإحداثيات.
 */
export const OMR_LAYOUT_VERSION = "1.3.3";

/** أبعاد مرجعية بعد إعادة الحجم — يُفضّل مسح A4 عمودي بنسبة قريبة من 1700:2400 */
export const OMR_REF_WIDTH = 1700;
export const OMR_REF_HEIGHT = 2400;

/** نصف قطر العينة بالبكسل (مرجع) */
export const OMR_BUBBLE_SAMPLE_RADIUS = 9;

export type OmrBubbleDef = {
  id: string;
  /** مركز نسبي 0..1 على صورة المرجع */
  nx: number;
  ny: number;
};

export type OmrSheetCodeBubble = { col: number; digit: number; nx: number; ny: number };

/** أعمدة رمز الشيت (5 خانات)، لكل خانة 10 دوائر للأرقام 0..9 من الأعلى للأسفل كما في المكوّن */
export function buildSheetCodeBubbles(): OmrSheetCodeBubble[] {
  const xCenters = [0.652, 0.706, 0.76, 0.814, 0.868];
  const y0 = 0.178;
  const yStep = 0.0194;
  const out: OmrSheetCodeBubble[] = [];
  for (let col = 0; col < 5; col++) {
    for (let digit = 0; digit <= 9; digit++) {
      out.push({
        col,
        digit,
        nx: xCenters[col]!,
        ny: y0 + digit * yStep,
      });
    }
  }
  return out;
}

const LETTERS = ["A", "B", "C", "D"] as const;
export type OmrAnswerLetter = (typeof LETTERS)[number];

export type OmrAnswerBubble = { q: number; letter: OmrAnswerLetter; nx: number; ny: number };

/**
 * شبكة الأسئلة 1..25 (4 أعمدة كما في CorrectionExamSheet: sm:grid-cols-4 + gap-y-8).
 * القيم هنا كانت أضيق عموديًا من المسح/الطباعة الفعلية → انزياح تدريجي للأسفل.
 * عند تغيير هوامش الشيت أو gap في المكوّن عدّل هذه الثوابت معًا.
 */
const ANSWER_BASE_NX = 0.042;
const ANSWER_COL_STEP = 0.236;
const ANSWER_LETTER_STEP = 0.034;
const ANSWER_LETTER_OFFSET_X = 0.084;
const ANSWER_BUBBLE_OFFSET_Y = 0.036;
/** خطوة بين صفوف الأسئلة (مركز ≈ مركز صف الدوائر) — رُفع من 0.0765 لتقليل الانزلاق عن المسح */
const ANSWER_ROW_STEP = 0.089;
const ANSWER_GRID_TOP_NY = 0.404;

export function buildAnswerBubbles(): OmrAnswerBubble[] {
  const out: OmrAnswerBubble[] = [];
  for (let q = 1; q <= 25; q++) {
    const idx = q - 1;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const baseX = ANSWER_BASE_NX + col * ANSWER_COL_STEP;
    const baseY = ANSWER_GRID_TOP_NY + row * ANSWER_ROW_STEP;
    LETTERS.forEach((letter, i) => {
      out.push({
        q,
        letter,
        nx: baseX + ANSWER_LETTER_OFFSET_X + i * ANSWER_LETTER_STEP,
        ny: baseY + ANSWER_BUBBLE_OFFSET_Y,
      });
    });
  }
  return out;
}

function sheetCodeDefsForJson(): OmrBubbleDef[] {
  return buildSheetCodeBubbles().map((b) => ({
    id: `code_c${b.col}_d${b.digit}`,
    nx: b.nx,
    ny: b.ny,
  }));
}

function answerDefsForJson(): OmrBubbleDef[] {
  return buildAnswerBubbles().map((b) => ({
    id: `q${b.q}_${b.letter}`,
    nx: b.nx,
    ny: b.ny,
  }));
}

export function buildOmrTemplateJson() {
  return {
    layoutVersion: OMR_LAYOUT_VERSION,
    referenceWidth: OMR_REF_WIDTH,
    referenceHeight: OMR_REF_HEIGHT,
    bubbleSampleRadius: OMR_BUBBLE_SAMPLE_RADIUS,
    sheetCode: sheetCodeDefsForJson(),
    answers: answerDefsForJson(),
    notes:
      "أرسل صورة A4 عمودية قريبة من نسبة 1:√2. يُفضّل 300dpi+. يُعاد قياس الصورة لتملأ المرجع (قد يحدث تشويه طفيف إن اختلفت النسبة).",
  };
}
