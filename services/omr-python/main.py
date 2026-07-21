from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from compare_answers import compare_answers
from omr_engine import analyze_image_post, analyze_page_image, analyze_pdf_all_pages
from schemas import ComparePayload


app = FastAPI(title="OMR Python Service", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True, "service": "omr-python"}


@app.post("/analyze-pdf")
async def analyze_pdf(
    examId: str = Form(...),
    templateName: str = Form("correction-exam-a4-v1"),
    file: UploadFile = File(...),
    debugMode: str = Form("1"),
):
    try:
        content = await file.read()
        out = analyze_pdf_all_pages(
            content,
            template_name=templateName,
            include_debug=debugMode == "1",
        )
        return {"success": True, "examId": examId, **out}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/analyze-page")
async def analyze_page(
    templateName: str = Form("correction-exam-a4-v1"),
    file: UploadFile = File(...),
    debugMode: str = Form("1"),
):
    try:
        content = await file.read()
        result = analyze_page_image(content, template_name=templateName, include_debug=debugMode == "1")
        return {"success": True, "result": result}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


def _analyze_image_error_payload(message: str) -> dict:
    return {
        "success": False,
        "studentCode": "",
        "answers": [],
        "needsReview": True,
        "errors": [message],
        "debugImages": {
            "original": "",
            "grayscale": "",
            "thresholded": "",
            "contour": "",
            "warped": "",
            "roiOverlay": "",
            "markedBubbles": "",
        },
    }


@app.post("/analyze-image")
async def analyze_image(
    file: UploadFile = File(...),
    templateName: str = Form("correction-exam-a4-v1"),
    debugMode: str = Form("0"),
    runLabel: str = Form(""),
):
    """
    صورة واحدة فقط — pipeline كامل (قالب ثابت + ROI + fill ratio)، بدون PDF.
    debugMode=1: يحفظ مراحل الصور على القرص ويعيد base64 في debugImages.
    """
    try:
        content = await file.read()
        return analyze_image_post(
            content,
            template_name=templateName,
            debug_mode=debugMode.strip() == "1",
            run_label=(runLabel.strip() or None),
        )
    except Exception as e:
        return JSONResponse(status_code=500, content=_analyze_image_error_payload(str(e)))


@app.post("/compare")
def compare(payload: ComparePayload):
    try:
        return {"success": True, "comparison": compare_answers(payload.studentAnswers, payload.answerKey)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

