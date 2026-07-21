"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  BookMarked,
  Building2,
  FileSpreadsheet,
  GraduationCap,
  Layers,
  Moon,
  Sun,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  UserSquare,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DashboardPayload = {
  success: boolean;
  error?: string;
  generatedAt?: string;
  students: {
    total: number;
    morning: number;
    evening: number;
    distinctDepartments: number;
    distinctStages: number;
    byDepartment: { department: string; count: number }[];
    byStage: { stage: string; count: number }[];
    byDepartmentStageStudy: { department: string; stage: string; studyType: string; count: number }[];
  };
  subjects: {
    referenceCount: number;
    byExportAggregate: {
      subjectName: string;
      subjectCode: string | null;
      exportStudentSlots: number;
      sliceCount: number;
    }[];
  };
  sheetExports: {
    totalSlices: number;
    totalStudentSlotsOnSheets: number;
    perExam: { subjectName: string; examDate: string; studentSlots: number; sliceCount: number }[];
    byDepartment: { department: string; studentSlots: number; sliceCount: number }[];
    mostDepartment: { department: string; studentSlots: number } | null;
    leastDepartment: { department: string; studentSlots: number } | null;
    mostSubject: { subjectName: string; studentSlots: number } | null;
    leastSubject: { subjectName: string; studentSlots: number } | null;
  };
  teachers: { total: number };
  correction: { uploadedBatchesCount: number; studentListUploadsCount: number };
  grading: {
    passCount: number;
    failCount: number;
    totalGraded: number;
    overallPassRate: number;
    overallFailRate: number;
    byDepartment: {
      department: string;
      passCount: number;
      failCount: number;
      passRate: number;
      failRate: number;
    }[];
  };
};

function studyTypeLabel(v: string): string {
  if (v === "morning") return "صباحي";
  if (v === "evening") return "مسائي";
  return v;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: typeof Users;
  accent: "slate" | "blue" | "emerald" | "amber" | "violet" | "rose";
}) {
  const ring =
    accent === "blue"
      ? "from-blue-600 to-indigo-700"
      : accent === "emerald"
        ? "from-emerald-600 to-teal-700"
        : accent === "amber"
          ? "from-amber-500 to-orange-600"
          : accent === "violet"
            ? "from-violet-600 to-purple-700"
            : accent === "rose"
              ? "from-rose-600 to-red-700"
              : "from-slate-700 to-slate-900";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div
        className={`pointer-events-none absolute -start-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br opacity-[0.12] ${ring}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-inner ${ring}`}
        >
          <Icon className="h-6 w-6 opacity-95" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 border-b border-slate-200 pb-3">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
    </div>
  );
}

