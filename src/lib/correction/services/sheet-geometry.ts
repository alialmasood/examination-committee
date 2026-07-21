import { buildAnswerBubbles, type OmrAnswerLetter } from "../omr-sheet-template";
import { bubbleMarkScore, bubbleMarkScoreInnerRing, readGray } from "./bubble-sampling";

export type BBox = { x0: number; y0: number; x1: number; y1: number };

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

export function findContentBBox(
  data: Buffer,
  w: number,
  h: number,
  channels: number
): BBox {
  const thr = 248;
  const minFrac = 0.004;
  const rowInk = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (let x = 0; x < w; x++) {
      if (readGray(data, w, h, channels, x, y) < thr) ink++;
    }
    rowInk[y] = ink / w;
  }
  const smooth = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    smooth[y] =
      (rowInk[Math.max(0, y - 1)]! + rowInk[y]! * 2 + rowInk[Math.min(h - 1, y + 1)]!) / 4;
  }
  let y0 = 0;
  let y1 = h - 1;
  for (let y = 0; y < h; y++) {
    if (smooth[y]! > minFrac) {
      y0 = y;
      break;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    if (smooth[y]! > minFrac) {
      y1 = y;
      break;
    }
  }

  const colInk = new Float64Array(w);
  const ySpan = Math.max(1, y1 - y0 + 1);
  for (let x = 0; x < w; x++) {
    let ink = 0;
    for (let y = y0; y <= y1; y++) {
      if (readGray(data, w, h, channels, x, y) < thr) ink++;
    }
    colInk[x] = ink / ySpan;
  }
  let x0 = 0;
  let x1 = w - 1;
  for (let x = 0; x < w; x++) {
    if (colInk[x]! > minFrac) {
      x0 = x;
      break;
    }
  }
  for (let x = w - 1; x >= 0; x--) {
    if (colInk[x]! > minFrac) {
      x1 = x;
      break;
    }
  }

  const pad = Math.round(Math.min(w, h) * 0.012);
  const bx0 = Math.max(0, Math.min(w - 1, x0 - pad));
  const by0 = Math.max(0, Math.min(h - 1, y0 - pad));
  const bx1 = Math.max(bx0, Math.min(w - 1, x1 + pad));
  const by1 = Math.max(by0, Math.min(h - 1, y1 + pad));
  return { x0: bx0, y0: by0, x1: bx1, y1: by1 };
}

export function mapNormToPixel(
  nx: number,
  ny: number,
  bbox: BBox,
  offsetX: number,
  offsetY: number,
  scale: number
): { cx: number; cy: number } {
  const bw = Math.max(1, bbox.x1 - bbox.x0);
  const bh = Math.max(1, bbox.y1 - bbox.y0);
  const tcx = 0.5 + (nx - 0.5) * scale;
  const tcy = 0.5 + (ny - 0.5) * scale;
  return {
    cx: bbox.x0 + tcx * bw + offsetX,
    cy: bbox.y0 + tcy * bh + offsetY,
  };
}

/** إحداثيات معيّنة 0..1 بالنسبة لكامل الصفحة المطبّعة (بعد resize) — لا تعتمد على content bbox */
export function mapTemplateNormToPixel(
  nx: number,
  ny: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scale: number
): { cx: number; cy: number } {
  const wm = Math.max(1, width - 1);
  const hm = Math.max(1, height - 1);
  const tcx = wm * (0.5 + (nx - 0.5) * scale);
  const tcy = hm * (0.5 + (ny - 0.5) * scale);
  return { cx: tcx + offsetX, cy: tcy + offsetY };
}

export function q1AlignmentMetric(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  innerR: number,
  bbox: BBox,
  ox: number,
  oy: number,
  sc: number
): number {
  const answerDefs = buildAnswerBubbles();
  const scores: number[] = [];
  for (const letter of ["A", "B", "C", "D"] as OmrAnswerLetter[]) {
    const def = answerDefs.find((d) => d.q === 1 && d.letter === letter);
    if (!def) return 0;
    const { cx, cy } = mapNormToPixel(def.nx, def.ny, bbox, ox, oy, sc);
    scores.push(bubbleMarkScore(data, width, height, channels, cx, cy, innerR));
  }
  const sorted = [...scores].sort((a, b) => b - a);
  const s0 = sorted[0]!;
  const s1 = sorted[1]!;
  const s3 = sorted[3]!;
  if (s0 < 1.2) return s0 * 0.08;
  return s0 - s1 + 0.14 * (s0 - s3) + 0.035 * s0;
}

