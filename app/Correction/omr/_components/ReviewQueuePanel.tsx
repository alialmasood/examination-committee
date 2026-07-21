"use client";

import type { Dispatch, SetStateAction } from "react";
import type { ReviewQueueItem, ReviewRecordDetail } from "../_types";

export type ReviewQueuePanelProps = {
  queue: ReviewQueueItem[];
  queueLoading: boolean;
  selectedReviewId: string;
  setSelectedReviewId: Dispatch<SetStateAction<string>>;
  reviewDetail: ReviewRecordDetail | null;
  reviewBusy: boolean;
  manualCode: string;
  setManualCode: Dispatch<SetStateAction<string>>;
  manualAnswers: Record<number, string>;
  setManualAnswers: Dispatch<SetStateAction<Record<number, string>>>;
  loadReviewDetail: (id: string) => Promise<void>;
  saveReview: (status: "reviewed" | "approved") => Promise<void>;
};

export function ReviewQueuePanel({
  queue,
  queueLoading,
  selectedReviewId,
  setSelectedReviewId,
  reviewDetail,
  reviewBusy,
  manualCode,
  setManualCode,
  manualAnswers,
  setManualAnswers,
  loadReviewDetail,
  saveReview,
}: ReviewQueuePanelProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Review Queue للحالات المشكوك بها</h2>
      <p className="mt-1 text-xs text-slate-600">
        تدخل المراجعة عندما يكون رقم الطالب غير واضح، أو يوجد سؤال بحالة uncertain/multiple، أو ثقة منخفضة.
      </p>

      {queueLoading ? (
        <p className="mt-2 text-sm text-slate-600">جاري تحميل قائمة المراجعة…</p>
      ) : queue.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">لا توجد حالات مراجعة لهذا الامتحان.</p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="max-h-[60vh] overflow-auto rounded border">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="border px-2 py-1 text-right">الصفحة</th>
                  <th className="border px-2 py-1 text-right">رمز الطالب</th>
                  <th className="border px-2 py-1 text-right">الحالة</th>
                  <th className="border px-2 py-1 text-right">الدرجة</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr
                    key={q.id}
                    className={`cursor-pointer ${selectedReviewId === q.id ? "bg-blue-50" : ""}`}
                    onClick={() => {
                      setSelectedReviewId(q.id);
                      void loadReviewDetail(q.id);
                    }}
                  >
                    <td className="border px-2 py-1">{q.page_index}</td>
                    <td className="border px-2 py-1 font-mono">{q.student_code || "—"}</td>
                    <td className="border px-2 py-1">{q.review_status}</td>
                    <td className="border px-2 py-1">
                      {q.comparison?.score ?? 0}/{q.comparison?.totalQuestions ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded border bg-slate-50 p-3">
            {!selectedReviewId ? (
              <p className="text-sm text-slate-600">اختر صفًا من القائمة لفتح شاشة المراجعة.</p>
            ) : reviewBusy ? (
              <p className="text-sm text-slate-600">جاري تحميل تفاصيل المراجعة…</p>
            ) : !reviewDetail ? (
              <p className="text-sm text-slate-600">لا توجد تفاصيل.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">تعديل studentCode</label>
                    <input
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      className="w-full rounded border px-2 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div className="text-xs text-slate-600">
                    <p>
                      <strong>الحالة:</strong> {reviewDetail.review_status}
                    </p>
                    <p>
                      <strong>النتيجة:</strong> {reviewDetail.comparison.score}/{reviewDetail.comparison.totalQuestions}
                    </p>
                  </div>
                </div>

                {reviewDetail.normalized_image_url ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-700">صورة الشيت بعد normalization</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={reviewDetail.normalized_image_url}
                      alt="normalized sheet"
                      className="max-h-[360px] w-full rounded border object-contain bg-white"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">الأسئلة المشكوك بها + Bubble Scores</p>
                  {(reviewDetail.detected_answers || [])
                    .filter((a) => a.status === "uncertain" || a.status === "multiple" || a.confidence < 0.35)
                    .map((a) => (
                      <div key={`rv-q-${a.questionNumber}`} className="rounded border bg-white p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <p>
                            س{a.questionNumber} — الحالة: <strong>{a.status}</strong> — الثقة:{" "}
                            {(a.confidence * 100).toFixed(0)}%
                          </p>
                          <p className="font-mono">
                            scores:{" "}
                            {Object.entries(a.bubbleScores || {})
                              .map(([k, v]) => `${k}:${Number(v).toFixed(1)}`)
                              .join(" | ")}
                          </p>
                        </div>

                        {reviewDetail.suspicious_crops?.[a.questionNumber] ? (
                          <div className="mt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={reviewDetail.suspicious_crops[a.questionNumber]}
                              alt={`q-${a.questionNumber}-crop`}
                              className="max-h-28 rounded border bg-slate-100"
                            />
                          </div>
                        ) : null}

                        <div className="mt-2 flex gap-1">
                          {["A", "B", "C", "D"].map((opt) => (
                            <button
                              key={`q-${a.questionNumber}-${opt}`}
                              type="button"
                              onClick={() =>
                                setManualAnswers((prev) => ({ ...prev, [a.questionNumber]: opt }))
                              }
                              className={`rounded border px-2 py-1 text-xs font-semibold ${
                                (manualAnswers[a.questionNumber] || a.selectedOption || "") === opt
                                  ? "border-blue-800 bg-blue-800 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setManualAnswers((prev) => ({ ...prev, [a.questionNumber]: "" }))
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            فراغ
                          </button>
                        </div>
                      </div>
                    ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() => void saveReview("reviewed")}
                    className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    حفظ كمراجَع
                  </button>
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() => void saveReview("approved")}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    اعتماد النتيجة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
