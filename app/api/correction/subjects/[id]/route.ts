import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

async function studentCount(): Promise<number> {
  const r = await query(`SELECT COUNT(*)::int AS c FROM examination_committee.correction_students`);
  return r.rows[0]?.c ?? 0;
}

async function validateDeptStage(department: string, stage: string, strict: boolean) {
  if (!strict) return { ok: true as const };
  const r = await query(
    `
    SELECT 1
    FROM examination_committee.correction_students
    WHERE department = $1 AND stage = $2
    LIMIT 1
    `,
    [department, stage]
  );
  if (r.rows.length === 0) {
    return { ok: false as const, error: "القسم والمرحلة يجب أن يطابقا بيانات الطلبة المدخلة." };
  }
  return { ok: true as const };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف غير صالح." }, { status: 400 });
    }
    const body = await request.json();
    const subjectName = body.subjectName != null ? String(body.subjectName).trim() : undefined;
    const department = body.department != null ? String(body.department).trim() : undefined;
    const teacherName = body.teacherName != null ? String(body.teacherName).trim() : undefined;
    const stage = body.stage != null ? String(body.stage).trim() : undefined;
    const notes = body.notes !== undefined ? String(body.notes ?? "").trim() : undefined;

    if (subjectName !== undefined && !subjectName) {
      return NextResponse.json({ success: false, error: "اسم المادة لا يمكن أن يكون فارغًا." }, { status: 400 });
    }
    if (department !== undefined && !department) {
      return NextResponse.json({ success: false, error: "القسم لا يمكن أن يكون فارغًا." }, { status: 400 });
    }
    if (teacherName !== undefined && !teacherName) {
      return NextResponse.json({ success: false, error: "اسم الأستاذ لا يمكن أن يكون فارغًا." }, { status: 400 });
    }
    if (stage !== undefined && !stage) {
      return NextResponse.json({ success: false, error: "المرحلة لا يمكن أن تكون فارغة." }, { status: 400 });
    }

    const current = await query(
      `SELECT department, stage FROM examination_committee.correction_subjects WHERE id = $1::uuid`,
      [id]
    );
    if (!current.rows.length) {
      return NextResponse.json({ success: false, error: "المادة غير موجودة." }, { status: 404 });
    }
    const nextDept = department ?? current.rows[0].department;
    const nextStage = stage ?? current.rows[0].stage;
    const strict = (await studentCount()) > 0;
    const v = await validateDeptStage(nextDept, nextStage, strict);
    if (!v.ok) {
      return NextResponse.json({ success: false, error: v.error }, { status: 400 });
    }

    const result = await query(
      `
      UPDATE examination_committee.correction_subjects
      SET
        subject_name = COALESCE($2, subject_name),
        department = COALESCE($3, department),
        teacher_name = COALESCE($4, teacher_name),
        stage = COALESCE($5, stage),
        notes = CASE WHEN $6::text IS NOT NULL THEN NULLIF($6, '') ELSE notes END,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, subject_name, subject_code, department, teacher_name, stage, notes, created_at, updated_at
      `,
      [
        id,
        subjectName ?? null,
        department ?? null,
        teacherName ?? null,
        stage ?? null,
        notes !== undefined ? notes : null,
      ]
    );

    if (!result.rows.length) {
      return NextResponse.json({ success: false, error: "المادة غير موجودة." }, { status: 404 });
    }

    return NextResponse.json({ success: true, subject: result.rows[0] });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر تحديث المادة." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف غير صالح." }, { status: 400 });
    }
    const result = await query(
      `DELETE FROM examination_committee.correction_subjects WHERE id = $1::uuid RETURNING id`,
      [id]
    );
    if (!result.rows.length) {
      return NextResponse.json({ success: false, error: "المادة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر حذف المادة." }, { status: 500 });
  }
}
