"use client";

import { flushSync } from "react-dom";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  type CSSProperties,
} from "react";
import {
  EMPTY_SAMPLE_STUDENT,
  type SheetStudent,
} from "@/app/Correction/_components/CorrectionExamSheet";
import {
  rasterImageDataUrlToTemplatePixels,
  rasterPdfFirstPageToTemplatePixels,
} from "@/src/lib/correction/omr-template-raster";

type StudentsResponse = { success: boolean; students: SheetStudent[]; error?: string };

type CatalogSubject = {
  id: string;
  subject_name: string;
  subject_code: string;
  department: string;
  teacher_name: string;
  stage: string;
};

type SubjectsResponse = { success: boolean; subjects?: CatalogSubject[]; error?: string };
type SheetTemplateOption = { code: "OMR_25" | "OMR_50" | "OMR_75" | "OMR_100"; questionCount: 25 | 50 | 75 | 100; label: string };
type TemplatePreviewResponse = {
  success?: boolean;
  imageDataUrl?: string;
  templateImageName?: string;
  templateAssetName?: string;
  previewDataUrl?: string;
  previewMime?: string;
  template?: { pageWidth?: number; pageHeight?: number };
  error?: string;
};

/** تاريخ اليوم YYYY-MM-DD حسب التوقيت المحلي (متوافق مع input[type=date]) */
function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SLICE_KEY_SEP = "\x1e";
const SHEET_TEMPLATE_OPTIONS: SheetTemplateOption[] = [
  { code: "OMR_25", questionCount: 25, label: "نموذج 25 سؤال" },
  { code: "OMR_50", questionCount: 50, label: "نموذج 50 سؤال" },
  { code: "OMR_75", questionCount: 75, label: "نموذج 75 سؤال" },
  { code: "OMR_100", questionCount: 100, label: "نموذج 100 سؤال" },
];

/** موضع وحجم مربع الـ QR فوق صورة النموذج (نسب مئوية من عرض/ارتفاع الصورة). عدّل هنا لكل نموذج حسب الطباعة الفعلية. */
const SHEET_QR_BOX_BY_TEMPLATE: Record<
  SheetTemplateOption["code"],
  { top: string; right: string; width: string }
> = {
  // مُستخرج تلقائيًا من صور النماذج في services/omr-python (نفس مربع الـ QR في الأربعة حاليًا)
  // نصف الحجم السابق (كان 18.5%)
  OMR_25: { top: "6.650%", right: "4.850%", width: "12.8%" },
  OMR_50: { top: "6.650%", right: "4.850%", width: "12.8%" },
  OMR_75: { top: "6.650%", right: "4.850%", width: "12.8%" },
  OMR_100: { top: "6.650%", right: "4.850%", width: "12.8%" },
};

/** إزاحة ترويسة الوزارة/الكلية نحو حافة اليسار (تقليل `left`) */
const SHEET_LEFT_HEADER_NUDGE = "12.5%";

/** إزاحة طفيفة نحو اليمين لكتلة الوزارة/الكلية/المادة/الطالب/القسم */
const SHEET_LEFT_HEADER_BIAS_RIGHT = "7.5%";

/** إزاحة لوحة «المرحلة / تاريخ الامتحان / كود الطالب» نسبةً لموضع الـ QR */
const SHEET_META_TOP_OFFSET = "0.55%";

/** إنزال الترويسة والحقول والباركود/QR نحو الأسفل بمقدار ~سطرين (حوالي 8mm من ارتفاع A4) */
const SHEET_OVERLAY_NUDGE_DOWN = "2.7%";

/** تصغير مرئي للـ QR داخل المربع (لا يغيّر موضع المربع نفسه) */
const SHEET_QR_IMAGE_SCALE = 1;

/**
 * أثناء ضبط الموقع: نعرض QR افتراضي (SVG محلي) حتى لا يظهر مربع أبيض إذا تعذر تحميل صورة QR من الإنترنت.
 * عند الانتهاء من الضبط، اجعلها false لإخفاء الطبقة الافتراضية.
 */
const SHEET_QR_SHOW_ALIGN_PLACEHOLDER = false;

function sheetQrBoxStyle(templateCode: SheetTemplateOption["code"]) {
  return SHEET_QR_BOX_BY_TEMPLATE[templateCode] ?? SHEET_QR_BOX_BY_TEMPLATE.OMR_25;
}

/** ترويسة يسار الصفحة (وزارة / كلية)، مقابل جانب الـ QR */
function sheetLeftHeaderBoxStyle(templateCode: SheetTemplateOption["code"]): CSSProperties {
  const qr = sheetQrBoxStyle(templateCode);
  return {
    position: "absolute",
    top: `calc(${qr.top} + ${SHEET_OVERLAY_NUDGE_DOWN})`,
    left: `calc(${qr.right} - ${SHEET_LEFT_HEADER_NUDGE} + ${SHEET_LEFT_HEADER_BIAS_RIGHT})`,
    width: "40%",
    maxWidth: "48%",
  };
}

/** بيانات الطالب بجوار مربع الـ QR (إلى يسار المربع على الصفحة، أي بعيدًا عن حافة اليمين) */
function sheetMetaBoxStyle(templateCode: SheetTemplateOption["code"]): CSSProperties {
  const qr = sheetQrBoxStyle(templateCode);
  return {
    position: "absolute",
    top: `calc(${qr.top} + ${SHEET_META_TOP_OFFSET} + ${SHEET_OVERLAY_NUDGE_DOWN})`,
    right: `calc(${qr.right} + ${qr.width} + 1.2%)`,
    width: "38%",
    maxWidth: "46%",
  };
}

