"""
قالب OMR ثابت — معايرة عملية.

كل الإحداثيات normalized (0..1) بالنسبة لعرض/ارتفاع الصفحة *بعد*
التصحيح المنظور والتحجيم إلى الحجم القياسي (PAGE_WIDTH × PAGE_HEIGHT).

عدّل الأقسام أدناه ثم شغّل:
  python run_single_page_calibration.py --image path/to/sheet.png --out output/calib-run-1

مطابقة الإدخال (صورة/PDF) مع نسبة هذه اللوحة تتم تلقائياً في preprocess (حشو بيض حتى تصبح نسبة الارتفاع/العرض = PAGE_HEIGHT/PAGE_WIDTH)
قبل اكتشاف حدود الصفحة — يقلل خطأ المواقع عند اختلاف إطار الكاميرا أو اقتصاص PDF.
"""

from __future__ import annotations

from dataclasses import dataclass

from calibration_ui_overrides import (
    apply_ui_overrides_to_answer_roi_map,
    apply_ui_overrides_to_student_code_roi_map,
)

# =============================================================================
# 1) حجم الصفحة القياسي (بكسل) — يجب أن يطابق preprocess.resize
# =============================================================================
PAGE_WIDTH = 2480
PAGE_HEIGHT = 3508

# =============================================================================
# 2) عتبات القرار (bubble fill ratio بين 0 و 1)
#
#    BLANK_THRESHOLD: إذا أعلى نسبة < هذا → فارغ
#    MULTIPLE_MARK_DELTA: إذا (الأعلى − الثاني) < هذا → multiple
#    MIN_CONFIDENCE: حد أدنى للثقة لقبول answered / ok
#    FILL_THRESHOLD: محجوز للتوسع (يُنسخ لحقل fill_threshold في القالب)
# =============================================================================
FILL_THRESHOLD = 0.07
BLANK_THRESHOLD = 0.03
# عتبة فرق (الأعلى − الثاني)؛ قيمة أعلى = تسامح أكثر مع ضوضاء المسح (يقل «متعدد» خاطئ).
MULTIPLE_MARK_DELTA = 0.022
MIN_CONFIDENCE = 0.03

# =============================================================================
# 3) فقاعة — نصف قطر نسبي وكسر قناع داخلي لحساب fill ratio
# =============================================================================
BUBBLE_RADIUS_NORM = 13 / 1700
INNER_MASK_RADIUS_FRACTION = 0.68

# =============================================================================
# 4) رمز الطالب (ROI) — أعمدة nx ثابتة + شبكة أرقام رأسية
#    لكل عمود: ny = STUDENT_CODE_Y0 + digit * STUDENT_CODE_Y_STEP (digit 0..9)
# =============================================================================
STUDENT_CODE_X_CENTERS = [0.652, 0.706, 0.760, 0.814, 0.868]
STUDENT_CODE_Y0 = 0.178
STUDENT_CODE_Y_STEP = 0.0194

# =============================================================================
# 5) الإجابات (ROI) — 25 سؤالًا، 4 أعمدة أسئلة × صفوف
# =============================================================================
TOTAL_QUESTIONS = 25
FIXED_OPTIONS = ("A", "B", "C", "D")

