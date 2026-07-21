import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/src/lib/db";

function normalizeHeader(value: unknown) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeStudyType(value: string): "morning" | "evening" | null {
  const text = String(value || "").trim().toLowerCase();
  if (text === "morning" || text.includes("صباح")) return "morning";
  if (text === "evening" || text.includes("مسائ") || text.includes("مساء")) return "evening";
  return null;
}

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "يرجى اختيار ملف Excel." }, { status: 400 });
    }

    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as unknown[][];
    if (!rows.length) {
      return NextResponse.json({ success: false, error: "الملف فارغ." }, { status: 400 });
    }

    const headerIndex = rows.findIndex((row) =>
      row.some((cell) => {
        const h = normalizeHeader(cell);
        return h === "sheet code" || h === "كود الورقة";
      })
    );
    if (headerIndex < 0) {
      return NextResponse.json({ success: false, error: "تعذر التعرف على أعمدة الملف." }, { status: 400 });
    }

    const header = rows[headerIndex].map(normalizeHeader);
    const idx = {
      sequence: header.findIndex((h) => ["no.", "no", "التسلسل"].includes(h)),
      studentCode: header.findIndex((h) => ["student code", "كود الطالب"].includes(h)),
      department: header.findIndex((h) => ["department", "القسم"].includes(h)),
      studentName: header.findIndex((h) => ["student name", "اسم الطالب"].includes(h)),
      stage: header.findIndex((h) => ["stage", "المرحلة"].includes(h)),
      studyType: header.findIndex((h) => ["type of study", "study type", "الدراسة"].includes(h)),
      sheetCode: header.findIndex((h) => ["sheet code", "كود الورقة"].includes(h)),
    };
    const required = [idx.studentCode, idx.department, idx.studentName, idx.stage, idx.studyType, idx.sheetCode];
    if (required.some((v) => v < 0)) {
      return NextResponse.json({ success: false, error: "بعض الأعمدة المطلوبة غير موجودة." }, { status: 400 });
    }

    await client.query("BEGIN");
    const upload = await client.query(
      `INSERT INTO examination_committee.correction_uploads (file_name) VALUES ($1) RETURNING id`,
      [file.name]
    );
    const uploadId = upload.rows[0].id as string;

    let inserted = 0;
    const errors: string[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const studentCode = String(row[idx.studentCode] || "").trim();
      const department = String(row[idx.department] || "").trim();
      const studentName = String(row[idx.studentName] || "").trim();
      const stage = String(row[idx.stage] || "").trim();
      const sheetCode = String(row[idx.sheetCode] || "").trim();
      const studyType = normalizeStudyType(String(row[idx.studyType] || ""));
      const sequenceRaw = String(row[idx.sequence] || "").trim();
      const sequenceNo = sequenceRaw ? Number(sequenceRaw) : null;

      if (!studentCode && !studentName && !sheetCode) continue;
      if (!studentCode || !department || !studentName || !stage || !studyType || !/^\d{5}$/.test(sheetCode)) {
        errors.push(`الصف ${i + 1}: بيانات غير صالحة.`);
        continue;
      }

      const res = await client.query(
        `
        INSERT INTO examination_committee.correction_students
          (sequence_no, student_code, department, student_name, stage, study_type, sheet_code, source_file, upload_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (sheet_code) DO NOTHING
        RETURNING id
        `,
        [Number.isFinite(sequenceNo) ? sequenceNo : null, studentCode, department, studentName, stage, studyType, sheetCode, file.name, uploadId]
      );
      if (res.rowCount) inserted += 1;
    }

    await client.query(`UPDATE examination_committee.correction_uploads SET inserted_count=$2 WHERE id=$1`, [uploadId, inserted]);
    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: `تم إدراج ${inserted} طالب بنجاح.`,
      data: { inserted, errors: errors.slice(0, 25) },
    });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ success: false, error: "حدث خطأ أثناء استيراد ملف الطلبة." }, { status: 500 });
  } finally {
    client.release();
  }
}
