import { buildCorrectionOmrTemplateFromPythonDiskSync } from "./python-template-config-sync";
import {
  applyQuestionUiCalibrationToTemplate,
  applyStudentCodeColumnCalibrationToTemplate,
} from "./question-calibration-ui-overrides";
import { getDefaultCorrectionOmrTemplate, type OmrTemplateConfig } from "./omr-template-config";

/**
 * قالب التعرف على شيت التصحيح: من template_config.py + المعايرة المحفوظة.
 * عند تمرير قالب صريح (omrTemplate) يُطبَّق ملف المعايرة فوقه فقط.
 */
export function resolveCorrectionOmrTemplate(explicit?: OmrTemplateConfig): OmrTemplateConfig {
  if (explicit) {
    return applyStudentCodeColumnCalibrationToTemplate(applyQuestionUiCalibrationToTemplate(explicit));
  }
  return buildCorrectionOmrTemplateFromPythonDiskSync() ?? applyStudentCodeColumnCalibrationToTemplate(getDefaultCorrectionOmrTemplate());
}
