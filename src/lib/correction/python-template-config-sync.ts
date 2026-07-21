/**
 * قراءة services/omr-python/template_config.py واشتقاق مواقع الفقاعات
 * بنفس منطق Python (build_answer_roi_map قبل/بعد المعايرة يُدار في question-calibration-ui-overrides).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveQuestionRoisFromBubbles,
  getDefaultCorrectionOmrTemplate,
  type OmrBubbleTemplateDef,
  type OmrTemplateConfig,
} from "./omr-template-config";
import {
  applyUiOverridesToFlatAnswerPoints,
  applyUiOverridesToFlatStudentCodePoints,
  flatAnswerPointsToBubbleDefs,
  loadQuestionCalibrationUiOverridesSync,
  loadStudentCodeColumnCalibrationUiOverridesSync,
  sheetCodeFlatPointsToBubbleDefs,
} from "./question-calibration-ui-overrides";

export const PYTHON_TEMPLATE_CONFIG_RELATIVE = join("services", "omr-python", "template_config.py");

function parseExprNumber(expr: string): number {
  const clean = expr.trim();
  if (!clean) return 0;
  if (clean.includes("/")) {
    const [a, b] = clean.split("/").map((x) => Number(x.trim()));
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function readConst(content: string, name: string): string {
  const rx = new RegExp(`^${name}\\s*=\\s*([^\\n#]+)`, "m");
  const m = content.match(rx);
  return m?.[1]?.trim() || "";
}

function readNumber(content: string, name: string, fallback: number): number {
  const raw = readConst(content, name);
  if (!raw) return fallback;
  const n = parseExprNumber(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readArray(content: string, name: string, fallback: number[]): number[] {
  const raw = readConst(content, name);
  if (!raw) return fallback;
  const m = raw.match(/\[([^\]]+)\]/);
  if (!m) return fallback;
  const arr = m[1]
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
  return arr.length ? arr : fallback;
}

export type PythonTemplateGeometry = {
  pageWidth: number;
  pageHeight: number;
  bubbleRadiusNorm: number;
  innerMaskRadiusFraction: number;
  fillThreshold: number;
  blankThreshold: number;
  multipleMarkDelta: number;
  minConfidence: number;
  totalQuestions: number;
  studentXs: number[];
  studentY0: number;
  studentYStep: number;
  answerBaseNx: number;
  answerColStep: number;
  answerLetterStep: number;
  answerLetterOffsetX: number;
  answerBubbleOffsetY: number;
  answerRowStep: number;
  answerGridTopNy: number;
  answerLastRowNyDelta: number;
  answerLastRowNxDelta: number;
  answerRowQ2124NyDelta: number;
  answerRowQ2124NxDelta: number;
  answerRowQ1720NyDelta: number;
  answerRowQ1316NyDelta: number;
  answerRowQ912NyDelta: number;
};

export function parsePythonTemplateConfigContent(content: string): PythonTemplateGeometry | null {
  if (!content || content.length < 50) return null;
  return {
    pageWidth: readNumber(content, "PAGE_WIDTH", 2480),
    pageHeight: readNumber(content, "PAGE_HEIGHT", 3508),
    bubbleRadiusNorm: readNumber(content, "BUBBLE_RADIUS_NORM", 13 / 1700),
    innerMaskRadiusFraction: readNumber(content, "INNER_MASK_RADIUS_FRACTION", 0.68),
    fillThreshold: readNumber(content, "FILL_THRESHOLD", 0.07),
    blankThreshold: readNumber(content, "BLANK_THRESHOLD", 0.03),
    multipleMarkDelta: readNumber(content, "MULTIPLE_MARK_DELTA", 0.015),
    minConfidence: readNumber(content, "MIN_CONFIDENCE", 0.03),
    totalQuestions: Math.floor(readNumber(content, "TOTAL_QUESTIONS", 25)),
    studentXs: readArray(content, "STUDENT_CODE_X_CENTERS", [0.652, 0.706, 0.76, 0.814, 0.868]),
    studentY0: readNumber(content, "STUDENT_CODE_Y0", 0.178),
    studentYStep: readNumber(content, "STUDENT_CODE_Y_STEP", 0.0194),
    answerBaseNx: readNumber(content, "ANSWER_BASE_NX", 0.0524),
    answerColStep: readNumber(content, "ANSWER_COL_STEP", 0.2154),
    answerLetterStep: readNumber(content, "ANSWER_LETTER_STEP", 0.0347),
    answerLetterOffsetX: readNumber(content, "ANSWER_LETTER_OFFSET_X", 0.0878),
    answerBubbleOffsetY: readNumber(content, "ANSWER_BUBBLE_OFFSET_Y", 0.0379),
    answerRowStep: readNumber(content, "ANSWER_ROW_STEP", 0.0484),
    answerGridTopNy: readNumber(content, "ANSWER_GRID_TOP_NY", 0.3817),
    answerLastRowNyDelta: readNumber(content, "ANSWER_LAST_ROW_NY_DELTA", 0),
    answerLastRowNxDelta: readNumber(content, "ANSWER_LAST_ROW_NX_DELTA", 0),
    answerRowQ2124NyDelta: readNumber(content, "ANSWER_ROW_Q21_24_NY_DELTA", 0),
    answerRowQ2124NxDelta: readNumber(content, "ANSWER_ROW_Q21_24_NX_DELTA", 0),
    answerRowQ1720NyDelta: readNumber(content, "ANSWER_ROW_Q17_20_NY_DELTA", 0),
    answerRowQ1316NyDelta: readNumber(content, "ANSWER_ROW_Q13_16_NY_DELTA", 0),
    answerRowQ912NyDelta: readNumber(content, "ANSWER_ROW_Q9_12_NY_DELTA", 0),
  };
}

/** مطابقة template_config.build_answer_roi_map قبل apply_ui_overrides */
export function buildAnswerBubbleFlatPointsFromGeometry(cfg: PythonTemplateGeometry): { nx: number; ny: number }[] {
  const out: { nx: number; ny: number }[] = [];
  const nQ = Math.max(1, Math.min(100, cfg.totalQuestions));
  const lastRow = Math.floor((nQ - 1) / 4);
  const rowQ2124 = Math.floor((21 - 1) / 4);
  const rowQ1720 = Math.floor((17 - 1) / 4);
  const rowQ1316 = Math.floor((13 - 1) / 4);
  const rowQ912 = Math.floor((9 - 1) / 4);

  for (let q = 1; q <= nQ; q++) {
    const idx = q - 1;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    let ny =
      cfg.answerGridTopNy + row * cfg.answerRowStep + cfg.answerBubbleOffsetY;
    if (row === lastRow) ny += cfg.answerLastRowNyDelta;
    else if (row === rowQ2124 && lastRow > rowQ2124) ny += cfg.answerRowQ2124NyDelta;
    else if (row === rowQ1720 && lastRow > rowQ1720) ny += cfg.answerRowQ1720NyDelta;
    else if (row === rowQ1316 && lastRow > rowQ1316) ny += cfg.answerRowQ1316NyDelta;
    else if (row === rowQ912 && lastRow > rowQ912) ny += cfg.answerRowQ912NyDelta;

    const nxLast = row === lastRow ? cfg.answerLastRowNxDelta : 0;
    const nxQ2124 = row === rowQ2124 && lastRow > rowQ2124 ? cfg.answerRowQ2124NxDelta : 0;
    const baseX = cfg.answerBaseNx + col * cfg.answerColStep + cfg.answerLetterOffsetX;
    for (let i = 0; i < 4; i++) {
      out.push({
        nx: baseX + i * cfg.answerLetterStep + nxLast + nxQ2124,
        ny,
      });
    }
  }
  return out;
}

