from __future__ import annotations

import sys

import cv2
import numpy as np

# إذا مساحة الرباعي أقل من هذا الجزء من مساحة الصورة → فشل → resize فقط بدون perspective
MIN_OUTER_QUAD_AREA_FRACTION = 0.70


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _quad_area(quad: np.ndarray) -> float:
    c = quad.reshape((-1, 1, 2)).astype(np.float32)
    return float(cv2.contourArea(c))


def _ordered_side_lengths(quad: np.ndarray) -> tuple[float, float, float, float]:
    """أطوال الأضلاع بالترتيب: أعلى، يمين، أسفل، يسار (بعد order_points)."""
    r = order_points(quad)
    d01 = float(np.linalg.norm(r[1] - r[0]))
    d12 = float(np.linalg.norm(r[2] - r[1]))
    d23 = float(np.linalg.norm(r[3] - r[2]))
    d30 = float(np.linalg.norm(r[0] - r[3]))
    return d01, d12, d23, d30


def _aspect_ratio_height_over_width(quad: np.ndarray) -> float:
    """نسبة الارتفاع/العرض للمستطيل المرتب (portrait A4 ≈ 1.41)."""
    r = order_points(quad)
    w_top = float(np.linalg.norm(r[1] - r[0]))
    w_bot = float(np.linalg.norm(r[2] - r[3]))
    h_r = float(np.linalg.norm(r[3] - r[0]))
    h_l = float(np.linalg.norm(r[2] - r[1]))
    width = max(w_top, w_bot, 1.0)
    height = max(h_r, h_l, 1.0)
    return height / width


def _is_plausible_page_quad(quad: np.ndarray, img_w: int, img_h: int, min_area_frac: float = 0.38) -> bool:
    """يرفض الصناديق الداخلية الصغيرة (مثل كتلة بيانات الطالب فقط)."""
    area = _quad_area(quad)
    if area < min_area_frac * float(img_w * img_h):
        return False
    ar = _aspect_ratio_height_over_width(quad)
    # صفحة A4 عمودية: ارتفاع أكبر من العرض
    if ar < 1.05 or ar > 2.3:
        return False
    d01, d12, d23, d30 = _ordered_side_lengths(quad)
    sides = [d01, d12, d23, d30]
    mx, mn = max(sides), min(sides)
    if mn < 1 or mx / mn > 2.8:
        return False
    return True


def _approx_to_quad(cnt: np.ndarray, eps_ratio: float) -> np.ndarray | None:
    peri = cv2.arcLength(cnt, True)
    if peri < 1e-6:
        return None
    approx = cv2.approxPolyDP(cnt, eps_ratio * peri, True)
    if len(approx) != 4:
        return None
    return approx.reshape(4, 2).astype(np.float32)


def _quads_from_contour(cnt: np.ndarray) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for eps in (0.015, 0.02, 0.03, 0.045, 0.065, 0.09, 0.12, 0.16):
        q = _approx_to_quad(cnt, eps)
        if q is not None:
            out.append(q)
    return out


def detect_page_contour(gray: np.ndarray) -> np.ndarray | None:
    """
    يختار رباعي أضلاع يمثل **حد الصفحة الخارجي** (وليس أول مضلع بأربع رؤوس).

    السابق كان يأخذ أول تطابق من أكبر 8 كونتورات؛ غالبًا الكونتور الأكبر لا يُبسّط
    إلى 4 نقاط فيُختار كونتور داخلي أصغر (مثل صندوق بيانات الطالب) فيُمدّد إلى
    كامل A4 فيظهر warped كأنه «رأس الصفحة فقط».
    """
    h, w = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    candidates: list[tuple[float, np.ndarray]] = []

    for cnt in contours[:30]:
        area = cv2.contourArea(cnt)
        if area < 0.08 * w * h:
            continue
        for q in _quads_from_contour(cnt):
            if _is_plausible_page_quad(q, w, h, min_area_frac=0.36):
                candidates.append((_quad_area(q), q))

    if candidates:
        candidates.sort(key=lambda t: t[0], reverse=True)
        return candidates[0][1]

    # احتياط: أكبر كونتور → convex hull → تبسيط إلى 4 رؤوس
    cnt0 = contours[0]
    hull = cv2.convexHull(cnt0)
    for eps in (0.02, 0.04, 0.06, 0.1, 0.14):
        q = _approx_to_quad(hull, eps)
        if q is not None and _is_plausible_page_quad(q, w, h, min_area_frac=0.28):
            return q

    # آخر احتياط: أكبر رباعي مساحة بغض النظر عن النسبة (أفضل من لا شيء)
    loose: list[tuple[float, np.ndarray]] = []
    for cnt in contours[:25]:
        area = cv2.contourArea(cnt)
        if area < 0.12 * w * h:
            continue
        for q in _quads_from_contour(cnt):
            if _quad_area(q) >= 0.12 * w * h:
                loose.append((_quad_area(q), q))
    if loose:
        loose.sort(key=lambda t: t[0], reverse=True)
        return loose[0][1]

    return None


def resize_to_canvas(img: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """تحجيم الصورة إلى أبعاد اللوحة القياسية (نفس صفحة المعايرة / template_config) بدون perspective — مسار fallback."""
    return cv2.resize(img, (out_w, out_h), interpolation=cv2.INTER_LINEAR)


def resolve_warped_page(
    original_bgr: np.ndarray,
    denoise_gray: np.ndarray,
    out_w: int,
    out_h: int,
) -> tuple[np.ndarray, np.ndarray | None, bool]:
    """
    يحاول اكتشاف حد الصفحة ثم perspective؛ إذا فشل أو الرباعي صغير جدًا
    يُرجع الصورة كاملة بـ resize_to_canvas فقط (بدون contour ولا perspective).

    Returns:
        (warped_bgr, contour_used_or_None, used_fallback)
    """
    ih, iw = original_bgr.shape[:2]
    img_area = float(iw * ih)

    contour = detect_page_contour(denoise_gray)
    if contour is None:
        print("[OMR] Using fallback full image (no contour detected)", file=sys.stderr)
        return resize_to_canvas(original_bgr, out_w, out_h), None, True

    quad_area = _quad_area(contour)
    if quad_area < MIN_OUTER_QUAD_AREA_FRACTION * img_area:
        print("[OMR] Using fallback full image (no contour detected)", file=sys.stderr)
        return resize_to_canvas(original_bgr, out_w, out_h), None, True

    warped = perspective_warp(original_bgr, contour, out_w, out_h)
    return warped, contour, False


def perspective_warp(img: np.ndarray, contour: np.ndarray | None, out_w: int, out_h: int) -> np.ndarray:
    if contour is None:
        return cv2.resize(img, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
    src = order_points(contour)
    dst = np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (out_w, out_h))
