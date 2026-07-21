import {
  OMR_BUBBLE_SAMPLE_RADIUS,
  buildAnswerBubbles,
} from "@/src/lib/correction/omr-sheet-template";
import { mapNormToPixel, searchAutoLayoutFromQuestion1 } from "@/src/lib/correction/services/sheet-geometry";
import sharp from "sharp";
import type { DebugCollector } from "../debug";
import type { BubbleMap, BubbleRoi, Raster } from "../types";

export type ExtractBubbleMapCalibration = {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  skipAutoBBox?: boolean;
  skipAutoLayout?: boolean;
};

/**
 * خريطة دوائر الإجابة في إحداثيات الصورة المُطبَّعة بعد محاذاة السؤال 1.
 */
export function extractBubbleMap(
  canonical: Raster,
  calibration?: ExtractBubbleMapCalibration
): BubbleMap {
  const cal = calibration ?? {};
  const userOffsetX = Number(cal.offsetX) || 0;
  const userOffsetY = Number(cal.offsetY) || 0;
  const userScale = cal.scale != null && cal.scale > 0.3 && cal.scale < 1.7 ? cal.scale : 1;
  const skipAutoLayout = Boolean(cal.skipAutoLayout);

  const bbox = { x0: 0, y0: 0, x1: canonical.width - 1, y1: canonical.height - 1 };
  const innerR = Math.max(5, OMR_BUBBLE_SAMPLE_RADIUS - 1);

  let autoOx = 0;
  let autoOy = 0;
  let autoSc = 1;
  let autoMetric = 0;
  if (!skipAutoLayout) {
    const found = searchAutoLayoutFromQuestion1(
      canonical.data,
      canonical.width,
      canonical.height,
      canonical.channels,
      innerR,
      bbox
    );
    autoOx = found.ox;
    autoOy = found.oy;
    autoSc = found.sc;
    autoMetric = found.metric;
  }

  const offsetX = autoOx + userOffsetX;
  const offsetY = autoOy + userOffsetY;
  const scale = autoSc * userScale;

  const defs = buildAnswerBubbles();
  const bubbles: BubbleRoi[] = [];
  for (const d of defs) {
    const { cx, cy } = mapNormToPixel(d.nx, d.ny, bbox, offsetX, offsetY, scale);
    bubbles.push({
      questionNumber: d.q,
      letter: d.letter,
      cx,
      cy,
      radius: innerR,
    });
  }

  return {
    innerRadius: innerR,
    layout: {
      offsetX,
      offsetY,
      scale,
      bbox,
      autoLayoutMetric: skipAutoLayout ? undefined : autoMetric,
    },
    bubbles,
  };
}

/** تراكب دوائر ROI على الشيت المُطبَّع */
export async function renderBubbleRoiOverlay(canonical: Raster, bubbleMap: BubbleMap): Promise<Buffer> {
  const { width: w, height: h } = canonical;
  const base = await sharp(Buffer.from(canonical.data), {
    raw: { width: w, height: h, channels: 1 },
  })
    .png()
    .toBuffer();

  const dots = bubbleMap.bubbles
    .map(
      (b) =>
        `<circle cx="${b.cx.toFixed(1)}" cy="${b.cy.toFixed(1)}" r="2" fill="rgba(37,99,235,0.7)"/>`
    )
    .join("");

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

export async function debugBubbleMapOverlay(canonical: Raster, bubbleMap: BubbleMap, debug: DebugCollector): Promise<void> {
  if (!debug.enabled) return;
  const png = await renderBubbleRoiOverlay(canonical, bubbleMap);
  await debug.addPngBuffer("06_overlay_rois", png);
}
