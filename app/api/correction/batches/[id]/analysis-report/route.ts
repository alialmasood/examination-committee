import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف الوجبة غير صالح." }, { status: 400 });
    }

    const res = await query(
      `
      SELECT analysis_report_file_name, analysis_report_file_mime, analysis_report_file_bytes
      FROM examination_committee.correction_batches
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [id]
    );
    if (!res.rows.length) {
      return NextResponse.json({ success: false, error: "وجبة التصحيح غير موجودة." }, { status: 404 });
    }
    const row = res.rows[0] as {
      analysis_report_file_name?: string | null;
      analysis_report_file_mime?: string | null;
      analysis_report_file_bytes?: Buffer | null;
    };
    if (!row.analysis_report_file_bytes) {
      return NextResponse.json({ success: false, error: "لا يوجد تقرير تحليل محفوظ لهذه الوجبة." }, { status: 404 });
    }

    const fileName = String(row.analysis_report_file_name || "analysis-report.pdf");
    const mime = String(row.analysis_report_file_mime || "application/octet-stream");
    const buffer = Buffer.isBuffer(row.analysis_report_file_bytes)
      ? row.analysis_report_file_bytes
      : Buffer.from(row.analysis_report_file_bytes as ArrayBuffer);
    const responseBody = new Uint8Array(buffer);
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("correction batch analysis-report GET:", error);
    return NextResponse.json({ success: false, error: "تعذر تنزيل تقرير التحليل المحفوظ." }, { status: 500 });
  }
}
