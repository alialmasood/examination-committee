"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "correction_system_settings_v1";

type CorrectionSystemSettings = {
  defaultPassPercent: number;
  defaultOmrDebugMode: boolean;
  showOmrDebugToggle: boolean;
  showCalibrationComparePanel: boolean;
  autoCreateBatchOnUpload: boolean;
  autoSaveReportToBatch: boolean;
  showCalibrationTab: boolean;
};

const defaultSettings: CorrectionSystemSettings = {
  defaultPassPercent: 50,
  defaultOmrDebugMode: false,
  showOmrDebugToggle: true,
  showCalibrationComparePanel: true,
  autoCreateBatchOnUpload: true,
  autoSaveReportToBatch: true,
  showCalibrationTab: true,
};

export default function CorrectionSystemPage() {
  const [settings, setSettings] = useState<CorrectionSystemSettings>(defaultSettings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CorrectionSystemSettings>;
      setSettings({
        defaultPassPercent: Number.isFinite(Number(parsed.defaultPassPercent))
          ? Math.max(0, Math.min(100, Number(parsed.defaultPassPercent)))
          : defaultSettings.defaultPassPercent,
        defaultOmrDebugMode: Boolean(parsed.defaultOmrDebugMode),
        showOmrDebugToggle:
          parsed.showOmrDebugToggle == null ? defaultSettings.showOmrDebugToggle : Boolean(parsed.showOmrDebugToggle),
        showCalibrationComparePanel:
          parsed.showCalibrationComparePanel == null
            ? defaultSettings.showCalibrationComparePanel
            : Boolean(parsed.showCalibrationComparePanel),
        autoCreateBatchOnUpload:
          parsed.autoCreateBatchOnUpload == null
            ? defaultSettings.autoCreateBatchOnUpload
            : Boolean(parsed.autoCreateBatchOnUpload),
        autoSaveReportToBatch:
          parsed.autoSaveReportToBatch == null
            ? defaultSettings.autoSaveReportToBatch
            : Boolean(parsed.autoSaveReportToBatch),
        showCalibrationTab:
          parsed.showCalibrationTab == null ? defaultSettings.showCalibrationTab : Boolean(parsed.showCalibrationTab),
      });
    } catch {
      setError("تعذر تحميل إعدادات النظام المحلية.");
    }
  }, []);

  const saveSettings = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.dispatchEvent(new Event("correction-settings-changed"));
      setMessage("تم حفظ الإعدادات بنجاح.");
      setError("");
    } catch {
      setError("تعذر حفظ الإعدادات.");
      setMessage("");
    }
  };

  const resetSettings = () => {
    const next = { ...defaultSettings };
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("correction-settings-changed"));
    } catch {
      // ignore write error, UI state still reset
    }
    setMessage("");
    setError("");
  };

  return (
    <main className="p-4 sm:p-8">
      <section className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">الإعدادات</h2>
        <p className="mt-2 text-sm text-slate-600">
          إعدادات افتراضية لوحدة التصحيح الإلكتروني. هذه الإعدادات محفوظة محليًا على نفس المتصفح.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-2 block text-sm font-semibold text-slate-700">نسبة النجاح الافتراضية (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={settings.defaultPassPercent}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultPassPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                }))
              }
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
            <p className="mt-2 text-xs text-slate-500">تستخدم تلقائيًا عند فتح صفحة تصحيح الامتحان.</p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-2 block text-sm font-semibold text-slate-700">خيارات التشغيل</label>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.defaultOmrDebugMode}
                onChange={(e) => setSettings((prev) => ({ ...prev, defaultOmrDebugMode: e.target.checked }))}
              />
              تفعيل وضع Debug للـ OMR افتراضيًا
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.showOmrDebugToggle}
                onChange={(e) => setSettings((prev) => ({ ...prev, showOmrDebugToggle: e.target.checked }))}
              />
              إظهار خيار «طلب صور تشخيص OMR من Python» في صفحة التصحيح
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.showCalibrationComparePanel}
                onChange={(e) => setSettings((prev) => ({ ...prev, showCalibrationComparePanel: e.target.checked }))}
              />
              إظهار «مقارنة إسقاط الفقاعات مع نموذج المعايرة» بعد التحليل
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.autoCreateBatchOnUpload}
                onChange={(e) => setSettings((prev) => ({ ...prev, autoCreateBatchOnUpload: e.target.checked }))}
              />
              إنشاء وجبة حفظ تلقائيًا عند رفع الملف
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.autoSaveReportToBatch}
                onChange={(e) => setSettings((prev) => ({ ...prev, autoSaveReportToBatch: e.target.checked }))}
              />
              حفظ التقرير داخل الوجبة تلقائيًا
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.showCalibrationTab}
                onChange={(e) => setSettings((prev) => ({ ...prev, showCalibrationTab: e.target.checked }))}
              />
              إظهار تبويب المعايرة في الشريط الجانبي
            </label>
          </article>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button onClick={saveSettings} className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
            حفظ الإعدادات
          </button>
          <button onClick={resetSettings} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">
            استعادة الإعدادات الافتراضية
          </button>
        </div>

        {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </section>
    </main>
  );
}
