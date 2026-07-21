import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { query } from "@/src/lib/db";

async function generateUniqueSubjectCode(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = `MAT${randomBytes(5).toString("hex").toUpperCase()}`;
    const r = await query(
      `SELECT 1 FROM examination_committee.correction_subjects WHERE subject_code = $1 LIMIT 1`,
      [code]
    );
    if (r.rows.length === 0) return code;
  }
  throw new Error("تعذر توليد رمز مادة فريد.");
}

async function loadStudentDepartmentMeta() {
  const countRes = await query(`
    SELECT COUNT(*)::int AS c FROM examination_committee.correction_students
  `);
  const totalStudents = countRes.rows[0]?.c ?? 0;

  const deptRes = await query(`
    SELECT DISTINCT department
    FROM examination_committee.correction_students
    WHERE TRIM(department) <> ''
    ORDER BY department ASC
  `);
  const departmentOptions: string[] = deptRes.rows.map((r: { department: string }) => r.department);

  const pairRes = await query(`
    SELECT DISTINCT department, stage
    FROM examination_committee.correction_students
    WHERE TRIM(department) <> '' AND TRIM(stage) <> ''
    ORDER BY department ASC, stage ASC
  `);
  const stageOptionsByDepartment: Record<string, string[]> = {};
  for (const row of pairRes.rows as { department: string; stage: string }[]) {
    if (!stageOptionsByDepartment[row.department]) stageOptionsByDepartment[row.department] = [];
    const list = stageOptionsByDepartment[row.department];
    if (!list.includes(row.stage)) list.push(row.stage);
  }

  return { totalStudents, departmentOptions, stageOptionsByDepartment };
}

async function validateDeptStageAgainstStudents(department: string, stage: string, strict: boolean) {
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

export async function GET() {
  try {
    const [subjectsResult, statsResult, meta] = await Promise.all([
      query(`
        SELECT
          id,
          subject_name,
          subject_code,
          department,
          teacher_name,
          stage,
          notes,
          created_at,
          updated_at
        FROM examination_committee.correction_subjects
        ORDER BY department ASC, stage ASC, subject_name ASC
      `),
      query(`
        SELECT
          COUNT(*)::int AS total_subjects,
          COUNT(DISTINCT department)::int AS departments_count,
          COUNT(DISTINCT NULLIF(TRIM(teacher_name), ''))::int AS teachers_count,
          COUNT(DISTINCT stage)::int AS stages_count
        FROM examination_committee.correction_subjects
      `),
      loadStudentDepartmentMeta(),
    ]);

    const stats = statsResult.rows[0] || {
      total_subjects: 0,
      departments_count: 0,
      teachers_count: 0,
      stages_count: 0,
    };

    return NextResponse.json({
      success: true,
      subjects: subjectsResult.rows,
      stats,
      departmentOptions: meta.departmentOptions,
      stageOptionsByDepartment: meta.stageOptionsByDepartment,
      studentsCount: meta.totalStudents,
    });
  } catch {
    return NextResponse.json({ success: false, error: "تعذر جلب المواد الدراسية." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const subjectName = String(body.subjectName || "").trim();
    const department = String(body.department || "").trim();
    const teacherName = String(body.teacherName || "").trim();
    const stage = String(body.stage || "").trim();

    if (!subjectName) {
      return NextResponse.json({ success: false, error: "اسم المادة الدراسية مطلوب." }, { status: 400 });
    }
    if (!department) {
      return NextResponse.json({ success: false, error: "القسم مطلوب." }, { status: 400 });
    }
    if (!teacherName) {
      return NextResponse.json({ success: false, error: "اسم أستاذ المادة مطلوب." }, { status: 400 });
    }
    if (!stage) {
      return NextResponse.json({ success: false, error: "المرحلة مطلوبة." }, { status: 400 });
    }

    const meta = await loadStudentDepartmentMeta();
    const strict = meta.totalStudents > 0;
    const v = await validateDeptStageAgainstStudents(department, stage, strict);
    if (!v.ok) {
      return NextResponse.json({ success: false, error: v.error }, { status: 400 });
    }

    const subjectCode = await generateUniqueSubjectCode();
    const notes = body.notes != null ? String(body.notes).trim() : "";

    const result = await query(
      `
      INSERT INTO examination_committee.correction_subjects
        (subject_name, subject_code, department, teacher_name, stage, notes)
      VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
      RETURNING id, subject_name, subject_code, department, teacher_name, stage, notes, created_at, updated_at
      `,
      [subjectName, subjectCode, department, teacherName, stage, notes]
    );

    return NextResponse.json({ success: true, subject: result.rows[0] });
  } catch (e) {
    console.error("subjects POST", e);
    return NextResponse.json({ success: false, error: "تعذر إضافة المادة." }, { status: 500 });
  }
}
