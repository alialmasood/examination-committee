"use client";

import Link from "next/link";
import type { ExamAnswerKeyInfo, SheetExportRow } from "../_types";

export type AnswerKeyStatusProps = {
  selectedExam: SheetExportRow | null;
  keyLoading: boolean;
  keyInfo: ExamAnswerKeyInfo | null;
  keyError: string;
  selectedExamId: string;
};

export function AnswerKeyStatus({ selectedExam, keyLoading, keyInfo, keyError, selectedExamId }: AnswerKeyStatusProps) {
  if (!selectedExam) return null;

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
        {keyLoading ? (
          <p className="text-slate-600">جاري التحقق من مفتاح الإجابة…</p>
        ) : keyInfo ? (
          <div className="space-y-1 text-emerald-800">
            <p>
              <strong>حالة readiness:</strong> جاهز للتحليل
            </p>
            <p>
              <strong>عدد الأسئلة:</strong> {keyInfo.totalQuestions}
            </p>
            <p>
              <strong>نوع الخيارات:</strong> {keyInfo.options.join(" / ")}
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-amber-900">
            <p>
              <strong>حالة readiness:</strong> غير جاهز — لا يوجد مفتاح إجابة محفوظ لهذا الامتحان.
            </p>
            {keyError ? <p>{keyError}</p> : null}
            <Link
              href={`/Correction/answer-key?exportId=${encodeURIComponent(selectedExamId)}`}
              className="inline-flex rounded border border-amber-400 bg-amber-50 px-2 py-1 font-semibold underline"
            >
              الانتقال إلى صفحة مفتاح الإجابة
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
