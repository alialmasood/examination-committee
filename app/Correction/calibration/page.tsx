import { CalibrationTemplatePreview } from "../_components/CalibrationTemplatePreview";

export default function CorrectionCalibrationPage() {
  return (
    <main dir="rtl" className="min-h-full bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="text-xl font-bold text-slate-900">معايرة OMR</h1>
          <p className="mt-1 text-sm text-slate-600">
            عرض الورقة القياسية للمسح مع مواقع الفقاعات كما في خدمة Python، للتحقق البصري قبل التشغيل.
          </p>
        </header>
        <CalibrationTemplatePreview />
      </div>
    </main>
  );
}
