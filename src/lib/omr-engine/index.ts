/**
 * محرك OMR: استخراج إجابات الطالب من شيت واحد فقط (بدون مفتاح إجابة).
 *
 * الأنابيب: loadImage → preprocessImage → detectSheetBounds → warpPerspective →
 *           normalizeSheet → extractBubbleMap → detectAnswers
 */

export type { DetectedAnswer, OMRResult, OmrEngineOptions, OmrEngineDebugOptions } from "./types";
export { createDebugCollector } from "./debug";
export { loadImage } from "./pipeline/load-image";
export { preprocessImage } from "./pipeline/preprocess-image";
export { detectSheetBounds } from "./pipeline/detect-sheet-bounds";
export { warpPerspective } from "./pipeline/warp-perspective";
export { normalizeSheet } from "./pipeline/normalize-sheet";
export { extractBubbleMap, debugBubbleMapOverlay, renderBubbleRoiOverlay } from "./pipeline/extract-bubble-map";
export {
  detectAnswers,
  debugMarkedBubbles,
  renderMarkedBubblesOverlayWithMap,
} from "./pipeline/detect-answers";

import { createDebugCollector } from "./debug";
import { detectAnswers, debugMarkedBubbles } from "./pipeline/detect-answers";
import { detectSheetBounds } from "./pipeline/detect-sheet-bounds";
import { debugBubbleMapOverlay, extractBubbleMap } from "./pipeline/extract-bubble-map";
import { loadImage } from "./pipeline/load-image";
import { normalizeSheet } from "./pipeline/normalize-sheet";
import { preprocessImage } from "./pipeline/preprocess-image";
import { warpPerspective } from "./pipeline/warp-perspective";
import type { OMRResult, OmrEngineOptions } from "./types";

export async function runOmrEngine(input: Buffer, options?: OmrEngineOptions): Promise<OMRResult> {
  const debug = createDebugCollector(options?.debug);

  try {
    const loaded = await loadImage(input);
    const preprocessed = await preprocessImage(loaded, debug);
    const bounds = await detectSheetBounds(preprocessed, { skipAutoBBox: options?.calibration?.skipAutoBBox }, debug);
    const warped = await warpPerspective(preprocessed, bounds, debug);
    const normalized = await normalizeSheet(warped, debug);
    const bubbleMap = extractBubbleMap(normalized, options?.calibration);
    await debugBubbleMapOverlay(normalized, bubbleMap, debug);
    const questions = detectAnswers(normalized, bubbleMap);
    await debugMarkedBubbles(normalized, bubbleMap, questions, debug);

    return {
      success: true,
      sheetWidth: normalized.width,
      sheetHeight: normalized.height,
      questions,
      debugImages: debug.enabled ? debug.images : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      error: msg,
      sheetWidth: 0,
      sheetHeight: 0,
      questions: [],
      debugImages: debug.enabled ? debug.images : undefined,
    };
  }
}