ANSWER_BASE_NX = 0.0524
ANSWER_COL_STEP = 0.2154
ANSWER_LETTER_STEP = 0.0347
ANSWER_LETTER_OFFSET_X = 0.0878
ANSWER_BUBBLE_OFFSET_Y = 0.0379
ANSWER_ROW_STEP = 0.0484
ANSWER_GRID_TOP_NY = 0.3817
# إزاحة ny للصف الأخير فقط (س25 عند TOTAL_QUESTIONS=25). سالب = رفع الدوائر، موجب = إنزالها.
ANSWER_LAST_ROW_NY_DELTA = -0.0015
# إزاحة nx للصف الأخير فقط (يمين الورقة = موجب، يسار = سالب).
ANSWER_LAST_ROW_NX_DELTA = 0.0
# إزاحة ny لصف الأسئلة 21–24 فقط (row=5 بأربعة أعمدة) عندما يوجد صف بعده (مثلاً س25). سالب = رفع.
ANSWER_ROW_Q21_24_NY_DELTA = -0.0015
# إزاحة nx لصف الأسئلة 21–24 فقط (يمين الورقة = موجب، يسار = سالب).
ANSWER_ROW_Q21_24_NX_DELTA = 0.0
# إزاحة ny لصف الأسئلة 17–20 فقط (row=4) عندما يوجد صف بعده. سالب = رفع.
ANSWER_ROW_Q17_20_NY_DELTA = -0.0015
# إزاحة ny لصف الأسئلة 13–16 فقط (row=3) عندما يوجد صف بعده. سالب = رفع.
ANSWER_ROW_Q13_16_NY_DELTA = 0.0
# إزاحة ny لصف الأسئلة 9–12 فقط (row=2) عندما يوجد صف بعده. سالب = رفع.
ANSWER_ROW_Q9_12_NY_DELTA = 0.0
# إزاحة موحّدة لكل فقاعات الإجابات (بعد معايرة الواجهة لكل سؤال) — للمسح الذي يزحف قليلًا عن empetyfofm.jpg
ANSWER_GLOBAL_NX_SHIFT = 0.0
ANSWER_GLOBAL_NY_SHIFT = 0.0


@dataclass(frozen=True)
class TemplateConfig:
    template_id: str
    page_width: int
    page_height: int
    total_questions: int
    bubble_radius_norm: float
    inner_mask_radius_fraction: float
    fill_threshold: float
    blank_threshold: float
    multiple_mark_delta: float
    min_confidence: float
    student_code_x_centers: tuple[float, ...]
    student_code_y0: float
    student_code_y_step: float
    answer_base_nx: float
    answer_col_step: float
    answer_letter_step: float
    answer_letter_offset_x: float
    answer_bubble_offset_y: float
    answer_row_step: float
    answer_grid_top_ny: float
    answer_last_row_ny_delta: float
    answer_last_row_nx_delta: float
    answer_row_q21_24_ny_delta: float
    answer_row_q21_24_nx_delta: float
    answer_row_q17_20_ny_delta: float
    answer_row_q13_16_ny_delta: float
    answer_row_q9_12_ny_delta: float
    answer_global_nx_shift: float
    answer_global_ny_shift: float
    options: tuple[str, ...]


DEFAULT_TEMPLATE = TemplateConfig(
    template_id="correction-exam-a4-v1",
    page_width=PAGE_WIDTH,
    page_height=PAGE_HEIGHT,
    total_questions=TOTAL_QUESTIONS,
    bubble_radius_norm=BUBBLE_RADIUS_NORM,
    inner_mask_radius_fraction=INNER_MASK_RADIUS_FRACTION,
    fill_threshold=FILL_THRESHOLD,
    blank_threshold=BLANK_THRESHOLD,
    multiple_mark_delta=MULTIPLE_MARK_DELTA,
    min_confidence=MIN_CONFIDENCE,
    student_code_x_centers=tuple(STUDENT_CODE_X_CENTERS),
    student_code_y0=STUDENT_CODE_Y0,
    student_code_y_step=STUDENT_CODE_Y_STEP,
    answer_base_nx=ANSWER_BASE_NX,
    answer_col_step=ANSWER_COL_STEP,
    answer_letter_step=ANSWER_LETTER_STEP,
    answer_letter_offset_x=ANSWER_LETTER_OFFSET_X,
    answer_bubble_offset_y=ANSWER_BUBBLE_OFFSET_Y,
    answer_row_step=ANSWER_ROW_STEP,
    answer_grid_top_ny=ANSWER_GRID_TOP_NY,
    answer_last_row_ny_delta=ANSWER_LAST_ROW_NY_DELTA,
    answer_last_row_nx_delta=ANSWER_LAST_ROW_NX_DELTA,
    answer_row_q21_24_ny_delta=ANSWER_ROW_Q21_24_NY_DELTA,
    answer_row_q21_24_nx_delta=ANSWER_ROW_Q21_24_NX_DELTA,
    answer_row_q17_20_ny_delta=ANSWER_ROW_Q17_20_NY_DELTA,
    answer_row_q13_16_ny_delta=ANSWER_ROW_Q13_16_NY_DELTA,
    answer_row_q9_12_ny_delta=ANSWER_ROW_Q9_12_NY_DELTA,
    answer_global_nx_shift=ANSWER_GLOBAL_NX_SHIFT,
    answer_global_ny_shift=ANSWER_GLOBAL_NY_SHIFT,
    options=FIXED_OPTIONS,
)

