from __future__ import annotations

import numpy as np

from template_config import TemplateConfig, build_student_code_roi_map

# حلقة عينة الإجابات: تتجنب مركز الفقاعة حيث حرف A/B/C/D المطبوع (شكل B يعطي انحيازًا على الفراغ عند قياس القرص المركزي فقط).
_ANS_RING_INNER_FRAC = 0.36
_ANS_RING_OUTER_FRAC = 0.96


def bubble_fill_ratio(binary_inv: np.ndarray, cx: int, cy: int, radius: int, inner_frac: float) -> float:
    r = max(2, int(radius * inner_frac))
    y0 = max(0, cy - r)
    y1 = min(binary_inv.shape[0], cy + r + 1)
    x0 = max(0, cx - r)
    x1 = min(binary_inv.shape[1], cx + r + 1)
    roi = binary_inv[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    ys, xs = np.ogrid[: roi.shape[0], : roi.shape[1]]
    mask = (xs - (cx - x0)) ** 2 + (ys - (cy - y0)) ** 2 <= r * r
    if not np.any(mask):
        return 0.0
    return float(np.mean(roi[mask] > 0))


def bubble_ink_score_gray(gray: np.ndarray, cx: int, cy: int, radius: int, inner_frac: float) -> float:
    """
    متوسط «الحبر الداكن» داخل نفس دائرة العينة (0..1).
    يكمّل adaptiveThreshold: أحيانًا تظلّل الطالب واضحًا في الرمادي بينما الثنائي يعطي B أعلى من A بسبب ضوضاء/عتبة محلية.
    """
    r = max(2, int(radius * inner_frac))
    y0 = max(0, cy - r)
    y1 = min(gray.shape[0], cy + r + 1)
    x0 = max(0, cx - r)
    x1 = min(gray.shape[1], cx + r + 1)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    ys, xs = np.ogrid[: roi.shape[0], : roi.shape[1]]
    mask = (xs - (cx - x0)) ** 2 + (ys - (cy - y0)) ** 2 <= r * r
    if not np.any(mask):
        return 0.0
    samples = roi[mask].astype(np.float32)
    return float(np.clip(np.mean((255.0 - samples) / 255.0), 0.0, 1.0))


def _annulus_mask(
    y0: int, y1: int, x0: int, x1: int, cx: int, cy: int, r_in: int, r_out: int
) -> np.ndarray:
    dy = np.arange(y0, y1, dtype=np.int32)[:, None] - int(cy)
    dx = np.arange(x0, x1, dtype=np.int32)[None, :] - int(cx)
    d2 = dy.astype(np.float64) * dy + dx.astype(np.float64) * dx
    ri2 = float(r_in * r_in)
    ro2 = float(r_out * r_out)
    return (d2 > ri2) & (d2 <= ro2)


def bubble_fill_ratio_annulus(
    binary_inv: np.ndarray,
    cx: int,
    cy: int,
    radius: int,
    *,
    inner_bound_frac: float = _ANS_RING_INNER_FRAC,
    outer_bound_frac: float = _ANS_RING_OUTER_FRAC,
) -> float:
    r_out = max(3, int(radius * outer_bound_frac))
    r_in = max(1, int(radius * inner_bound_frac))
    if r_in >= r_out - 2:
        return bubble_fill_ratio(binary_inv, cx, cy, radius, inner_frac=0.68)
    y0 = max(0, cy - r_out)
    y1 = min(binary_inv.shape[0], cy + r_out + 1)
    x0 = max(0, cx - r_out)
    x1 = min(binary_inv.shape[1], cx + r_out + 1)
    roi = binary_inv[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    mask = _annulus_mask(y0, y1, x0, x1, cx, cy, r_in, r_out)
    if not np.any(mask):
        return 0.0
    return float(np.mean(roi[mask] > 0))


def bubble_ink_score_gray_annulus(
    gray: np.ndarray,
    cx: int,
    cy: int,
    radius: int,
    *,
    inner_bound_frac: float = _ANS_RING_INNER_FRAC,
    outer_bound_frac: float = _ANS_RING_OUTER_FRAC,
) -> float:
    r_out = max(3, int(radius * outer_bound_frac))
    r_in = max(1, int(radius * inner_bound_frac))
    if r_in >= r_out - 2:
        return bubble_ink_score_gray(gray, cx, cy, radius, inner_frac=0.68)
    y0 = max(0, cy - r_out)
    y1 = min(gray.shape[0], cy + r_out + 1)
    x0 = max(0, cx - r_out)
    x1 = min(gray.shape[1], cx + r_out + 1)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    mask = _annulus_mask(y0, y1, x0, x1, cx, cy, r_in, r_out)
    if not np.any(mask):
        return 0.0
    samples = roi[mask].astype(np.float32)
    return float(np.clip(np.mean((255.0 - samples) / 255.0), 0.0, 1.0))


def detect_student_code(binary_inv: np.ndarray, cfg: TemplateConfig) -> dict:
    h, w = binary_inv.shape[:2]
    bubble_r = int(cfg.bubble_radius_norm * min(w, h))
    roi_map = build_student_code_roi_map(cfg)
    digits_out = []
    code_chars: list[str] = []
    for col_idx in sorted(roi_map.keys()):
        scores = {}
        for digit in range(10):
            nx, ny = roi_map[col_idx][digit]
            cx = int(nx * w)
            cy = int(ny * h)
            scores[digit] = bubble_fill_ratio(
                binary_inv=binary_inv, cx=cx, cy=cy, radius=bubble_r, inner_frac=cfg.inner_mask_radius_fraction
            )
        ordered = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        best_digit, best = ordered[0]
        second = ordered[1][1] if len(ordered) > 1 else 0.0
        conf = max(0.0, min(1.0, best - second))
        status = "ok"
        detected_digit = best_digit
        if best < cfg.blank_threshold:
            status = "blank"
            detected_digit = None
        elif best - second < cfg.multiple_mark_delta:
            status = "multiple"
            detected_digit = None
        elif conf < cfg.min_confidence:
            status = "uncertain"
            detected_digit = None
        if detected_digit is None:
            code_chars.append("?")
        else:
            code_chars.append(str(detected_digit))
        digits_out.append(
            {
                "columnIndex": col_idx,
                "detectedDigit": detected_digit,
                "confidence": float(conf),
                "scores": {int(k): float(v) for k, v in scores.items()},
                "status": status,
            }
        )
    clean = "".join(c for c in code_chars if c != "?")
    can_build = all(d["detectedDigit"] is not None for d in digits_out)
    return {
        "studentCode": "".join(code_chars).replace("?", "") if can_build else None,
        "digits": digits_out,
        "confidence": float(min([d["confidence"] for d in digits_out] or [0.0])),
        "rawCode": clean,
    }
