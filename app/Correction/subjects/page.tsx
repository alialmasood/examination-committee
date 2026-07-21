"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Subject = {
  id: string;
  subject_name: string;
  subject_code: string;
  department: string;
  teacher_name: string;
  stage: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total_subjects: number;
  departments_count: number;
  teachers_count: number;
  stages_count: number;
};

type LoadResponse = {
  success?: boolean;
  subjects?: Subject[];
  stats?: Stats;
  departmentOptions?: string[];
  stageOptionsByDepartment?: Record<string, string[]>;
  studentsCount?: number;
  error?: string;
};

export default function CorrectionSubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [stats, setStats] = useState<Stats>({
    total_subjects: 0,
    departments_count: 0,
    teachers_count: 0,
    stages_count: 0,
  });
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [stageOptionsByDepartment, setStageOptionsByDepartment] = useState<Record<string, string[]>>({});
  const [studentsCount, setStudentsCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [subjectName, setSubjectName] = useState("");
  const [department, setDepartment] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [stage, setStage] = useState("");
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Subject | null>(null);
  const [editName, setEditName] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editTeacher, setEditTeacher] = useState("");
  const [editStage, setEditStage] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterTeacher, setFilterTeacher] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/correction/subjects");
      const data = (await res.json()) as LoadResponse;
      if (!res.ok || !data.success) throw new Error(data.error || "تعذر تحميل المواد");
      setSubjects(data.subjects || []);
      if (data.stats) setStats(data.stats);
      setDepartmentOptions(data.departmentOptions || []);
      setStageOptionsByDepartment(data.stageOptionsByDepartment || {});
      setStudentsCount(data.studentsCount ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير متوقع");
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stageChoicesForForm = useMemo(() => {
    if (!department) return [];
    return stageOptionsByDepartment[department] || [];
  }, [department, stageOptionsByDepartment]);

  const stageChoicesForEdit = useMemo(() => {
    if (!editDepartment) return [];
    const base = stageOptionsByDepartment[editDepartment] || [];
    if (editing && editStage && !base.includes(editStage)) return [editStage, ...base];
    return base;
  }, [editDepartment, editStage, editing, stageOptionsByDepartment]);

  const departmentOptionsForEdit = useMemo(() => {
    const s = new Set(departmentOptions);
    if (editing?.department) s.add(editing.department);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [departmentOptions, editing]);

  const filterStageOptions = useMemo(() => {
    if (filterDepartment === "all") {
      const set = new Set<string>();
      for (const s of subjects) set.add(s.stage);
      return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
    }
    return stageOptionsByDepartment[filterDepartment] || [];
  }, [filterDepartment, subjects, stageOptionsByDepartment]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ft = filterTeacher.trim().toLowerCase();
    return subjects.filter((s) => {
      if (filterDepartment !== "all" && s.department !== filterDepartment) return false;
      if (filterStage !== "all" && s.stage !== filterStage) return false;
      if (ft && !s.teacher_name.toLowerCase().includes(ft)) return false;
      if (!q) return true;
      return (
        s.subject_name.toLowerCase().includes(q) ||
        s.subject_code.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.teacher_name.toLowerCase().includes(q) ||
        s.stage.toLowerCase().includes(q)
      );
    });
  }, [subjects, search, filterDepartment, filterStage, filterTeacher]);

  useEffect(() => {
    if (filterStage !== "all" && filterDepartment !== "all" && !filterStageOptions.includes(filterStage)) {
      setFilterStage("all");
    }
  }, [filterDepartment, filterStage, filterStageOptions]);

  const handleAdd = async () => {
    const name = subjectName.trim();
    if (!name) {
      setError("يرجى إدخال اسم المادة الدراسية.");
      return;
    }
    if (!department.trim()) {
      setError("يرجى اختيار أو إدخال القسم.");
      return;
    }
    if (!teacherName.trim()) {
      setError("يرجى إدخال اسم أستاذ المادة الدراسية.");
      return;
    }
    if (!stage.trim()) {
      setError("يرجى اختيار أو إدخال المرحلة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/correction/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: name,
          department: department.trim(),
          teacherName: teacherName.trim(),
          stage: stage.trim(),
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "تعذر الإضافة");
      setMessage("تمت إضافة المادة وتوليد رمز المادة تلقائيًا.");
      setSubjectName("");
      setDepartment("");
      setTeacherName("");
      setStage("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s: Subject) => {
    setEditing(s);
    setEditName(s.subject_name);
    setEditDepartment(s.department);
    setEditTeacher(s.teacher_name);
    setEditStage(s.stage);
    setError("");
    setMessage("");
  };

  const cancelEdit = () => setEditing(null);

  const handleSaveEdit = async () => {
    if (!editing) return;
    const name = editName.trim();
    if (!name || !editDepartment.trim() || !editTeacher.trim() || !editStage.trim()) {
      setError("يرجى تعبئة جميع الحقول المطلوبة.");
      return;
    }
    setEditSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/correction/subjects/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: name,
          department: editDepartment.trim(),
          teacherName: editTeacher.trim(),
          stage: editStage.trim(),
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "تعذر الحفظ");
      setMessage("تم تحديث بيانات المادة (رمز المادة ثابت).");
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("حذف هذه المادة من السجل؟")) return;
    setDeletingId(id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/correction/subjects/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "تعذر الحذف");
      setMessage("تم حذف المادة.");
      if (editing?.id === id) setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setDeletingId(null);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setFilterDepartment("all");
    setFilterStage("all");
    setFilterTeacher("");
  };

  const useSelects = departmentOptions.length > 0;

  return (
    <main dir="rtl" className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto w-full max-w-7xl space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">إدخال المواد الدراسية</h1>
          <p className="mt-2 text-sm text-slate-600">
            ربط القسم والمرحلة ببيانات الطلبة في «ادخال الطلبة»، وتوليد رمز مادة فريد تلقائيًا لكل سجل.
          </p>

          {studentsCount === 0 ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              لا يوجد طلبة مسجّلون بعد. يُفضّل إدخال الطلبة أولًا حتى تُستدعى الأقسام والمراحل من قاعدة البيانات؛ يمكنك
              حاليًا كتابة القسم والمرحلة يدويًا.
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">اسم المادة الدراسية</label>
              <input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="مثال: تشريح عام"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">أستاذ المادة الدراسية</label>
              <input
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                placeholder="الاسم الكامل"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">اسم القسم</label>
              {useSelects ? (
                <select
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    setStage("");
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">اختر القسم</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    setStage("");
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  placeholder="اسم القسم"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">المرحلة</label>
              {useSelects && department ? (
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">اختر المرحلة</option>
                  {stageChoicesForForm.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  placeholder={useSelects ? "اختر القسم أولًا" : "مثال: المرحلة الثانية"}
                  disabled={useSelects && !department}
                />
              )}
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleAdd()}
                className="rounded-lg bg-blue-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "جاري الحفظ..." : "حفظ المادة في السجل"}
              </button>
              <span className="me-3 text-xs text-slate-500">يُولَّد رمز المادة تلقائيًا بعد الحفظ.</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm lg:col-span-2"
              placeholder="بحث بالمادة / الرمز / القسم / الأستاذ / المرحلة"
            />
            <select
              value={filterDepartment}
              onChange={(e) => {
                setFilterDepartment(e.target.value);
                setFilterStage("all");
              }}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              <option value="all">كل الأقسام</option>
              {Array.from(new Set(subjects.map((s) => s.department)))
                .sort((a, b) => a.localeCompare(b, "ar"))
                .map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
            </select>
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              <option value="all">كل المراحل</option>
              {filterStageOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={filterTeacher}
                onChange={(e) => setFilterTeacher(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                placeholder="تصفية بالأستاذ"
              />
              <button
                type="button"
                onClick={resetFilters}
                className="shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold"
              >
                إعادة تعيين
              </button>
            </div>
          </div>

          {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["إجمالي المواد", stats.total_subjects],
              ["الأقسام الممثلة", stats.departments_count],
              ["المراحل الممثلة", stats.stages_count],
              ["أساتذة مسجّلون", stats.teachers_count],
            ] as const
          ).map(([label, value]) => (
            <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
            </article>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">رمز المادة</th>
                  <th className="px-4 py-3 text-right font-semibold">اسم المادة الدراسية</th>
                  <th className="px-4 py-3 text-right font-semibold">القسم</th>
                  <th className="px-4 py-3 text-right font-semibold">أستاذ المادة</th>
                  <th className="px-4 py-3 text-right font-semibold">المرحلة</th>
                  <th className="px-4 py-3 text-right font-semibold">تاريخ التسجيل</th>
                  <th className="px-4 py-3 text-right font-semibold">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      جاري تحميل السجل…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      لا توجد نتائج.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) =>
                    editing?.id === s.id ? (
                      <tr key={s.id} className="bg-slate-50">
                        <td className="px-4 py-3 align-top">
                          <span className="font-bold text-blue-900">{s.subject_code}</span>
                          <span className="mt-1 block text-xs text-slate-500">ثابت</span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full min-w-[8rem] rounded-lg border px-3 py-2 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          {useSelects ? (
                            <select
                              value={editDepartment}
                              onChange={(e) => {
                                setEditDepartment(e.target.value);
                                setEditStage("");
                              }}
                              className="w-full rounded-lg border px-3 py-2 text-sm"
                            >
                              {departmentOptionsForEdit.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={editDepartment}
                              onChange={(e) => setEditDepartment(e.target.value)}
                              className="w-full rounded-lg border px-3 py-2 text-sm"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={editTeacher}
                            onChange={(e) => setEditTeacher(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          {useSelects && editDepartment ? (
                            <select
                              value={editStage}
                              onChange={(e) => setEditStage(e.target.value)}
                              className="w-full rounded-lg border px-3 py-2 text-sm"
                            >
                              {stageChoicesForEdit.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={editStage}
                              onChange={(e) => setEditStage(e.target.value)}
                              className="w-full rounded-lg border px-3 py-2 text-sm"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400">—</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={editSaving}
                              onClick={() => void handleSaveEdit()}
                              className="rounded-md bg-blue-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {editSaving ? "..." : "حفظ"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-md border px-3 py-1 text-xs font-semibold"
                            >
                              إلغاء
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-blue-900">{s.subject_code}</td>
                        <td className="px-4 py-3">{s.subject_name}</td>
                        <td className="px-4 py-3">{s.department}</td>
                        <td className="px-4 py-3">{s.teacher_name}</td>
                        <td className="px-4 py-3">{s.stage}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {s.created_at ? new Date(s.created_at).toLocaleString("ar-IQ") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white"
                            >
                              تعديل
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === s.id}
                              onClick={() => void handleDelete(s.id)}
                              className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {deletingId === s.id ? "..." : "حذف"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        {!loading && subjects.length > 0 ? (
          <p className="text-center text-sm text-slate-500">
            عرض {filtered.length} من أصل {subjects.length} مادة في السجل
          </p>
        ) : null}
      </section>
    </main>
  );
}