function DataTable({
  columns,
  rows,
  emptyText,
}: {
  columns: { key: string; label: string; className?: string }[];
  rows: Record<string, string | number>[];
  emptyText: string;
}) {
  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">{emptyText}</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[min(28rem,55vh)] overflow-auto">
        <table className="w-full min-w-[18rem] border-collapse text-right text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800 text-white">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-4 py-3 font-semibold ${c.className || ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="bg-white hover:bg-slate-50/90">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 text-slate-800 ${c.className || ""}`}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CorrectionUserDashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/correction/dashboard-stats", { cache: "no-store" });
      const json = (await res.json()) as DashboardPayload;
      if (!res.ok || !json.success) {
        setError(json.error || "تعذر تحميل الإحصائيات.");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("تعذر الاتصال بالخادم.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main dir="rtl" className="min-h-full w-full bg-gradient-to-b from-slate-100 via-slate-50 to-white pb-12 pt-6">
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">نظام التصحيح الإلكتروني</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">لوحة المؤشرات والإحصائيات</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              نظرة موحّدة على الطلبة، التصدير، التصحيح، والموارد البشرية المرتبطة بنظام التصحيح. يتم تحديث الأرقام من قاعدة البيانات مباشرة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="self-start rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? "جاري التحديث…" : "تحديث البيانات"}
          </button>
        </header>

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}

        {loading && !data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/70" />
            ))}
          </div>
        ) : null}

        {data ? (
          <>
            <p className="mb-6 text-xs text-slate-500">
              آخر تجميع:{" "}
              {data.generatedAt
                ? new Date(data.generatedAt).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" })
                : "—"}
            </p>

            <section className="mb-10">
              <SectionTitle title="ملخص عام" subtitle="أعداد أساسية في النظام" />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="الأقسام (مميّزة في سجل الطلبة)"
                  value={data.students.distinctDepartments}
                  hint="عدد تسميات الأقسام المختلفة لدى الطلبة المسجلين"
                  icon={Building2}
                  accent="slate"
                />
                <StatCard
                  title="المراحل الدراسية"
                  value={data.students.distinctStages}
                  hint="عدد المراحل المختلفة في سجل الطلبة"
                  icon={Layers}
                  accent="violet"
                />
                <StatCard title="إجمالي الطلبة المسجلين" value={data.students.total} icon={Users} accent="blue" />
                <StatCard title="المواد في المرجع" value={data.subjects.referenceCount} icon={BookMarked} accent="emerald" />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard title="طلبة صباحي" value={data.students.morning} icon={Sun} accent="amber" />
                <StatCard title="طلبة مسائي" value={data.students.evening} icon={Moon} accent="blue" />
                <StatCard title="أساتذة مسجّلون (موارد بشرية)" value={data.teachers.total} icon={UserSquare} accent="slate" />
                <StatCard
                  title="ملفات مرفوعة للتصحيح"
                  value={data.correction.uploadedBatchesCount}
                  hint={`استيراد قوائم طلبة (مرفقات): ${data.correction.studentListUploadsCount}`}
                  icon={UploadCloud}
                  accent="rose"
                />
              </div>
            </section>

            <section className="mb-10">
              <SectionTitle title="شيتات الامتحان (التصدير)" subtitle="من جدول تصدير الشيتات — الشرائح والطلبة على الشيت" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title="إجمالي شرائح التصدير"
                  value={data.sheetExports.totalSlices}
                  hint="عدد سجلات الشرائح المحفوظة"
                  icon={FileSpreadsheet}
                  accent="blue"
                />
                <StatCard
                  title="إجمالي «أوراق» الطلبة على الشيتات"
                  value={data.sheetExports.totalStudentSlotsOnSheets}
                  hint="مجموع خانات الطلبة ضمن التصديرات"
                  icon={FileSpreadsheet}
                  accent="emerald"
                />
                <StatCard
                  title="أكثر قسم (حسب التصدير)"
                  value={data.sheetExports.mostDepartment?.department ?? "—"}
                  hint={
                    data.sheetExports.mostDepartment
                      ? `${data.sheetExports.mostDepartment.studentSlots} خانة`
                      : "لا بيانات"
                  }
                  icon={ArrowUpRight}
                  accent="emerald"
                />
                <StatCard
                  title="أقل قسم (حسب التصدير)"
                  value={data.sheetExports.leastDepartment?.department ?? "—"}
                  hint={
                    data.sheetExports.leastDepartment
                      ? `${data.sheetExports.leastDepartment.studentSlots} خانة`
                      : "لا بيانات"
                  }
                  icon={ArrowDownRight}
                  accent="amber"
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <StatCard
                  title="أكثر مادة (تصدير)"
                  value={data.sheetExports.mostSubject?.subjectName ?? "—"}
                  hint={
                    data.sheetExports.mostSubject ? `${data.sheetExports.mostSubject.studentSlots} خانة` : "لا بيانات"
                  }
                  icon={ArrowUpRight}
                  accent="violet"
                />
                <StatCard
                  title="أقل مادة (تصدير)"
                  value={data.sheetExports.leastSubject?.subjectName ?? "—"}
                  hint={
                    data.sheetExports.leastSubject ? `${data.sheetExports.leastSubject.studentSlots} خانة` : "لا بيانات"
                  }
                  icon={ArrowDownRight}
                  accent="rose"
                />
              </div>
            </section>

            <section className="mb-10">
              <SectionTitle
                title="نتائج التصحيح المحفوظة"
                subtitle="مستخرجة من ملخص الوجبات (بعد إتمام خطوة التصحيح). قد لا تشمل كل الامتحانات إن لم تُحفظ الملخصات."
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="ناجحون (مجموع)" value={data.grading.passCount} icon={GraduationCap} accent="emerald" />
                <StatCard title="راسبون (مجموع)" value={data.grading.failCount} icon={GraduationCap} accent="rose" />
                <StatCard title="نسبة النجاح الكلية" value={formatPct(data.grading.overallPassRate)} icon={TrendingUp} accent="emerald" />
                <StatCard title="نسبة الرسوب الكلية" value={formatPct(data.grading.overallFailRate)} icon={TrendingDown} accent="rose" />
              </div>
            </section>

            <div className="grid gap-10 lg:grid-cols-2">
              <section>
                <SectionTitle title="الطلبة حسب القسم" />
                <DataTable
                  columns={[
                    { key: "department", label: "القسم" },
                    { key: "count", label: "العدد", className: "tabular-nums w-24" },
                  ]}
                  rows={data.students.byDepartment.map((r) => ({ department: r.department, count: r.count }))}
                  emptyText="لا توجد بيانات طلبة بعد."
                />
              </section>
              <section>
                <SectionTitle title="الطلبة حسب المرحلة" />
                <DataTable
                  columns={[
                    { key: "stage", label: "المرحلة" },
                    { key: "count", label: "العدد", className: "tabular-nums w-24" },
                  ]}
                  rows={data.students.byStage.map((r) => ({ stage: r.stage, count: r.count }))}
                  emptyText="لا توجد بيانات."
                />
              </section>
            </div>

            <section className="mt-10">
              <SectionTitle
                title="الطلبة حسب القسم والمرحلة ونوع الدراسة"
                subtitle="صباحي / مسائي لكل قسم ومرحلة"
              />
              <DataTable
                columns={[
                  { key: "department", label: "القسم" },
                  { key: "stage", label: "المرحلة" },
                  { key: "studyType", label: "نوع الدراسة" },
                  { key: "count", label: "العدد", className: "tabular-nums w-24" },
                ]}
                rows={data.students.byDepartmentStageStudy.map((r) => ({
                  department: r.department,
                  stage: r.stage,
                  studyType: studyTypeLabel(r.studyType),
                  count: r.count,
                }))}
                emptyText="لا توجد بيانات."
              />
            </section>

            <section className="mt-10">
              <SectionTitle
                title="المواد والطلبة على شيتات التصدير"
                subtitle="مجموع خانات الطلبة لكل مادة من سجلات التصدير (ليس بالضرورة مطابقاً لعدد الطلبة في السجل المركزي إن اختلفت التسميات)."
              />
              <DataTable
                columns={[
                  { key: "subjectName", label: "المادة" },
                  { key: "subjectCode", label: "الرمز" },
                  { key: "exportStudentSlots", label: "خانات على الشيتات", className: "tabular-nums" },
                  { key: "sliceCount", label: "شرائح", className: "tabular-nums w-24" },
                ]}
                rows={data.subjects.byExportAggregate.map((r) => ({
                  subjectName: r.subjectName,
                  subjectCode: r.subjectCode || "—",
                  exportStudentSlots: r.exportStudentSlots,
                  sliceCount: r.sliceCount,
                }))}
                emptyText="لا توجد تصديرات مواد بعد."
              />
            </section>

            <section className="mt-10">
              <SectionTitle title="كل امتحان (مادة + تاريخ): الشرائح والأوراق" />
              <DataTable
                columns={[
                  { key: "subjectName", label: "المادة" },
                  { key: "examDate", label: "تاريخ الامتحان" },
                  { key: "sliceCount", label: "شرائح", className: "tabular-nums w-20" },
                  { key: "studentSlots", label: "خانات طلبة", className: "tabular-nums" },
                ]}
                rows={data.sheetExports.perExam.map((r) => ({
                  subjectName: r.subjectName,
                  examDate: r.examDate,
                  sliceCount: r.sliceCount,
                  studentSlots: r.studentSlots,
                }))}
                emptyText="لا توجد تصديرات."
              />
            </section>

            <div className="mt-10 grid gap-10 lg:grid-cols-2">
              <section>
                <SectionTitle title="التصدير حسب القسم" />
                <DataTable
                  columns={[
                    { key: "department", label: "القسم" },
                    { key: "sliceCount", label: "شرائح", className: "tabular-nums w-24" },
                    { key: "studentSlots", label: "خانات", className: "tabular-nums" },
                  ]}
                  rows={data.sheetExports.byDepartment.map((r) => ({
                    department: r.department,
                    sliceCount: r.sliceCount,
                    studentSlots: r.studentSlots,
                  }))}
                  emptyText="لا بيانات."
                />
              </section>
              <section>
                <SectionTitle title="النجاح والرسوب حسب القسم" />
                <DataTable
                  columns={[
                    { key: "department", label: "القسم" },
                    { key: "passCount", label: "ناجح", className: "tabular-nums w-20" },
                    { key: "failCount", label: "راسب", className: "tabular-nums w-20" },
                    { key: "passRate", label: "نجاح %", className: "tabular-nums w-24" },
                    { key: "failRate", label: "رسوب %", className: "tabular-nums w-24" },
                  ]}
                  rows={data.grading.byDepartment.map((r) => ({
                    department: r.department,
                    passCount: r.passCount,
                    failCount: r.failCount,
                    passRate: formatPct(r.passRate),
                    failRate: formatPct(r.failRate),
                  }))}
                  emptyText="لا توجد وجبات بملخص تصحيح مرتبط بقسم."
                />
              </section>
            </div>

            <footer className="mt-12 rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-sm leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">ملاحظات تشغيلية</p>
              <ul className="mt-2 list-disc space-y-1 pe-5">
                <li>مؤشرات النجاح والرسوب تعتمد على حقل الملخص داخل الوجبة بعد حفظ التصحيح.</li>
                <li>أكثر/أقل قسم أو مادة للتصدير تُحسب من مجموع خانات الطلبة على الشيتات وليس عدد الملفات فقط.</li>
                <li>إن رغبت لاحقاً بإضافة: معدلات زمنية، رسوم بيانية، أو ربط بنتائج OMR الموحّدة، يمكن توسيع هذا الـ API.</li>
              </ul>
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
