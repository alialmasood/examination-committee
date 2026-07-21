import type { OmrRecognizeResult } from "@/src/lib/correction/services/types";

export type OmrPreprocessContext = {
  image: Buffer;
};

export function preprocessImage(input: Buffer): OmrPreprocessContext {
  return { image: input };
}

export function detectSheetBounds(ctx: OmrPreprocessContext): OmrPreprocessContext {
  return ctx;
}

export function perspectiveCorrection(ctx: OmrPreprocessContext): OmrPreprocessContext {
  return ctx;
}

export function normalizeToCanonicalSize(ctx: OmrPreprocessContext): OmrPreprocessContext {
  return ctx;
}

export function extractStudentCode(result: OmrRecognizeResult): string | null {
  return result.sheetCode || null;
}

