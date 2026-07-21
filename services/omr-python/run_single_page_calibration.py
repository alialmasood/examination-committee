"""
معايرة شيت واحد — تشغيل pipeline كامل، حفظ صور debug، وطباعة تفاصيل كل سؤال.

الاستخدام (--image يجب أن يكون مسار ملف حقيقي على جهازك، وليس نصًا توضيحيًا):
  cd services/omr-python
  python run_single_page_calibration.py --image debug-runs/single-page-test-1/original.png --out output/calib-my-run

يحفظ:
  original.png, grayscale.png, thresholded.png, contour.png
  detected_outer_page_contour.png, warped_full_page.png, warpedSheet.png
  roiOverlay.png (دوائر من المحرك)
  roi_overlay_rectangles.png (مستطيلات معايرة من calibration_viz)
  markedBubbles.png (من المحرك)
  marked_bubbles_labeled.png (نص قرار لكل سؤال)
  result.json (بدون حقول base64 ضخمة)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

from calibration_viz import build_marked_bubbles_with_labels, build_roi_overlay_rectangles
from template_config import get_template
from detect_answers import detect_answers
from detect_student_code import detect_student_code
from omr_engine import analyze_image_post
from preprocess import preprocess_page


def _write_bgr(path: Path, img: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def _write_gray_as_bgr(path: Path, gray: np.ndarray) -> None:
    if gray.ndim == 2:
        bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    else:
        bgr = gray
    _write_bgr(path, bgr)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="معايرة OMR على صورة شيت واحدة")
    parser.add_argument(
        "--image",
        required=True,
        type=Path,
        metavar="FILE",
        help="مسار ملف صورة الشيت (PNG/JPEG…) — ملف موجود فعليًا، مثال: debug-runs/single-page-test-1/original.png",
    )
    parser.add_argument("--out", required=True, type=Path, help="مجلد حفظ المخرجات")
    parser.add_argument("--template", default="correction-exam-a4-v1", help="اسم القالب (حاليًا قالب واحد)")
    args = parser.parse_args()

    image_path: Path = args.image.expanduser().resolve()
    out_dir: Path = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not image_path.is_file():
        raise SystemExit(
            "الملف غير موجود.\n"
            "  استخدم مسار صورة حقيقي على القرص؛ القيمة `path/to/sheet.png` في الوثائق كانت مثالًا فقط وليست مسارًا جاهزًا.\n"
            f"  المطلوب: ملف موجود\n"
            f"  المستلم: {image_path}\n"
            "مثال من هذا المشروع:\n"
            "  python run_single_page_calibration.py --image debug-runs/single-page-test-1/original.png --out output/calib-1"
        )

    raw = cv2.imread(str(image_path))
    if raw is None:
        raise SystemExit(
            f"تعذر فتح الصورة (صيغة غير مدعومة أو ملف تالف): {image_path}\n"
            "جرّب PNG أو JPEG."
        )

    ok, buf = cv2.imencode(".png", raw)
    if not ok:
        raise SystemExit("تعذر ترميز الصورة كـ PNG")
    image_bytes = buf.tobytes()

    cfg = get_template(args.template)
    stage = preprocess_page(raw, cfg)

    # --- حفظ مراحل الصورة (نفس تسلسل المعالجة) ---
    _write_bgr(out_dir / "original.png", stage["original"])
    _write_gray_as_bgr(out_dir / "grayscale.png", stage["grayscale"])
    _write_gray_as_bgr(out_dir / "thresholded.png", stage["thresholded"])
    _write_bgr(out_dir / "contour.png", stage["detected_sheet_contour"])
    _write_bgr(out_dir / "detected_outer_page_contour.png", stage["detected_outer_page_contour"])
    _write_bgr(out_dir / "warped_full_page.png", stage["warped_full_page"])
    _write_bgr(out_dir / "warpedSheet.png", stage["warped_sheet"])

    warped_thr = stage["warped_thresholded"]
    warped_sheet = stage["warped_sheet"]

    student = detect_student_code(warped_thr, cfg)
    answers, roi_overlay, marked = detect_answers(warped_thr, warped_sheet, cfg)

    _write_bgr(out_dir / "roiOverlay.png", roi_overlay)
    _write_bgr(out_dir / "markedBubbles.png", marked)

    roi_rect = build_roi_overlay_rectangles(warped_sheet, cfg)
    _write_bgr(out_dir / "roi_overlay_rectangles.png", roi_rect)

    marked_labeled = build_marked_bubbles_with_labels(warped_sheet, answers, cfg)
    _write_bgr(out_dir / "marked_bubbles_labeled.png", marked_labeled)

    trimmed = answers[: cfg.total_questions]
    code_str = student.get("studentCode") or ""
    needs_review = (student.get("studentCode") is None) or any(
        a["status"] in {"uncertain", "multiple"} or float(a["confidence"]) < cfg.min_confidence for a in trimmed
    )

    payload = {
        "success": True,
        "templateId": cfg.template_id,
        "studentCode": code_str,
        "studentCodeConfidence": float(student.get("confidence", 0.0)),
        "studentCodeDigits": student.get("digits"),
        "needsReview": bool(needs_review),
        "answers": trimmed,
        "errors": [],
        "savedImages": {k: str(out_dir / k) for k in [
            "original.png",
            "grayscale.png",
            "thresholded.png",
            "contour.png",
            "detected_outer_page_contour.png",
            "warped_full_page.png",
            "warpedSheet.png",
            "roiOverlay.png",
            "roi_overlay_rectangles.png",
            "markedBubbles.png",
            "marked_bubbles_labeled.png",
        ]},
    }
    (out_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # --- طباعة ملخص JSON كامل من analyze_image_post (للتطابق مع الـ API) ---
    api_like = analyze_image_post(image_bytes, template_name=args.template, debug_mode=False)
    print("\n========== analyze_image_post (مثل /analyze-image) ==========")
    print(json.dumps({k: v for k, v in api_like.items() if k != "debugImages"}, ensure_ascii=False, indent=2))

    print("\n========== كل سؤال (تفاصيل المعايرة) ==========")
    for a in trimmed:
        print("-" * 60)
        print(f"questionNumber: {a['questionNumber']}")
        print(f"selectedOption: {a.get('selectedOption')!r}")
        print(f"status:         {a.get('status')}")
        print(f"confidence:     {a.get('confidence')}")
        print(f"bubbleScores:   {json.dumps(a.get('bubbleScores'), ensure_ascii=False)}")

    print("\n========== ملخص ==========")
    print(f"studentCode: {code_str!r}  (confidence={student.get('confidence')})")
    print(f"needsReview: {needs_review}")
    print(f"تم الحفظ في: {out_dir}")


if __name__ == "__main__":
    main()
