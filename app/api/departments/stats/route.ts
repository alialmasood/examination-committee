import { NextResponse } from 'next/server';
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
export async function GET() {
  try {
    const statsPromises = DEPARTMENTS.map(async (dept) => {
      // جلب إجمالي عدد الطلاب في القسم - استخدام دالة تطبيع النص العربي
      const totalResult = await query(
        `SELECT COUNT(*) as total FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1)`,
        [dept.arabicName]
      );
      const total = parseInt(totalResult.rows[0].total);

      // جلب عدد الطلاب حسب المرحلة الدراسية (admission_type)
      const firstYear = await query(
        `SELECT COUNT(*) as count FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND admission_type = $2`,
        [dept.arabicName, 'first']
      );
      
      const secondYear = await query(
        `SELECT COUNT(*) as count FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND admission_type = $2`,
        [dept.arabicName, 'second']
      );
      
      const thirdYear = await query(
        `SELECT COUNT(*) as count FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND admission_type = $2`,
        [dept.arabicName, 'third']
      );
      
      const fourthYear = await query(
        `SELECT COUNT(*) as count FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND admission_type = $2`,
        [dept.arabicName, 'fourth']
      );

      // جلب إجمالي المبالغ المدفوعة للقسم
      const totalAmountResult = await query(
        `SELECT COALESCE(SUM(payment_amount), 0) as total_amount FROM student_affairs.students WHERE normalize_arabic(major) = normalize_arabic($1) AND payment_status = $2`,
        [dept.arabicName, 'paid']
      );
      const totalAmount = parseFloat(totalAmountResult.rows[0].total_amount);

      return {
        id: dept.id,
        name: dept.arabicName,
        total: total,
        totalAmount: totalAmount,
        years: {
          first: parseInt(firstYear.rows[0].count),
          second: parseInt(secondYear.rows[0].count),
          third: parseInt(thirdYear.rows[0].count),
          fourth: parseInt(fourthYear.rows[0].count)
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
