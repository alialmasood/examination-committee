from __future__ import annotations


def compare_answers(student_answers: list[dict], answer_key: dict[int, str] | dict[str, str]) -> dict:
    key = {int(k): str(v).strip().upper() for k, v in answer_key.items()}
    by_q = {int(a["questionNumber"]): a for a in student_answers}
    rows = []
    c = w = b = m = 0
    for q in sorted(key.keys()):
        a = by_q.get(q) or {}
        st = str(a.get("status", "blank")).lower()
        sel = a.get("selectedOption")
        if sel is not None:
            sel = str(sel).upper().strip()
        if st == "blank":
            result = "blank"
            b += 1
        elif st == "multiple":
            result = "multiple"
            m += 1
        elif sel == key[q]:
            result = "correct"
            c += 1
        else:
            result = "wrong"
            w += 1
        rows.append(
            {
                "questionNumber": q,
                "studentOption": sel,
                "correctOption": key[q],
                "result": result,
                "confidence": float(a.get("confidence", 0)),
            }
        )
    total = len(rows)
    score = c
    return {
        "totalQuestions": total,
        "correctCount": c,
        "wrongCount": w,
        "blankCount": b,
        "multipleCount": m,
        "score": score,
        "percentage": (score / total * 100) if total > 0 else 0,
        "questions": rows,
    }
