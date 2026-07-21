"""
قراءة ضبط المعايرة من الواجهة (question_calibration_ui_overrides.json)
وتطبيقه على خريطة ROI للإجابات — نفس منطق الواجهة: إزاحة ثم تباعد أفقي حول وسط السؤال.
"""

from __future__ import annotations

import json
from pathlib import Path

_FILENAME = "question_calibration_ui_overrides.json"
_DEFAULT_TEMPLATE_CODE = "OMR_25"


def _normalize_template_code(template_name: str | None) -> str:
    v = str(template_name or "").strip().upper()
    mapping = {
        "CORRECTION-EXAM-A4-V1": "OMR_25",
        "CORRECTION-EXAM-A4-25Q-V1": "OMR_25",
        "CORRECTION-EXAM-A4-50Q-V1": "OMR_50",
        "CORRECTION-EXAM-A4-75Q-V1": "OMR_75",
        "CORRECTION-EXAM-A4-100Q-V1": "OMR_100",
    }
    if v in mapping:
        return mapping[v]
    return "".join(ch for ch in v if ch.isalnum() or ch in {"_", "-"}) or _DEFAULT_TEMPLATE_CODE


def overrides_path(template_name: str | None = None) -> Path:
    code = _normalize_template_code(template_name)
    if code in {"", _DEFAULT_TEMPLATE_CODE, "OMR25"}:
        return Path(__file__).resolve().parent / _FILENAME
    return Path(__file__).resolve().parent / f"question_calibration_ui_overrides.{code}.json"


def load_ui_overrides(template_name: str | None = None) -> dict[int, dict[str, object]]:
    path = overrides_path(template_name)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[int, dict[str, object]] = {}
    for ks, v in raw.items():
        if not isinstance(ks, str) or not ks.isdigit():
            continue
        q = int(ks)
        if not isinstance(v, dict):
            continue
        try:
            nx = float(v.get("nx", 0) or 0)
            ny = float(v.get("ny", 0) or 0)
            sp = float(v.get("spread", 1) or 1)
        except (TypeError, ValueError):
            continue
        if sp <= 0:
            sp = 1.0
        row_d: dict[str, object] = {"nx": nx, "ny": ny, "spread": sp}
        letters_raw = v.get("letters")
        if isinstance(letters_raw, dict):
            letters: dict[str, dict[str, float]] = {}
            for L in ("A", "B", "C", "D"):
                ent = letters_raw.get(L)
                if not isinstance(ent, dict):
                    continue
                try:
                    lnx = float(ent.get("nx", 0) or 0)
                    lny = float(ent.get("ny", 0) or 0)
                except (TypeError, ValueError):
                    continue
                letters[str(L)] = {"nx": lnx, "ny": lny}
            if letters:
                row_d["letters"] = letters
        out[q] = row_d
    return out


def load_student_code_column_ui_overrides(template_name: str | None = None) -> dict[int, dict[str, float]]:
    """أعمدة كود الورقة (0..4): nx/ny إزاحة العمود كاملاً، spread تباعد رأسي حول وسط العمود (مثل تباعد الإجابات أفقيًا)."""
    path = overrides_path(template_name)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    sc = raw.get("studentCodeColumns")
    if not isinstance(sc, dict):
        return {}
    out: dict[int, dict[str, float | int]] = {}
    for ks, v in sc.items():
        if not isinstance(ks, str) or not ks.isdigit():
            continue
        col = int(ks)
        if col < 0 or col > 4:
            continue
        if not isinstance(v, dict):
            continue
        try:
            nx = float(v.get("nx", 0) or 0)
            ny = float(v.get("ny", 0) or 0)
            sp = float(v.get("spread", 1) or 1)
        except (TypeError, ValueError):
            continue
        if sp <= 0:
            sp = 1.0
        row_d: dict[str, float | int] = {"nx": nx, "ny": ny, "spread": sp}
        tf_raw = v.get("tailFromDigit")
        tail_from: int | None = None
        if tf_raw is not None and not isinstance(tf_raw, bool):
            try:
                tfi = int(float(tf_raw))
                if 0 <= tfi <= 9:
                    tail_from = tfi
            except (TypeError, ValueError):
                pass
        if tail_from is not None:
            row_d["tailFromDigit"] = tail_from
        try:
            row_d["tailExtraNy"] = float(v.get("tailExtraNy", 0) or 0)
        except (TypeError, ValueError):
            row_d["tailExtraNy"] = 0.0
        out[col] = row_d
    return out


