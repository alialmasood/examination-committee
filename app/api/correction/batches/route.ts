import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

type CreateBatchBody = {
  sheetExportId?: string | null;
  batchName?: string | null;
  sourceFileName?: string;
  sourceFileMime?: string | null;
  sourceFileSizeBytes?: number | null;
  sourceFileSha256?: string | null;
  sourceFileBase64?: string | null;
  passPercent?: number | string | null;
  status?: string | null;
  currentStep?: string | null;
  eventPayload?: unknown;
};

const ALLOWED_STATUS = new Set([
  "uploaded",
  "previewed",
  "analyzed",
  "corrected",
  "detailed_corrected",
  "custom_corrected",
  "report_ready",
  "completed",
  "failed",
]);

const ALLOWED_STEPS = new Set(["upload", "preview", "analyze", "correct", "detailed", "custom", "report"]);

function decodeBase64File(raw: string | null | undefined): Buffer | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const base64 = v.includes(",") ? v.split(",").pop() || "" : v;
  if (!base64) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const res = await query(
      `
      SELECT
        b.id,
        b.sheet_export_id,
        b.batch_name,
        b.source_file_name,
        b.source_file_mime,
        b.source_file_size_bytes,
        b.source_file_sha256,
        b.status,
        b.current_step,
        b.pass_percent,
        b.created_at,
        b.updated_at,
        (b.source_file_bytes IS NOT NULL) AS has_source_file,
        (b.report_file_bytes IS NOT NULL) AS has_report_file,
        se.subject_name,
        se.exam_date::text AS exam_date
      FROM examination_committee.correction_batches b
      LEFT JOIN examination_committee.correction_sheet_exports se
        ON se.id = b.sheet_export_id
      ORDER BY b.created_at DESC
      LIMIT 500
      `
    );
    return NextResponse.json({ success: true, batches: res.rows });
  } catch (error) {
    console.error("correction batches GET:", error);
    return NextResponse.json({ success: false, error: "تعذر تحميل وجبات التصحيح.", batches: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBatchBody;
    const sourceFileName = String(body.sourceFileName || "").trim();
    const batchName = body.batchName != null ? String(body.batchName).trim() : "";
    const sourceFileMime = body.sourceFileMime != null ? String(body.sourceFileMime).trim() : "";
    const sourceFileSizeBytes = Number(body.sourceFileSizeBytes ?? 0);
    const sourceFileSha256 = body.sourceFileSha256 != null ? String(body.sourceFileSha256).trim() : "";
    const rawPassPercent = body.passPercent;
    let passPercent: number | null = null;
    if (rawPassPercent !== undefined && rawPassPercent !== null && rawPassPercent !== "") {
      const parsed = Number(rawPassPercent);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return NextResponse.json(
          { success: false, error: "نسبة النجاح يجب أن تكون رقماً بين 0 و100" },
          { status: 400 }
        );
      }
      passPercent = parsed;
    }
    const statusRaw = body.status != null ? String(body.status).trim() : "";
    const stepRaw = body.currentStep != null ? String(body.currentStep).trim() : "";
    const sheetExportId = body.sheetExportId != null ? String(body.sheetExportId).trim() : "";

    if (!sourceFileName) {
      return NextResponse.json({ success: false, error: "اسم ملف الاختبار مطلوب." }, { status: 400 });
    }
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "uploaded";
    const currentStep = ALLOWED_STEPS.has(stepRaw) ? stepRaw : "upload";
    const sourceFileBuffer = decodeBase64File(body.sourceFileBase64 ?? null);

    const ins = await query(
      `
      INSERT INTO examination_committee.correction_batches
        (
          sheet_export_id,
          batch_name,
          source_file_name,
          source_file_mime,
          source_file_size_bytes,
          source_file_sha256,
          source_file_bytes,
          status,
          current_step,
          pass_percent
        )
      VALUES
        (
          NULLIF($1, '')::uuid,
          NULLIF($2, ''),
          $3,
          NULLIF($4, ''),
          CASE WHEN $5::int > 0 THEN $5::int ELSE NULL END,
          NULLIF($6, ''),
          $7::bytea,
          $8,
          $9,
          $10::numeric
        )
      RETURNING id, created_at
      `,
      [
        sheetExportId,
        batchName,
        sourceFileName,
        sourceFileMime,
        Number.isFinite(sourceFileSizeBytes) ? sourceFileSizeBytes : 0,
        sourceFileSha256,
        sourceFileBuffer,
        status,
        currentStep,
        passPercent,
      ]
    );

    const batchId = String(ins.rows[0]?.id || "");
    await query(
      `
      INSERT INTO examination_committee.correction_batch_events (batch_id, event_type, payload)
      VALUES ($1::uuid, 'upload', $2::jsonb)
      `,
      [batchId, JSON.stringify(body.eventPayload ?? null)]
    );

    return NextResponse.json({
      success: true,
      batch: {
        id: batchId,
        created_at: ins.rows[0]?.created_at ?? null,
      },
    });
  } catch (error) {
    console.error("correction batches POST:", error);
    return NextResponse.json({ success: false, error: "تعذر إنشاء وجبة التصحيح." }, { status: 500 });
  }
}
