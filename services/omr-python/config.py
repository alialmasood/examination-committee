from __future__ import annotations

from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = SERVICE_ROOT / "output"
DEBUG_DIR = OUTPUT_DIR / "debug"

# canonical A4 at 300dpi
CANONICAL_A4_WIDTH = 2480
CANONICAL_A4_HEIGHT = 3508

# preprocessing defaults
GAUSSIAN_BLUR_KERNEL = (5, 5)
ADAPTIVE_BLOCK_SIZE = 31
ADAPTIVE_C = 7
