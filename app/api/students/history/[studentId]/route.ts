import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  StudentHistorySummary,
  StudentHistoryTimelineEntry,
} from '@/src/lib/types/student-history';
import { resolveStageLabel, resolveStatusLabel } from '../helpers';

interface SubjectGrade {
  subjectId: string;
  subjectName: string;
  department: string;
  instructorName: string;
  academicYear: string;
  semester: string;
  stage?: string;
  sae_40?: number;
  first_practical_25?: number;
  first_theory_35?: number;
  first_total_60?: number;
  first_final_100?: number;
  second_practical_25?: number;
  second_theory_35?: number;
  second_total_60?: number;
  second_final_100?: number;
  finalGrade?: number;
  gradeId?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId } = await params;
  const { searchParams } = new URL(request.url);
  const academicYear = searchParams.get('academicYear');

  try {
    // جلب معلومات الطالب الأساسية
    const summaryResult = await query(
      `
SELECT
  s.id AS student_id,
  s.university_id,
  COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) AS full_name,
  COALESCE(s.academic_year, 'غير محدد') AS academic_year,
  LOWER(COALESCE(NULLIF(s.admission_type, ''), NULLIF(s.level, ''))) AS stage_code,
  LOWER(COALESCE(s.status, 'غير محدد')) AS status_code,
  COALESCE(s.major, 'غير محدد') AS department,
  s.study_type,
  s.registration_date,
  s.national_id,
  s.birth_date,
  s.gender,
  s.phone,
  s.email,
  s.photo
FROM student_affairs.students s
WHERE s.id::text = $1
LIMIT 1;
      `,
      [studentId]
    );

    if (!summaryResult.rowCount) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الطالب المطلوب' },
        { status: 404 }
      );
    }

    const summaryRow = summaryResult.rows[0];

    // جلب الخط الزمني الأكاديمي
    const timelineResult = await query(
      `
SELECT
  smg.academic_year,
  smg.semester,
  LOWER(COALESCE(NULLIF(ts.stage, ''), NULLIF(s.admission_type, ''), NULLIF(s.level, ''))) AS stage_code,
  LOWER(COALESCE(s.status, 'غير محدد')) AS status_code,
  AVG(
    COALESCE(
      smg.second_final_100,
      smg.first_final_100,
      smg.second_total_60 * (100.0 / 60.0),
      smg.first_total_60 * (100.0 / 60.0),
      smg.sae_40 * (100.0 / 40.0)
    )
  ) AS gpa_value,
  COUNT(*) AS subjects_count
FROM examination_committee.sub_master_grades smg
JOIN student_affairs.students s ON s.id = smg.student_id
LEFT JOIN examination_committee.teaching_subjects ts ON ts.id = smg.subject_id
WHERE s.id::text = $1
${academicYear ? 'AND smg.academic_year = $2' : ''}
GROUP BY
  smg.academic_year,
  smg.semester,
  LOWER(COALESCE(NULLIF(ts.stage, ''), NULLIF(s.admission_type, ''), NULLIF(s.level, ''))),
  LOWER(COALESCE(s.status, 'غير محدد'))
ORDER BY smg.academic_year, smg.semester;
      `,
      academicYear ? [studentId, academicYear] : [studentId]
    );

    const timeline: StudentHistoryTimelineEntry[] = timelineResult.rows.map((row) => {
      const stageCode = row.stage_code ? String(row.stage_code) : null;
      const statusCode = row.status_code ? String(row.status_code) : 'unknown';
      return {
        academicYear: row.academic_year ?? 'غير محدد',
        semester: row.semester ?? null,
        stageCode,
        stage: resolveStageLabel(stageCode),
        status: statusCode,
        statusLabel: resolveStatusLabel(statusCode),
        gpa: row.gpa_value !== null && row.gpa_value !== undefined ? Number(row.gpa_value) : null,
        subjectsCount: row.subjects_count ?? null,
        notes: null,
      };
    });

    // جلب جميع المواد الدراسية مع درجاتها
    const subjectsQuery = `
SELECT
  smg.id AS grade_id,
  ts.id AS subject_id,
  ts.material_name AS subject_name,
  ts.department,
  ts.instructor_name,
  ts.stage,
  ts.academic_year,
  ts.semester,
  smg.sae_40,
  smg.first_practical_25,
  smg.first_theory_35,
  smg.first_total_60,
  smg.first_final_100,
  smg.second_practical_25,
  smg.second_theory_35,
  smg.second_total_60,
  smg.second_final_100
FROM examination_committee.sub_master_grades smg
JOIN examination_committee.teaching_subjects ts ON ts.id = smg.subject_id
WHERE smg.student_id::text = $1
${academicYear ? 'AND ts.academic_year = $2' : ''}
ORDER BY ts.academic_year DESC, ts.semester DESC, ts.material_name;
    `;

    const subjectsResult = await query(
      subjectsQuery,
      academicYear ? [studentId, academicYear] : [studentId]
    );

    const subjects: SubjectGrade[] = subjectsResult.rows.map((row) => {
      const finalGrade = row.second_final_100 ?? 
                        row.first_final_100 ?? 
                        (row.second_total_60 ? row.second_total_60 * (100.0 / 60.0) : null) ??
                        (row.first_total_60 ? row.first_total_60 * (100.0 / 60.0) : null) ??
                        (row.sae_40 ? row.sae_40 * (100.0 / 40.0) : null);

      return {
        gradeId: row.grade_id,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        department: row.department,
        instructorName: row.instructor_name,
        academicYear: row.academic_year,
        semester: row.semester,
        stage: row.stage,
        sae_40: row.sae_40 ? Number(row.sae_40) : undefined,
        first_practical_25: row.first_practical_25 ? Number(row.first_practical_25) : undefined,
        first_theory_35: row.first_theory_35 ? Number(row.first_theory_35) : undefined,
        first_total_60: row.first_total_60 ? Number(row.first_total_60) : undefined,
        first_final_100: row.first_final_100 ? Number(row.first_final_100) : undefined,
        second_practical_25: row.second_practical_25 ? Number(row.second_practical_25) : undefined,
        second_theory_35: row.second_theory_35 ? Number(row.second_theory_35) : undefined,
        second_total_60: row.second_total_60 ? Number(row.second_total_60) : undefined,
        second_final_100: row.second_final_100 ? Number(row.second_final_100) : undefined,
        finalGrade: finalGrade ? Number(finalGrade) : undefined,
      };
    });

    // حساب المعدل التراكمي
    const latestEntry = timeline.at(-1);
    const overallGPA = subjects.length > 0
      ? subjects.reduce((sum, sub) => sum + (sub.finalGrade ?? 0), 0) / subjects.length
      : null;

    const summary: StudentHistorySummary = {
      studentId: summaryRow.student_id,
      universityId: summaryRow.university_id,
      fullName: summaryRow.full_name,
      academicYear: summaryRow.academic_year,
      stageCode: summaryRow.stage_code ? String(summaryRow.stage_code) : null,
      stage: resolveStageLabel(summaryRow.stage_code),
      department: summaryRow.department,
      status: summaryRow.status_code ? String(summaryRow.status_code) : 'unknown',
      statusLabel: resolveStatusLabel(summaryRow.status_code),
      studyType: summaryRow.study_type,
      gpa: latestEntry?.gpa ?? overallGPA,
    };

    return NextResponse.json({
      success: true,
      data: {
        student: summary,
        timeline,
        subjects,
        studentDetails: {
          registrationDate: summaryRow.registration_date,
          nationalId: summaryRow.national_id,
          birthDate: summaryRow.birth_date,
          gender: summaryRow.gender,
          phone: summaryRow.phone,
          email: summaryRow.email,
          photo: summaryRow.photo,
        },
      },
    });
  } catch (error) {
    console.error('خطأ في جلب السيرة الأكاديمية للطالب:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب السيرة الأكاديمية للطالب' },
      { status: 500 }
    );
  }
}
