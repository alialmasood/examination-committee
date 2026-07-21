from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

from template_config import get_template
from preprocess import preprocess_page
from detect_student_code import detect_student_code
from detect_answers import detect_answers


def run_test(image_path: Path, out_dir: Path, template_name: str = "correction-exam-a4-v1") -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = get_template(template_name)

    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError(f"تعذر قراءة الصورة: {image_path}")

    stage = preprocess_page(img, cfg)
    student = detect_student_code(stage["warped_thresholded"], cfg)
    answers, roi_overlay, final_overlay = detect_answers(stage["warped_thresholded"], stage["warped_sheet"], cfg)

    cv2.imwrite(str(out_dir / "original.png"), stage["original"])
    cv2.imwrite(str(out_dir / "grayscale.png"), stage["grayscale"])
    cv2.imwrite(str(out_dir / "threshold.png"), stage["thresholded"])
    cv2.imwrite(str(out_dir / "contour.png"), stage["detected_sheet_contour"])
    cv2.imwrite(str(out_dir / "warped.png"), stage["warped_sheet"])
    cv2.imwrite(str(out_dir / "roi_overlay.png"), roi_overlay)
    cv2.imwrite(str(out_dir / "final_detection_overlay.png"), final_overlay)

    result = {
        "pageIndex": 0,
        "studentCode": student["studentCode"],
        "studentCodeConfidence": float(student["confidence"]),
        "answers": answers[:25],
        "needsReview": bool(
            student["studentCode"] is None
            or any(a["status"] in {"uncertain", "multiple"} or float(a["confidence"]) < cfg.min_confidence for a in answers[:25])
        ),
        "errors": [],
        "debugImages": [
            str(out_dir / "original.png"),
            str(out_dir / "grayscale.png"),
            str(out_dir / "threshold.png"),
            str(out_dir / "contour.png"),
            str(out_dir / "warped.png"),
            str(out_dir / "roi_overlay.png"),
            str(out_dir / "final_detection_overlay.png"),
        ],
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="اختبار OMR على صفحة واحدة فقط")
    parser.add_argument("--image", required=True, help="مسار صورة الشيت (صفحة واحدة)")
    parser.add_argument("--out", required=True, help="مجلد حفظ صور debug")
    parser.add_argument("--template", default="correction-exam-a4-v1", help="اسم القالب")
    parser.add_argument("--json-out", default="", help="ملف JSON للحفظ (اختياري)")
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    out_dir = Path(args.out).resolve()
    result = run_test(image_path=image_path, out_dir=out_dir, template_name=args.template)

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    print(payload)
    if args.json_out:
        Path(args.json_out).resolve().write_text(payload, encoding="utf-8")


if __name__ == "__main__":
    main()
