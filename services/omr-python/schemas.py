from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


AnswerStatus = Literal["answered", "blank", "multiple", "uncertain"]


class AnswerItem(BaseModel):
    questionNumber: int
    selectedOption: str | None
    status: AnswerStatus
    confidence: float = Field(ge=0.0, le=1.0)
    bubbleScores: dict[str, float]


class StudentDigitDetection(BaseModel):
    columnIndex: int
    detectedDigit: int | None
    confidence: float = Field(ge=0.0, le=1.0)
    scores: dict[int, float]
    status: Literal["ok", "blank", "multiple", "uncertain"]


class StudentCodeDetection(BaseModel):
    studentCode: str | None
    digits: list[StudentDigitDetection]
    confidence: float = Field(ge=0.0, le=1.0)


class AnalyzeImageResult(BaseModel):
    pageIndex: int = 0
    studentCode: str | None
    studentCodeConfidence: float = Field(ge=0.0, le=1.0)
    studentCodeDetection: StudentCodeDetection | None = None
    answers: list[AnswerItem]
    needsReview: bool
    errors: list[str]
    debugImages: dict[str, str] | list[str]


class ComparePayload(BaseModel):
    studentAnswers: list[dict]
    answerKey: dict
