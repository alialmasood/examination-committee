import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/sub-master-grades/[system]
 * جلب درجات السب ماستر لجميع المواد التدريسية
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';
    const semester = searchParams.get('semester') || 'first';

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

    // جلب المواد التدريسية
    const conditions = departmentNames.map((_, i) => `ts.department = $${i + 1}`).join(' OR ');
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
        COUNT(DISTINCT smg.student_id) as student_count
      FROM examination_committee.teaching_subjects ts
      LEFT JOIN examination_committee.sub_master_grades smg 
        ON ts.id = smg.subject_id 
        AND smg.academic_year = $${departmentNames.length + 1}
        AND smg.semester = $${departmentNames.length + 2}
      WHERE ts.academic_year = $${departmentNames.length + 1}
        AND ts.semester = $${departmentNames.length + 2}
        AND (${conditions})
      GROUP BY ts.id, ts.material_name, ts.instructor_name, ts.semester, ts.academic_year, ts.stage, ts.study_type, ts.has_practical
      ORDER BY ts.material_name ASC
    `;

    const subjectsResult = await query(subjectsQuery, [...departmentNames, academicYear, semester]);

    const subjects = subjectsResult.rows.map(row => ({
      subject_id: row.subject_id,
      material_name: row.material_name,
      instructor_name: row.instructor_name,
      semester: row.semester,
      academic_year: row.academic_year,
      stage: row.stage,
      study_type: row.study_type,
      has_practical: row.has_practical ?? true,
      student_count: parseInt(row.student_count) || 0,
    }));

    return NextResponse.json({
      success: true,
      data: subjects,
      academic_year: academicYear,
      semester: semester
    });
  } catch (error) {
    console.error('خطأ في جلب درجات السب ماستر:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب درجات السب ماستر' },
      { status: 500 }
    );
  }
}

