"use client";

import type { OMRPageResult } from "../_types";

export type SuspiciousResultsPanelProps = {
  results: OMRPageResult[];
};

export function SuspiciousResultsPanel({ results }: SuspiciousResultsPanelProps) {
  const suspicious = results.filter(
    (r) =>
      !r.success ||
      r.detectedAnswers.some((a) => a.status === "uncertain" || a.status === "multiple") ||
      (r.errors?.length || 0) > 0
  );

  if (suspicious.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <h2 className="text-lg font-bold text-amber-900">حالات مشكوك بها للمراجعة اليدوية</h2>
      <div className="mt-2 space-y-2 text-xs text-amber-950">
        {suspicious.map((r) => (
          <div key={`sus-${r.pageIndex}`} className="rounded border border-amber-200 bg-white px-3 py-2">
            <p>
              صفحة {r.pageIndex} — رمز الطالب: <strong>{r.studentCode || "غير مقروء"}</strong>
            </p>
            <p>
              أسئلة مشكوك بها:{" "}
              {r.detectedAnswers
                .filter((a) => a.status === "uncertain" || a.status === "multiple")
                .map((a) => a.questionNumber)
                .join(", ") || "—"}
            </p>
            {r.errors?.length ? <p>الأسباب: {r.errors.join(" | ")}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
