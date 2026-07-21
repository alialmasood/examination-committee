from __future__ import annotations
from io import BytesIO

import cv2
import fitz
import numpy as np
from PIL import Image

from template_config import build_full_roi_map, get_template
from preprocess import preprocess_page
from detect_student_code import detect_student_code
from detect_answers import detect_answers
from debug_utils import create_debug_run_dir, image_to_base64_png, write_json, write_png


def _empty_debug_images() -> dict[str, str]:
    return {
        "original": "",
        "grayscale": "",
        "thresholded": "",
        "contour": "",
        "warped": "",
        "roiOverlay": "",
        "markedBubbles": "",
    }


def _extract_sheet_code_from_text(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    # السطر الأول = كود الورقة (5 أرقام فقط) عند QR نصي متعدد الأسطر للعرض على الهاتف
    first_line = s.split("\n", 1)[0].strip() if s else ""
    if len(first_line) == 5 and first_line.isdigit():
        return first_line
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) == 5:
        return digits
    if len(digits) > 5:
        return digits[-5:]
    return None


def _detect_qr_sheet_code(*images: np.ndarray) -> tuple[str | None, str | None]:
    detector = cv2.QRCodeDetector()
    for img in images:
        if img is None or getattr(img, "size", 0) == 0:
            continue
        try:
            data, _pts, _straight = detector.detectAndDecode(img)
        except Exception:
            data = ""
        data = (data or "").strip()
        if not data:
            continue
        code = _extract_sheet_code_from_text(data)
        if code:
            return code, data
    return None, None


def analyze_image_post(
    image_bytes: bytes,
    *,
    template_name: str | None = None,
    debug_mode: bool = False,
    run_label: str | None = None,
) -> dict:
    """
    تحليل صورة شيت واحدة — قالب ثابت + ROI بعد التصحيح المنظور + fill ratio.
    يُرجع JSON بالشكل المطلوب لواجهة /analyze-image (بدون PDF).
    """
    cfg = get_template(template_name)
    empty = _empty_debug_images()
    img = _np_from_bytes(image_bytes)
    stage = preprocess_page(img, cfg)
    student = detect_student_code(stage["warped_thresholded"], cfg)
    qr_code, qr_raw = _detect_qr_sheet_code(stage.get("warped_full_page"), stage.get("warped_sheet"), stage.get("original"))
    answers, roi_overlay, marked = detect_answers(stage["warped_thresholded"], stage["warped_sheet"], cfg)
    trimmed = answers[: cfg.total_questions]

    # QR أكثر موثوقية عند توفره؛ الدوائر تبقى fallback فقط.
    code_str = qr_code or student.get("studentCode") or ""
    needs_review = (not code_str) or any(
        a["status"] in {"uncertain", "multiple"} or float(a["confidence"]) < cfg.min_confidence for a in trimmed
    )

    out: dict = {
        "success": True,
        "studentCode": code_str,
        "answers": trimmed,
        "needsReview": bool(needs_review),
        "errors": [],
        "debugImages": dict(empty),
        "qrCodeRaw": qr_raw,
    }

    if debug_mode:
        out_dir = create_debug_run_dir(run_label)
        paths = {
            "original": out_dir / "original.png",
            "grayscale": out_dir / "grayscale.png",
            "thresholded": out_dir / "thresholded.png",
            "contour": out_dir / "contour.png",
            "detected_outer_page_contour": out_dir / "detected_outer_page_contour.png",
            "warped_full_page": out_dir / "warped_full_page.png",
            "warped": out_dir / "warped.png",
            "roiOverlay": out_dir / "roi_overlay.png",
            "markedBubbles": out_dir / "marked_bubbles.png",
        }
        write_png(paths["original"], stage["original"])
        write_png(paths["grayscale"], cv2.cvtColor(stage["grayscale"], cv2.COLOR_GRAY2BGR))
        write_png(paths["thresholded"], cv2.cvtColor(stage["thresholded"], cv2.COLOR_GRAY2BGR))
        write_png(paths["contour"], stage["detected_sheet_contour"])
        write_png(paths["detected_outer_page_contour"], stage["detected_outer_page_contour"])
        write_png(paths["warped_full_page"], stage["warped_full_page"])
        write_png(paths["warped"], stage["warped_sheet"])
        write_png(paths["roiOverlay"], roi_overlay)
        write_png(paths["markedBubbles"], marked)

        out["debugImages"] = {
            "original": _png_base64(stage["original"]),
            "grayscale": _png_base64(cv2.cvtColor(stage["grayscale"], cv2.COLOR_GRAY2BGR)),
            "thresholded": _png_base64(cv2.cvtColor(stage["thresholded"], cv2.COLOR_GRAY2BGR)),
            "contour": _png_base64(stage["detected_sheet_contour"]),
            "warped": _png_base64(stage["warped_sheet"]),
            "roiOverlay": _png_base64(roi_overlay),
            "markedBubbles": _png_base64(marked),
        }
        out["debugImageFiles"] = {k: str(v) for k, v in paths.items()}
        write_json(
            out_dir / "result.json",
            {
                "success": out["success"],
                "studentCode": out["studentCode"],
                "answers": out["answers"],
                "needsReview": out["needsReview"],
                "errors": out["errors"],
                "debugImageFiles": out["debugImageFiles"],
            },
        )
    return out