export function searchAutoLayoutFromQuestion1(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  innerR: number,
  bbox: BBox
): { ox: number; oy: number; sc: number; metric: number } {
  let best = { ox: 0, oy: 0, sc: 1, metric: -1e12 };
  const scales = [0.9, 0.92, 0.94, 0.96, 0.98, 1, 1.02, 1.04, 1.06, 1.08, 1.1];
  for (const sc of scales) {
    for (let ox = -168; ox <= 168; ox += 24) {
      for (let oy = -168; oy <= 168; oy += 24) {
        const m = q1AlignmentMetric(data, width, height, channels, innerR, bbox, ox, oy, sc);
        if (m > best.metric) best = { ox, oy, sc, metric: m };
      }
    }
  }
  const { ox: ox0, oy: oy0, sc: sc0 } = best;
  for (let dsc = -0.04; dsc <= 0.04 + 1e-6; dsc += 0.02) {
    const sc = Math.min(1.12, Math.max(0.88, sc0 + dsc));
    for (let ox = ox0 - 28; ox <= ox0 + 28; ox += 7) {
      for (let oy = oy0 - 28; oy <= oy0 + 28; oy += 7) {
        const m = q1AlignmentMetric(data, width, height, channels, innerR, bbox, ox, oy, sc);
        if (m > best.metric) best = { ox, oy, sc, metric: m };
      }
    }
  }
  return best;
}

export type Q1BubbleNorm = { letter: OmrAnswerLetter; nx: number; ny: number };

export function q1AlignmentMetricPage(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  outerRadiusPx: number,
  innerFrac: number,
  ox: number,
  oy: number,
  sc: number,
  q1Bubbles: Q1BubbleNorm[]
): number {
  const scores: number[] = [];
  for (const letter of ["A", "B", "C", "D"] as OmrAnswerLetter[]) {
    const def = q1Bubbles.find((b) => b.letter === letter);
    if (!def) return 0;
    const { cx, cy } = mapTemplateNormToPixel(def.nx, def.ny, width, height, ox, oy, sc);
    scores.push(bubbleMarkScoreInnerRing(data, width, height, channels, cx, cy, outerRadiusPx, innerFrac));
  }
  const sorted = [...scores].sort((a, b) => b - a);
  const s0 = sorted[0]!;
  const s1 = sorted[1]!;
  const s3 = sorted[3]!;
  if (s0 < 1.2) return s0 * 0.08;
  return s0 - s1 + 0.14 * (s0 - s3) + 0.035 * s0;
}

export function searchAutoLayoutFromQuestion1Page(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  outerRadiusPx: number,
  innerFrac: number,
  q1Bubbles: Q1BubbleNorm[]
): { ox: number; oy: number; sc: number; metric: number } {
  let best = { ox: 0, oy: 0, sc: 1, metric: -1e12 };
  const scales = [0.9, 0.92, 0.94, 0.96, 0.98, 1, 1.02, 1.04, 1.06, 1.08, 1.1];
  for (const sc of scales) {
    for (let ox = -168; ox <= 168; ox += 24) {
      for (let oy = -168; oy <= 168; oy += 24) {
        const m = q1AlignmentMetricPage(data, width, height, channels, outerRadiusPx, innerFrac, ox, oy, sc, q1Bubbles);
        if (m > best.metric) best = { ox, oy, sc, metric: m };
      }
    }
  }
  const { ox: ox0, oy: oy0, sc: sc0 } = best;
  for (let dsc = -0.04; dsc <= 0.04 + 1e-6; dsc += 0.02) {
    const sc = Math.min(1.12, Math.max(0.88, sc0 + dsc));
    for (let ox = ox0 - 28; ox <= ox0 + 28; ox += 7) {
      for (let oy = oy0 - 28; oy <= oy0 + 28; oy += 7) {
        const m = q1AlignmentMetricPage(data, width, height, channels, outerRadiusPx, innerFrac, ox, oy, sc, q1Bubbles);
        if (m > best.metric) best = { ox, oy, sc, metric: m };
      }
    }
  }
  return best;
}
