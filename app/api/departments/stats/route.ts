import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// قائمة الأقسام الأكاديمية
const DEPARTMENTS = [
  { id: 'anesthesia', name: 'تقنيات التخدير', arabicName: 'تقنيات التخدير' },
  { id: 'radiology', name: 'تقنيات الاشعة', arabicName: 'تقنيات الاشعة' },
  { id: 'dental', name: 'تقنيات صناعة الاسنان', arabicName: 'تقنيات صناعة الاسنان' },
  { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات', arabicName: 'هندسة تقنيات البناء والانشاءات' },
  { id: 'oil-gas', name: 'تقنيات هندسة النفط والغاز', arabicName: 'تقنيات هندسة النفط والغاز' },
  { id: 'health-physics', name: 'تقنيات الفيزياء الصحية', arabicName: 'تقنيات الفيزياء الصحية' },
  { id: 'optics', name: 'تقنيات البصريات', arabicName: 'تقنيات البصريات' },
  { id: 'community-health', name: 'تقنيات صحة المجتمع', arabicName: 'تقنيات صحة المجتمع' },
  { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ', arabicName: 'تقنيات طب الطوارئ' },
  { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي', arabicName: 'تقنيات العلاج الطبيعي' },
  { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', arabicName: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية' },
  { id: 'law', name: 'القانون', arabicName: 'القانون' }
];

// GET /api/departments/stats - جلب إحصائيات الأقسام الأكاديمية
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academic_year') || '2025-2026';

    const statsPromises = DEPARTMENTS.map(async (dept) => {
      // جلب إجمالي عدد الطلاب في القسم - استخدام دالة تطبيع النص العربي
      const totalQuery = academicYear
        ? `SELECT COUNT(*) as total FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND academic_year = $2`
        : `SELECT COUNT(*) as total FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1)`;
      const totalParams = academicYear ? [dept.arabicName, academicYear] : [dept.arabicName];
      const totalResult = await query(totalQuery, totalParams);
      const total = parseInt(totalResult.rows[0].total);

      // دالة مساعدة لجلب إحصائيات حسب نوع الدراسة والمرحلة
      const getStatsByStudyType = async (studyType: string) => {
        const firstYearQuery = academicYear
          ? `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3
             AND academic_year = $4`
          : `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3`;
        const firstYearParams = academicYear 
          ? [dept.arabicName, 'first', studyType, academicYear]
          : [dept.arabicName, 'first', studyType];
        const firstYear = await query(firstYearQuery, firstYearParams);
        
        const secondYearQuery = academicYear
          ? `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3
             AND academic_year = $4`
          : `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3`;
        const secondYearParams = academicYear 
          ? [dept.arabicName, 'second', studyType, academicYear]
          : [dept.arabicName, 'second', studyType];
        const secondYear = await query(secondYearQuery, secondYearParams);
        
        const thirdYearQuery = academicYear
          ? `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3
             AND academic_year = $4`
          : `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3`;
        const thirdYearParams = academicYear 
          ? [dept.arabicName, 'third', studyType, academicYear]
          : [dept.arabicName, 'third', studyType];
        const thirdYear = await query(thirdYearQuery, thirdYearParams);
        
        const fourthYearQuery = academicYear
          ? `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3
             AND academic_year = $4`
          : `SELECT COUNT(*) as count FROM student_affairs.students 
             WHERE normalize_arabic(major) = normalize_arabic($1) 
             AND admission_type = $2 
             AND COALESCE(study_type, 'morning') = $3`;
        const fourthYearParams = academicYear 
          ? [dept.arabicName, 'fourth', studyType, academicYear]
          : [dept.arabicName, 'fourth', studyType];
        const fourthYear = await query(fourthYearQuery, fourthYearParams);

        return {
          first: parseInt(firstYear.rows[0].count),
          second: parseInt(secondYear.rows[0].count),
          third: parseInt(thirdYear.rows[0].count),
          fourth: parseInt(fourthYear.rows[0].count)
        };
      };

      // جلب إحصائيات الصباحي والمسائي
      const [morningStats, eveningStats] = await Promise.all([
        getStatsByStudyType('morning'),
        getStatsByStudyType('evening')
      ]);

      // جلب إجمالي المبالغ المدفوعة للقسم
      const totalAmountQuery = academicYear
        ? `SELECT COALESCE(SUM(payment_amount), 0) as total_amount FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND payment_status = $2 AND academic_year = $3`
        : `SELECT COALESCE(SUM(payment_amount), 0) as total_amount FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND payment_status = $2`;
      const totalAmountParams = academicYear 
        ? [dept.arabicName, 'paid', academicYear]
        : [dept.arabicName, 'paid'];
      const totalAmountResult = await query(totalAmountQuery, totalAmountParams);
      const totalAmount = parseFloat(totalAmountResult.rows[0].total_amount);

      return {
        id: dept.id,
        name: dept.arabicName,
        total: total,
        totalAmount: totalAmount,
        years: {
          first: morningStats.first + eveningStats.first,
          second: morningStats.second + eveningStats.second,
          third: morningStats.third + eveningStats.third,
          fourth: morningStats.fourth + eveningStats.fourth
        },
        studyTypes: {
          morning: morningStats,
          evening: eveningStats
        }
      };
    });

    const stats = await Promise.all(statsPromises);

    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('خطأ في جلب إحصائيات الأقسام:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
