import { bubbleFillRatio, bubbleMarkScore } from "@/src/lib/correction/services/bubble-sampling";
import sharp from "sharp";
import type { DebugCollector } from "../debug";
import type {
  BubbleMap,
  DetectedAnswer,
  OmrOptionLetter,
  Raster,
} from "../types";

const LETTERS = ["A", "B", "C", "D"] as const;

type Letter4 = (typeof LETTERS)[number];

export type DetectAnswersOptions = {
  /** أقل درجة mark للخيار الأعلى يُعتبر فراغًا */
  markBlankThreshold?: number;
  /** فرق أقل بين الأول والثاني → متعدد */
  markMultipleMinGap?: number;
  /** إن كان الفرق بين الأول والثاني فوق multiple لكن تحت هذا → غير متأكد */
  markUncertainGapMultiplier?: number;
};

const DEFAULTS: Required<DetectAnswersOptions> = {
  markBlankThreshold: 7,
  markMultipleMinGap: 5,
  markUncertainGapMultiplier: 1.65,
};

function decide(
  scores: Record<Letter4, number>,
  opts: Required<DetectAnswersOptions>
): {
  selected: OmrOptionLetter | null;
  status: DetectedAnswer["status"];
  confidence: number;
} {
  const entries = (Object.entries(scores) as [Letter4, number][]).sort((a, b) => b[1] - a[1]);
  const top = entries[0]!;
  const second = entries[1]!;

  if (top[1] < opts.markBlankThreshold) {
    return { selected: null, status: "blank", confidence: 0 };
  }
  const gap = top[1] - second[1];
  if (gap < opts.markMultipleMinGap) {
    return { selected: null, status: "multiple", confidence: Math.max(0, Math.min(1, gap / (opts.markMultipleMinGap + 1e-6))) };
  }
  if (gap < opts.markMultipleMinGap * opts.markUncertainGapMultiplier) {
    const conf = Math.min(1, gap / (opts.markMultipleMinGap * opts.markUncertainGapMultiplier));
    return { selected: top[0], status: "uncertain", confidence: conf };
  }
  const conf = Math.min(1, gap / (top[1] * 0.25 + 12));
  return { selected: top[0], status: "answered", confidence: conf };
}

/**
 * قياس كل دوائر السؤال وإخراج قرار لكل سؤال 1..25.
 */
export function detectAnswers(
  canonical: Raster,
  bubbleMap: BubbleMap,
  scoreOptions?: DetectAnswersOptions
): DetectedAnswer[] {
  const opts = { ...DEFAULTS, ...scoreOptions };
  const byQ = new Map<number, Partial<Record<Letter4, { mark: number; fill: number }>>>();

  for (const b of bubbleMap.bubbles) {
    const m = byQ.get(b.questionNumber) ?? {};
    const mark = bubbleMarkScore(
      canonical.data,
      canonical.width,
      canonical.height,
      canonical.channels,
      b.cx,
      b.cy,
      bubbleMap.innerRadius
    );
    const fill = bubbleFillRatio(
      canonical.data,
      canonical.width,
      canonical.height,
      canonical.channels,
      b.cx,
      b.cy,
      bubbleMap.innerRadius
    );
    m[b.letter] = { mark, fill };
    byQ.set(b.questionNumber, m);
  }

  const out: DetectedAnswer[] = [];
  for (let q = 1; q <= 25; q++) {
    const row = byQ.get(q) ?? {};
    const scores: Record<Letter4, number> = {
      A: row.A?.mark ?? 0,
      B: row.B?.mark ?? 0,
      C: row.C?.mark ?? 0,
      D: row.D?.mark ?? 0,
    };
    const { selected, status, confidence } = decide(scores, opts);
    out.push({
      questionNumber: q,
      selectedOption: selected,
      status,
      confidence,
      bubbleScores: {
        A: scores.A,
        B: scores.B,
        C: scores.C,
        D: scores.D,
        E: 0,
      },
    });
  }
  return out;
}

export async function renderMarkedBubblesOverlayWithMap(
  canonical: Raster,
  bubbleMap: BubbleMap,
  questions: DetectedAnswer[]
): Promise<Buffer> {
  const { width: w, height: h } = canonical;
  const base = await sharp(Buffer.from(canonical.data), {
    raw: { width: w, height: h, channels: 1 },
  })
    .png()
    .toBuffer();

  const answerByQ = new Map(questions.map((q) => [q.questionNumber, q]));
  const circles: string[] = [];
  for (const b of bubbleMap.bubbles) {
    const ans = answerByQ.get(b.questionNumber);
    if (!ans?.selectedOption || ans.selectedOption !== b.letter) continue;
    if (ans.status === "blank" || ans.status === "multiple") continue;
    const stroke = ans.status === "uncertain" ? "rgba(234,179,8,0.95)" : "rgba(22,163,74,0.95)";
    circles.push(
      `<circle cx="${b.cx.toFixed(1)}" cy="${b.cy.toFixed(1)}" r="${b.radius + 2}" fill="none" stroke="${stroke}" stroke-width="3"/>`
    );
  }
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${circles.join("")}</svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

export async function debugMarkedBubbles(
  canonical: Raster,
  bubbleMap: BubbleMap,
  questions: DetectedAnswer[],
  debug: DebugCollector
): Promise<void> {
  if (!debug.enabled) return;
  const png = await renderMarkedBubblesOverlayWithMap(canonical, bubbleMap, questions);
  await debug.addPngBuffer("07_marked_detected_bubbles", png);
}
