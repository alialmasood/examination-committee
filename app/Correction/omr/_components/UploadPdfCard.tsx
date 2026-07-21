"use client";

import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";

export type UploadPdfCardProps = {
  setPdfFile: Dispatch<SetStateAction<File | null>>;
  busy: boolean;
  keyLoading: boolean;
  keyReady: boolean;
  processPdf: () => Promise<void>;
  setDebugMode: Dispatch<SetStateAction<boolean>>;
  debugMode: boolean;
  error: string;
};

export function UploadPdfCard({
  setPdfFile,
  busy,
  keyLoading,
  keyReady,
  processPdf,
  setDebugMode,
  debugMode,
  error,
}: UploadPdfCardProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-600">صورة الشيت (PNG/JPG/JPEG)</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,image/tiff"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || keyLoading || !keyReady}
          onClick={() => void processPdf()}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "جاري تحليل الصورة…" : "رفع وتحليل الصورة"}
        </button>
        <Link href="/Correction/answer-key" className="rounded-lg border px-4 py-2 text-sm font-semibold">
          إدارة مفتاح الإجابة
        </Link>
        <button
          type="button"
          onClick={() => setDebugMode((v) => !v)}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
            debugMode ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white"
          }`}
        >
          {debugMode ? "Debug Mode: مفعّل" : "Debug Mode: متوقف"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
