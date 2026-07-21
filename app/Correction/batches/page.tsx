"use client";

import { useEffect, useMemo, useState } from "react";

type BatchRow = {
  id: string;
  sheet_export_id: string | null;
  batch_name: string | null;
  source_file_name: string;
  source_file_mime: string | null;
  source_file_size_bytes: number | null;
  source_file_sha256: string | null;
  status: string;
  current_step: string;
  pass_percent: number | null;
  created_at: string;
  updated_at: string;
  has_source_file: boolean;
  has_report_file: boolean;
  subject_name: string | null;
  exam_date: string | null;
};

type BatchEvent = {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
};

type BatchDetails = {
  id: string;
  sheet_export_id: string | null;
  batch_name: string | null;
  source_file_name: string;
  source_file_mime: string | null;
  source_file_size_bytes: number | null;
  source_file_sha256: string | null;
  status: string;
  current_step: string;
  pass_percent: number | null;
  analyze_payload: unknown;
  correction_payload: unknown;
  detailed_payload: unknown;
  custom_payload: unknown;
  report_file_name: string | null;
  report_file_mime: string | null;
  has_source_file: boolean;
  has_report_file: boolean;
  analysis_report_file_name: string | null;
  analysis_report_file_mime: string | null;
  has_analysis_report_file: boolean;
  report_payload: unknown;
  created_at: string;
  updated_at: string;
};

export default function CorrectionBatchesPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [details, setDetails] = useState<BatchDetails | null>(null);
  const [events, setEvents] = useState<BatchEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadBatches = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/correction/batches", { cache: "no-store" });
      const data = (await res.json()) as { success?: boolean; batches?: BatchRow[]; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "تعذر تحميل وجبات التصحيح.");
      }
      const rows = Array.isArray(data.batches) ? data.batches : [];
      setBatches(rows);
      if (rows.length > 0 && !selectedBatchId) {
        setSelectedBatchId(rows[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء تحميل الوجبات.");
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (batchId: string) => {
    if (!batchId) return;
    setDetailsLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/correction/batches/${batchId}`, { cache: "no-store" });
      const data = (await res.json()) as {
        success?: boolean;
        batch?: BatchDetails;
        events?: BatchEvent[];
        error?: string;
      };
      if (!res.ok || !data.success || !data.batch) {
        throw new Error(data.error || "تعذر تحميل تفاصيل الوجبة.");
      }
      setDetails(data.batch);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء تحميل التفاصيل.");
      setDetails(null);
      setEvents([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    void loadBatches();
  }, []);

  useEffect(() => {
    if (!selectedBatchId) return;
    void loadDetails(selectedBatchId);
  }, [selectedBatchId]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => {
      return (
        String(b.source_file_name || "").toLowerCase().includes(q) ||
        String(b.batch_name || "").toLowerCase().includes(q) ||
        String(b.subject_name || "").toLowerCase().includes(q) ||
        String(b.status || "").toLowerCase().includes(q) ||
        String(b.id || "").toLowerCase().includes(q)
      );
    });
  }, [batches, searchTerm]);

  const formatBytes = (n: number | null | undefined): string => {
    if (!n || n <= 0) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  const downloadFile = (url: string) => {
    window.open(url, "_blank");
  };

  const deleteBatch = async (batchId: string) => {
    if (!window.confirm("هل تريد حذف وجبة التصحيح هذه نهائيًا؟")) return;
    setDeletingId(batchId);
    setError("");
    try {
      const res = await fetch(`/api/correction/batches/${batchId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "تعذر حذف الوجبة.");
      }
      const next = batches.filter((b) => b.id !== batchId);
      setBatches(next);
      if (selectedBatchId === batchId) {
        const fallbackId = next[0]?.id || "";
        setSelectedBatchId(fallbackId);
        if (!fallbackId) {
          setDetails(null);
          setEvents([]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ أثناء حذف الوجبة.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <section className="mx-auto w-full max-w-7xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">وجبات التصحيح المحفوظة</h1>
              <p className="mt-1 text-sm text-slate-600">أرشيف العمليات الكاملة لرفع وتحليل وتصحيح الامتحانات.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void loadBatches()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
                تحديث القائمة
              </button>
            </div>
          </div>
          <div className="mt-4">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث بالملف/المادة/الحالة/المعرف"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold">
                {loading ? "جاري التحميل..." : `عدد الوجبات: ${filtered.length}`}
              </div>
              <div className="max-h-[70vh] overflow-y-auto">
                <ul className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <li className="px-4 py-6 text-center text-sm text-slate-500">لا توجد وجبات محفوظة.</li>
                  ) : (
                    filtered.map((b) => (
                      <li key={b.id}>
                        <div className={`px-4 py-3 ${selectedBatchId === b.id ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}>
                          <button onClick={() => setSelectedBatchId(b.id)} className="w-full text-right">
                            <p className="truncate text-sm font-bold text-slate-900">
                              {b.batch_name || b.subject_name || b.source_file_name || "بدون اسم وجبة"}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              الملف: {b.source_file_name || "—"} | {b.status} | {new Date(b.created_at).toLocaleString("ar-IQ")}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{b.id}</p>
                          </button>
                          <div className="mt-2 flex justify-end">
                            <button
                              onClick={() => void deleteBatch(b.id)}
                              disabled={deletingId === b.id}
                              className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {deletingId === b.id ? "جاري الحذف..." : "حذف الوجبة"}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {detailsLoading ? (
                <p className="text-sm text-slate-600">جاري تحميل التفاصيل...</p>
              ) : !details ? (
                <p className="text-sm text-slate-500">اختر وجبة من القائمة لعرض التفاصيل.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">اسم الوجبة</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {details.batch_name || "—"}
                      </p>
                    </article>
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">اسم الملف</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{details.source_file_name}</p>
                    </article>
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">الحالة الحالية</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {details.status} / {details.current_step}
                      </p>
                    </article>
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">حجم الملف</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatBytes(details.source_file_size_bytes)}</p>
                    </article>
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">نسبة النجاح المعتمدة</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {details.pass_percent == null ? "—" : `${Number(details.pass_percent).toFixed(2)}%`}
                      </p>
                    </article>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={!details.has_source_file}
                      onClick={() => downloadFile(`/api/correction/batches/${details.id}/source`)}
                      className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      تنزيل الملف المرفوع
                    </button>
                    <button
                      disabled={!details.has_report_file}
                      onClick={() => downloadFile(`/api/correction/batches/${details.id}/report`)}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      تنزيل التقرير المحفوظ
                    </button>
                    <button
                      disabled={!details.has_analysis_report_file}
                      onClick={() => downloadFile(`/api/correction/batches/${details.id}/analysis-report`)}
                      className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      تنزيل تقرير التحليل
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold">سجل الأحداث</div>
                    <div className="max-h-72 overflow-y-auto">
                      <ul className="divide-y divide-slate-100">
                        {events.length === 0 ? (
                          <li className="px-4 py-4 text-sm text-slate-500">لا توجد أحداث مسجلة.</li>
                        ) : (
                          events.map((ev) => (
                            <li key={ev.id} className="px-4 py-3">
                              <p className="text-sm font-semibold text-slate-900">{ev.event_type}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{new Date(ev.created_at).toLocaleString("ar-IQ")}</p>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
