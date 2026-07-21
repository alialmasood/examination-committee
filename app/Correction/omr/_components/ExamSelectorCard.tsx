"use client";

import Link from "next/link";
import type { SheetExportRow } from "../_types";

function studyLabel(v: string | null | undefined) {
  if (v === "evening") return "مسائي";
  if (v === "morning") return "صباحي";
  return "—";
}

export type ExamSelectorCardProps = {
  rows: SheetExportRow[];
  loadingRows: boolean;
  selectedExamId: string;
  setSelectedExamId: (value: string) => void;
  selectedExam: SheetExportRow | null;
};

export function ExamSelectorCard({
  rows,
  loadingRows,
  selectedExamId,
  setSelectedExamId,
  selectedExam,
}: ExamSelectorCardProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-600">الامتحان</label>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            disabled={loadingRows}
            className="w-full rounded-lg border px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">— اختر امتحانًا —</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.subject_name} — {r.exam_date} — {(r.department || "").trim()} / {(r.stage || "").trim()} /{" "}
                {studyLabel(r.study_type)}
              </option>
            ))}
          </select>
          {!loadingRows && rows.length === 0 ? (
            <p className="mt-1 text-xs text-amber-800">
              لا توجد سجلات امتحانات بعد. أضف المفتاح من{" "}
              <Link href="/Correction/answer-key" className="font-semibold underline">
                صفحة مفتاح الإجابة
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>

      {selectedExam ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <strong>{selectedExam.subject_name}</strong> — {selectedExam.exam_date} — {selectedExam.student_count} طالب
        </div>
      ) : null}
    </section>
  );
}