def _np_from_bytes(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("تعذر قراءة الصورة.")
    return img


def _png_base64(img: np.ndarray) -> str:
    return image_to_base64_png(img)


def _read_pdf_pages(pdf_bytes: bytes, dpi: int = 300) -> list[np.ndarray]:
    pages = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for page in doc:
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pil = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")
            cv_img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
            pages.append(cv_img)
    finally:
        doc.close()
    return pages


def analyze_page_image(image_bytes: bytes, template_name: str | None = None, include_debug: bool = True) -> dict:
    cfg = get_template(template_name)
    img = _np_from_bytes(image_bytes)
    stage = preprocess_page(img, cfg)
    student = detect_student_code(stage["warped_thresholded"], cfg)
    qr_code, qr_raw = _detect_qr_sheet_code(stage.get("warped_full_page"), stage.get("warped_sheet"), stage.get("original"))
    answers, roi_overlay, marked = detect_answers(stage["warped_thresholded"], stage["warped_sheet"], cfg)

    # اعتماد QR أولًا لتفادي انزياحات قراءة الدوائر.
    resolved_student_code = qr_code or student["studentCode"]
    needs_review = resolved_student_code is None or any(
        a["status"] in {"uncertain", "multiple"} or float(a["confidence"]) < cfg.min_confidence for a in answers
    )
    result = {
        "templateId": cfg.template_id,
        "roiMap": build_full_roi_map(cfg),
        "studentCode": resolved_student_code,
        "studentCodeConfidence": float(student["confidence"]),
        "studentCodeDetection": {
            "studentCode": student["studentCode"],
            "digits": student["digits"],
            "confidence": float(student["confidence"]),
        },
        "qrCodeRaw": qr_raw,
        "answers": answers,
        "needsReview": needs_review,
        "errors": [],
        "debugImages": [],
    }
    if include_debug:
        out_dir = create_debug_run_dir("analyze-page")
        original_path = out_dir / "original.png"
        grayscale_path = out_dir / "grayscale.png"
        threshold_path = out_dir / "threshold.png"
        contour_path = out_dir / "contour.png"
        outer_contour_path = out_dir / "detected_outer_page_contour.png"
        warped_full_path = out_dir / "warped_full_page.png"
        warped_path = out_dir / "warped.png"
        roi_overlay_path = out_dir / "roi_overlay.png"
        final_overlay_path = out_dir / "final_detection_overlay.png"

        write_png(original_path, stage["original"])
        write_png(grayscale_path, cv2.cvtColor(stage["grayscale"], cv2.COLOR_GRAY2BGR))
        write_png(threshold_path, cv2.cvtColor(stage["thresholded"], cv2.COLOR_GRAY2BGR))
        write_png(contour_path, stage["detected_sheet_contour"])
        write_png(outer_contour_path, stage["detected_outer_page_contour"])
        write_png(warped_full_path, stage["warped_full_page"])
        write_png(warped_path, stage["warped_sheet"])
        write_png(roi_overlay_path, roi_overlay)
        write_png(final_overlay_path, marked)

        result["debugImages"] = {
            "original page image": _png_base64(stage["original"]),
            "grayscale": _png_base64(cv2.cvtColor(stage["grayscale"], cv2.COLOR_GRAY2BGR)),
            "thresholded": _png_base64(cv2.cvtColor(stage["thresholded"], cv2.COLOR_GRAY2BGR)),
            "detected sheet contour": _png_base64(stage["detected_sheet_contour"]),
            "detected outer page contour": _png_base64(stage["detected_outer_page_contour"]),
            "warped full page": _png_base64(stage["warped_full_page"]),
            "warped sheet": _png_base64(stage["warped_sheet"]),
            "roi overlay": _png_base64(roi_overlay),
            "marked bubbles": _png_base64(marked),
        }
        result["debugImageFiles"] = {
            "original": str(original_path),
            "grayscale": str(grayscale_path),
            "threshold": str(threshold_path),
            "contour": str(contour_path),
            "detected_outer_page_contour": str(outer_contour_path),
            "warped_full_page": str(warped_full_path),
            "warped": str(warped_path),
            "roi_overlay": str(roi_overlay_path),
            "final_detection_overlay": str(final_overlay_path),
        }
    return result


def analyze_single_image_with_debug_files(
    image_bytes: bytes,
    template_name: str | None = None,
    run_label: str | None = None,
) -> dict:
    cfg = get_template(template_name)
    img = _np_from_bytes(image_bytes)
    stage = preprocess_page(img, cfg)
    student = detect_student_code(stage["warped_thresholded"], cfg)
    qr_code, qr_raw = _detect_qr_sheet_code(stage.get("warped_full_page"), stage.get("warped_sheet"), stage.get("original"))
    answers, roi_overlay, final_overlay = detect_answers(stage["warped_thresholded"], stage["warped_sheet"], cfg)

    out_dir = create_debug_run_dir(run_label)

    original_path = out_dir / "original.png"
    grayscale_path = out_dir / "grayscale.png"
    threshold_path = out_dir / "threshold.png"
    contour_path = out_dir / "contour.png"
    outer_contour_path = out_dir / "detected_outer_page_contour.png"
    warped_full_path = out_dir / "warped_full_page.png"
    warped_path = out_dir / "warped.png"
    roi_overlay_path = out_dir / "roi_overlay.png"
    final_overlay_path = out_dir / "final_detection_overlay.png"

    write_png(original_path, stage["original"])
    write_png(grayscale_path, cv2.cvtColor(stage["grayscale"], cv2.COLOR_GRAY2BGR))
    write_png(threshold_path, cv2.cvtColor(stage["thresholded"], cv2.COLOR_GRAY2BGR))
    write_png(contour_path, stage["detected_sheet_contour"])
    write_png(outer_contour_path, stage["detected_outer_page_contour"])
    write_png(warped_full_path, stage["warped_full_page"])
    write_png(warped_path, stage["warped_sheet"])
    write_png(roi_overlay_path, roi_overlay)
    write_png(final_overlay_path, final_overlay)

    result = {
        "pageIndex": 0,
        "templateId": cfg.template_id,
        "roiMap": build_full_roi_map(cfg),
        "studentCode": qr_code or student["studentCode"],
        "studentCodeConfidence": float(student["confidence"]),
        "qrCodeRaw": qr_raw,
        "answers": answers[: cfg.total_questions],
        "needsReview": bool(
            (qr_code or student["studentCode"]) is None
            or any(
                a["status"] in {"uncertain", "multiple"} or float(a["confidence"]) < cfg.min_confidence
                for a in answers[: cfg.total_questions]
            )
        ),
        "errors": [],
        "debugImages": {
            "original": str(original_path),
            "grayscale": str(grayscale_path),
            "threshold": str(threshold_path),
            "contour": str(contour_path),
            "detected_outer_page_contour": str(outer_contour_path),
            "warped_full_page": str(warped_full_path),
            "warped": str(warped_path),
            "roi_overlay": str(roi_overlay_path),
            "final_detection_overlay": str(final_overlay_path),
        },
    }
    write_json(out_dir / "result.json", result)
    return result


def analyze_pdf_all_pages(pdf_bytes: bytes, template_name: str | None = None, include_debug: bool = True) -> dict:
    """تحليل كل صفحات PDF كصورة منفصلة (شيت لكل صفحة)."""
    pages = _read_pdf_pages(pdf_bytes, dpi=300)
    if not pages:
        raise ValueError("ملف PDF لا يحتوي صفحات قابلة للمعالجة.")
    cfg = get_template(template_name)
    results: list[dict] = []
    for idx, page_img in enumerate(pages):
        ok, enc = cv2.imencode(".png", page_img)
        if not ok:
            raise ValueError(f"تعذر ترميز الصفحة رقم {idx + 1}.")
        page_result = analyze_page_image(enc.tobytes(), template_name=template_name, include_debug=include_debug)
        page_result["pageIndex"] = idx
        if isinstance(page_result.get("answers"), list):
            page_result["answers"] = page_result["answers"][: cfg.total_questions]
        results.append(page_result)
    return {
        "totalPages": len(pages),
        "processedPages": len(results),
        "results": results,
        # للتأكد من أن العميل يتصل بنسخة تدعم كل الصفحات (يظهر في JSON)
        "engineTag": "pdf-all-pages",
    }


# اسم قديم لأي استيراد خارجي
analyze_pdf_first_page = analyze_pdf_all_pages
