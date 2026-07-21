"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type StudentPayload = {
  student_name: string;
  department: string;
  stage: string;
  study_type: string;
  student_code: string;
  sheet_code: string;
};

function studyTypeLabel(v: string): string {
  if (v === "evening") return "مسائي";
  if (v === "morning") return "صباحي";
  return v || "";
}

function formatExamDateFromParam(iso: string): string {
  const s = String(iso || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || "—";
}

function SheetScanContent({ sheetCode }: { sheetCode: string }) {
  const searchParams = useSearchParams();
  const subjectFromUrl = useMemo(() => {
    const t = searchParams.get("t");
    if (!t) return "";
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }, [searchParams]);
  const examIso = useMemo(() => String(searchParams.get("e") || "").trim(), [searchParams]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [student, setStudent] = useState<StudentPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/correction/students/by-sheet-code?code=${encodeURIComponent(sheetCode)}`);
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
          student?: StudentPayload;
        };
        if (cancelled) return;
        if (!res.ok || !data.success || !data.student) {
          setStudent(null);
          setError(data.error || "تعذر تحميل البيانات.");
          return;
        }
        setStudent(data.student);
        setError("");
      } catch {
        if (!cancelled) {
          setStudent(null);
          setError("تعذر الاتصال بالخادم.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetCode]);

  const stageLine = student
    ? [String(student.stage || "").trim(), studyTypeLabel(String(student.study_type || "").trim())].filter(Boolean).join("، ")
    : "";

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-lg font-bold text-slate-800">بيانات ورقة الامتحان</h1>
        <p className="mb-6 text-center text-xs text-slate-500">كلية الشرق التقنية التخصصية</p>

        {loading ? (
          <p className="text-center text-sm text-slate-600">جاري التحميل…</p>
        ) : error ? (
          <p className="text-center text-sm text-red-700">{error}</p>
        ) : student ? (
          <dl className="space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold text-slate-500">كود الورقة</dt>
              <dd dir="ltr" className="font-mono text-base font-bold tracking-wide">
                {student.sheet_code}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">اسم المادة الامتحانية</dt>
              <dd>{subjectFromUrl || "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">اسم الطالب</dt>
              <dd className="font-medium">{student.student_name || "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">القسم</dt>
              <dd>{student.department || "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">المرحلة</dt>
              <dd>{stageLine || "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">تاريخ الامتحان</dt>
              <dd>{examIso ? formatExamDateFromParam(examIso) : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold text-slate-500">كود الطالب</dt>
              <dd dir="ltr" className="font-mono">
                {String(student.student_code || "").trim() || "—"}
              </dd>
            </div>
            <p className="m-0 pt-2 text-center text-xs font-semibold text-slate-600">الامتحانات النهائية 2025-2026</p>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

export default function SheetScanPage() {
  const params = useParams();
  const raw = params?.code != null ? String(params.code) : "";
  const digits = raw.replace(/\D/g, "").slice(-5);
  const sheetCode = /^\d{5}$/.test(digits) ? digits : "";

  if (!sheetCode) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-100 px-4 py-12 text-center text-sm text-red-700">
        كود الورقة في الرابط غير صالح.
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div dir="rtl" className="min-h-screen bg-slate-100 px-4 py-12 text-center text-sm text-slate-600">
          جاري التحميل…
        </div>
      }
    >
      <SheetScanContent sheetCode={sheetCode} />
    </Suspense>
  );
}
