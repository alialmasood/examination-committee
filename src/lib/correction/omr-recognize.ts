/**
 * واجهة التعرف على شيت OMR — تفويض كامل إلى مسار الخدمات (تطبيع → استخراج).
 * المقارنة الرمزية مع المفتاح تتم في API وليس هنا.
 */

export type {
  RecognizedAnswer,
  OmrRecognizeResult,
  OmrRecognizeOptions,
  OmrCalibrationDebug,
} from "./services/types";

export { runOmrRecognitionPipeline } from "./services/run-omr-pipeline";

import { runOmrRecognitionPipeline } from "./services/run-omr-pipeline";
import type { OmrRecognizeOptions, OmrRecognizeResult } from "./services/types";

export async function recognizeOmrSheetImage(
  input: Buffer,
  options?: OmrRecognizeOptions
): Promise<OmrRecognizeResult> {
  return runOmrRecognitionPipeline(input, options);
}
