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
 * GET /api/examinationadministration/sub-master-status
 * جلب حالة السب ماستر لجميع الأنظمة الفرعية
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';
    const semester = searchParams.get('semester') || 'first';
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
            .map((_, index) => `ts.department = $${index + 1}`)
            .join(' OR ');

          // حساب عدد المواد التدريسية
          let subjectsQuery = `
            SELECT COUNT(DISTINCT ts.id) as count
            FROM examination_committee.teaching_subjects ts
            WHERE ts.academic_year = $${departmentNames.length + 1}
              AND ts.semester = $${departmentNames.length + 2}
              AND (${departmentConditions})
          `;
          const subjectsParams = [...departmentNames, academicYear, semester];

          if (stage) {
            subjectsQuery += ` AND ts.stage = $${departmentNames.length + 3}`;
            subjectsParams.push(stage);
          }

          if (studyType) {
            subjectsQuery += ` AND ts.study_type = $${departmentNames.length + (stage ? 4 : 3)}`;
            subjectsParams.push(studyType);
          }

          const subjectsResult = await query(subjectsQuery, subjectsParams);
          const subjectsCount = parseInt(subjectsResult.rows[0]?.count || '0', 10);

          // حساب عدد المواد المكتملة (التي لديها درجات)
          let completedSubjectsQuery = `
            SELECT COUNT(DISTINCT ts.id) as count
            FROM examination_committee.teaching_subjects ts
            INNER JOIN examination_committee.sub_master_grades smg 
              ON ts.id = smg.subject_id 
              AND smg.academic_year = $${departmentNames.length + 1}
              AND smg.semester = $${departmentNames.length + 2}
            WHERE ts.academic_year = $${departmentNames.length + 1}
              AND ts.semester = $${departmentNames.length + 2}
              AND (${departmentConditions})
          `;
          const completedSubjectsParams = [...departmentNames, academicYear, semester];

          if (stage) {
            completedSubjectsQuery += ` AND ts.stage = $${departmentNames.length + 3}`;
            completedSubjectsParams.push(stage);
          }

          if (studyType) {
            completedSubjectsQuery += ` AND ts.study_type = $${departmentNames.length + (stage ? 4 : 3)}`;
            completedSubjectsParams.push(studyType);
          }

          const completedSubjectsResult = await query(completedSubjectsQuery, completedSubjectsParams);
          const completedSubjectsCount = parseInt(completedSubjectsResult.rows[0]?.count || '0', 10);

          // حساب عدد الدرجات المسجلة
          let gradesQuery = `
            SELECT COUNT(*) as count
            FROM examination_committee.sub_master_grades smg
            INNER JOIN examination_committee.teaching_subjects ts ON smg.subject_id = ts.id
            WHERE smg.academic_year = $${departmentNames.length + 1}
              AND smg.semester = $${departmentNames.length + 2}
              AND (${departmentConditions})
          `;
          const gradesParams = [...departmentNames, academicYear, semester];

          if (stage) {
            gradesQuery += ` AND ts.stage = $${departmentNames.length + 3}`;
            gradesParams.push(stage);
          }

          if (studyType) {
            gradesQuery += ` AND ts.study_type = $${departmentNames.length + (stage ? 4 : 3)}`;
            gradesParams.push(studyType);
          }

          const gradesResult = await query(gradesQuery, gradesParams);
          const gradesCount = parseInt(gradesResult.rows[0]?.count || '0', 10);

          // حساب نسبة الاكتمال
          const completionPercentage = subjectsCount > 0 
            ? Math.round((completedSubjectsCount / subjectsCount) * 100) 
            : 0;

          // تحديد الحالة
          let status: 'completed' | 'in_progress' | 'not_started' = 'not_started';
          if (completionPercentage >= 90) {
            status = 'completed';
          } else if (completionPercentage > 0) {
            status = 'in_progress';
          }

          return {
            code: system.code,
            name: system.name,
            subjectsCount,
            completedSubjectsCount,
            gradesCount,
            completionPercentage,
            status,
            hasData: subjectsCount > 0
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
      academicYear,
      semester
    });
  } catch (error) {
    console.error('خطأ في جلب حالة السب ماستر:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب حالة السب ماستر' },
      { status: 500 }
    );
  }
}