def apply_ui_overrides_to_student_code_roi_map(
    col_map: dict[int, dict[int, tuple[float, float]]],
    *,
    template_name: str | None = None,
    overrides: dict[int, dict[str, float | int]] | None = None,
) -> dict[int, dict[int, tuple[float, float]]]:
    ovs = overrides if overrides is not None else load_student_code_column_ui_overrides(template_name)
    if not ovs:
        return col_map
    out: dict[int, dict[int, tuple[float, float]]] = {
        c: {d: (float(p[0]), float(p[1])) for d, p in col.items()} for c, col in col_map.items()
    }
    for col_idx, delta in ovs.items():
        if col_idx not in out:
            continue
        row = out[col_idx]
        digits = sorted(row.keys())
        if len(digits) != 10:
            continue
        dnx = float(delta.get("nx", 0) or 0)
        dny = float(delta.get("ny", 0) or 0)
        spread = float(delta.get("spread", 1) or 1)
        if spread <= 0:
            spread = 1.0
        tail_extra = float(delta.get("tailExtraNy", 0) or 0)
        tf_raw = delta.get("tailFromDigit")
        tail_from: int | None = None
        if tf_raw is not None and not isinstance(tf_raw, bool):
            try:
                tfx = int(float(tf_raw))
                if 0 <= tfx <= 9:
                    tail_from = tfx
            except (TypeError, ValueError):
                tail_from = None

        base_pts = {d: (float(row[d][0]), float(row[d][1])) for d in digits}

        if tail_from is None:
            translated = [(base_pts[d][0] + dnx, base_pts[d][1] + dny) for d in digits]
            cy = sum(t[1] for t in translated) / 10.0
            for i, d in enumerate(digits):
                tnx = float(translated[i][0])
                tny = float(cy + (translated[i][1] - cy) * spread)
                row[d] = (tnx, tny)
            continue

        # رأس العمود: إزاحة فقط (بدون تباعد رأسي جماعي). الذيل: تباعد حول وسط الذيل + إزاحة إضافية لأسفل.
        for d in digits:
            if d < tail_from:
                row[d] = (base_pts[d][0] + dnx, base_pts[d][1] + dny)
        tail_ds = [d for d in digits if d >= tail_from]
        if not tail_ds:
            continue
        translated = [(base_pts[d][0] + dnx, base_pts[d][1] + dny) for d in tail_ds]
        cy_tail = sum(t[1] for t in translated) / float(len(translated))
        for i, d in enumerate(tail_ds):
            tnx = float(translated[i][0])
            tny = float(cy_tail + (translated[i][1] - cy_tail) * spread + tail_extra)
            row[d] = (tnx, tny)
    return out


def apply_ui_overrides_to_answer_roi_map(
    answer_map: dict[int, dict[str, tuple[float, float]]],
    options: tuple[str, ...],
    *,
    template_name: str | None = None,
    overrides: dict[int, dict[str, object]] | None = None,
) -> dict[int, dict[str, tuple[float, float]]]:
    """نسخة جديدة من الخريطة مع تطبيق الضبط المحفوظ لكل سؤال موجود في الملف."""
    ovs = overrides if overrides is not None else load_ui_overrides(template_name)
    if not ovs:
        return answer_map
    letters_order = list(options[:4])
    out: dict[int, dict[str, tuple[float, float]]] = {q: dict(letters) for q, letters in answer_map.items()}
    for q, delta in ovs.items():
        if q not in out:
            continue
        row = out[q]
        if not all(let in row for let in letters_order):
            continue
        dnx = float(delta.get("nx", 0) or 0)
        dny = float(delta.get("ny", 0) or 0)
        spread = float(delta.get("spread", 1) or 1)
        if spread <= 0:
            spread = 1.0
        pts = [row[let] for let in letters_order]
        translated = [(p[0] + dnx, p[1] + dny) for p in pts]
        cx = sum(t[0] for t in translated) / 4.0
        for i, let in enumerate(letters_order):
            tnx = cx + (translated[i][0] - cx) * spread
            tny = translated[i][1]
            row[let] = (float(tnx), float(tny))
        letters = delta.get("letters")
        if isinstance(letters, dict):
            for let in letters_order:
                ent = letters.get(let)
                if not isinstance(ent, dict):
                    continue
                try:
                    lnx = float(ent.get("nx", 0) or 0)
                    lny = float(ent.get("ny", 0) or 0)
                except (TypeError, ValueError):
                    continue
                cur = row.get(let)
                if not cur:
                    continue
                row[let] = (float(cur[0] + lnx), float(cur[1] + lny))
    return out