_TEMPLATE_VARIANTS: dict[str, int] = {
    "correction-exam-a4-v1": 25,
    "correction-exam-a4-25q-v1": 25,
    "correction-exam-a4-50q-v1": 50,
    "correction-exam-a4-75q-v1": 75,
    "correction-exam-a4-100q-v1": 100,
}

_TEMPLATE_VARIANT_GLOBAL_SHIFT: dict[str, tuple[float, float]] = {
    # نموذج 100 سؤال يبدأ بصريًا من موضع يقارب سطر 26 على لوحة 25 سؤال القديمة.
    # نرفع الشبكة 6 صفوف (كل صف = 4 أسئلة) لإرجاع البداية لأعلى الورقة.
    "correction-exam-a4-100q-v1": (0.0, -(ANSWER_ROW_STEP * 6.0)),
}


def _clone_template_with_question_count(
    base: TemplateConfig,
    template_id: str,
    total_questions: int,
    global_shift: tuple[float, float] = (0.0, 0.0),
) -> TemplateConfig:
    n_q = max(1, min(100, int(total_questions)))
    gx, gy = global_shift
    return TemplateConfig(
        template_id=template_id,
        page_width=base.page_width,
        page_height=base.page_height,
        total_questions=n_q,
        bubble_radius_norm=base.bubble_radius_norm,
        inner_mask_radius_fraction=base.inner_mask_radius_fraction,
        fill_threshold=base.fill_threshold,
        blank_threshold=base.blank_threshold,
        multiple_mark_delta=base.multiple_mark_delta,
        min_confidence=base.min_confidence,
        student_code_x_centers=base.student_code_x_centers,
        student_code_y0=base.student_code_y0,
        student_code_y_step=base.student_code_y_step,
        answer_base_nx=base.answer_base_nx,
        answer_col_step=base.answer_col_step,
        answer_letter_step=base.answer_letter_step,
        answer_letter_offset_x=base.answer_letter_offset_x,
        answer_bubble_offset_y=base.answer_bubble_offset_y,
        answer_row_step=base.answer_row_step,
        answer_grid_top_ny=base.answer_grid_top_ny,
        answer_last_row_ny_delta=base.answer_last_row_ny_delta,
        answer_last_row_nx_delta=base.answer_last_row_nx_delta,
        answer_row_q21_24_ny_delta=base.answer_row_q21_24_ny_delta,
        answer_row_q21_24_nx_delta=base.answer_row_q21_24_nx_delta,
        answer_row_q17_20_ny_delta=base.answer_row_q17_20_ny_delta,
        answer_row_q13_16_ny_delta=base.answer_row_q13_16_ny_delta,
        answer_row_q9_12_ny_delta=base.answer_row_q9_12_ny_delta,
        answer_global_nx_shift=base.answer_global_nx_shift + float(gx),
        answer_global_ny_shift=base.answer_global_ny_shift + float(gy),
        options=base.options,
    )


def get_template(template_name: str | None = None) -> TemplateConfig:
    if not template_name:
        return DEFAULT_TEMPLATE
    key = str(template_name).strip().lower()
    matched_count = _TEMPLATE_VARIANTS.get(key)
    if matched_count is None:
        return DEFAULT_TEMPLATE
    shift = _TEMPLATE_VARIANT_GLOBAL_SHIFT.get(key, (0.0, 0.0))
    return _clone_template_with_question_count(DEFAULT_TEMPLATE, str(template_name), matched_count, shift)


