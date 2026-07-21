from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from detect_answers import detect_answers
from detect_student_code import detect_student_code
from preprocess import preprocess_page
from template_config import TemplateConfig, get_template


def _load_expected(path: Path) -> dict[int, str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "answers" in raw and isinstance(raw["answers"], dict):
        raw = raw["answers"]
    out: dict[int, str] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        try:
            q = int(k)
        except Exception:
            continue
        ans = str(v or "").strip().upper()
        if q >= 1 and ans:
            out[q] = ans
    return out


def _np_from_image(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise ValueError(f"تعذر قراءة الصورة: {path}")
    return img


def _build_cfg(
    *,
    template_name: str,
    fill_threshold: float | None,
    blank_threshold: float | None,
    multiple_delta: float | None,
    min_confidence: float | None,
) -> TemplateConfig:
    cfg = get_template(template_name)
    return replace(
        cfg,
        fill_threshold=fill_threshold if fill_threshold is not None else cfg.fill_threshold,
        blank_threshold=blank_threshold if blank_threshold is not None else cfg.blank_threshold,
        multiple_mark_delta=multiple_delta if multiple_delta is not None else cfg.multiple_mark_delta,
        min_confidence=min_confidence if min_confidence is not None else cfg.min_confidence,
    )


def _evaluate_answers(answers: list[dict[str, Any]], expected: dict[int, str]) -> dict[str, Any]:
    total = len(expected)
    correct = 0
    wrong = 0
    blanks = 0
    multiple = 0
    uncertain = 0

    for q, exp in expected.items():
        row = next((a for a in answers if int(a.get("questionNumber", 0)) == q), None)
        if not row:
            wrong += 1
            continue
        status = str(row.get("status") or "")
        selected = row.get("selectedOption")
        if status == "blank":
            blanks += 1
            continue
        if status == "multiple":
            multiple += 1
            continue
        if status == "uncertain":
            uncertain += 1
        if selected == exp and status == "answered":
            correct += 1
        else:
            wrong += 1

    accuracy = (correct / total * 100.0) if total > 0 else 0.0
    return {
        "totalQuestions": total,
        "correctReads": correct,
        "wrongReads": wrong,
        "blanks": blanks,
        "multiple": multiple,
        "uncertain": uncertain,
        "accuracyPercentage": round(accuracy, 2),
    }


def _analyze_single(image_path: Path, cfg: TemplateConfig) -> dict[str, Any]:
    img = _np_from_image(image_path)
    stage = preprocess_page(img, cfg)
    student = detect_student_code(stage["warped_thresholded"], cfg)
    answers, _, _ = detect_answers(stage["warped_thresholded"], stage["warped_sheet"], cfg)
    return {
        "imagePath": str(image_path),
        "studentCode": student.get("studentCode") or "",
        "answers": answers[: cfg.total_questions],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="تحليل صور OMR مفردة + تقييم دقة القراءة")
    parser.add_argument("--images", nargs="+", required=True, help="مسارات الصور المراد تحليلها")
    parser.add_argument("--expected", required=True, help="ملف JSON للإجابات الصحيحة المتوقعة")
    parser.add_argument("--out", required=True, help="ملف JSON ناتج (تفصيلي)")
    parser.add_argument("--template", default="correction-exam-a4-v1", help="اسم القالب")
    parser.add_argument("--fill-threshold", type=float, default=None, help="تعديل fillThreshold")
    parser.add_argument("--blank-threshold", type=float, default=None, help="تعديل blankThreshold")
    parser.add_argument("--multiple-delta", type=float, default=None, help="تعديل multipleDelta")
    parser.add_argument("--min-confidence", type=float, default=None, help="تعديل minConfidence")
    args = parser.parse_args()

    expected = _load_expected(Path(args.expected).resolve())
    cfg = _build_cfg(
        template_name=args.template,
        fill_threshold=args.fill_threshold,
        blank_threshold=args.blank_threshold,
        multiple_delta=args.multiple_delta,
        min_confidence=args.min_confidence,
    )

    per_image: list[dict[str, Any]] = []
    agg_correct = agg_wrong = agg_blanks = agg_multiple = agg_uncertain = agg_total = 0

    for img_str in args.images:
        analyzed = _analyze_single(Path(img_str).resolve(), cfg)
        metrics = _evaluate_answers(analyzed["answers"], expected)
        per_image.append(
            {
                "imagePath": analyzed["imagePath"],
                "studentCode": analyzed["studentCode"],
                "answers": analyzed["answers"],
                "metrics": metrics,
            }
        )
        agg_total += int(metrics["totalQuestions"])
        agg_correct += int(metrics["correctReads"])
        agg_wrong += int(metrics["wrongReads"])
        agg_blanks += int(metrics["blanks"])
        agg_multiple += int(metrics["multiple"])
        agg_uncertain += int(metrics["uncertain"])

    aggregate_accuracy = (agg_correct / agg_total * 100.0) if agg_total > 0 else 0.0
    payload = {
        "template": cfg.template_id,
        "thresholds": {
            "fillThreshold": cfg.fill_threshold,
            "blankThreshold": cfg.blank_threshold,
            "multipleDelta": cfg.multiple_mark_delta,
            "minConfidence": cfg.min_confidence,
        },
        "expectedAnswersCount": len(expected),
        "results": per_image,
        "aggregate": {
            "totalQuestions": agg_total,
            "correctReads": agg_correct,
            "wrongReads": agg_wrong,
            "blanks": agg_blanks,
            "multiple": agg_multiple,
            "uncertain": agg_uncertain,
            "accuracyPercentage": round(aggregate_accuracy, 2),
        },
    }

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["aggregate"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
