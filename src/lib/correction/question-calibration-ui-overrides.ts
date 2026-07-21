/**
 * قراءة question_calibration_ui_overrides.json (نفس مسار API المعايرة)
 * وتطبيق إزاحة + تباعد أفقي لكل سؤال — مطابق لـ calibration_ui_overrides.py والواجهة.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OmrAnswerLetter } from "./omr-sheet-template";
import type { OmrBubbleTemplateDef, OmrTemplateConfig } from "./omr-template-config";
import { deriveQuestionRoisFromBubbles } from "./omr-template-config";
import {
  applyOneStudentColumnToTenPoints,
  applyUiOverridesToFlatStudentCodePoints,
  type StudentCodeColumnOverride,
} from "./student-code-column-calibration-apply";
import type { BubbleLetterOffset, QuestionUiOverride } from "./apply-ui-overrides-flat-answer";

export type { BubbleLetterOffset, QuestionUiOverride };
export { applyUiOverridesToFlatAnswerPoints } from "./apply-ui-overrides-flat-answer";

const FILE_NAME = "question_calibration_ui_overrides.json";

const LETTERS: OmrAnswerLetter[] = ["A", "B", "C", "D"];

export type { StudentCodeColumnOverride };
export { applyOneStudentColumnToTenPoints, applyUiOverridesToFlatStudentCodePoints };

export function questionCalibrationOverridesPath(): string {
  return join(process.cwd(), "services", "omr-python", FILE_NAME);
}

function parseLettersObject(raw: unknown): Partial<Record<OmrAnswerLetter, BubbleLetterOffset>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<OmrAnswerLetter, BubbleLetterOffset>> = {};
  for (const L of ["A", "B", "C", "D"] as const) {
    if (!Object.prototype.hasOwnProperty.call(src, L)) continue;
    const entry = src[L];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[L] = { nx: 0, ny: 0 };
      continue;
    }
    const e = entry as Record<string, unknown>;
    const nx = Number(e.nx);
    const ny = Number(e.ny);
    out[L] = {
      nx: Number.isFinite(nx) ? nx : 0,
      ny: Number.isFinite(ny) ? ny : 0,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export function loadQuestionCalibrationUiOverridesSync(): Record<number, QuestionUiOverride> {
  try {
    const raw = readFileSync(questionCalibrationOverridesPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<number, QuestionUiOverride> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k === "studentCodeColumns") continue;
      if (!/^\d+$/.test(k)) continue;
      const q = Number(k);
      const o = v as Record<string, unknown>;
      const nx = Number(o.nx);
      const ny = Number(o.ny);
      const spread = Number(o.spread);
      const letters = parseLettersObject(o.letters);
      out[q] = {
        nx: Number.isFinite(nx) ? nx : 0,
        ny: Number.isFinite(ny) ? ny : 0,
        spread: Number.isFinite(spread) && spread > 0 ? spread : 1,
        ...(letters ? { letters } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** أعمدة كود الورقة (0..4): nx / ny / spread؛ اختياريًا tailFromDigit + tailExtraNy */
