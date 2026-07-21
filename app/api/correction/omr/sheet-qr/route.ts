import { NextResponse } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

function normalizeSheetCode(raw: string): string | null {
  const digits = String(raw || "")
    .trim()
    .replace(/\D/g, "");
  const last5 = digits.slice(-5);
  return /^\d{5}$/.test(last5) ? last5 : null;
}

function formatExamDateForQr(iso: string): string {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function safeHttpOrigin(raw: string | undefined, request: Request): string {
  const fallback = new URL(request.url).origin.replace(/\/$/, "");
  const t = String(raw || "").trim();
  if (!t) return fallback;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

/** السطر الأول = كود الورقة (5 أرقام)، السطر الثاني = رابط قصير نسبيًا لتفاصيل الطالب على الهاتف */
function buildSheetQrLinkPayload(
  sheetCode: string,
  origin: string,
  input: { examDateIso: string; subjectName: string }
): string {
  const base = origin.replace(/\/$/, "");
  const path = `/Correction/sheet-scan/${sheetCode}`;
  const sp = new URLSearchParams();
  const e = String(input.examDateIso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) sp.set("e", e);
  let t = String(input.subjectName || "").trim();
  if (t.length > 120) t = `${t.slice(0, 117)}...`;
  if (t) sp.set("t", t);
  const qs = sp.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  return `${sheetCode}\n${url}`;
}

/** نص QR للطباعة: السطر الأول كود الورقة فقط (لتوافق OMR)، ثم معلومات للقراءة على الهاتف */
function buildSheetQrRichTextPayload(input: {
  sheetCode: string;
  subjectName: string;
  studentName: string;
  department: string;
  stage: string;
  /** إن وُجد فقط يُذكر صباحي/مسائي بجانب المرحلة (لا يُستخدم في معاينة الشيت قبل اختيار طالب حقيقي) */
  studyType?: "morning" | "evening";
  examDateIso: string;
  studentCode: string;
}): string {
  const subject = String(input.subjectName || "").trim();
  const name = String(input.studentName || "").trim();
  const dept = String(input.department || "").trim();
  const stage = String(input.stage || "").trim();
  const studyLabel =
    input.studyType === "evening" ? "مسائي" : input.studyType === "morning" ? "صباحي" : "";
  const stageLine = [stage, studyLabel].filter(Boolean).join("، ");
  const dateLine = formatExamDateForQr(input.examDateIso);
  const sc = String(input.studentCode || "").trim();
  return [
    input.sheetCode,
    "كلية الشرق التقنية التخصصية",
    "",
    `اسم المادة الامتحانية: ${subject}`,
    `اسم الطالب: ${name}`,
    `القسم: ${dept}`,
    `المرحلة: ${stageLine}`,
    `تاريخ الامتحان: ${dateLine}`,
    `كود الطالب: ${sc}`,
    "الامتحانات النهائية 2025-2026",
  ].join("\n");
}

async function renderQrPng(
  text: string,
  size: number,
  margin: number,
  errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M"
): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: size,
    margin,
    errorCorrectionLevel,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sheetCodeRaw = String(searchParams.get("sheetCode") || "").trim();
    const sheetCode = normalizeSheetCode(sheetCodeRaw);

    if (!sheetCode) {
      return NextResponse.json({ success: false, error: "كود الورقة غير صالح (يجب أن يكون 5 أرقام)." }, { status: 400 });
    }

    const sizeRaw = Number(searchParams.get("size") || 256);
    const size = Number.isFinite(sizeRaw) ? Math.max(64, Math.min(1024, Math.floor(sizeRaw))) : 256;
    const marginRaw = Number(searchParams.get("margin") || 1);
    const margin = Number.isFinite(marginRaw) ? Math.max(0, Math.min(8, Math.floor(marginRaw))) : 1;

    const png = await renderQrPng(sheetCode, size, margin, "L");

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر توليد QR.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

type SheetQrPostBody = {
  sheetCode?: string;
  /** richText = كل النصوص داخل QR (مزدحم). link = كود الورقة + رابط (موصى به للمسح). */
  payloadMode?: "link" | "richText";
  /** مطلوب معنويًا لوضع link؛ يُفضّل إرساله من المتصفح (مثل window.location.origin). */
  publicBaseUrl?: string;
  subjectName?: string;
  examDate?: string;
  studentName?: string;
  department?: string;
  stage?: string;
  studyType?: string;
  studentCode?: string;
  size?: number;
  margin?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SheetQrPostBody;
    const sheetCode = normalizeSheetCode(String(body.sheetCode || ""));
    if (!sheetCode) {
      return NextResponse.json({ success: false, error: "كود الورقة غير صالح (يجب أن يكون 5 أرقام)." }, { status: 400 });
    }

    const st = body.studyType;
    let studyType: "morning" | "evening" | undefined;
    if (st === "evening" || st === "morning") studyType = st;

    const sizeRaw = Number(body.size ?? 510);
    const size = Number.isFinite(sizeRaw) ? Math.max(64, Math.min(1024, Math.floor(sizeRaw))) : 510;
    const marginRaw = Number(body.margin ?? 1);
    const margin = Number.isFinite(marginRaw) ? Math.max(0, Math.min(8, Math.floor(marginRaw))) : 1;

    const mode = body.payloadMode === "richText" ? "richText" : "link";
    const origin = safeHttpOrigin(body.publicBaseUrl, request);

    const text =
      mode === "richText"
        ? buildSheetQrRichTextPayload({
            sheetCode,
            subjectName: String(body.subjectName ?? ""),
            studentName: String(body.studentName ?? ""),
            department: String(body.department ?? ""),
            stage: String(body.stage ?? ""),
            ...(studyType ? { studyType } : {}),
            examDateIso: String(body.examDate ?? ""),
            studentCode: String(body.studentCode ?? ""),
          })
        : buildSheetQrLinkPayload(sheetCode, origin, {
            examDateIso: String(body.examDate ?? ""),
            subjectName: String(body.subjectName ?? ""),
          });

    const png = await renderQrPng(text, size, margin, "M");

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر توليد QR.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
