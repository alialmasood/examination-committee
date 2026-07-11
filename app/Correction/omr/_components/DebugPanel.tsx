"use client";

import type { ReactNode } from "react";
import type { OMRPageResult } from "../_types";

export type DebugPanelProps = {
  results: OMRPageResult[];
  openDebugPage: number | null;
};

export function DebugPanel({ results, openDebugPage }: DebugPanelProps) {
  if (openDebugPage == null) return null;

  const page = results.find((x) => x.pageIndex === openDebugPage);

  let inner: ReactNode;
  if (!page) {
    inner = <p className="text-xs text-slate-600">الصفحة غير موجودة.</p>;
  } else if (!page.debug) {
    inner = (
      <p className="text-xs text-slate-600">لا توجد صور Debug محفوظة لهذه الصفحة. فعّل Debug Mode قبل التحليل.</p>
    );
  } else {
    const dbg = page.debug;
    const pairs: Array<{ key: string; url?: string }> = [
      { key: "original page image", url: dbg.original },
      { key: "grayscale", url: dbg.grayscale },
      { key: "thresholded", url: dbg.thresholded },
      { key: "detected sheet contour", url: dbg.detectedSheetContour },
      { key: "warped sheet", url: dbg.warpedSheet },
      { key: "roi overlay", url: dbg.roiOverlay },
      { key: "marked bubbles", url: dbg.markedBubbles },
    ];
    inner = (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-800">Debug الصفحة {page.pageIndex}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pairs
            .filter((x) => x.url)
            .map((x) => (
              <div key={x.key} className="rounded border bg-white p-2">
                <p className="mb-1 text-[11px] font-semibold text-slate-700">{x.key}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.url} alt={x.key} className="h-40 w-full rounded border object-contain bg-slate-100" />
              </div>
            ))}
        </div>

        <div className="rounded border bg-white p-2">
          <p className="mb-2 text-xs font-semibold text-slate-800">Bubble scores + القرار النهائي + الثقة</p>
          <div className="max-h-64 overflow-auto rounded border">
            <table className="min-w-full border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="border px-2 py-1 text-right">س</th>
                  <th className="border px-2 py-1 text-right">scores</th>
                  <th className="border px-2 py-1 text-right">القرار</th>
                  <th className="border px-2 py-1 text-right">الثقة</th>
                </tr>
              </thead>
              <tbody>
                {page.detectedAnswers.map((a) => (
                  <tr key={`dbg-q-${a.questionNumber}`}>
                    <td className="border px-2 py-1">{a.questionNumber}</td>
                    <td className="border px-2 py-1 font-mono">
                      {Object.entries(a.bubbleScores || {})
                        .map(([k, v]) => `${k}:${Number(v).toFixed(1)}`)
                        .join(" | ")}
                    </td>
                    <td className="border px-2 py-1">
                      {a.status} / {a.selectedOption || "—"}
                    </td>
                    <td className="border px-2 py-1">{(a.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return <div className="rounded border bg-slate-50 p-3">{inner}</div>;
}
