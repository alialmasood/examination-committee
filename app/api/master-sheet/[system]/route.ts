import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/master-sheet/[system]
 * جلب بيانات الماستر شيت: الطلاب والمواد الدراسية ودرجاتهم
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';
    const stage = searchParams.get('stage') || null;
    const studyType = searchParams.get('studyType') || null;

    // خريطة ربط الأقسام بالأنظمة
    const systemDepartmentMap: Record<string, string[]> = {
      'dentalindustry': ['تقنيات صناعة الاسنان', 'تقنيات صناعة الأسنان'],
      'anesthesia': ['تقنيات التخدير'],
      'xrays': ['تقنيات الاشعة', 'تقنيات الأشعة'],
      'construction': ['هندسة تقنيات البناء والانشاءات', 'تقنيات البناء والاستشارات'], // للتوافق مع البيانات القديمة
      'oil': ['تقنيات هندسة النفط والغاز', 'تقنيات النفط والغاز'],
      'physics': ['تقنيات الفيزياء الصحية'],
      'optics': ['تقنيات البصريات'],
      'health': ['تقنيات صحة المجتمع'],
      'emergency': ['تقنيات طب الطوارئ'],
      'therapy': ['تقنيات العلاج الطبيعي'],
      'cyber': ['هندسة تقنيات الامن السيبراني والحوسبة السحابية', 'تقنيات الامن السيبراني', 'تقنيات الأمن السيبراني'], // للتوافق مع البيانات القديمة
    };

    const departmentNames = systemDepartmentMap[system];

    if (!departmentNames || departmentNames.length === 0) {
      return NextResponse.json({ success: false, error: 'نظام غير معروف' }, { status: 400 });
    }

    // جلب جميع المواد الدراسية للفصل الدراسي الأول والثاني
    const conditions = departmentNames.map((_, i) => `ts.department = $${i + 1}`).join(' OR ');
    
    // بناء شروط إضافية
    let whereConditions = [`(${conditions})`, `ts.academic_year = $${departmentNames.length + 1}`];
    const queryParams: (string | null)[] = [...departmentNames, academicYear];

    if (stage) {
      whereConditions.push(`ts.stage = $${queryParams.length + 1}`);
      queryParams.push(stage);
    }
    if (studyType) {
      whereConditions.push(`ts.study_type = $${queryParams.length + 1}`);
      queryParams.push(studyType);
    }

    const subjectsQuery = `
      SELECT 
        ts.id as subject_id,
        ts.material_name,
        ts.instructor_name,
        ts.semester,
        ts.academic_year,
        ts.stage,
        ts.study_type,
        ts.has_practical
      FROM examination_committee.teaching_subjects ts
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ts.semester ASC, ts.material_name ASC
    `;

    const subjectsResult = await query(subjectsQuery, queryParams);

    // تجميع المواد حسب الفصل الدراسي
    const firstSemesterSubjects = subjectsResult.rows.filter((s: any) => s.semester === 'first');
    const secondSemesterSubjects = subjectsResult.rows.filter((s: any) => s.semester === 'second');

    // جلب جميع الطلاب للقسم
    const baseParamsCount = 1; // academicYear
    let paramIndex = baseParamsCount + 1;
    const majorConditions = departmentNames.map((_, i) => `s.major = $${paramIndex++}`).join(' OR ');
    
    const studentConditions: string[] = [];
    const studentParams: (string | null)[] = [academicYear, ...departmentNames];

    studentConditions.push(`(${majorConditions})`);
    studentConditions.push(`s.academic_year = $1`);
    studentConditions.push(`s.payment_status = 'paid'`);

    if (stage) {
      studentConditions.push(`s.admission_type = $${studentParams.length + 1}`);
      studentParams.push(stage);
    }
    if (studyType) {
      studentConditions.push(`s.study_type = $${studentParams.length + 1}`);
      studentParams.push(studyType);
    }

    const studentsQuery = `
      SELECT 
        s.id,
        s.university_id,
        COALESCE(s.full_name_ar, s.full_name, s.first_name || ' ' || s.last_name) as full_name,
        s.admission_type,
        s.semester,
        s.academic_year
      FROM student_affairs.students s
      WHERE ${studentConditions.join(' AND ')}
      ORDER BY s.full_name_ar ASC
    `;

    const studentsResult = await query(studentsQuery, studentParams);

    // جلب درجات جميع الطلاب في جميع المواد
    const allSubjectIds = subjectsResult.rows.map((s: any) => s.subject_id);
    
    if (allSubjectIds.length === 0) {
      return NextResponse.json({
        success: true,
        students: [],
        firstSemesterSubjects: [],
        secondSemesterSubjects: [],
        grades: {}
      });
    }

    // بناء استعلام لجلب جميع الدرجات دفعة واحدة
    const gradesPlaceholders = allSubjectIds.map((_: any, i: number) => `$${i + 2}`).join(', ');
    const gradesQuery = `
      SELECT 
        smg.student_id,
        smg.subject_id,
        smg.semester,
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
      WHERE smg.academic_year = $1
        AND smg.subject_id IN (${gradesPlaceholders})
    `;

    const gradesResult = await query(gradesQuery, [academicYear, ...allSubjectIds]);

    // تجميع الدرجات بحسب الطالب والمادة
    const gradesMap: Record<string, Record<string, any>> = {};
    gradesResult.rows.forEach((row: any) => {
      if (!gradesMap[row.student_id]) {
        gradesMap[row.student_id] = {};
      }
      gradesMap[row.student_id][row.subject_id] = {
        semester: row.semester,
        sae_40: row.sae_40,
        first_practical_25: row.first_practical_25,
        first_theory_35: row.first_theory_35,
        first_total_60: row.first_total_60,
        first_final_100: row.first_final_100,
        second_practical_25: row.second_practical_25,
        second_theory_35: row.second_theory_35,
        second_total_60: row.second_total_60,
        second_final_100: row.second_final_100,
      };
    });

    return NextResponse.json({
      success: true,
      students: studentsResult.rows.map((row: any, index: number) => ({
        id: row.id,
        sequence: index + 1,
        university_id: row.university_id,
        full_name: row.full_name,
        admission_type: row.admission_type,
        semester: row.semester,
        academic_year: row.academic_year
      })),
      firstSemesterSubjects: firstSemesterSubjects.map((s: any) => ({
        subject_id: s.subject_id,
        material_name: s.material_name,
        instructor_name: s.instructor_name,
        semester: s.semester,
        has_practical: s.has_practical ?? true
      })),
      secondSemesterSubjects: secondSemesterSubjects.map((s: any) => ({
        subject_id: s.subject_id,
        material_name: s.material_name,
        instructor_name: s.instructor_name,
        semester: s.semester,
        has_practical: s.has_practical ?? true
      })),
      grades: gradesMap,
      academic_year: academicYear
    });
  } catch (error) {
    console.error('خطأ في جلب بيانات الماستر شيت:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب بيانات الماستر شيت' },
      { status: 500 }
    );
  }
}

