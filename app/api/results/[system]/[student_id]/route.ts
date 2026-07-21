import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/results/[system]/[student_id]
 * جلب بيانات النتائج لطالب معين
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string; student_id: string }> }
) {
  try {
    const { system, student_id } = await params;
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';

    // خريطة ربط الأقسام بالأنظمة
    const systemDepartmentMap: Record<string, string[]> = {
      'dentalindustry': ['تقنيات صناعة الاسنان', 'تقنيات صناعة الأسنان'],
      'anesthesia': ['تقنيات التخدير'],
      'xrays': ['تقنيات الاشعة', 'تقنيات الأشعة'],
      'construction': ['هندسة تقنيات البناء والانشاءات', 'تقنيات البناء والاستشارات'],
      'oil': ['تقنيات هندسة النفط والغاز', 'تقنيات النفط والغاز'],
      'physics': ['تقنيات الفيزياء الصحية'],
      'optics': ['تقنيات البصريات'],
      'health': ['تقنيات صحة المجتمع'],
      'emergency': ['تقنيات طب الطوارئ'],
      'therapy': ['تقنيات العلاج الطبيعي'],
      'cyber': ['هندسة تقنيات الامن السيبراني والحوسبة السحابية', 'تقنيات الامن السيبراني', 'تقنيات الأمن السيبراني'],
    };

    const departmentNames = systemDepartmentMap[system];

    if (!departmentNames || departmentNames.length === 0) {
      return NextResponse.json({ success: false, error: 'نظام غير معروف' }, { status: 400 });
    }

    // جلب بيانات الطالب
    const studentQuery = `
      SELECT 
        s.id,
        s.university_id,
        s.full_name_ar,
        s.full_name,
        s.first_name,
        s.last_name,
        s.major,
        s.admission_type,
        s.study_type,
        s.academic_year
      FROM student_affairs.students s
      WHERE s.id = $1
        AND s.payment_status = 'paid'
    `;

    const studentResult = await query(studentQuery, [student_id]);

    if (studentResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطالب غير موجود' }, { status: 404 });
    }

    const student = studentResult.rows[0];
    const studentFullName = student.full_name_ar || student.full_name || `${student.first_name} ${student.last_name}`;

    // جلب المواد الدراسية للطالب في السنة الأكاديمية
    const conditions = departmentNames.map((_, i) => `ts.department = $${i + 2}`).join(' OR ');
    
    const subjectsQuery = `
      SELECT 
        ts.id as subject_id,
        ts.material_name,
        ts.instructor_name,
        ts.semester,
        ts.academic_year,
        ts.stage,
        ts.study_type,
        ts.has_practical,
        COALESCE(ts.units, 0) as units
      FROM examination_committee.teaching_subjects ts
      WHERE (${conditions})
        AND ts.academic_year = $1
        AND ts.stage = $${departmentNames.length + 2}
        AND ts.study_type = $${departmentNames.length + 3}
      ORDER BY ts.semester ASC, ts.material_name ASC
    `;

    const subjectsParams = [
      academicYear,
      ...departmentNames,
      student.admission_type,
      student.study_type
    ];

    const subjectsResult = await query(subjectsQuery, subjectsParams);

    // جلب درجات الطالب
    const gradesQuery = `
      SELECT 
        smg.subject_id,
        smg.semester,
        smg.first_final_100,
        smg.second_final_100
      FROM examination_committee.sub_master_grades smg
      WHERE smg.student_id = $1
        AND smg.academic_year = $2
    `;

    const gradesResult = await query(gradesQuery, [student_id, academicYear]);

    // تجميع الدرجات حسب subject_id و semester
    const gradesMap: Record<string, { first?: number; second?: number }> = {};
    gradesResult.rows.forEach((row: any) => {
      // التأكد من أن semester هو 'first' أو 'second' (تحويل إلى lowercase)
      const semester = String(row.semester).toLowerCase().trim();
      const key = `${row.subject_id}_${semester}`;
      if (!gradesMap[key]) {
        gradesMap[key] = {};
      }
      if (row.first_final_100 !== null && row.first_final_100 !== undefined) {
        gradesMap[key].first = Number(row.first_final_100);
      }
      if (row.second_final_100 !== null && row.second_final_100 !== undefined) {
        gradesMap[key].second = Number(row.second_final_100);
      }
    });

    // تجميع المواد حسب الفصل الدراسي
    const firstSemesterSubjects = subjectsResult.rows
      .filter((s: any) => String(s.semester).toLowerCase().trim() === 'first')
      .map((s: any) => {
        const gradeKey = `${s.subject_id}_first`;
        const gradeData = gradesMap[gradeKey];
        const subjectData = {
          subject_id: s.subject_id,
          material_name: s.material_name,
          units: Number(s.units),
          first_round_grade: gradeData?.first || null,
          second_round_grade: gradeData?.second || null,
        };
        // تسجيل للتشخيص
        if (!gradeData) {
          console.log(`⚠️ No grades found for first semester subject: ${s.material_name} (ID: ${s.subject_id}), key: ${gradeKey}`);
        } else {
          console.log(`✅ Grades for first semester subject: ${s.material_name} (ID: ${s.subject_id}) - First: ${gradeData.first}, Second: ${gradeData.second}`);
        }
        return subjectData;
      });

    const secondSemesterSubjects = subjectsResult.rows
      .filter((s: any) => String(s.semester).toLowerCase().trim() === 'second')
      .map((s: any) => {
        const gradeKey = `${s.subject_id}_second`;
        const gradeData = gradesMap[gradeKey];
        const subjectData = {
          subject_id: s.subject_id,
          material_name: s.material_name,
          units: Number(s.units),
          first_round_grade: gradeData?.first || null,
          second_round_grade: gradeData?.second || null,
        };
        // تسجيل للتشخيص
        if (!gradeData) {
          console.log(`⚠️ No grades found for second semester subject: ${s.material_name} (ID: ${s.subject_id}), key: ${gradeKey}`);
        } else {
          console.log(`✅ Grades for second semester subject: ${s.material_name} (ID: ${s.subject_id}) - First: ${gradeData.first}, Second: ${gradeData.second}`);
        }
        return subjectData;
      });

    // تسجيل للتشخيص (يمكن حذفه لاحقاً)
    console.log('Grades Map:', JSON.stringify(gradesMap, null, 2));
    console.log('First Semester Subjects Count:', firstSemesterSubjects.length);
    console.log('Second Semester Subjects Count:', secondSemesterSubjects.length);

    // حساب المجاميع والمعدلات
    const calculateSemesterTotals = (subjects: typeof firstSemesterSubjects) => {
      let totalUnits = 0;
      let totalFirstRound = 0;
      let totalSecondRound = 0;

      subjects.forEach(subj => {
        totalUnits += subj.units;
        if (subj.first_round_grade !== null) {
          totalFirstRound += subj.first_round_grade * subj.units;
        }
        if (subj.second_round_grade !== null) {
          totalSecondRound += subj.second_round_grade * subj.units;
        }
      });

      const firstRoundGPA = totalUnits > 0 ? totalFirstRound / totalUnits : 0;
      const secondRoundGPA = totalUnits > 0 ? totalSecondRound / totalUnits : 0;

      return {
        totalUnits,
        totalFirstRound,
        totalSecondRound,
        firstRoundGPA,
        secondRoundGPA,
      };
    };

    const firstSemesterTotals = calculateSemesterTotals(firstSemesterSubjects);
    const secondSemesterTotals = calculateSemesterTotals(secondSemesterSubjects);

    // المجموع العام والمعدل العام للمرحلة الأولى
    const totalAllUnits = firstSemesterTotals.totalUnits + secondSemesterTotals.totalUnits;
    const totalAllFirstRound = firstSemesterTotals.totalFirstRound + secondSemesterTotals.totalFirstRound;
    const totalAllSecondRound = firstSemesterTotals.totalSecondRound + secondSemesterTotals.totalSecondRound;
    const overallFirstRoundGPA = totalAllUnits > 0 ? totalAllFirstRound / totalAllUnits : 0;
    const overallSecondRoundGPA = totalAllUnits > 0 ? totalAllSecondRound / totalAllUnits : 0;

    return NextResponse.json({
      success: true,
      student: {
        id: student.id,
        university_id: student.university_id,
        full_name: studentFullName,
        major: student.major,
        stage: student.admission_type,
        study_type: student.study_type,
      },
      academicYear,
      firstSemester: {
        subjects: firstSemesterSubjects,
        totals: firstSemesterTotals,
      },
      secondSemester: {
        subjects: secondSemesterSubjects,
        totals: secondSemesterTotals,
      },
      overall: {
        totalUnits: totalAllUnits,
        totalFirstRound: totalAllFirstRound,
        totalSecondRound: totalAllSecondRound,
        firstRoundGPA: overallFirstRoundGPA,
        secondRoundGPA: overallSecondRoundGPA,
      },
    });
  } catch (error) {
    console.error('خطأ في جلب بيانات النتائج:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب بيانات النتائج' },
      { status: 500 }
    );
  }
}

