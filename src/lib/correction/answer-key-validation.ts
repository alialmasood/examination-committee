export type AnswerKeyJson = Record<string, string>;

/** أعداد الأسئلة المعتمدة (تطابق نماذج الشيت 25 / 50 / 75 / 100) */
export const ANSWER_KEY_QUESTION_TOTALS = [25, 50, 75, 100] as const;
export type AnswerKeyQuestionTotal = (typeof ANSWER_KEY_QUESTION_TOTALS)[number];

export function isAnswerKeyQuestionTotal(n: number): n is AnswerKeyQuestionTotal {
  return (ANSWER_KEY_QUESTION_TOTALS as readonly number[]).includes(Math.floor(n));
}

export function normalizeAnswerKeyQuestionTotal(n: number): AnswerKeyQuestionTotal {
  const v = Math.floor(Number(n));
  return isAnswerKeyQuestionTotal(v) ? v : 25;
}

export type AnswerKeyValidationOptions = {
  totalQuestions?: number;
  options?: string[];
};

function normalizeOptions(options?: string[]): string[] {
  const src = options?.length ? options : ["A", "B", "C", "D"];
  const out: string[] = [];
  for (const raw of src) {
    const v = String(raw || "").trim().toUpperCase();
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function validateAnswersObject(
  obj: unknown,
  opts?: AnswerKeyValidationOptions
): { ok: true; answers: AnswerKeyJson } | { ok: false; error: string } {
  if (!obj || typeof obj !== "object") {
    return { ok: false, error: "بيانات الإجابات غير صالحة." };
  }
  const totalQuestions = Math.floor(Number(opts?.totalQuestions ?? 25));
  if (!isAnswerKeyQuestionTotal(totalQuestions)) {
    return { ok: false, error: "عدد الأسئلة يجب أن يكون 25 أو 50 أو 75 أو 100." };
  }
  const allowed = normalizeOptions(opts?.options);
  if (allowed.length < 2) {
    return { ok: false, error: "يجب توفير خيارين على الأقل." };
  }
  const o = obj as Record<string, unknown>;
  const out: AnswerKeyJson = {};
  for (let i = 1; i <= totalQuestions; i++) {
    const k = String(i);
    const v = o[k];
    if (v == null || typeof v !== "string") {
      return { ok: false, error: `الإجابة للسؤال ${i} مطلوبة.` };
    }
    const u = v.toUpperCase().trim();
    if (!allowed.includes(u)) {
      return { ok: false, error: `السؤال ${i}: الخيار ${u} غير مسموح.` };
    }
    out[k] = u;
  }
  return { ok: true, answers: out };
}
