"use client";

import type { OMRPageResult, ProcessResponse } from "../_types";

export type ProcessingSummaryCardProps = {
  exam: ProcessResponse["exam"];
  results: OMRPageResult[];
  totalPages?: number;
  successPages?: number;
  failedPages?: number;
  manualReviewPages?: number;
};

export function ProcessingSummaryCard({
  exam,
  results,
  totalPages,
  successPages,
  failedPages,
  manualReviewPages,
}: ProcessingSummaryCardProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">ملخص المعالجة</h2>
      <p className="mt-1 text-sm text-slate-700">
        الامتحان: {exam?.subject_name} — {exam?.exam_date}
      </p>
      <p className="text-sm text-slate-700">
        الصفحات الكلية: <strong>{totalPages ?? results.length}</strong> — الصفحات الناجحة:{" "}
        <strong>{successPages ?? results.filter((r) => r.success).length}</strong> — الصفحات الفاشلة:{" "}
        <strong>{failedPages ?? results.filter((r) => !r.success).length}</strong> — صفحات تحتاج مراجعة:{" "}
        <strong>{manualReviewPages ?? 0}</strong>
      </p>
    </section>
  );
}