function formatExamDateForSheet(iso: string) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function buildSlicesFromSelected(selected: SheetStudent[]) {
  const map = new Map<string, SheetStudent[]>();
  for (const s of selected) {
    const key = `${s.department}${SLICE_KEY_SEP}${s.stage}${SLICE_KEY_SEP}${s.study_type}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([key, students]) => {
    const [department, stage, st] = key.split(SLICE_KEY_SEP);
    const studyType = st === "evening" ? "evening" : "morning";
    return { department, stage, studyType, students };
  });
}

function normalizeFiveDigitSheetCode(raw: string): string | null {
  const digits = String(raw || "")
    .trim()
    .replace(/\D/g, "");
  const last5 = digits.slice(-5);
  return /^\d{5}$/.test(last5) ? last5 : null;
}

function sheetQrPayload(student: SheetStudent) {
  const normalized = normalizeFiveDigitSheetCode(String(student.sheet_code || ""));
  if (normalized) return normalized;
  if (student.id === "sample") return "00000";
  return "";
}

function alignPlaceholderQrDataUrl() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="510" height="510" viewBox="0 0 510 510">
  <rect width="510" height="510" fill="#ffffff"/>
  <rect x="17" y="17" width="476" height="476" fill="none" stroke="#111827" stroke-width="12"/>
  <g fill="#111827">
    <rect x="51" y="51" width="119" height="119"/>
    <rect x="340" y="51" width="119" height="119"/>
    <rect x="51" y="340" width="119" height="119"/>
    <rect x="85" y="85" width="51" height="51" fill="#ffffff"/>
    <rect x="374" y="85" width="51" height="51" fill="#ffffff"/>
    <rect x="85" y="374" width="51" height="51" fill="#ffffff"/>
  </g>
  <g fill="#111827" opacity="0.92">
    <rect x="222" y="222" width="17" height="17"/><rect x="255" y="222" width="17" height="17"/><rect x="288" y="222" width="17" height="17"/>
    <rect x="222" y="255" width="17" height="17"/><rect x="272" y="255" width="17" height="17"/><rect x="323" y="255" width="17" height="17"/>
    <rect x="205" y="288" width="17" height="17"/><rect x="255" y="288" width="17" height="17"/><rect x="306" y="288" width="17" height="17"/>
    <rect x="238" y="323" width="17" height="17"/><rect x="289" y="323" width="17" height="17"/><rect x="340" y="323" width="17" height="17"/>
    <rect x="205" y="357" width="17" height="17"/><rect x="272" y="357" width="17" height="17"/><rect x="340" y="357" width="17" height="17"/>
  </g>
  <text x="255" y="489" text-anchor="middle" font-size="30" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" fill="#64748b">ALIGN</text>
</svg>`.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function SheetQrSlot({
  student,
  subjectName,
  examDate,
  qrPayloadMode,
  printQrAckId,
  onPrintQrAck,
}: {
  student: SheetStudent;
  subjectName: string;
  examDate: string;
  /** link = رابط قصير (QR أقل ازدحامًا). richText = كل النصوص داخل QR. */
  qrPayloadMode: "link" | "richText";
  /** عند الطباعة: معرّف الطالب لتمريره لـ onPrintQrAck */
  printQrAckId?: string;
  /** يُستدعى مرة عند جاهزية صورة QR لهذا الطالب (قبل window.print) */
  onPrintQrAck?: (studentId: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const printNotifiedRef = useRef(false);
  const placeholderSrc = alignPlaceholderQrDataUrl();

  const firePrintAck = useCallback(() => {
    if (!printQrAckId || !onPrintQrAck || printNotifiedRef.current) return;
    printNotifiedRef.current = true;
    onPrintQrAck(printQrAckId);
  }, [printQrAckId, onPrintQrAck]);

  useEffect(() => {
    printNotifiedRef.current = false;
  }, [printQrAckId, imgSrc]);

  useEffect(() => {
    const code = sheetQrPayload(student);
    if (!code) {
      setImgSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setFailed(true);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    setFailed(false);
    setImgSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    void (async () => {
      try {
        const publicBaseUrl =
          (typeof window !== "undefined" && window.location?.origin) ||
          (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")) ||
          "";
        const res = await fetch("/api/correction/omr/sheet-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sheetCode: code,
            payloadMode: qrPayloadMode,
            ...(qrPayloadMode === "link" && publicBaseUrl ? { publicBaseUrl } : {}),
            subjectName,
            examDate,
            studentName: student.student_name,
            department: student.department,
            stage: student.stage,
            ...(student.id !== "sample" ? { studyType: student.study_type } : {}),
            studentCode: student.student_code,
            size: 510,
            margin: 1,
          }),
        });
        if (!res.ok) throw new Error("qr");
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        createdUrl = u;
        setImgSrc(u);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [student, subjectName, examDate, qrPayloadMode]);

  useLayoutEffect(() => {
    if (!printQrAckId || !onPrintQrAck || !imgSrc) return;
    const el = imgElRef.current;
    if (el?.complete && el.naturalWidth > 0) firePrintAck();
  }, [printQrAckId, onPrintQrAck, imgSrc, firePrintAck]);

  return (
    <div className="relative h-full w-full">
      {SHEET_QR_SHOW_ALIGN_PLACEHOLDER ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={placeholderSrc}
          alt="QR افتراضي لضبط الموقع"
          className="h-full w-full origin-center object-contain"
          style={{ transform: `scale(${SHEET_QR_IMAGE_SCALE})` }}
        />
      ) : failed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={placeholderSrc}
          alt="QR افتراضي (فشل تحميل QR الحقيقي)"
          className="h-full w-full origin-center object-contain"
          style={{ transform: `scale(${SHEET_QR_IMAGE_SCALE})` }}
        />
      ) : imgSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          ref={imgElRef}
          src={imgSrc}
          alt={`QR ورقة ${sheetQrPayload(student)}`}
          className="h-full w-full origin-center object-contain"
          style={{ transform: `scale(${SHEET_QR_IMAGE_SCALE})` }}
          onLoad={firePrintAck}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-slate-100 print:bg-white" aria-hidden />
      )}
    </div>
  );
}

function SheetPrintInstitutionOverlay({
  templateCode,
  subjectName,
  student,
}: {
  templateCode: SheetTemplateOption["code"];
  subjectName: string;
  student: SheetStudent;
}) {
  const subjectLine = String(subjectName || "").trim() || "";
  const nameLine = String(student.student_name || "").trim() || "";
  const deptLine = String(student.department || "").trim() || "";
  return (
    <div
      dir="rtl"
      className="absolute text-right text-slate-900 print:text-black"
      style={{
        ...sheetLeftHeaderBoxStyle(templateCode),
        fontSize: "3mm",
        lineHeight: "4mm",
      }}
    >
      <p className="m-0 p-0 font-semibold">وزارة التعليم العالي والبحث العلمي</p>
      <p className="m-0 mt-[0.4em] p-0 font-semibold">كلية الشرق التقنية التخصصية</p>
      <div className="mt-[0.55em] flex flex-col gap-[0.4em] font-medium">
        <div>
          <span className="font-bold">اسم المادة الامتحانية:</span> {subjectLine}
        </div>
        <div>
          <span className="font-bold">اسم الطالب:</span> {nameLine}
        </div>
        <div>
          <span className="font-bold">القسم:</span> {deptLine}
        </div>
      </div>
    </div>
  );
}

function SheetPrintMetaOverlay({
  student,
  examDate,
  templateCode,
}: {
  student: SheetStudent;
  examDate: string;
  templateCode: SheetTemplateOption["code"];
}) {
  const stage = String(student.stage || "").trim() || "";
  const isPlaceholderStudent = student.id === "sample";
  const studyLabel =
    isPlaceholderStudent ? "" : student.study_type === "evening" ? "مسائي" : "صباحي";
  const stageWithStudy = [stage, studyLabel].filter(Boolean).join("، ");
  const studentCode = String(student.student_code || "").trim() || "";
  const dateLine = formatExamDateForSheet(examDate);
  return (
    <div
      dir="rtl"
      className="absolute text-right font-medium text-slate-900 print:text-black"
      style={{
        ...sheetMetaBoxStyle(templateCode),
        fontSize: "3mm",
        lineHeight: "4mm",
      }}
    >
      <div className="flex flex-col gap-[0.45em]">
        <div>
          <span className="font-bold">المرحلة:</span> {stageWithStudy}
        </div>
        <div>
          <span className="font-bold">تاريخ الامتحان:</span> {dateLine}
        </div>
        <div>
          <span className="font-bold">كود الطالب:</span>{" "}
          <span dir="ltr" className="inline-block font-mono" style={{ unicodeBidi: "plaintext" }}>
            {studentCode}
          </span>
        </div>
        <p className="m-0 mt-[0.55em] p-0 font-bold">الامتحانات النهائية 2025-2026</p>
      </div>
    </div>
  );
}

function SheetQrWithCodeColumn({
  student,
  templateCode,
  subjectName,
  examDate,
  qrPayloadMode,
  printQrAckId,
  onPrintQrAck,
}: {
  student: SheetStudent;
  templateCode: SheetTemplateOption["code"];
  subjectName: string;
  examDate: string;
  qrPayloadMode: "link" | "richText";
  printQrAckId?: string;
  onPrintQrAck?: (studentId: string) => void;
}) {
  const qr = sheetQrBoxStyle(templateCode);
  const code = sheetQrPayload(student) || "";
  return (
    <div
      className="absolute flex flex-col items-stretch"
      style={{ top: `calc(${qr.top} + ${SHEET_OVERLAY_NUDGE_DOWN})`, right: qr.right, width: qr.width }}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-white">
        <SheetQrSlot
          student={student}
          subjectName={subjectName}
          examDate={examDate}
          qrPayloadMode={qrPayloadMode}
          printQrAckId={printQrAckId}
          onPrintQrAck={onPrintQrAck}
        />
      </div>
      <div
        className="mt-[0.12em] text-center font-mono font-semibold leading-none text-slate-900 print:text-black"
        style={{ fontSize: "2.5mm" }}
      >
        {code}
      </div>
    </div>
  );
}

const INSTITUTION_LINES = [
  "وزارة التعليم العالي والبحث العلمي",
  "كلية الشرق التقنية التخصصية",
] as const;

function SheetExportCoverReport({
  generated,
  department,
  stage,
  studyType,
  subjectName,
  subjectCode,
  examDate,
  teacherName,
  templateLabel,
  templateCode,
  questionCount,
  templateImageName,
  sheetBackgroundSource,
  qrPayloadMode,
}: {
  generated: SheetStudent[];
  department: string;
  stage: string;
  studyType: "all" | "morning" | "evening";
  subjectName: string;
  subjectCode: string;
  examDate: string;
  teacherName: string;
  templateLabel: string;
  templateCode: string;
  questionCount: number;
  templateImageName: string;
  sheetBackgroundSource: "canonical" | "folder";
  qrPayloadMode: "link" | "richText";
}) {
  const examDateDisplay = formatExamDateForSheet(examDate);
  const filterDept = department === "all" ? "كل الأقسام" : department;
  const filterStage = stage === "all" ? "كل المراحل" : stage;
  const filterStudy =
    studyType === "all" ? "كل الأنواع" : studyType === "morning" ? "صباحي" : "مسائي";
  const bgLabel =
    sheetBackgroundSource === "canonical" ? "شيت مُولَّد (SVG) من النظام" : "ملف PDF من المجلد (نموذج المعايرة)";
  const qrLabel = qrPayloadMode === "link" ? "مضغوط — رابط + كود الورقة" : "نص كامل داخل الرمز";
  const issuedAt = useMemo(
    () =>
      new Intl.DateTimeFormat("ar-IQ", { dateStyle: "long", timeStyle: "short" }).format(new Date()),
    []
  );
  const sliceRows = useMemo(() => buildSlicesFromSelected(generated), [generated]);

  return (
    <section
      dir="rtl"
      className="sheet-export-cover mx-auto mb-4 w-full max-w-[210mm] border border-slate-200 bg-white text-slate-900 shadow-sm print:mb-0 print:max-w-none print:shadow-none print:break-after-page"
    >
      <div className="border-b-4 border-slate-800 bg-gradient-to-b from-slate-50 to-white px-6 pb-5 pt-6 print:border-slate-900 print:bg-white print:from-white print:to-white">
        <p className="text-center text-[11px] font-semibold leading-relaxed text-slate-600 print:text-slate-800">
          {INSTITUTION_LINES[0]}
        </p>
        <p className="mt-0.5 text-center text-sm font-bold text-slate-900 print:text-black">{INSTITUTION_LINES[1]}</p>
        <div className="mx-auto mt-4 max-w-md border-y border-slate-300 py-2 text-center print:border-slate-400">
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 print:text-base">
            تقرير تأكيد تصدير أوراق الاستجابة (OMR)
          </h1>
          <p className="mt-1 text-xs text-slate-600 print:text-slate-700">بطاقة مراجعة قبل الطباعة — الامتحانات النهائية 2025-2026</p>
        </div>
      </div>

      <div className="px-5 pb-2 pt-4 sm:px-6">
        <h2 className="mb-3 flex items-center gap-2 border-r-4 border-blue-800 pr-2 text-sm font-bold text-slate-900 print:border-slate-800">
          بيانات الامتحان المحدد
        </h2>
        <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-2.5">
          {[
            { k: "المادة الامتحانية", v: subjectName || "—" },
            { k: "رمز المادة", v: subjectCode ? <span dir="ltr" className="font-mono">{subjectCode}</span> : "—" },
            { k: "تاريخ الامتحان", v: examDateDisplay || "—" },
            { k: "أستاذ المادة", v: teacherName || "—" },
            { k: "نموذج الشيت", v: `${templateLabel} (${templateCode})` },
            { k: "عدد الأسئلة", v: String(questionCount) },
            { k: "ملف النموذج", v: templateImageName || "—" },
            { k: "خلفية الشيت", v: bgLabel },
            { k: "وضع رمز QR", v: qrLabel },
            { k: "نطاق التصدير — القسم", v: filterDept },
            { k: "نطاق التصدير — المرحلة", v: filterStage },
            { k: "نطاق التصدير — نوع الدراسة", v: filterStudy },
            { k: "إجمالي أوراق الطباعة التالية", v: `${generated.length} ورقة` },
          ].map(({ k, v }) => (
            <div
              key={k}
              className="flex flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 print:border-slate-200 print:bg-white"
            >
              <dt className="text-[11px] font-semibold text-slate-500 print:text-slate-600">{k}</dt>
              <dd className="text-sm font-medium text-slate-900 print:text-black">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {sliceRows.length > 1 ? (
        <div className="px-5 pb-1 pt-1 sm:px-6">
          <h2 className="mb-2 border-r-4 border-emerald-700 pr-2 text-sm font-bold text-slate-900 print:border-slate-800">
            توزيع الطلبة حسب القطاع
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {sliceRows.map((row) => (
              <li
                key={`${row.department}-${row.stage}-${row.studyType}`}
                className="rounded-md border border-slate-100 bg-emerald-50/50 px-3 py-1.5 text-xs print:bg-white"
              >
                <span className="font-semibold text-emerald-900">{row.department}</span>
                <span className="text-slate-600"> — {row.stage} — </span>
                <span className="text-slate-700">{row.studyType === "evening" ? "مسائي" : "صباحي"}</span>
                <span className="mr-2 font-bold text-slate-900">({row.students.length})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="px-5 pb-5 pt-3 sm:px-6">
        <h2 className="mb-2 flex items-center gap-2 border-r-4 border-slate-700 pr-2 text-sm font-bold text-slate-900 print:border-slate-800">
          قائمة الطلبة المراد طباعة أوراقهم ({generated.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-300 print:border-slate-400">
          <table className="w-full min-w-[640px] border-collapse text-right text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 print:bg-neutral-100">
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">#</th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">اسم الطالب</th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">القسم</th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">المرحلة</th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">نوع الدراسة</th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">
                  <span dir="ltr">كود الطالب</span>
                </th>
                <th className="px-2 py-2 font-bold text-slate-800 sm:px-3">
                  <span dir="ltr">كود الورقة</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {generated.map((s, i) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-200 odd:bg-white even:bg-slate-50/60 print:even:bg-neutral-50"
                >
                  <td className="px-2 py-1.5 text-center font-medium text-slate-600 sm:px-3">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900 sm:px-3">{s.student_name || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-800 sm:px-3">{s.department || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-800 sm:px-3">{s.stage || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-800 sm:px-3">
                    {s.study_type === "evening" ? "مسائي" : "صباحي"}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-900 sm:px-3" dir="ltr">
                    {s.student_code || "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs font-semibold text-slate-900 sm:px-3" dir="ltr">
                    {normalizeFiveDigitSheetCode(String(s.sheet_code || "")) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-center text-[11px] text-slate-500 print:border-slate-300 print:bg-white print:text-slate-600">
        <p>
          أُعدَّ هذا التقرير آلياً من نظام الامتحانات — وقت الإصدار:{" "}
          <span className="font-semibold text-slate-700 print:text-slate-800">{issuedAt}</span>
        </p>
        <p className="mt-1">
          الصفحات التالية: {generated.length} ورقة استجابة مطبوعة بنفس إعدادات هذا التصدير.
        </p>
      </footer>
    </section>
  );
}

export default function ExportSheetPage() {
  const [students, setStudents] = useState<SheetStudent[]>([]);
  const [department, setDepartment] = useState("all");
  const [stage, setStage] = useState("all");
  const [studyType, setStudyType] = useState<"all" | "morning" | "evening">("all");
  const [subjectName, setSubjectName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [subjectsCatalog, setSubjectsCatalog] = useState<CatalogSubject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedSubjectCode, setSelectedSubjectCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [generated, setGenerated] = useState<SheetStudent[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [qrPayloadMode, setQrPayloadMode] = useState<"link" | "richText">("link");
  const [printNow, setPrintNow] = useState(false);
  const printNowRef = useRef(false);
  const qrReadyIdsRef = useRef<Set<string>>(new Set());
  const printExpectedCountRef = useRef(0);
  const printFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSheetQrReady = useCallback((studentId: string) => {
    if (!printNowRef.current) return;
    qrReadyIdsRef.current.add(studentId);
    const need = printExpectedCountRef.current;
    if (need > 0 && qrReadyIdsRef.current.size >= need) {
      if (printFallbackRef.current) {
        clearTimeout(printFallbackRef.current);
        printFallbackRef.current = null;
      }
      requestAnimationFrame(() => {
        printNowRef.current = false;
        window.print();
        setPrintNow(false);
        qrReadyIdsRef.current.clear();
      });
    }
  }, []);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selectedTemplateCode, setSelectedTemplateCode] = useState<SheetTemplateOption["code"]>("OMR_25");
  const [selectedTemplateImageName, setSelectedTemplateImageName] = useState("empetyfofm.pdf");
  const [selectedTemplatePreviewUrl, setSelectedTemplatePreviewUrl] = useState("");
  const [selectedTemplatePreviewRawUrl, setSelectedTemplatePreviewRawUrl] = useState("");
  const [selectedTemplatePreviewMime, setSelectedTemplatePreviewMime] = useState("");
  /** يجب أن يطابق template_config.py (PAGE_WIDTH / PAGE_HEIGHT) — يُحدَّث من استجابة المعاينة */
  const [templatePixelSize, setTemplatePixelSize] = useState({ w: 2480, h: 3508 });
  /** افتراضي: ملفات PDF الأصلية في services/omr-python (empetyfofm.pdf، sheet50، …) */
  const [sheetBackgroundSource, setSheetBackgroundSource] = useState<"canonical" | "folder">("folder");
  const selectedTemplate = useMemo(
    () => SHEET_TEMPLATE_OPTIONS.find((t) => t.code === selectedTemplateCode) ?? SHEET_TEMPLATE_OPTIONS[0],
    [selectedTemplateCode]
  );
  const hasTemplatePreview =
    selectedTemplatePreviewUrl.startsWith("data:image/") ||
    selectedTemplatePreviewUrl.startsWith("http://") ||
    selectedTemplatePreviewUrl.startsWith("https://") ||
    selectedTemplatePreviewUrl.startsWith("/");

  /** أبعاد القالب للعرض (شاشة) وللطباعة (mm) — تُمرَّر كمتغيرات CSS */
  const omrSheetCssVars = useMemo(
    () =>
      ({
        ["--omr-tw"]: String(Math.max(1, templatePixelSize.w)),
        ["--omr-th"]: String(Math.max(1, templatePixelSize.h)),
      }) as CSSProperties,
    [templatePixelSize.w, templatePixelSize.h]
  );

  useEffect(() => {
    const load = async () => {
      const [resStudents, resSubjects] = await Promise.all([
        fetch("/api/correction/students"),
        fetch("/api/correction/subjects"),
      ]);
      const dataStudents = (await resStudents.json()) as StudentsResponse;
      if (resStudents.ok && dataStudents.success) setStudents(dataStudents.students || []);
      const dataSubjects = (await resSubjects.json()) as SubjectsResponse;
      if (resSubjects.ok && dataSubjects.success) setSubjectsCatalog(dataSubjects.subjects || []);
    };
    void load();
  }, []);

  useEffect(() => {
    if (!printNow || generated.length === 0) return;
    printFallbackRef.current = setTimeout(() => {
      qrReadyIdsRef.current.clear();
      printNowRef.current = false;
      window.print();
      setPrintNow(false);
      printFallbackRef.current = null;
    }, 15000);
    return () => {
      if (printFallbackRef.current) {
        clearTimeout(printFallbackRef.current);
        printFallbackRef.current = null;
      }
    };
  }, [printNow, generated]);

  const departments = useMemo(
    () => Array.from(new Set(students.map((s) => s.department))).sort(),
    [students]
  );
  const stages = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((s) => department === "all" || s.department === department)
            .map((s) => s.stage)
        )
      ).sort(),
    [students, department]
  );
  const selected = useMemo(
    () =>
      students.filter(
        (s) =>
          (department === "all" || s.department === department) &&
          (stage === "all" || s.stage === stage) &&
          (studyType === "all" || s.study_type === studyType)
      ),
    [students, department, stage, studyType]
  );

  const subjectsForFilters = useMemo(() => {
    return subjectsCatalog.filter(
      (sub) =>
        (department === "all" || sub.department === department) &&
        (stage === "all" || sub.stage === stage)
    );
  }, [subjectsCatalog, department, stage]);

  const applySubjectSelection = (id: string) => {
    setSelectedSubjectId(id);
    if (!id) {
      setSelectedSubjectCode("");
      setSubjectName("");
      setTeacherName("");
      return;
    }
    const sub = subjectsCatalog.find((s) => s.id === id);
    if (sub) {
      setSelectedSubjectCode(sub.subject_code || "");
      setSubjectName(sub.subject_name);
      setTeacherName(sub.teacher_name);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    const loadTemplatePreview = async () => {
      try {
        if (sheetBackgroundSource === "canonical") {
          const res = await fetch(
            `/api/correction/omr/calibration-preview?templateCode=${encodeURIComponent(selectedTemplateCode)}&metaOnly=1`,
            { cache: "no-store", signal: ac.signal }
          );
          const data = (await res.json()) as TemplatePreviewResponse;
          if (!res.ok || !data.success) return;
          const tw = Number(data.template?.pageWidth);
          const th = Number(data.template?.pageHeight);
          if (Number.isFinite(tw) && Number.isFinite(th) && tw > 0 && th > 0) {
            setTemplatePixelSize({ w: Math.floor(tw), h: Math.floor(th) });
          }
          setSelectedTemplateImageName("canonical.svg");
          const origin =
            typeof window !== "undefined" && window.location?.origin
              ? window.location.origin
              : "";
          if (origin) {
            setSelectedTemplatePreviewRawUrl(
              `${origin}/api/correction/omr/canonical-sheet?templateCode=${encodeURIComponent(selectedTemplateCode)}`
            );
            setSelectedTemplatePreviewMime("image/svg+xml");
          }
          return;
        }

        const res = await fetch(
          `/api/correction/omr/calibration-preview?templateCode=${encodeURIComponent(selectedTemplateCode)}`,
          { cache: "no-store", signal: ac.signal }
        );
        const data = (await res.json()) as TemplatePreviewResponse;
        if (!res.ok || !data.success) return;
        const assetName = String(data.templateAssetName || data.templateImageName || "").trim();
        if (assetName) {
          setSelectedTemplateImageName(assetName);
        }
        const tw = Number(data.template?.pageWidth);
        const th = Number(data.template?.pageHeight);
        if (Number.isFinite(tw) && Number.isFinite(th) && tw > 0 && th > 0) {
          setTemplatePixelSize({ w: Math.floor(tw), h: Math.floor(th) });
        }
        const rawPreview = String(data.previewDataUrl || data.imageDataUrl || "").trim();
        if (rawPreview.startsWith("data:")) {
          setSelectedTemplatePreviewRawUrl(rawPreview);
          setSelectedTemplatePreviewMime(String(data.previewMime || ""));
        }
      } catch {
        // تجاهل أي خطأ شبكة؛ يبقى اسم الملف الافتراضي حسب الاختيار.
      }
    };
    void loadTemplatePreview();
    return () => ac.abort();
  }, [selectedTemplateCode, sheetBackgroundSource]);

  useEffect(() => {
    const raw = String(selectedTemplatePreviewRawUrl || "").trim();
    const mime = String(selectedTemplatePreviewMime || "").trim().toLowerCase();
    const tw = Math.max(1, templatePixelSize.w);
    const th = Math.max(1, templatePixelSize.h);
    if (!raw) {
      startTransition(() => setSelectedTemplatePreviewUrl(""));
      return;
    }
    let cancelled = false;
    startTransition(() => setSelectedTemplatePreviewUrl(""));
    void (async () => {
      try {
        if (mime === "application/pdf") {
          const png = await rasterPdfFirstPageToTemplatePixels(raw, tw, th);
          if (!cancelled) setSelectedTemplatePreviewUrl(png);
          return;
        }
        /* SVG + foreignObject/تضمين: رسمه على canvas يلوّثه ويمنع toDataURL */
        if (mime === "image/svg+xml" || raw.includes("image/svg+xml")) {
          if (!cancelled) setSelectedTemplatePreviewUrl(raw);
          return;
        }
        if (mime.startsWith("image/") || raw.startsWith("data:image/")) {
          const png = await rasterImageDataUrlToTemplatePixels(raw, tw, th);
          if (!cancelled) setSelectedTemplatePreviewUrl(png);
          return;
        }
        if (!cancelled) setSelectedTemplatePreviewUrl("");
      } catch {
        if (!cancelled) setSelectedTemplatePreviewUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTemplatePreviewRawUrl, selectedTemplatePreviewMime, templatePixelSize.w, templatePixelSize.h]);

  const handleGenerateAndPrint = async () => {
    if (!selectedSubjectId || !subjectName.trim() || !examDate || !teacherName.trim()) {
      setErrorMessage("يرجى اختيار المادة الامتحانية من القائمة (من إدخال المواد الدراسية) وتاريخ الامتحان وتأكيد اسم الأستاذ.");
      return;
    }
    const minD = localISODate();
    if (examDate < minD) {
      setErrorMessage("لا يمكن اختيار تاريخ في الماضي.");
      return;
    }
    if (!selected.length) {
      setErrorMessage("لا يوجد طلبة مطابقون للاختيار.");
      return;
    }
    if (!hasTemplatePreview) {
      setErrorMessage("تعذر تحميل صورة النموذج المختار للطباعة. جرّب اختيار النموذج مرة أخرى.");
      return;
    }
    const missingSheet = selected.find((s) => !normalizeFiveDigitSheetCode(String(s.sheet_code || "")));
    if (missingSheet) {
      setErrorMessage(
        `يوجد طالب بدون كود ورقة صالح (5 أرقام) ضمن الاختيار الحالي: ${missingSheet.student_name}. يرجى تصحيحه من صفحة الطلبة قبل التصدير.`
      );
      return;
    }
    const missingStudentCode = selected.find((s) => !String(s.student_code || "").trim());
    if (missingStudentCode) {
      setErrorMessage(
        `يوجد طالب بدون كود طالب ضمن الاختيار الحالي: ${missingStudentCode.student_name}. يرجى تصحيحه من صفحة الطلبة قبل التصدير.`
      );
      return;
    }
    setErrorMessage("");
    setSaveStatus("saving");
    const slices = buildSlicesFromSelected(selected).map((slice) => ({
      department: slice.department,
      stage: slice.stage,
      studyType: slice.studyType,
      students: slice.students.map((s) => ({
        id: s.id,
        student_code: s.student_code,
        student_name: s.student_name,
        stage: s.stage,
        study_type: s.study_type,
        department: s.department,
        sheet_code: s.sheet_code,
      })),
    }));
    const exportBatchId = crypto.randomUUID();
    try {
      const res = await fetch("/api/correction/sheet-exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exportBatchId,
          subjectName: subjectName.trim(),
          subjectCode: selectedSubjectCode.trim(),
          examDate,
          teacherName: teacherName.trim(),
          templateCode: selectedTemplate.code,
          totalQuestions: selectedTemplate.questionCount,
          templateImageName: selectedTemplateImageName,
          slices,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setSaveStatus("error");
        setErrorMessage(data.error || "تعذر حفظ سجل التصدير (اسم المادة والتاريخ). تحقق من تشغيل قاعدة البيانات وتطبيق الهجرات.");
        return;
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      setErrorMessage("تعذر الاتصال بالخادم لحفظ سجل التصدير.");
      return;
    }
    qrReadyIdsRef.current.clear();
    printExpectedCountRef.current = selected.length;
    printNowRef.current = true;
    setGenerated(selected);
    setShowReport(true);
    setPrintNow(true);
  };

  const handlePreviewAndConfirm = () => {
    if (!selectedSubjectId || !subjectName.trim() || !examDate || !teacherName.trim()) {
      setErrorMessage("يرجى اختيار المادة الامتحانية من القائمة وتاريخ الامتحان وتأكيد اسم أستاذ المادة.");
      return;
    }
    const minD = localISODate();
    if (examDate < minD) {
      setErrorMessage("لا يمكن اختيار تاريخ في الماضي.");
      return;
    }
    if (!selected.length) {
      setErrorMessage("لا يوجد طلبة مطابقون للاختيار.");
      return;
    }
    if (!hasTemplatePreview) {
      setErrorMessage("تعذر تحميل صورة النموذج المختار للعرض. جرّب اختيار النموذج مرة أخرى.");
      return;
    }
    const missingSheet = selected.find((s) => !normalizeFiveDigitSheetCode(String(s.sheet_code || "")));
    if (missingSheet) {
      setErrorMessage(
        `يوجد طالب بدون كود ورقة صالح (5 أرقام) ضمن الاختيار الحالي: ${missingSheet.student_name}. يرجى تصحيحه من صفحة الطلبة قبل المعاينة.`
      );
      return;
    }
    const missingStudentCode = selected.find((s) => !String(s.student_code || "").trim());
    if (missingStudentCode) {
      setErrorMessage(
        `يوجد طالب بدون كود طالب ضمن الاختيار الحالي: ${missingStudentCode.student_name}. يرجى تصحيحه من صفحة الطلبة قبل المعاينة.`
      );
      return;
    }
    setErrorMessage("");
    setGenerated(selected);
    setShowReport(true);
  };

  const handlePrintSampleOnly = () => {
    if (!hasTemplatePreview) {
      setErrorMessage("تعذر تحميل صورة النموذج المختار للطباعة. جرّب اختيار النموذج مرة أخرى.");
      return;
    }
    setErrorMessage("");
    qrReadyIdsRef.current.clear();
    printExpectedCountRef.current = 1;
    printNowRef.current = true;
    setGenerated([EMPTY_SAMPLE_STUDENT]);
    setShowReport(false);
    setPrintNow(true);
  };

  const BLANK_PRINT_BODY_CLASS = "export-sheet-print-no-overlays";

  const handlePrintSheetWithoutHeader = () => {
    if (!hasTemplatePreview) {
      setErrorMessage("تعذر تحميل صورة النموذج المختار للطباعة. جرّب اختيار النموذج مرة أخرى.");
      return;
    }
    setErrorMessage("");
    printNowRef.current = false;
    setPrintNow(false);
    flushSync(() => {
      setGenerated([EMPTY_SAMPLE_STUDENT]);
      setShowReport(false);
    });
    const cleanup = () => {
      document.body.classList.remove(BLANK_PRINT_BODY_CLASS);
    };
    document.body.classList.add(BLANK_PRINT_BODY_CLASS);
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 2000);
    }, 0);
  };

  return (
    <main className="correction-export-sheet-page bg-slate-200 p-4 sm:p-8">
      <div
        dir="rtl"
        className="mx-auto mb-5 grid w-full max-w-[285mm] grid-cols-1 gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_220px]"
      >
        <section className="rounded-xl border bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setStage("all");
              applySubjectSelection("");
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">كل الأقسام</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              applySubjectSelection("");
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">كل المراحل</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">نوع الدراسة</label>
            <select
              value={studyType}
              onChange={(e) => setStudyType(e.target.value as "all" | "morning" | "evening")}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="all">كل أنواع الدراسة</option>
              <option value="morning">صباحي</option>
              <option value="evening">مسائي</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              المادة الامتحانية <span className="font-normal text-slate-500">(من إدخال المواد الدراسية، الاسم فقط)</span>
            </label>
            <select
              value={selectedSubjectId}
              onChange={(e) => applySubjectSelection(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              disabled={subjectsForFilters.length === 0}
            >
              <option value="">اختر المادة</option>
              {subjectsForFilters.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.subject_name}
                </option>
              ))}
            </select>
            {subjectsCatalog.length === 0 ? (
              <p className="mt-1 text-xs text-amber-800">
                لا توجد مواد مسجّلة. أضف موادًا من صفحة{" "}
                <Link href="/Correction/subjects" className="font-semibold underline">
                  إدخال المواد الدراسية
                </Link>
                .
              </p>
            ) : subjectsForFilters.length === 0 ? (
              <p className="mt-1 text-xs text-amber-800">
                لا توجد مادة مطابقة للقسم والمرحلة المختارين؛ غيّر الفلتر أو سجّل مادة لهذا القسم والمرحلة.
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">تاريخ الامتحان</label>
            <input
              type="date"
              min={localISODate()}
              value={examDate}
              onChange={(e) => {
                const v = e.target.value;
                const minD = localISODate();
                setExamDate(v && v < minD ? minD : v);
              }}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">اسم أستاذ المادة</label>
            <input
              value={teacherName}
              readOnly={!!selectedSubjectId}
              onChange={(e) => {
                if (!selectedSubjectId) setTeacherName(e.target.value);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                selectedSubjectId ? "cursor-default bg-slate-100 text-slate-800" : ""
              }`}
              placeholder="يُملأ تلقائيًا بعد اختيار المادة"
              title={selectedSubjectId ? "قيمة تلقائية من سجل المادة، لا يمكن تعديلها" : undefined}
            />
          </div>
          <div className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handlePreviewAndConfirm}
                disabled={!hasTemplatePreview}
                className="min-h-[40px] flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                عرض و تاكد
              </button>
              <button
                type="button"
                disabled={saveStatus === "saving" || !hasTemplatePreview}
                onClick={() => void handleGenerateAndPrint()}
                className="min-h-[40px] flex-1 rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saveStatus === "saving" ? "جاري الحفظ…" : "تصدير اوراق الشيت (PDF)"}
              </button>
              <button
                onClick={handlePrintSampleOnly}
                disabled={!hasTemplatePreview}
                className="min-h-[40px] flex-1 rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                طباعة نموذج فارغ (PDF)
              </button>
              <button
                type="button"
                onClick={handlePrintSheetWithoutHeader}
                disabled={!hasTemplatePreview}
                className="min-h-[40px] flex-1 rounded-lg border-2 border-slate-600 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                طباعة شيت بدون عنوان
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              «طباعة شيت بدون عنوان» تُخفي طباعة الترويسة (الوزارة، الكلية، المادة، الطالب، القسم، المرحلة، التاريخ، كود
              الطالب، سطر الامتحانات النهائية) والـ QR وكود الورقة أسفله — يبقى خلفية الشيت فقط (وما هو مرسوم داخل ملف
              PDF نفسه إن وُجد).
            </p>
          </div>
          </div>
          <p className="mt-2 text-sm">عدد الطلبة المطابقين: <span className="font-bold">{selected.length}</span></p>
          {saveStatus === "saved" ? (
            <p className="mt-1 text-sm text-emerald-700">
            تم حفظ التصدير في «الامتحانات المكونة» مقسّمًا حسب القسم ونوع الدراسة والمرحلة، مع تقرير نصّي وقائمة الطلبة لكل
            خانة (دون صورة الشيت أو QR في ذلك التقرير). تُطبع أوراق الشيت مع QR من هذه الصفحة بعد اكتمال تحميل الرموز.
            </p>
          ) : null}
          {errorMessage ? <p className="mt-1 text-sm text-red-700">{errorMessage}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">نوع نموذج الشيت</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {SHEET_TEMPLATE_OPTIONS.map((tpl) => {
              const active = tpl.code === selectedTemplateCode;
              return (
                <button
                  key={tpl.code}
                  type="button"
                  onClick={() => setSelectedTemplateCode(tpl.code)}
                  className={`rounded-lg border px-3 py-2 text-right text-sm font-semibold transition ${
                    active
                      ? "border-blue-700 bg-blue-700 text-white"
                      : "border-slate-300 bg-white text-slate-800 hover:border-slate-400"
                  }`}
                >
                  {tpl.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-2 text-right text-xs text-slate-700">
            <p className="font-semibold text-slate-800">مصدر خلفية الشيت</p>
            <p className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600">
              النماذج الأصلية (PDF):{" "}
              <code className="rounded bg-white px-0.5">empetyfofm.pdf</code> (25)،{" "}
              <code className="rounded bg-white px-0.5">sheet50.pdf</code>،{" "}
              <code className="rounded bg-white px-0.5">sheet75.pdf</code>،{" "}
              <code className="rounded bg-white px-0.5">sheet100.pdf</code> — داخل{" "}
              <code className="rounded bg-white px-0.5">services/omr-python</code>. الطباعة بنفس نسبة{" "}
              <code className="rounded bg-white px-0.5">template_config.py</code> (صفحة A4 مطابقة للمعايرة).
            </p>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="sheet-bg-src"
                className="mt-0.5"
                checked={sheetBackgroundSource === "folder"}
                onChange={() => setSheetBackgroundSource("folder")}
              />
              <span>
                <strong>ملفات المجلد (PDF الأصلي)</strong>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                  الافتراضي — نفس الملفات المستخدمة في المعايرة والتصحيح بعد التطبيع إلى أبعاد القالب.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="sheet-bg-src"
                className="mt-0.5"
                checked={sheetBackgroundSource === "canonical"}
                onChange={() => setSheetBackgroundSource("canonical")}
              />
              <span>
                <strong>شيت مُولَّد (SVG) من النظام</strong>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                  بديل برمجي إذا احتجت، بدون الاعتماد على ملف PDF من المجلد.
                </span>
              </span>
            </label>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-right text-xs text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={qrPayloadMode === "link"}
              onChange={(e) => setQrPayloadMode(e.target.checked ? "link" : "richText")}
            />
            <span>
              <span className="font-semibold text-slate-800">QR مضغوط (رابط)</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                يُفضّل للمسح من الهاتف: السطر الأول يبقى كود الورقة، والثاني رابط يعرض التفاصيل. عطّل الخيار لو أردت
                تخزين كل النصوص داخل الرمز (أكثر ازدحامًا).
              </span>
            </span>
          </label>
        </section>
      </div>

      {generated.length > 0 ? (
        <div className="print-container">
          {showReport ? (
            <SheetExportCoverReport
              generated={generated}
              department={department}
              stage={stage}
              studyType={studyType}
              subjectName={subjectName}
              subjectCode={selectedSubjectCode}
              examDate={examDate}
              teacherName={teacherName}
              templateLabel={selectedTemplate.label}
              templateCode={selectedTemplate.code}
              questionCount={selectedTemplate.questionCount}
              templateImageName={selectedTemplateImageName}
              sheetBackgroundSource={sheetBackgroundSource}
              qrPayloadMode={qrPayloadMode}
            />
          ) : null}
          {generated.map((s, index) => (
            <section
              key={s.id}
              className={`sheet-print-page mx-auto mb-6 flex w-full max-w-[210mm] justify-center bg-white p-4 shadow sm:p-6 print:relative print:mb-0 print:max-w-none print:overflow-visible print:p-0 print:shadow-none print:break-inside-avoid ${
                index === generated.length - 1 ? "print:break-after-auto" : "print:break-after-page"
              }`}
            >
              {hasTemplatePreview ? (
                <div
                  className="sheet-print-box relative mx-auto box-border w-full overflow-hidden"
                  style={omrSheetCssVars}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedTemplatePreviewUrl}
                    alt={`نموذج الشيت ${selectedTemplate.label}`}
                    className="pointer-events-none absolute inset-0 block h-full w-full object-fill"
                  />
                  <div className="sheet-print-overlay">
                    <SheetPrintInstitutionOverlay
                      templateCode={selectedTemplateCode}
                      subjectName={subjectName}
                      student={s}
                    />
                    <SheetPrintMetaOverlay student={s} examDate={examDate} templateCode={selectedTemplateCode} />
                    <SheetQrWithCodeColumn
                      student={s}
                      templateCode={selectedTemplateCode}
                      subjectName={subjectName}
                      examDate={examDate}
                      qrPayloadMode={qrPayloadMode}
                      printQrAckId={printNow ? s.id : undefined}
                      onPrintQrAck={printNow ? markSheetQrReady : undefined}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-slate-600">جاري تجهيز نموذج الشيت المختار…</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-4 print:hidden">
          <section className="mx-auto w-full max-w-[210mm] bg-white p-4 shadow sm:p-6">
            {hasTemplatePreview ? (
              <div
                className="sheet-print-box relative mx-auto box-border w-full overflow-hidden"
                style={omrSheetCssVars}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedTemplatePreviewUrl}
                  alt={`معاينة نموذج الشيت ${selectedTemplate.label}`}
                  className="pointer-events-none absolute inset-0 block h-full w-full object-fill"
                />
                <div className="sheet-print-overlay">
                  <SheetPrintInstitutionOverlay
                    templateCode={selectedTemplateCode}
                    subjectName={subjectName}
                    student={EMPTY_SAMPLE_STUDENT}
                  />
                  <SheetPrintMetaOverlay
                    student={EMPTY_SAMPLE_STUDENT}
                    examDate={examDate}
                    templateCode={selectedTemplateCode}
                  />
                  <SheetQrWithCodeColumn
                    student={EMPTY_SAMPLE_STUDENT}
                    templateCode={selectedTemplateCode}
                    subjectName={subjectName}
                    examDate={examDate}
                    qrPayloadMode={qrPayloadMode}
                    printQrAckId={printNow ? EMPTY_SAMPLE_STUDENT.id : undefined}
                    onPrintQrAck={printNow ? markSheetQrReady : undefined}
                  />
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-slate-600">جاري تجهيز نموذج الشيت المختار…</p>
            )}
          </section>
        </div>
      )}
      <style jsx global>{`
        /* معاينة الشاشة: نفس نسبة القالب؛ الطباعة: صفحة A4 كاملة 210×297 مم (مطابقة أبعاد template_config) */
        .correction-export-sheet-page .sheet-print-box {
          box-sizing: border-box;
          overflow: hidden;
          width: min(210mm, 100%);
          aspect-ratio: var(--omr-tw) / var(--omr-th);
          height: auto;
          margin-left: auto;
          margin-right: auto;
        }

        @media print {
          .correction-export-sheet-page {
            position: static !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          .correction-export-sheet-page .print-container {
            position: static !important;
            display: block !important;
            width: 210mm !important;
            height: auto !important;
            min-height: 0 !important;
            max-width: 210mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            overflow: hidden !important;
            font-size: initial !important;
            line-height: normal !important;
          }

          .correction-export-sheet-page .sheet-print-box {
            width: 210mm !important;
            height: 297mm !important;
            aspect-ratio: unset !important;
            max-width: none !important;
            max-height: none !important;
            overflow: hidden !important;
          }

          .correction-export-sheet-page .print-container,
          .correction-export-sheet-page .print-container * {
            visibility: visible !important;
          }

          .correction-export-sheet-page .sheet-print-page {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            break-after: page !important;
            margin: 0 !important;
          }

          .correction-export-sheet-page .sheet-print-page:last-child {
            break-after: auto !important;
          }

          .correction-export-sheet-page .sheet-export-cover thead {
            display: table-header-group;
          }

          .correction-export-sheet-page .sheet-export-cover tbody tr {
            break-inside: avoid;
          }

          @page {
            size: A4 portrait;
            margin: 0;
          }

          body.export-sheet-print-no-overlays .correction-export-sheet-page .sheet-print-overlay {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}