export function loadStudentCodeColumnCalibrationUiOverridesSync(): Record<number, StudentCodeColumnOverride> {
  try {
    const raw = readFileSync(questionCalibrationOverridesPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sc = (parsed as Record<string, unknown>).studentCodeColumns;
    if (!sc || typeof sc !== "object" || Array.isArray(sc)) return {};
    const out: Record<number, StudentCodeColumnOverride> = {};
    for (const [k, v] of Object.entries(sc as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) continue;
      const col = Number(k);
      if (col < 0 || col > 4) continue;
      const o = v as Record<string, unknown>;
      const nx = Number(o.nx);
      const ny = Number(o.ny);
      const spread = Number(o.spread);
      const row: StudentCodeColumnOverride = {
        nx: Number.isFinite(nx) ? nx : 0,
        ny: Number.isFinite(ny) ? ny : 0,
        spread: Number.isFinite(spread) && spread > 0 ? spread : 1,
      };
      if (o.tailFromDigit !== undefined && o.tailFromDigit !== null && o.tailFromDigit !== "") {
        const tf = Number(o.tailFromDigit);
        if (Number.isInteger(tf) && tf >= 0 && tf <= 9) {
          row.tailFromDigit = tf;
          const ten = Number(o.tailExtraNy);
          row.tailExtraNy = Number.isFinite(ten) ? ten : 0;
        }
      }
      out[col] = row;
    }
    return out;
  } catch {
    return {};
  }
}

/** يبني تعريفات فقاعات كود الورقة من قائمة مسطّحة (5×10) */
export function sheetCodeFlatPointsToBubbleDefs(
  flat: { nx: number; ny: number }[],
  numColumns = 5
): OmrBubbleTemplateDef[] {
  const out: OmrBubbleTemplateDef[] = [];
  const perCol = 10;
  let i = 0;
  for (let col = 0; col < numColumns; col++) {
    for (let digit = 0; digit <= 9; digit++) {
      const p = flat[i++];
      if (!p) return out;
      out.push({
        id: `code_c${col}_d${digit}`,
        sheetCol: col,
        sheetDigit: digit,
        center: { nx: p.nx, ny: p.ny },
      });
    }
  }
  return out;
}

/** يطبّق ملف المعايرة على فقاعات كود الورقة في قالب جاهز (مثلاً قالب افتراضي صريح) */
export function applyStudentCodeColumnCalibrationToTemplate(cfg: OmrTemplateConfig): OmrTemplateConfig {
  const ovs = loadStudentCodeColumnCalibrationUiOverridesSync();
  if (!Object.keys(ovs).length) return cfg;
  const bubbles = cfg.sheetCodeBubbles.map((b) => ({
    ...b,
    center: { ...b.center },
  }));
  const byCol = new Map<number, typeof bubbles>();
  for (const b of bubbles) {
    if (typeof b.sheetCol !== "number") continue;
    if (!byCol.has(b.sheetCol)) byCol.set(b.sheetCol, []);
    byCol.get(b.sheetCol)!.push(b);
  }
  for (const [colStr, delta] of Object.entries(ovs)) {
    const col = Number(colStr);
    if (!Number.isInteger(col) || col < 0 || col > 4) continue;
    const group = byCol.get(col);
    if (!group || group.length !== 10) continue;
    const sorted = [...group].sort((a, b) => (a.sheetDigit ?? 0) - (b.sheetDigit ?? 0));
    const baseTen = sorted.map((b) => ({ nx: b.center.nx, ny: b.center.ny }));
    const adj = applyOneStudentColumnToTenPoints(baseTen, delta);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i]!.center = { nx: adj[i]!.nx, ny: adj[i]!.ny };
    }
  }
  return { ...cfg, sheetCodeBubbles: bubbles };
}

/** يطبّق ملف المعايرة على قالب ممرّر (مثلاً قالب مخصّص) */
export function applyQuestionUiCalibrationToTemplate(cfg: OmrTemplateConfig): OmrTemplateConfig {
  const ovs = loadQuestionCalibrationUiOverridesSync();
  if (!Object.keys(ovs).length) return cfg;

  const answerBubbles = cfg.answerBubbles.map((b) => ({
    ...b,
    center: { ...b.center },
  }));

  for (let q = 1; q <= cfg.questionsPerTemplate; q++) {
    const d = ovs[q];
    if (!d) continue;
    const row = answerBubbles.filter((b) => b.question === q && b.letter && LETTERS.includes(b.letter as OmrAnswerLetter));
    const ordered = LETTERS.map((L) => row.find((b) => b.letter === L)).filter(Boolean) as typeof answerBubbles;
    if (ordered.length !== 4) continue;
    const spread = d.spread > 0 ? d.spread : 1;
    const translated = ordered.map((b) => ({
      nx: b.center.nx + d.nx,
      ny: b.center.ny + d.ny,
    }));
    const cx = translated.reduce((s, p) => s + p.nx, 0) / 4;
    for (let i = 0; i < 4; i++) {
      ordered[i]!.center = {
        nx: cx + (translated[i]!.nx - cx) * spread,
        ny: translated[i]!.ny,
      };
    }
    const letters = d.letters;
    if (letters) {
      for (let i = 0; i < 4; i++) {
        const L = LETTERS[i]!;
        const off = letters[L];
        if (!off) continue;
        const b = ordered[i]!;
        b.center = { nx: b.center.nx + off.nx, ny: b.center.ny + off.ny };
      }
    }
  }

  return {
    ...cfg,
    answerBubbles,
    questionRoisNorm: deriveQuestionRoisFromBubbles({
      ...cfg,
      answerBubbles,
    }),
  };
}

/** تحويل قائمة مسطّحة (س1 أربع نقاط، …) إلى تعريفات الفقاعات */
export function flatAnswerPointsToBubbleDefs(
  points: { nx: number; ny: number }[],
  totalQuestions: number
): OmrBubbleTemplateDef[] {
  const out: OmrBubbleTemplateDef[] = [];
  const n = Math.min(totalQuestions, Math.floor(points.length / 4));
  for (let q = 1; q <= n; q++) {
    const start = (q - 1) * 4;
    for (let i = 0; i < 4; i++) {
      const letter = LETTERS[i]!;
      const p = points[start + i]!;
      out.push({
        id: `q${q}_${letter}`,
        question: q,
        letter,
        center: { nx: p.nx, ny: p.ny },
      });
    }
  }
  return out;
}
