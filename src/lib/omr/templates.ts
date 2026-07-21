import {
  getDefaultCorrectionOmrTemplate,
  mergeQuestionRois,
  type NormRect,
  type OmrTemplateConfig,
} from "@/src/lib/correction/omr-template-config";

export type CanonicalRoiMap = {
  studentCode: NormRect;
  study: {
    morningBubble: { nx: number; ny: number };
    eveningBubble: { nx: number; ny: number };
  };
  answersByQuestion: Record<number, NormRect>;
};

export type OmrTemplate = {
  id: string;
  totalQuestions: number;
  options: string[];
  canonicalSheetSize: { width: number; height: number };
  roiMap: CanonicalRoiMap;
  templateConfig: OmrTemplateConfig;
};

function buildFixedRoiMap(cfg: OmrTemplateConfig): CanonicalRoiMap {
  const questionRois = mergeQuestionRois(cfg);
  const codeXs = cfg.sheetCodeBubbles.map((b) => b.center.nx);
  const codeYs = cfg.sheetCodeBubbles.map((b) => b.center.ny);
  const pad = cfg.bubbleRadiusNorm * 3;
  const studentCode: NormRect = {
    nx0: Math.max(0, Math.min(...codeXs) - pad),
    ny0: Math.max(0, Math.min(...codeYs) - pad),
    nx1: Math.min(1, Math.max(...codeXs) + pad),
    ny1: Math.min(1, Math.max(...codeYs) + pad),
  };

  // ثابتة حسب قالب الشيت الرسمي الحالي (فقاعات صباحي/مسائي أعلى معلومات الطالب)
  const study = {
    morningBubble: { nx: 0.335, ny: 0.279 },
    eveningBubble: { nx: 0.239, ny: 0.279 },
  };

  return {
    studentCode,
    study,
    answersByQuestion: questionRois,
  };
}

/**
 * قالب ثابت للشيت الحالي المولّد من النظام:
 * - canonical sheet size بعد التطبيع
 * - ROI map مطبّعة 0..1 (رقم الطالب/الدراسة/الأسئلة)
 * - استخراج أسئلة بعدد متغير (يأخذ أول N أسئلة من نفس التخطيط الثابت)
 */
export function normalizeTemplate(totalQuestions: number, options: string[]): OmrTemplate {
  void options;
  const base = getDefaultCorrectionOmrTemplate();
  const tq = Number.isFinite(totalQuestions) && totalQuestions > 0 ? Math.floor(totalQuestions) : 25;
  // الشيت الرسمي الحالي ثابت على A/B/C/D، لذلك تُفرض هذه الخيارات في محرك OMR.
  const allowed = ["A", "B", "C", "D"];

  const answers = base.answerBubbles.filter((b) => (b.question || 0) <= tq);
  const rois = mergeQuestionRois(base);
  const limitedRois: Record<number, NormRect> = {};
  for (let q = 1; q <= tq; q++) {
    if (rois[q]) limitedRois[q] = rois[q]!;
  }

  const templateConfig: OmrTemplateConfig = {
    ...base,
    questionsPerTemplate: tq,
    optionsPerQuestion: allowed.length,
    answerBubbles: answers,
    questionRoisNorm: limitedRois,
  };

  return {
    id: `fixed-student-sheet-${tq}-${allowed.join("") || "ABCD"}`,
    totalQuestions: tq,
    options: allowed,
    canonicalSheetSize: { width: templateConfig.pageWidth, height: templateConfig.pageHeight },
    roiMap: buildFixedRoiMap(templateConfig),
    templateConfig,
  };
}