def build_student_code_roi_map(cfg: TemplateConfig) -> dict[int, dict[int, tuple[float, float]]]:
    """عمود → رقم 0..9 → (nx, ny) مركز الفقاعة normalized."""
    out: dict[int, dict[int, tuple[float, float]]] = {}
    for col_idx, nx in enumerate(cfg.student_code_x_centers):
        out[col_idx] = {}
        for digit in range(10):
            ny = cfg.student_code_y0 + digit * cfg.student_code_y_step
            out[col_idx][digit] = (float(nx), float(ny))
    return apply_ui_overrides_to_student_code_roi_map(out, template_name=cfg.template_id)


def build_study_mode_roi_map() -> dict[str, tuple[float, float]]:
    return {
        "morning": (0.335, 0.279),
        "evening": (0.239, 0.279),
    }


def build_answer_roi_map(cfg: TemplateConfig) -> dict[int, dict[str, tuple[float, float]]]:
    """سؤال → خيار → (nx, ny) مركز الفقاعة normalized."""
    out: dict[int, dict[str, tuple[float, float]]] = {}
    last_row = (cfg.total_questions - 1) // 4
    row_q21_24 = (21 - 1) // 4  # صف يضم 21..24 بتخطيط 4 أعمدة
    row_q17_20 = (17 - 1) // 4  # صف يضم 17..20
    row_q13_16 = (13 - 1) // 4  # صف يضم 13..16
    row_q9_12 = (9 - 1) // 4  # صف يضم 9..12
    for q in range(1, cfg.total_questions + 1):
        idx = q - 1
        col = idx % 4
        row = idx // 4
        base_x = cfg.answer_base_nx + col * cfg.answer_col_step + cfg.answer_letter_offset_x
        ny = cfg.answer_grid_top_ny + row * cfg.answer_row_step + cfg.answer_bubble_offset_y
        if row == last_row:
            ny += cfg.answer_last_row_ny_delta
        elif row == row_q21_24 and last_row > row_q21_24:
            ny += cfg.answer_row_q21_24_ny_delta
        elif row == row_q17_20 and last_row > row_q17_20:
            ny += cfg.answer_row_q17_20_ny_delta
        elif row == row_q13_16 and last_row > row_q13_16:
            ny += cfg.answer_row_q13_16_ny_delta
        elif row == row_q9_12 and last_row > row_q9_12:
            ny += cfg.answer_row_q9_12_ny_delta
        nx_last = cfg.answer_last_row_nx_delta if row == last_row else 0.0
        nx_q21_24 = cfg.answer_row_q21_24_nx_delta if row == row_q21_24 and last_row > row_q21_24 else 0.0
        out[q] = {
            cfg.options[0]: (base_x + 0 * cfg.answer_letter_step + nx_last + nx_q21_24, ny),
            cfg.options[1]: (base_x + 1 * cfg.answer_letter_step + nx_last + nx_q21_24, ny),
            cfg.options[2]: (base_x + 2 * cfg.answer_letter_step + nx_last + nx_q21_24, ny),
            cfg.options[3]: (base_x + 3 * cfg.answer_letter_step + nx_last + nx_q21_24, ny),
        }
    mapped = apply_ui_overrides_to_answer_roi_map(out, cfg.options, template_name=cfg.template_id)
    gx = float(cfg.answer_global_nx_shift)
    gy = float(cfg.answer_global_ny_shift)
    if gx != 0.0 or gy != 0.0:
        for q in mapped:
            for let in mapped[q]:
                nx, ny = mapped[q][let]
                mapped[q][let] = (nx + gx, ny + gy)
    return mapped


def build_full_roi_map(cfg: TemplateConfig) -> dict:
    return {
        "studentCode": build_student_code_roi_map(cfg),
        "studyMode": build_study_mode_roi_map(),
        "answers": build_answer_roi_map(cfg),
    }
