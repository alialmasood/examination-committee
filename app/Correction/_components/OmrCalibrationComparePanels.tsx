"use client";

import type { NormPoint } from "@/src/lib/correction/merge-calibration-overlay-points";

type Props = {
  calibrationImageSrc: string;
  pageWidth: number;
  pageHeight: number;
  /** نقاط الفقاعات (0..1) بعد دمج معايرة الواجهة المحفوظة — نفسها على اللوحتين */
  overlayPoints: NormPoint[];
  /** صورة الشيت بعد التصحيح من Python (مفضّلة للمقارنة الدقيقة) */
  examWarpedSrc: string | null;
  /** معاينة أول صفحة من الملف الأصلي إن لم يتوفر warped */
  examFallbackSrc?: string | null;
  /**
   * إزاحة إضافية على المحور الرأسي لمراكز الدوائر (وحدات ny من 0…1) عند عرض المعاينة الخام فقط —
   * تُقدَّر من قطر الفقاعة في القالب (~قطر فقاعة بالبكسل ÷ ارتفاع الصفحة) لتقريب الإسقاط إلى الشيت.
   */
  examFallbackNyShift?: number;
  /** إزاحة إضافية على عمود ملف الاختبار فقط (عرض؛ سالبة = للأعلى) — لا تغيّر قراءة المحرك */
  examScanNyNudge?: number;
};

function toImgSrc(raw: string): string {
  if (raw.startsWith("data:")) return raw;
  return `data:image/png;base64,${raw}`;
}

/**
 * صورة بأبعاد نسبية مطابقة للقالب (pageWidth/pageHeight) + دوائر الفقاعات بنفس nx/ny المعايرة.
 * يُستخدم في مقارنة المعايرة وفي معاينة صفحات الاختبار المرفوعة.
 */
