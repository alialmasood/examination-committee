"use client";

import type { Dispatch, SetStateAction } from "react";
import type { OMRPageResult } from "../_types";

export type ResultsTableProps = {
  results: OMRPageResult[];
  openDebugPage: number | null;
  setOpenDebugPage: Dispatch<SetStateAction<number | null>>;
};

export function ResultsTable({ results, openDebugPage, setOpenDebugPage }: ResultsTableProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-bold text-slate-900">جدول نتائج الطلاب</h2>
      <div className="max-h-[60vh] overflow-auto rounded border">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="border px-2 py-1 text-right">الصفحة</th>
              <th className="border px-2 py-1 text-right">رمز الطالب</th>
              <th className="border px-2 py-1 text-right">الدرجة</th>
              <th className="border px-2 py-1 text-right">صحيح</th>
              <th className="border px-2 py-1 text-right">خطأ</th>
              <th className="border px-2 py-1 text-right">فراغ</th>
              <th className="border px-2 py-1 text-right">متعدد</th>
              <th className="border px-2 py-1 text-right">مراجعة</th>
              <th className="border px-2 py-1 text-right">Debug</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.pageIndex} className={openDebugPage === r.pageIndex ? "bg-indigo-50" : ""}>
                <td className="border px-2 py-1">{r.pageIndex}</td>
                <td className="border px-2 py-1 font-mono">{r.studentCode || "—"}</td>
                <td className="border px-2 py-1">
                  {r.comparison ? `${r.comparison.score} / ${r.comparison.totalQuestions}` : "—"}
                </td>
                <td className="border px-2 py-1">{r.comparison?.correctCount ?? "—"}</td>
                <td className="border px-2 py-1">{r.comparison?.wrongCount ?? "—"}</td>
                <td className="border px-2 py-1">{r.comparison?.blankCount ?? "—"}</td>
                <td className="border px-2 py-1">{r.comparison?.multipleCount ?? "—"}</td>
                <td className="border px-2 py-1">
                  {!r.success ? (
                    <span className="font-semibold text-red-700">فاشلة</span>
                  ) : r.detectedAnswers.some((a) => a.status === "uncertain" || a.status === "multiple") ||
                    (r.errors?.length || 0) > 0 ? (
                    <span className="font-semibold text-amber-700">مشكوكة</span>
                  ) : (
                    <span className="text-emerald-700">واضحة</span>
                  )}
                </td>
                <td className="border px-2 py-1">
                  <button
                    type="button"
                    disabled={!r.debug}
                    onClick={() => setOpenDebugPage((prev) => (prev === r.pageIndex ? null : r.pageIndex))}
                    className="rounded border border-indigo-700 px-2 py-1 text-[11px] font-semibold text-indigo-800 disabled:opacity-50"
                  >
                    عرض debug
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