/** نفس ترتيب معاينة المعايرة: لكل nx من الأعمدة، الأرقام 0..9 من الأعلى للأسفل */
export function buildStudentCodeFlatPointsFromGeometry(cfg: PythonTemplateGeometry): { nx: number; ny: number }[] {
  const out: { nx: number; ny: number }[] = [];
  for (const nx of cfg.studentXs) {
    for (let digit = 0; digit <= 9; digit++) {
      out.push({ nx, ny: cfg.studentY0 + digit * cfg.studentYStep });
    }
  }
  return out;
}

export function buildSheetCodeBubbleDefsFromGeometry(cfg: PythonTemplateGeometry): OmrBubbleTemplateDef[] {
  const flat = buildStudentCodeFlatPointsFromGeometry(cfg);
  return sheetCodeFlatPointsToBubbleDefs(flat, cfg.studentXs.length);
}

export function readPythonTemplateConfigFileSync(): string | null {
  try {
    const path = join(process.cwd(), PYTHON_TEMPLATE_CONFIG_RELATIVE);
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * قالب استخراج Node يطابق Python + ملف المعايرة.
 * يُرجع null إن تعذر قراءة template_config.py.
 */
export function buildCorrectionOmrTemplateFromPythonDiskSync(): OmrTemplateConfig | null {
  const text = readPythonTemplateConfigFileSync();
  if (!text) return null;
  const geom = parsePythonTemplateConfigContent(text);
  if (!geom) return null;

  const baseFlat = buildAnswerBubbleFlatPointsFromGeometry(geom);
  const ovs = loadQuestionCalibrationUiOverridesSync();
  const adjusted = applyUiOverridesToFlatAnswerPoints(baseFlat, geom.totalQuestions, ovs);
  const answerBubbles = flatAnswerPointsToBubbleDefs(adjusted, geom.totalQuestions);
  const baseStudentFlat = buildStudentCodeFlatPointsFromGeometry(geom);
  const studOvs = loadStudentCodeColumnCalibrationUiOverridesSync();
  const adjustedStudent = applyUiOverridesToFlatStudentCodePoints(
    baseStudentFlat,
    studOvs,
    geom.studentXs.length
  );
  const sheetCodeBubbles = sheetCodeFlatPointsToBubbleDefs(adjustedStudent, geom.studentXs.length);

  const defaults = getDefaultCorrectionOmrTemplate();
  const merged: OmrTemplateConfig = {
    ...defaults,
    pageWidth: geom.pageWidth,
    pageHeight: geom.pageHeight,
    questionsPerTemplate: geom.totalQuestions,
    bubbleRadiusNorm: geom.bubbleRadiusNorm,
    innerMaskRadiusFraction: geom.innerMaskRadiusFraction,
    fillThreshold: geom.fillThreshold,
    blankThreshold: geom.blankThreshold,
    multipleMarkDelta: geom.multipleMarkDelta,
    minConfidence: geom.minConfidence,
    answerBubbles,
    sheetCodeBubbles,
    questionRoisNorm: deriveQuestionRoisFromBubbles({
      answerBubbles,
      bubbleRadiusNorm: geom.bubbleRadiusNorm,
      pageWidth: geom.pageWidth,
      pageHeight: geom.pageHeight,
    }),
  };
  return merged;
}