export function CalibrationNormOverlayPanel({
  title,
  subtitle,
  imageSrc,
  aspectW,
  aspectH,
  points,
  empty,
  nyShift = 0,
}: {
  title: string;
  subtitle?: string;
  imageSrc: string | null;
  aspectW: number;
  aspectH: number;
  points: NormPoint[];
  empty?: boolean;
  /** إزاحة على ny (زيادة = للأسفل في اتجاه الصفحة) */
  nyShift?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="mb-1 text-sm font-bold text-slate-900">{title}</p>
      {subtitle ? <p className="mb-2 text-xs text-slate-600">{subtitle}</p> : null}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 shadow-sm"
        style={{ aspectRatio: `${aspectW} / ${aspectH}` }}
      >
        {empty || !imageSrc ? (
          <div className="flex h-full min-h-[200px] items-center justify-center p-4 text-center text-sm text-slate-500">
            لا توجد صورة للعرض بعد.
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toImgSrc(imageSrc)} alt="" className="absolute inset-0 h-full w-full object-contain" />
            <div className="pointer-events-none absolute inset-0">
              {points.map((p, i) => {
                const ny = Math.min(1, Math.max(0, p.ny + nyShift));
                return (
                <span
                  key={i}
                  className="absolute rounded-full border-2 border-red-500 bg-red-500/20"
                  style={{
                    left: `${p.nx * 100}%`,
                    top: `${ny * 100}%`,
                    width: "1.65%",
                    aspectRatio: "1",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function OmrCalibrationComparePanels({
  calibrationImageSrc,
  pageWidth,
  pageHeight,
  overlayPoints,
  examWarpedSrc,
  examFallbackSrc,
  examFallbackNyShift = 0,
  examScanNyNudge = 0,
}: Props) {
  const examSrc = examWarpedSrc || examFallbackSrc || null;
  const examUsingRawFallback = Boolean(examFallbackSrc) && !examWarpedSrc;
  const rawShiftPct = Math.abs(examFallbackNyShift) * 100;
  const rawShiftHint =
    rawShiftPct < 1e-5
      ? "لا إزاحة صافية مطبّقة على دوائر المعاينة الخام حاليًا."
      : `إزاحة صافية على الدوائر للعرض فقط ≈ ${rawShiftPct.toFixed(2)}% من ارتفاع الصفحة (${examFallbackNyShift >= 0 ? "للأسفل" : "للأعلى"}).`;
  const examSubtitle = examWarpedSrc
    ? "صورة warped من Python: نفس نقاط المعايرة؛ يُسمح بإزاحة عرض طفيفة للأعلى على عمود الملف الممسوح فقط لتقريب الدوائر بصريًا (لا تُغيّر حساب القراءة في الخادم)."
    : examFallbackSrc
      ? `معاينة خام (أول صفحة داخل المتصفح، ليس مسار القراءة). نفس نقاط المعايرة؛ ${rawShiftHint} للتحقق من تطابق الإسقاط مع القراءة استخدم صورة warped.`
      : "فعّل «طلب صور تشخيص OMR من Python» ثم «تحليل الملف» لعرض الشيت بعد التصحيح (warped) هنا.";

  return (
    <section className="mt-6 rounded-xl border border-rose-200 bg-rose-50/40 p-4">
      <h3 className="mb-1 text-base font-bold text-slate-900">مقارنة إسقاط الفقاعات مع نموذج المعايرة</h3>
      <p className="mb-4 text-xs leading-relaxed text-slate-700">
        <strong>يشترك العمودان في نفس القائمة <code className="rounded bg-white/80 px-0.5">overlayPoints</code></strong> من المعايرة. على عمود «ملف الاختبار» قد تُضاف <strong>إزاحات عرض فقط</strong> (بما فيها تقريب للأعلى على الشيت الممسوح) لتحسين المطابقة البصرية؛ قراءة المحرك تعتمد على الإحداثيات الأصلية على صورة warped.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CalibrationNormOverlayPanel
          title="نموذج المعايرة"
          subtitle={`صورة ${pageWidth}×${pageHeight} من خادم المعايرة — نفس مسار /Correction/calibration`}
          imageSrc={calibrationImageSrc}
          aspectW={pageWidth}
          aspectH={pageHeight}
          points={overlayPoints}
        />
        <CalibrationNormOverlayPanel
          title="ملف الاختبار (المستدعى)"
          subtitle={examSubtitle}
          imageSrc={examSrc}
          aspectW={pageWidth}
          aspectH={pageHeight}
          points={overlayPoints}
          empty={!examSrc}
          nyShift={(examUsingRawFallback ? examFallbackNyShift : 0) + examScanNyNudge}
        />
      </div>
      {examWarpedSrc ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-xs leading-relaxed text-emerald-950">
          <strong>تشخيص OMR نشط:</strong> أساس الإسقاط هو nx/ny من المعايرة على صورة{" "}
          <code className="rounded bg-emerald-100 px-1">warped</code> كما في المحرك؛ على هذا العمود قد تُطبَّق إزاحة عرض
          بسيطة للأعلى (من إعدادات الصفحة) فقط لتحسين المطابقة مع التظليل الظاهر.
        </p>
      ) : null}
      {!examWarpedSrc ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">
            للمقارنة الموثوقة مع دوائر القراءة الفعلية: فعّل «طلب صور تشخيص OMR من Python» ثم أعد «تحليل الملف»
            — ستُعرض صورة <code className="rounded bg-amber-100 px-1">warped</code> التي يُحسب عليها nx/ny.
          </p>
          {examUsingRawFallback ? (
            <p className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-950">
              إذا رأيت الدوائر «مرتفعة» أو منزاحة عن الشيت أثناء عرض PDF هنا، فهذا لا يعني بالضرورة خطأ في المعايرة:
              ملف PDF للمسح غالبًا لا يكون مطابقًا هندسيًا للقالب الثابت (هوامش، مقص ضوئي، مقاس صفحة مختلف)، بينما
              النظام يطبّق الفقاعات على الصفحة بعد التصحيح وليس على معاينة المتصفح.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
