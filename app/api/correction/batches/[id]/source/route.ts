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
      SELECT source_file_name, source_file_mime, source_file_bytes
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
      source_file_name?: string | null;
      source_file_mime?: string | null;
      source_file_bytes?: Buffer | null;
    };
    if (!row.source_file_bytes) {
      return NextResponse.json({ success: false, error: "لا يوجد ملف مرفوع محفوظ لهذه الوجبة." }, { status: 404 });
    }

    const fileName = String(row.source_file_name || "uploaded-file");
    const mime = String(row.source_file_mime || "application/octet-stream");
    const buffer = Buffer.isBuffer(row.source_file_bytes)
      ? row.source_file_bytes
      : Buffer.from(row.source_file_bytes as ArrayBuffer);
    const responseBody = new Uint8Array(buffer);
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("correction batch source GET:", error);
    return NextResponse.json({ success: false, error: "تعذر تنزيل الملف المرفوع." }, { status: 500 });
  }
}
