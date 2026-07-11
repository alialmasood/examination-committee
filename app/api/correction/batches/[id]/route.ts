import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

type UpdateBatchBody = {
  status?: string;
  currentStep?: string;
  /** قد يصل من JSON كرقم أو نص؛ اختياري وقابل للإفراغ */
  passPercent?: number | string | null;
  analyzePayload?: unknown;
  correctionPayload?: unknown;
  detailedPayload?: unknown;
  customPayload?: unknown;
  reportPayload?: unknown;
  reportFileName?: string | null;
  reportFileMime?: string | null;
  reportFileBase64?: string | null;
  analysisReportFileName?: string | null;
  analysisReportFileMime?: string | null;
  analysisReportFileBase64?: string | null;
  eventType?: string | null;
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
const ALLOWED_EVENT_TYPES = new Set(["upload", "preview", "analyze", "correct", "detailed", "custom", "report", "status"]);

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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ success: false, error: "معرّف الوجبة غير صالح." }, { status: 400 });

    const batchRes = await query(
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
        b.analyze_payload,
        b.correction_payload,
        b.detailed_payload,
        b.custom_payload,
        b.report_file_name,
        b.report_file_mime,
        (b.source_file_bytes IS NOT NULL) AS has_source_file,
        (b.report_file_bytes IS NOT NULL) AS has_report_file,
        b.analysis_report_file_name,
        b.analysis_report_file_mime,
        (b.analysis_report_file_bytes IS NOT NULL) AS has_analysis_report_file,
        b.report_payload,
        b.created_at,
        b.updated_at
      FROM examination_committee.correction_batches b
      WHERE b.id = $1::uuid
      LIMIT 1
      `,
      [id]
    );

    if (!batchRes.rows.length) {
      return NextResponse.json({ success: false, error: "وجبة التصحيح غير موجودة." }, { status: 404 });
    }

    const eventRes = await query(
      `
      SELECT id, event_type, payload, created_at
      FROM examination_committee.correction_batch_events
      WHERE batch_id = $1::uuid
      ORDER BY created_at DESC
      `,
      [id]
    );

    return NextResponse.json({
      success: true,
      batch: batchRes.rows[0],
      events: eventRes.rows,
    });
  } catch (error) {
    console.error("correction batch [id] GET:", error);
    return NextResponse.json({ success: false, error: "تعذر تحميل وجبة التصحيح." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ success: false, error: "معرّف الوجبة غير صالح." }, { status: 400 });

    const body = (await request.json()) as UpdateBatchBody;
    const statusRaw = body.status != null ? String(body.status).trim() : "";
    const stepRaw = body.currentStep != null ? String(body.currentStep).trim() : "";
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : null;
    const currentStep = ALLOWED_STEPS.has(stepRaw) ? stepRaw : null;

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

    const reportBuffer = decodeBase64File(body.reportFileBase64 ?? null);
    const reportFileName = body.reportFileName != null ? String(body.reportFileName).trim() : "";
    const reportFileMime = body.reportFileMime != null ? String(body.reportFileMime).trim() : "";
    const analysisReportBuffer = decodeBase64File(body.analysisReportFileBase64 ?? null);
    const analysisReportFileName = body.analysisReportFileName != null ? String(body.analysisReportFileName).trim() : "";
    const analysisReportFileMime = body.analysisReportFileMime != null ? String(body.analysisReportFileMime).trim() : "";

    const upd = await query(
      `
      UPDATE examination_committee.correction_batches
      SET
        status = COALESCE($2, status),
        current_step = COALESCE($3, current_step),
        pass_percent = COALESCE($4::numeric, pass_percent),
        analyze_payload = COALESCE($5::jsonb, analyze_payload),
        correction_payload = COALESCE($6::jsonb, correction_payload),
        detailed_payload = COALESCE($7::jsonb, detailed_payload),
        custom_payload = COALESCE($8::jsonb, custom_payload),
        report_payload = COALESCE($9::jsonb, report_payload),
        report_file_name = COALESCE(NULLIF($10, ''), report_file_name),
        report_file_mime = COALESCE(NULLIF($11, ''), report_file_mime),
        report_file_bytes = COALESCE($12::bytea, report_file_bytes),
        analysis_report_file_name = COALESCE(NULLIF($13, ''), analysis_report_file_name),
        analysis_report_file_mime = COALESCE(NULLIF($14, ''), analysis_report_file_mime),
        analysis_report_file_bytes = COALESCE($15::bytea, analysis_report_file_bytes),
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, status, current_step, updated_at
      `,
      [
        id,
        status,
        currentStep,
        passPercent,
        body.analyzePayload != null ? JSON.stringify(body.analyzePayload) : null,
        body.correctionPayload != null ? JSON.stringify(body.correctionPayload) : null,
        body.detailedPayload != null ? JSON.stringify(body.detailedPayload) : null,
        body.customPayload != null ? JSON.stringify(body.customPayload) : null,
        body.reportPayload != null ? JSON.stringify(body.reportPayload) : null,
        reportFileName,
        reportFileMime,
        reportBuffer,
        analysisReportFileName,
        analysisReportFileMime,
        analysisReportBuffer,
      ]
    );

    if (!upd.rows.length) {
      return NextResponse.json({ success: false, error: "وجبة التصحيح غير موجودة." }, { status: 404 });
    }

    const eventTypeRaw = body.eventType != null ? String(body.eventType).trim() : "";
    const eventType = ALLOWED_EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : "status";
    await query(
      `
      INSERT INTO examination_committee.correction_batch_events (batch_id, event_type, payload)
      VALUES ($1::uuid, $2, $3::jsonb)
      `,
      [id, eventType, JSON.stringify(body.eventPayload ?? null)]
    );

    return NextResponse.json({ success: true, batch: upd.rows[0] });
  } catch (error) {
    console.error("correction batch [id] PATCH:", error);
    return NextResponse.json({ success: false, error: "تعذر تحديث وجبة التصحيح." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ success: false, error: "معرّف الوجبة غير صالح." }, { status: 400 });

    const del = await query(
      `
      DELETE FROM examination_committee.correction_batches
      WHERE id = $1::uuid
      RETURNING id
      `,
      [id]
    );

    if (!del.rows.length) {
      return NextResponse.json({ success: false, error: "وجبة التصحيح غير موجودة." }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: del.rows[0]?.id || id });
  } catch (error) {
    console.error("correction batch [id] DELETE:", error);
    return NextResponse.json({ success: false, error: "تعذر حذف وجبة التصحيح." }, { status: 500 });
  }
}
