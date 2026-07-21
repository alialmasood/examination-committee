from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import random

import cv2

from detect_answers import detect_answers
from preprocess import preprocess_page
from template_config import get_template


def _predict_from_scores(scores: dict[str, float], blank_threshold: float, min_gap: float) -> str:
    ordered = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    if not ordered:
        return ""
    best_opt, best_score = ordered[0]
    second = float(ordered[1][1]) if len(ordered) > 1 else 0.0
    if float(best_score) < blank_threshold:
        return ""
    if float(best_score - second) < min_gap:
        return ""
    return best_opt


def main() -> None:
    # Ground truth confirmed with user for this sheet
    expected = {
        1: "A",
        2: "B",
        3: "C",
        4: "C",
        5: "A",
        6: "B",
        7: "",
        8: "",
        9: "C",
        10: "D",
        11: "C",
        12: "D",
        13: "D",
        14: "C",
        15: "B",
        16: "D",
        17: "B",
        18: "B",
        19: "C",
        20: "C",
        21: "B",
        22: "B",
        23: "B",
        24: "D",
        25: "C",
    }

    img_path = Path(
        r"C:\Users\NARUTO\.cursor\projects\d-projects-Examinationcommittee-systimit\assets\c__Users_NARUTO_AppData_Roaming_Cursor_User_workspaceStorage_766766d8018dde4de1ddefc0b7e05082_images_tasheh1-d642d2c0-d5d0-41a9-a80e-9802395ec08a.png"
    )
    img = cv2.imread(str(img_path))
    if img is None:
        raise ValueError(f"Cannot read image: {img_path}")

    base = get_template("correction-exam-a4-v1")
    stage = preprocess_page(img, base)
    warped_thr = stage["warped_thresholded"]
    warped_sheet = stage["warped_sheet"]

    best = None
    # Disable row-specific custom deltas during search for stable global fit
    common = dict(
        answer_last_row_ny_delta=0.0,
        answer_last_row_nx_delta=0.0,
        answer_row_q21_24_ny_delta=0.0,
        answer_row_q21_24_nx_delta=0.0,
        answer_row_q17_20_ny_delta=0.0,
        answer_row_q13_16_ny_delta=0.0,
        answer_row_q9_12_ny_delta=0.0,
    )
    rng = random.Random(42)
    for _ in range(12000):
        base_nx = round(rng.uniform(0.045, 0.075), 4)
        col_step = round(rng.uniform(0.205, 0.235), 4)
        letter_offset = round(rng.uniform(0.075, 0.115), 4)
        letter_step = round(rng.uniform(0.032, 0.036), 4)
        grid_top = round(rng.uniform(0.36, 0.41), 4)
        row_step = round(rng.uniform(0.045, 0.065), 4)
        bubble_y = round(rng.uniform(0.028, 0.045), 4)
        blank_th = round(rng.uniform(0.03, 0.08), 4)
        min_gap = round(rng.uniform(0.01, 0.03), 4)
        cfg = replace(
            base,
            answer_base_nx=base_nx,
            answer_col_step=col_step,
            answer_letter_offset_x=letter_offset,
            answer_letter_step=letter_step,
            answer_grid_top_ny=grid_top,
            answer_row_step=row_step,
            answer_bubble_offset_y=bubble_y,
            **common,
        )
        answers, _, _ = detect_answers(warped_thr, warped_sheet, cfg)
        pred = {
            int(a["questionNumber"]): _predict_from_scores(a["bubbleScores"], blank_th, min_gap)
            for a in answers[:25]
        }
        correct = sum(1 for q in range(1, 26) if pred.get(q, "") == expected[q])
        score = (
            correct,
            -abs(base_nx - base.answer_base_nx),
            -abs(col_step - base.answer_col_step),
            -abs(letter_offset - base.answer_letter_offset_x),
            -abs(grid_top - base.answer_grid_top_ny),
            -abs(row_step - base.answer_row_step),
        )
        if best is None or score > best[0]:
            best = (
                score,
                correct,
                base_nx,
                col_step,
                letter_offset,
                letter_step,
                grid_top,
                row_step,
                bubble_y,
                blank_th,
                min_gap,
                pred,
            )

    assert best is not None
    (
        _,
        correct,
        best_base_nx,
        best_col_step,
        best_off,
        best_step,
        best_grid_top,
        best_row_step,
        best_bubble_y,
        best_blank,
        best_gap,
        pred,
    ) = best
    print("best_correct", correct, "/25")
    print("best_answer_base_nx", best_base_nx)
    print("best_answer_col_step", best_col_step)
    print("best_letter_offset_x", best_off)
    print("best_letter_step", best_step)
    print("best_grid_top_ny", best_grid_top)
    print("best_row_step", best_row_step)
    print("best_bubble_offset_y", best_bubble_y)
    print("best_blank_threshold", best_blank)
    print("best_min_gap", best_gap)
    print("pred", pred)


if __name__ == "__main__":
    main()
