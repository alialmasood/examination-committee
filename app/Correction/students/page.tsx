"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Student = {
  id: string;
  sequence_no: number | null;
  student_code: string;
  department: string;
  student_name: string;
  stage: string;
  study_type: "morning" | "evening";
  sheet_code: string;
};

type UploadRecord = { id: string; file_name: string; inserted_count: number; created_at: string };
type SortKey = "sequence_no" | "student_code" | "department" | "student_name" | "stage" | "study_type" | "sheet_code";

export default function CorrectionStudentsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [stats, setStats] = useState({ total_students: 0, morning_students: 0, evening_students: 0, departments_count: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [studyTypeFilter, setStudyTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sequence_no");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [editing, setEditing] = useState<Student | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  /** مراحل معروفة في النظام (طلبة التصحيح + تصديرات الشيتات) من الـ API */
  const [knownStages, setKnownStages] = useState<string[]>([]);

  const fetchData = async () => {
    const res = await fetch("/api/correction/students");
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "تعذر تحميل البيانات");
    setStudents(data.students || []);
    setUploads(data.uploads || []);
    setStats(data.stats || stats);
    setKnownStages(Array.isArray(data.knownStages) ? data.knownStages : []);
  };

  useEffect(() => {
    fetchData().catch((e) => setError(e.message));
  }, []);

  const departments = useMemo(() => Array.from(new Set(students.map((s) => s.department))).sort(), [students]);
  const stages = useMemo(() => Array.from(new Set(students.map((s) => s.stage))).sort(), [students]);
  /** قائمة المراحل للمودال: مدخلات النظام + مرحلة السجل الحالي إن لم تكن في القائمة */
  const stagesForEditSelect = useMemo(() => {
    const set = new Set(knownStages.map((s) => String(s || "").trim()).filter(Boolean));
    if (editing?.stage?.trim()) set.add(editing.stage.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [knownStages, editing?.stage]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return students.filter((s) => {
      const f1 = departmentFilter === "all" || s.department === departmentFilter;
      const f2 = stageFilter === "all" || s.stage === stageFilter;
      const f3 = studyTypeFilter === "all" || s.study_type === studyTypeFilter;
      const f4 = !q || s.student_name.toLowerCase().includes(q) || s.student_code.toLowerCase().includes(q) || s.sheet_code.includes(q);
      return f1 && f2 && f3 && f4;
    });
  }, [students, departmentFilter, stageFilter, studyTypeFilter, searchTerm]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "sequence_no") {
        const an = Number(av ?? Number.MAX_SAFE_INTEGER);
        const bn = Number(bv ?? Number.MAX_SAFE_INTEGER);
        return sortDirection === "asc" ? an - bn : bn - an;
      }
      const at = String(av ?? "").toLowerCase();
      const bt = String(bv ?? "").toLowerCase();
      if (at < bt) return sortDirection === "asc" ? -1 : 1;
      if (at > bt) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDirection]);

  const sortIndicator = (k: SortKey) => (sortKey !== k ? "↕" : sortDirection === "asc" ? "↑" : "↓");
  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDirection((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDirection("asc");
    }
  };

  const resetFilters = () => {
    setDepartmentFilter("all");
    setStageFilter("all");
    setStudyTypeFilter("all");
    setSearchTerm("");
    setSortKey("sequence_no");
    setSortDirection("asc");
  };

  const handleUpload = async () => {
    if (!file) return setError("يرجى اختيار ملف Excel");
    setIsUploading(true);
    setError("");
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/correction/students/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "فشل الاستيراد");
      setMessage(data.message || "تم الاستيراد");
      setFile(null);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setIsUploading(false);
    }
  };

  const exportExcel = () => {
    if (!sorted.length) return setError("لا توجد بيانات للتصدير");
    const rows = sorted.map((s, i) => ({
      "No.": i + 1,
      "Student code": s.student_code,
      department: s.department,
      "Student name": s.student_name,
      stage: s.stage,
      "Type of study": s.study_type === "morning" ? "Morning" : "Evening",
      "Sheet code": s.sheet_code,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "correction-students.xlsx");
  };

  const exportPdf = () => {
    if (!sorted.length) return setError("لا توجد بيانات للتصدير");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Correction Students Report", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["No.", "Student code", "Department", "Student name", "Stage", "Study", "Sheet code"]],
      body: sorted.map((s, i) => [String(i + 1), s.student_code, s.department, s.student_name, s.stage, s.study_type, s.sheet_code]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    });
    doc.save("correction-students-report-a4.pdf");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setIsSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/correction/students/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "فشل التعديل");
      setEditing(null);
      setMessage("تم تعديل الطالب بنجاح");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteStudent = async (s: Student) => {
    if (!window.confirm(`حذف الطالب ${s.student_name}؟`)) return;
    setDeletingId(s.id);
    try {
      const res = await fetch(`/api/correction/students/${s.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "فشل الحذف");
      setMessage("تم حذف الطالب");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteUpload = async (u: UploadRecord) => {
    if (!window.confirm(`حذف الرفع ${u.file_name}؟`)) return;
    setDeletingUploadId(u.id);
    try {
      const res = await fetch(`/api/correction/students/uploads/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "فشل حذف الرفع");
      setMessage("تم حذف الرفع المحدد");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setDeletingUploadId(null);
    }
  };

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto w-full max-w-7xl space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">إدخال الطلبة</h1>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:max-w-md" />
            <button onClick={handleUpload} disabled={isUploading} className="rounded-lg bg-blue-900 px-5 py-2 text-sm font-semibold text-white">
              {isUploading ? "جاري الاستيراد..." : "رفع ملف الطلبة"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" placeholder="بحث بالاسم/كود الطالب/كود الورقة" />
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
              <option value="all">كل الأقسام</option>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
              <option value="all">كل المراحل</option>
              {stages.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={studyTypeFilter} onChange={(e) => setStudyTypeFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
              <option value="all">كل أنواع الدراسة</option>
              <option value="morning">صباحي</option>
              <option value="evening">مسائي</option>
            </select>
            <div className="flex gap-2">
              <button onClick={exportExcel} className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">تصدير Excel</button>
              <button onClick={exportPdf} className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">تصدير PDF</button>
              <button onClick={resetFilters} className="flex-1 rounded-lg border px-4 py-2 text-sm font-semibold">إعادة تعيين</button>
            </div>
          </div>
          {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["إجمالي الطلبة", stats.total_students],
            ["الدراسة الصباحية", stats.morning_students],
            ["الدراسة المسائية", stats.evening_students],
            ["عدد الأقسام", stats.departments_count],
          ].map(([label, value]) => (
            <article key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{label as string}</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{value as number}</p>
            </article>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  {[
                    ["sequence_no", "التسلسل"],
                    ["student_code", "كود الطالب"],
                    ["department", "القسم"],
                    ["student_name", "اسم الطالب"],
                    ["stage", "المرحلة"],
                    ["study_type", "الدراسة"],
                    ["sheet_code", "كود الورقة"],
                  ].map(([k, l]) => (
                    <th key={k} className="px-4 py-3 text-right font-semibold">
                      <button onClick={() => handleSort(k as SortKey)} className="inline-flex items-center gap-1">{l}<span>{sortIndicator(k as SortKey)}</span></button>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">لا توجد نتائج.</td></tr>
                ) : sorted.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{s.sequence_no ?? "-"}</td>
                    <td className="px-4 py-3">{s.student_code}</td>
                    <td className="px-4 py-3">{s.department}</td>
                    <td className="px-4 py-3">{s.student_name}</td>
                    <td className="px-4 py-3">{s.stage}</td>
                    <td className="px-4 py-3">{s.study_type === "morning" ? "صباحي" : "مسائي"}</td>
                    <td className="px-4 py-3 font-bold text-blue-900">{s.sheet_code}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...s })} className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white">تعديل</button>
                        <button onClick={() => deleteStudent(s)} disabled={deletingId === s.id} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white">{deletingId === s.id ? "..." : "حذف"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-base font-bold">جدول الرفعات (الملفات المرفوعة)</h3></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">اسم الملف</th>
                  <th className="px-4 py-3 text-right font-semibold">عدد الطلبة المدرجين</th>
                  <th className="px-4 py-3 text-right font-semibold">تاريخ الرفع</th>
                  <th className="px-4 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploads.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">لا توجد رفعات مسجلة.</td></tr>
                ) : uploads.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">{u.file_name}</td>
                    <td className="px-4 py-3">{u.inserted_count}</td>
                    <td className="px-4 py-3">{new Date(u.created_at).toLocaleString("ar-IQ")}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteUpload(u)} disabled={deletingUploadId === u.id} className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white">
                        {deletingUploadId === u.id ? "..." : "حذف الرفع"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {editing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white p-5">
              <h2 className="text-lg font-bold">تعديل بيانات الطالب</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={editing.sequence_no ?? ""} onChange={(e) => setEditing({ ...editing, sequence_no: e.target.value ? Number(e.target.value) : null })} className="rounded-lg border px-3 py-2 text-sm" placeholder="التسلسل" />
                <input value={editing.student_code} onChange={(e) => setEditing({ ...editing, student_code: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" placeholder="كود الطالب" />
                <select value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} className="rounded-lg border px-3 py-2 text-sm">
                  <option value="">اختر القسم</option>
                  {departments.map((d) => <option key={d}>{d}</option>)}
                </select>
                <select
                  value={editing.stage.trim()}
                  onChange={(e) => setEditing({ ...editing, stage: e.target.value })}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">اختر المرحلة</option>
                  {stagesForEditSelect.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <input value={editing.student_name} onChange={(e) => setEditing({ ...editing, student_name: e.target.value })} className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="اسم الطالب" />
                <select value={editing.study_type} onChange={(e) => setEditing({ ...editing, study_type: e.target.value as "morning" | "evening" })} className="rounded-lg border px-3 py-2 text-sm">
                  <option value="morning">صباحي</option>
                  <option value="evening">مسائي</option>
                </select>
                <input value={editing.sheet_code} onChange={(e) => setEditing({ ...editing, sheet_code: e.target.value.replace(/\D/g, "").slice(0, 5) })} className="rounded-lg border px-3 py-2 text-sm" placeholder="كود الورقة (5 أرقام)" />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm font-semibold">إلغاء</button>
                <button onClick={saveEdit} disabled={isSaving} className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white">{isSaving ? "جاري الحفظ..." : "حفظ التعديلات"}</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
