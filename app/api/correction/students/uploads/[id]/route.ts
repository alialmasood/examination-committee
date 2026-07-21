import { NextRequest, NextResponse } from "next/server";
import { query } from "@/src/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await query(`DELETE FROM examination_committee.correction_uploads WHERE id=$1 RETURNING id`, [id]);
    if (!res.rows.length) {
      return NextResponse.json({ success: false, error: "الرفع غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر حذف الرفع." }, { status: 500 });
  }
}
