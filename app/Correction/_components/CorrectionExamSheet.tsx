"use client";

export type SheetStudent = {
  id: string;
  /** كود الطالب كما في جدول الطلبة (للربط مع كود الورقة) */
  student_code: string;
  student_name: string;
  stage: string;
  study_type: "morning" | "evening";
  department: string;
  sheet_code: string;
};

export type ModelAnswerLetter = "A" | "B" | "C" | "D";

const answerChoices: ModelAnswerLetter[] = ["A", "B", "C", "D"];
const idDigits = Array.from({ length: 10 }, (_, i) => i);
const idColumns = 5;

export const EMPTY_SAMPLE_STUDENT: SheetStudent = {
  id: "sample",
  student_code: "",
  student_name: "",
  stage: "",
  study_type: "morning",
  department: "",
  // كود ورقة افتراضي للمعاينة/الطباعة النموذجية (5 أرقام)، لا يُفترض أن يتعارض مع كود طالب حقيقي
  sheet_code: "00000",
};

export function Bubble({ label, selected = false }: { label: string | number; selected?: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
        selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-700 text-slate-800"
      }`}
    >
      {label}
    </span>
  );
}

export type CorrectionExamSheetProps = {
  student: SheetStudent;
  subjectName: string;
  examDate: string;
  questionCount?: number;
  isSample?: boolean;
  isLast?: boolean;
  /** دوائر الإجابة النموذجية للأسئلة 1..25 (نفس مواقع شيت الطالب) */
  modelAnswers?: Partial<Record<number, ModelAnswerLetter>>;
  /** شريط تنبيه فوق الشيت (مثلاً: مفتاح إجابة نموذجي) */
  topBanner?: string;
};

function normalizeFiveDigitSheetCode(raw: string): string | null {
  const digits = String(raw || "")
    .trim()
    .replace(/\D/g, "");
  const last5 = digits.slice(-5);
  return /^\d{5}$/.test(last5) ? last5 : null;
}

export function CorrectionExamSheet({
  student,
  subjectName,
  examDate,
  questionCount = 25,
  isSample = false,
  isLast = false,
  modelAnswers,
  topBanner,
}: CorrectionExamSheetProps) {
  const questionNumbers = Array.from({ length: Math.max(1, Math.min(100, Math.floor(questionCount))) }, (_, i) => i + 1);
  const normalizedSheetCode = normalizeFiveDigitSheetCode(String(student.sheet_code || ""));
  const hasValidSheetCode = Boolean(normalizedSheetCode);
  const codeDigits = hasValidSheetCode ? normalizedSheetCode!.split("").map(Number) : [];
  const qrCode = hasValidSheetCode ? normalizedSheetCode! : isSample ? "00000" : "";
  const qrSrc = qrCode
    ? `/api/correction/omr/sheet-qr?sheetCode=${encodeURIComponent(qrCode)}&size=256&margin=1`
    : "";
  const qrLabel = hasValidSheetCode ? normalizedSheetCode! : isSample ? qrCode : "";

  return (
    <section
      dir="ltr"
      className={`mx-auto mb-6 w-full max-w-[210mm] bg-white p-4 shadow sm:p-6 print:mb-0 print:max-w-none print:p-0 print:shadow-none ${
        isLast ? "print:break-after-auto" : "print:break-after-page"
      }`}
    >
      <div dir="ltr" className="mx-auto w-full max-w-[190mm] text-left text-slate-900">
        {topBanner ? (
          <div className="mb-3 rounded-lg border-2 border-amber-600 bg-amber-50 px-3 py-2 text-center text-sm font-bold text-amber-900 print:border-slate-700 print:bg-white print:text-slate-900">
            {topBanner}
          </div>
        ) : null}
        {/* هيدر النص الرسمي فقط */}
        <div className="mb-4 flex flex-row items-center justify-between gap-4 rounded-[28px] border-2 border-slate-700 px-5 py-4">
          <div
            dir="rtl"
            className="min-w-0 flex-1 text-right text-sm leading-7 text-slate-900"
            style={{ direction: "rtl", unicodeBidi: "plaintext" }}
          >
            <p>وزارة التعليم العالي والبحث العلمي</p>
            <p>كلية الشرق التقنية التخصصية</p>
            <p className="font-bold">الامتحان النهائي 2025-2026</p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-[1fr_auto] gap-4">
          <div
            dir="rtl"
            style={{ direction: "rtl", unicodeBidi: "plaintext" }}
            className="border-2 border-slate-700 p-3 text-right text-[15px]"
          >
            <div className="space-y-1.5 leading-6">
              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">اسم الطالب:</span>
                <span>{student.student_name}</span>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">المرحلة:</span>
                <span>{student.stage || "-"}</span>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">الدراسة:</span>
                <div className="flex items-center justify-start gap-4">
                  <span className="inline-flex items-center gap-1">
                    <Bubble label={1} selected={!isSample && student.study_type === "morning"} />
                    صباحي
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Bubble label={0} selected={!isSample && student.study_type === "evening"} />
                    مسائي
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">القسم:</span>
                <span>{student.department}</span>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">الكلية:</span>
                <span>كلية الشرق التقنية التخصصية</span>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">اسم المادة:</span>
                <span>{subjectName}</span>
              </div>

              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="font-semibold">تاريخ الامتحان:</span>
                <span>{examDate}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex h-[112px] w-[112px] flex-col items-center justify-center border-2 border-slate-700 p-1">
              {qrSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={qrSrc}
                  alt={`رمز QR لكود الورقة: ${qrCode}`}
                  width={96}
                  height={96}
                  className="h-[96px] w-[96px] object-contain"
                />
              ) : (
                <span className="px-2 text-center text-[10px] font-semibold text-slate-500">لا يوجد كود ورقة</span>
              )}
            </div>
            <span className="max-w-[7rem] text-center font-mono text-[10px] leading-tight text-slate-600 print:text-[9px]">
              {qrLabel}
            </span>
            <div className="flex gap-4">
              {Array.from({ length: idColumns }).map((_, col) => (
                <div key={col} className="flex flex-col items-center gap-1">
                  {idDigits.map((d) => (
                    <Bubble
                      key={`${col}-${d}`}
                      label={d}
                      selected={hasValidSheetCode && codeDigits[col] === d}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* مسافات الشبكة يجب أن تبقى متسقة مع src/lib/correction/omr-sheet-template.ts (ANSWER_ROW_STEP وغيره) */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-4">
          {questionNumbers.map((q) => (
            <div key={`${student.id}-${q}`} className="flex items-center justify-start gap-3">
              <span className="w-6 text-left font-semibold">{q}</span>
              <div className="flex gap-2">
                {answerChoices.map((c) => (
                  <Bubble key={`${q}-${c}`} label={c} selected={modelAnswers?.[q] === c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SampleExamSheet() {
  return <CorrectionExamSheet student={EMPTY_SAMPLE_STUDENT} subjectName="" examDate="" isSample />;
}
