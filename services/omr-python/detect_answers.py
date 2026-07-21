from __future__ import annotations

import cv2
import numpy as np

from detect_student_code import (
    bubble_fill_ratio_annulus,
    bubble_ink_score_gray_annulus,
)
from template_config import TemplateConfig, build_answer_roi_map

# فراغ يبدو «أعلى خيار» بفارق ضئيل بسبب الضوضاء (مثل س17 بدون تظليل) — لا يُصنَّف answered
_WEAK_TOP_FILL_MAX = 0.095
_WEAK_TOP_SECOND_GAP_MAX = 0.032
# الأربع قيم متقاربة وليست عالية → لا يوجد تظليل حقيقي
_TIGHT_CLUSTER_HI_MAX = 0.205
_TIGHT_CLUSTER_SPREAD_MAX = 0.078
# أعلى درجة لا تتفوق على متوسط الأربع بما يكفي → فراغ (يمنع B عندما تكون الأربع «ضجيجًا» مرتفعًا قليلًا)
_DOMINANCE_OVER_MEAN_MIN = 0.10
_DOMINANCE_TOP_MAX = 0.36
# الثاني قريب جدًا من الأول نسبيًا رغم انخفاض القيم → ضوضاء موحّدة (غالبًا B في صف فارغ)
_RELATIVE_SECOND_RATIO_MAX = 0.82
_RELATIVE_SECOND_TOP_MAX = 0.30
# الرمادي يرفع الضوضاء المتجانسة؛ نخفّض وزنه قليلًا مقابل الثنائي
# وزن أعلى قليلًا للمسح اليدوي/الرمادي حتى لا يُغلب الثنائي المحلي على الحبر الواضح
_GRAY_SCORE_WEIGHT = 0.92
# ---------------------------------------------------------------------------
# تظليل مزدوج (إجابتان): الفارق المطلق وحده لا يكفي — أحيانًا يظلّ الطالب
# خيارين بقوة متقاربة فيُقرأ أعلى قيمة بفارق > multiple_mark_delta فيُصنَّف
# answered خطأ. القاعدة النسبية: إذا كان الثاني ≥ نسبة من الأعلى والأعلى
# فوق عتبة «حبر حقيقي» → multiple (باطل كالفراغ في الامتحان).
# ---------------------------------------------------------------------------
_TWIN_SECOND_TO_BEST_RATIO = 0.58
_TWIN_MIN_BEST_SCORE = 0.072


def detect_answers(
    warped_thresholded: np.ndarray,
    warped_sheet: np.ndarray,
    cfg: TemplateConfig,
) -> tuple[list[dict], np.ndarray, np.ndarray]:
    """
    استخراج إجابات 1..N من صورة ثنائية بعد التصحيح المنظور، باستخدام ROI ثابتة من القالب
    ونسبة تعبئة الفقاعة (bubble fill ratio) — بدون مقارنة صورة بصورة.

    يُدمج قياس الثنائي مع قياس الحبر على الرمادي (نفس مركز العينة) لتفادي اختيار خاطئ رغم
    تمركز الـ ROI على الفقاعة المظلّلة (أثر عتبة أدابتيف أو تسرّب ضوضاء للجار).
    """
    h, w = warped_thresholded.shape[:2]
    bubble_r = max(2, int(cfg.bubble_radius_norm * min(w, h)))
    gray = (
        cv2.cvtColor(warped_sheet, cv2.COLOR_BGR2GRAY)
        if warped_sheet is not None and len(warped_sheet.shape) == 3
        else warped_sheet
    )
    roi_map = build_answer_roi_map(cfg)
    overlay = warped_sheet.copy()
    marked = warped_sheet.copy()

    answers: list[dict] = []
    for q in range(1, cfg.total_questions + 1):
        opt_map = roi_map[q]
        scores: dict[str, float] = {}
        for letter, (nx, ny) in opt_map.items():
            cx = int(nx * w)
            cy = int(ny * h)
            fr_bin = bubble_fill_ratio_annulus(
                warped_thresholded,
                cx,
                cy,
                bubble_r,
            )
            fr_gray = bubble_ink_score_gray_annulus(
                gray,
                cx,
                cy,
                bubble_r,
            )
            scores[letter] = float(max(fr_bin, fr_gray * _GRAY_SCORE_WEIGHT))
            cv2.circle(overlay, (cx, cy), bubble_r, (200, 200, 255), 1)

        ordered = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        best_letter, best = ordered[0]
        second = ordered[1][1] if len(ordered) > 1 else 0.0
        gap_conf = max(0.0, min(1.0, float(best - second)))

        vals_sorted = sorted((float(v) for v in scores.values()), reverse=True)
        hi_all = vals_sorted[0]
        lo_all = vals_sorted[-1]
        mean_all = sum(vals_sorted) / max(len(vals_sorted), 1)
        dominance_over_mean = best - mean_all

        status = "answered"
        selected: str | None = best_letter
        if best < cfg.blank_threshold:
            status = "blank"
            selected = None
        elif hi_all < _TIGHT_CLUSTER_HI_MAX and (hi_all - lo_all) < _TIGHT_CLUSTER_SPREAD_MAX:
            status = "blank"
            selected = None
        elif best < _DOMINANCE_TOP_MAX and dominance_over_mean < _DOMINANCE_OVER_MEAN_MIN:
            status = "blank"
            selected = None
        elif best < _WEAK_TOP_FILL_MAX and (best - second) < _WEAK_TOP_SECOND_GAP_MAX:
            status = "blank"
            selected = None
        elif (
            best < _RELATIVE_SECOND_TOP_MAX
            and second > 1e-9
            and (second / best) >= _RELATIVE_SECOND_RATIO_MAX
        ):
            status = "blank"
            selected = None
        elif (
            best >= max(_TWIN_MIN_BEST_SCORE, float(cfg.blank_threshold) * 2.4)
            and second > 1e-9
            and (second / best) >= _TWIN_SECOND_TO_BEST_RATIO
        ):
            status = "multiple"
            selected = None
        elif best - second < cfg.multiple_mark_delta:
            status = "multiple"
            selected = None
        elif gap_conf < cfg.min_confidence:
            status = "uncertain"
            selected = None

        confidence = float(
            min(1.0, max(gap_conf, best)) if status == "answered" else max(0.0, min(1.0, best))
        )

        if status == "answered" and selected is not None:
            nx_sel, ny_sel = opt_map[selected]
            cx_s, cy_s = int(nx_sel * w), int(ny_sel * h)
            cv2.circle(marked, (cx_s, cy_s), bubble_r, (0, 220, 0), 2)

        # تقدير للعرض فقط — أعلى من عتبة الفراغ العادية حتى لا يظهر B على سؤال فارغ (uncertain)
        _hint_min_fill = max(cfg.blank_threshold * 2.5, 0.07)
        _hint_min_gap = max(cfg.multiple_mark_delta * 1.4, 0.03)
        best_choice_letter: str | None = (
            best_letter
            if best >= _hint_min_fill and (best - second) >= _hint_min_gap and best_letter in opt_map
            else None
        )

        answers.append(
            {
                "questionNumber": q,
                "selectedOption": selected,
                "status": status,
                "confidence": confidence,
                "bubbleScores": scores,
                "bestChoiceLetter": best_choice_letter,
            }
        )

    return answers, overlay, marked
