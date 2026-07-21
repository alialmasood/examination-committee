from __future__ import annotations

import base64
import json
from pathlib import Path
from datetime import datetime

import cv2
import numpy as np

from config import DEBUG_DIR


def image_to_base64_png(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def write_png(path: Path, img: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def create_debug_run_dir(run_label: str | None = None) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = run_label or f"single-{stamp}"
    out_dir = DEBUG_DIR / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
