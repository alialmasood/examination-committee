from __future__ import annotations

import sys

import cv2
import numpy as np

from template_config import TemplateConfig
from config import ADAPTIVE_BLOCK_SIZE, ADAPTIVE_C, GAUSSIAN_BLUR_KERNEL
from detect_page import resolve_warped_page


def ensure_portrait(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if w > h:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    return img


def pad_original_to_template_aspect(img_bgr: np.ndarray, page_w: int, page_h: int) -> np.ndarray:
    """
    يطابق نسبة ارتفاع/عرض إطار الصورة مع نسبة لوحة التصحيح (page_h/page_w) قبل اكتشاف الحدود.
    يقلل انضغاط المحتوى عند homography عندما تكون صورة الكاميرا أو PDF بإطار غير A4 عمودي.
    """
    ih, iw = img_bgr.shape[:2]
    if iw < 2 or ih < 2:
        return img_bgr
    target_ar = page_h / page_w
    curr_ar = ih / iw
    if abs(curr_ar - target_ar) < 0.002:
        return img_bgr
    if curr_ar > target_ar:
        new_w = max(1, int(round(ih / target_ar)))
        pad = max(0, new_w - iw)
        pl, pr = pad // 2, pad - (pad // 2)
        return cv2.copyMakeBorder(img_bgr, 0, 0, pl, pr, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    new_h = max(1, int(round(iw * target_ar)))
    pad = max(0, new_h - ih)
    pt, pb = pad // 2, pad - (pad // 2)
    return cv2.copyMakeBorder(img_bgr, pt, pb, 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))


def preprocess_page(img_bgr: np.ndarray, cfg: TemplateConfig) -> dict[str, np.ndarray]:
    original = ensure_portrait(img_bgr)
    original = pad_original_to_template_aspect(original, cfg.page_width, cfg.page_height)
    oh, ow = original.shape[:2]

    gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
    denoise = cv2.GaussianBlur(gray, GAUSSIAN_BLUR_KERNEL, 0)
    thresholded = cv2.adaptiveThreshold(
        denoise,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        ADAPTIVE_BLOCK_SIZE,
        ADAPTIVE_C,
    )
    warped_full_page, contour, used_fallback = resolve_warped_page(
        original, denoise, cfg.page_width, cfg.page_height
    )

    # رسم الحد الخارجي المُختار (للمعايرة — أخضر سميك)؛ في مسار fallback لا يُرسم رباعي
    detected_outer_page_contour = original.copy()
    if contour is not None:
        cv2.polylines(
            detected_outer_page_contour,
            [contour.astype(np.int32)],
            True,
            (0, 220, 0),
            6,
            lineType=cv2.LINE_AA,
        )

    contour_canvas = original.copy()
    if contour is not None:
        cv2.polylines(contour_canvas, [contour.astype(np.int32)], True, (0, 0, 255), 4)

    wh, ww = warped_full_page.shape[:2]
    if ww != cfg.page_width or wh != cfg.page_height:
        warped = cv2.resize(
            warped_full_page, (cfg.page_width, cfg.page_height), interpolation=cv2.INTER_LINEAR
        )
        wh, ww = warped.shape[:2]
    else:
        warped = warped_full_page

    print(
        f"[omr-preprocess] original={ow}x{oh}px  warped_sheet={ww}x{wh}px  "
        f"outer_quad={'yes' if contour is not None else 'no'}  "
        f"fallback_resize_only={used_fallback}",
        file=sys.stderr,
    )

    warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    warped_thr = cv2.adaptiveThreshold(
        warped_gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        ADAPTIVE_BLOCK_SIZE,
        ADAPTIVE_C,
    )
    return {
        "original": original,
        "grayscale": gray,
        "thresholded": thresholded,
        "detected_sheet_contour": contour_canvas,
        "detected_outer_page_contour": detected_outer_page_contour,
        "warped_full_page": warped_full_page,
        "warped_sheet": warped,
        "warped_gray": warped_gray,
        "warped_thresholded": warped_thr,
    }
