import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// قائمة جميع الأنظمة الفرعية
const SYSTEMS = [
  { code: 'dentalindustry', name: 'تقنيات صناعة الأسنان' },
  { code: 'anesthesia', name: 'تقنيات التخدير' },
  { code: 'xrays', name: 'تقنيات الأشعة' },
  { code: 'construction', name: 'تقنيات البناء والاستشارات' },
  { code: 'oil', name: 'تقنيات النفط والغاز' },
  { code: 'physics', name: 'تقنيات الفيزياء الصحية' },
  { code: 'optics', name: 'تقنيات البصريات' },
  { code: 'health', name: 'تقنيات صحة المجتمع' },
  { code: 'emergency', name: 'تقنيات طب الطوارئ' },
  { code: 'therapy', name: 'تقنيات العلاج الطبيعي' },
  { code: 'cyber', name: 'تقنيات الأمن السيبراني' },
];

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

/**
 * GET /api/examinationadministration/systems-status
 * جلب حالة جميع الأنظمة الفرعية (عدد الطلاب، حالة الماستر شيت، إلخ)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';
    const stage = searchParams.get('stage') || null;
    const studyType = searchParams.get('studyType') || null;

    const systemsStatus = await Promise.all(
      SYSTEMS.map(async (system) => {
        try {
          const departmentNames = systemDepartmentMap[system.code] || [];
          if (departmentNames.length === 0) {
            return {
              code: system.code,
              name: system.name,
              error: 'قسم غير معروف'
            };
          }

          // بناء استعلام للبحث في أسماء الأقسام
          const departmentConditions = departmentNames
            .map((_, index) => `s.major = $${index + 1}`)
            .join(' OR ');

          // حساب عدد الطلاب
          let studentCountQuery = `
            SELECT COUNT(DISTINCT s.id) as count
            FROM student_affairs.students s
            WHERE s.academic_year = $${departmentNames.length + 1}
              AND (${departmentConditions})
          `;
          const studentCountParams = [...departmentNames, academicYear];

          if (stage) {
            studentCountQuery += ` AND s.stage = $${departmentNames.length + 2}`;
            studentCountParams.push(stage);
          }

          if (studyType) {
            studentCountQuery += ` AND s.study_type = $${departmentNames.length + (stage ? 3 : 2)}`;
            studentCountParams.push(studyType);
          }

          const studentCountResult = await query(studentCountQuery, studentCountParams);
          const studentCount = parseInt(studentCountResult.rows[0]?.count || '0', 10);

          // حساب عدد المواد في الفصل الأول
          let firstSemesterSubjectsQuery = `
            SELECT COUNT(DISTINCT sub.id) as count
            FROM student_affairs.subjects sub
            WHERE sub.academic_year = $${departmentNames.length + 1}
              AND sub.semester = 'first'
              AND (${departmentConditions.replace(/s\.major/g, 'sub.major')})
          `;
          const firstSemesterParams = [...departmentNames, academicYear];

          if (stage) {
            firstSemesterSubjectsQuery += ` AND sub.stage = $${departmentNames.length + 2}`;
            firstSemesterParams.push(stage);
          }

          const firstSemesterResult = await query(firstSemesterSubjectsQuery, firstSemesterParams);
          const firstSemesterSubjectsCount = parseInt(firstSemesterResult.rows[0]?.count || '0', 10);

          // حساب عدد المواد في الفصل الثاني
          let secondSemesterSubjectsQuery = `
            SELECT COUNT(DISTINCT sub.id) as count
            FROM student_affairs.subjects sub
            WHERE sub.academic_year = $${departmentNames.length + 1}
              AND sub.semester = 'second'
              AND (${departmentConditions.replace(/s\.major/g, 'sub.major')})
          `;
          const secondSemesterParams = [...departmentNames, academicYear];

          if (stage) {
            secondSemesterSubjectsQuery += ` AND sub.stage = $${departmentNames.length + 2}`;
            secondSemesterParams.push(stage);
          }

          const secondSemesterResult = await query(secondSemesterSubjectsQuery, secondSemesterParams);
          const secondSemesterSubjectsCount = parseInt(secondSemesterResult.rows[0]?.count || '0', 10);

          // حساب عدد الدرجات المسجلة (مؤشر على اكتمال الماستر شيت)
          let gradesQuery = `
            SELECT COUNT(*) as count
            FROM exam_committee.student_grades sg
            INNER JOIN student_affairs.students s ON sg.student_id = s.id
            WHERE s.academic_year = $${departmentNames.length + 1}
              AND (${departmentConditions})
          `;
          const gradesParams = [...departmentNames, academicYear];

          if (stage) {
            gradesQuery += ` AND s.stage = $${departmentNames.length + 2}`;
            gradesParams.push(stage);
          }

          if (studyType) {
            gradesQuery += ` AND s.study_type = $${departmentNames.length + (stage ? 3 : 2)}`;
            gradesParams.push(studyType);
          }

          const gradesResult = await query(gradesQuery, gradesParams);
          const gradesCount = parseInt(gradesResult.rows[0]?.count || '0', 10);

          // حساب نسبة الاكتمال (تقريبي)
          const totalPossibleGrades = studentCount * (firstSemesterSubjectsCount + secondSemesterSubjectsCount);
          const completionPercentage = totalPossibleGrades > 0 
            ? Math.round((gradesCount / totalPossibleGrades) * 100) 
            : 0;

          // تحديد حالة الماستر شيت
          let status: 'completed' | 'in_progress' | 'not_started' = 'not_started';
          if (completionPercentage >= 90) {
            status = 'completed';
          } else if (completionPercentage > 0) {
            status = 'in_progress';
          }

          return {
            code: system.code,
            name: system.name,
            studentCount,
            firstSemesterSubjectsCount,
            secondSemesterSubjectsCount,
            gradesCount,
            totalPossibleGrades,
            completionPercentage,
            status,
            hasData: studentCount > 0
          };
        } catch (error) {
          console.error(`خطأ في جلب بيانات النظام ${system.code}:`, error);
          return {
            code: system.code,
            name: system.name,
            error: 'خطأ في جلب البيانات',
            hasData: false
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      systems: systemsStatus,
      academicYear
    });
  } catch (error) {
    console.error('خطأ في جلب حالة الأنظمة:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب حالة الأنظمة' },
      { status: 500 }
    );
  }
}
