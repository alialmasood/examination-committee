"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type ReportStudent = {
  id: string;
  student_name: string;
  stage: string;
  study_type: string;
  department: string;
  sheet_code: string;
};

type ReportPayload = {
  version?: number;
  exportBatchId?: string;
  subjectName: string;
  subjectCode?: string;
  examDate: string;
  teacherName: string;
  department: string;
  stage: string;
  studyType: string;
  studentCount?: number;
  students: ReportStudent[];
  savedAt?: string;
};

type ExportDetail = {
  id: string;
  export_batch_id: string | null;
  subject_name: string;
  subject_code: string | null;
  exam_date: string;
  teacher_name: string | null;
  department: string;
  stage: string;
  study_type: string;
  student_count: number;
  created_at: string;
  report_payload: ReportPayload | null;
};

function studyLabel(v: string) {
  if (v === "morning") return "صباحي";
  if (v === "evening") return "مسائي";
  return v || "—";
}

export default function ComposedExamReportPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [row, setRow] = useState<ExportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/correction/sheet-exports/${id}`);
        const data = (await res.json()) as { success?: boolean; export?: ExportDetail; error?: string };
        if (!res.ok || !data.success || !data.export) {
          setError(data.error || "تعذر تحميل السجل.");
          setRow(null);
          return;
        }
        setRow(data.export);
      } catch {
        setError("تعذر الاتصال بالخادم.");
        setRow(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id]);

  if (!id) {
    return (
      <main dir="rtl" className="p-6">
        <p className="text-sm text-red-700">معرّف غير صالح.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main dir="rtl" className="bg-slate-100 p-6">
        <p className="text-sm text-slate-600">جاري التحميل…</p>
      </main>
    );
  }

  if (error || !row) {
    return (
      <main dir="rtl" className="bg-slate-100 p-6">
        <p className="text-sm text-red-700">{error || "لا يوجد سجل."}</p>
        <Link href="/Correction/composed-exams" className="mt-3 inline-block text-sm text-blue-800 underline">
          العودة إلى الامتحانات المكونة
        </Link>
      </main>
    );
  }

  const payload = row.report_payload;

  return (
    <main dir="rtl" className="bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/Correction/composed-exams" className="text-sm font-medium text-blue-800 underline">
            ← الامتحانات المكونة
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-lg font-bold text-slate-900">تقرير الامتحان المكوّن</h2>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="font-semibold">المادة:</span> {row.subject_name}
            </p>
            <p>
              <span className="font-semibold">رمز المادة:</span> {row.subject_code || "—"}
            </p>
            <p>
              <span className="font-semibold">تاريخ الامتحان:</span> {row.exam_date}
            </p>
            <p>
              <span className="font-semibold">أستاذ المادة:</span> {row.teacher_name || "—"}
            </p>
            <p>
              <span className="font-semibold">القسم:</span> {row.department}
            </p>
            <p>
              <span className="font-semibold">المرحلة:</span> {row.stage}
            </p>
            <p>
              <span className="font-semibold">نوع الدراسة:</span> {studyLabel(row.study_type)}
            </p>
            <p>
              <span className="font-semibold">عدد الطلبة في هذه الخانة:</span> {row.student_count}
            </p>
            {row.export_batch_id ? (
              <p className="sm:col-span-2">
                <span className="font-semibold">رقم الدفعة (نفس التصدير):</span>{" "}
                <code className="rounded bg-slate-100 px-1 text-xs">{row.export_batch_id}</code>
              </p>
            ) : null}
          </div>
        </section>

        {payload?.students?.length ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="mb-3 text-base font-bold text-slate-900">قائمة الطلبة (أوراق الشيت المكوّنة)</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-right text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-semibold">تسلسل</th>
                    <th className="px-3 py-2 font-semibold">اسم الطالب</th>
                    <th className="px-3 py-2 font-semibold">رمز الشيت</th>
                    <th className="px-3 py-2 font-semibold">القسم</th>
                    <th className="px-3 py-2 font-semibold">المرحلة</th>
                    <th className="px-3 py-2 font-semibold">الدراسة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payload.students.map((s, i) => (
                    <tr key={s.id || i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{s.student_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.sheet_code || "—"}</td>
                      <td className="px-3 py-2">{s.department}</td>
                      <td className="px-3 py-2">{s.stage}</td>
                      <td className="px-3 py-2">{studyLabel(s.study_type)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500 print:hidden">
              يمكن طباعة هذه الصفحة من المتصفح كنسخة من التقرير. رموز QR وصور الشيتات تُولَّد من صفحة «تصدير الشيت» عند
              الطباعة وليست جزءًا من هذا الملف المحفوظ.
            </p>
          </section>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            لا يوجد حمولة تقرير محفوظة لهذا السجل (قد يكون سجلاً قديماً قبل تفعيل حفظ التقرير).
          </section>
        )}
      </div>
    </main>
  );
}
