"""
تصورات مساعدة للمعايرة على شيت واحد (مستطيلات ROI + نصوص القرار).
لا يُستدعى من مسار الإنتاج الافتراضي — يُستخدم من سكربت المعايرة فقط.
"""

from __future__ import annotations

import cv2
import numpy as np

from template_config import TemplateConfig, build_answer_roi_map, build_student_code_roi_map


def _bubble_px_radius(cfg: TemplateConfig, h: int, w: int) -> int:
    return max(4, int(cfg.bubble_radius_norm * min(w, h)))


def build_roi_overlay_rectangles(warped_sheet_bgr: np.ndarray, cfg: TemplateConfig) -> np.ndarray:
    """
    نسخة من ورقة warped مع مستطيلات واضحة حول كل ROI (رمز الطالب + إجابات).
    """
    img = warped_sheet_bgr.copy()
    h, w = img.shape[:2]
    r = _bubble_px_radius(cfg, h, w)
    half = max(6, int(r * 1.25))

    # رمز الطالب — رمادي رفيع
    sc_map = build_student_code_roi_map(cfg)
    for _col, digits in sc_map.items():
        for _d, (nx, ny) in digits.items():
            cx, cy = int(nx * w), int(ny * h)
            cv2.rectangle(img, (cx - half, cy - half), (cx + half, cy + half), (160, 160, 160), 1)

    ans_map = build_answer_roi_map(cfg)
    colors = {
        "A": (0, 180, 0),
        "B": (200, 100, 0),
        "C": (0, 120, 220),
        "D": (200, 0, 200),
    }
    for q, letters in ans_map.items():
        for letter, (nx, ny) in letters.items():
            cx, cy = int(nx * w), int(ny * h)
            color = colors.get(letter, (200, 200, 200))
            cv2.rectangle(img, (cx - half, cy - half), (cx + half, cy + half), color, 2)
            cv2.putText(
                img,
                f"Q{q}{letter}",
                (cx - half, max(14, cy - half - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.35,
                color,
                1,
                cv2.LINE_AA,
            )
    return img


def build_marked_bubbles_with_labels(
    warped_sheet_bgr: np.ndarray,
    answers: list[dict],
    cfg: TemplateConfig,
) -> np.ndarray:
    """
    ورقة warped مع نص قرار لكل سؤال بجانب مجموعة الفقاعات (ASCII لتفادي مشاكل الخطوط).
    """
    img = warped_sheet_bgr.copy()
    h, w = img.shape[:2]
    ans_map = build_answer_roi_map(cfg)
    bubble_r = _bubble_px_radius(cfg, h, w)

    for a in answers:
        q = int(a["questionNumber"])
        opt = a.get("selectedOption")
        st = str(a.get("status", ""))
        conf = float(a.get("confidence", 0.0))
        letters = ans_map.get(q, {})
        if not letters:
            continue
        xs = [letters[L][0] * w for L in letters]
        ys = [letters[L][1] * h for L in letters]
        cx = int(sum(xs) / len(xs))
        cy = int(sum(ys) / len(ys))
        ox = max(8, int(min(xs) - bubble_r * 5.5))
        oy = int(min(ys) - bubble_r * 0.8)
        oy = max(16, oy)
        label = f"Q{q}:{opt or '-'}|{st}|c={conf:.2f}"
        cv2.putText(
            img,
            label,
            (ox, oy),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (20, 20, 220),
            1,
            cv2.LINE_AA,
        )
        # إبراز الفقاعة المختارة
        if opt and opt in letters:
            nx, ny = letters[opt]
            sx, sy = int(nx * w), int(ny * h)
            cv2.circle(img, (sx, sy), bubble_r + 2, (0, 255, 0), 2)
    return img
