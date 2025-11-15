import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { getSystemPathByDepartment } from '@/src/lib/department-system-map';

/**
 * GET /api/department-students/[system]
 * جلب الطلاب الذين أكملوا الدفع (payment_status = 'paid') والذين ينتمون للقسم المرتبط بهذا النظام
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    
    // خريطة ربط الأقسام بالأنظمة
    const systemDepartmentMap: Record<string, string[]> = {
      'dentalindustry': ['تقنيات صناعة الأسنان', 'صناعة الأسنان'],
      'anesthesia': ['تقنيات التخدير', 'التخدير'],
      'xrays': ['تقنيات الأشعة', 'الأشعة'],
      'construction': ['هندسة تقنيات البناء والانشاءات', 'تقنيات البناء والاستشارات', 'البناء والاستشارات'], // للتوافق مع البيانات القديمة
      'oil': ['تقنيات هندسة النفط والغاز', 'هندسة النفط والغاز', 'تقنيات النفط والغاز'],
      'physics': ['تقنيات الفيزياء الصحية', 'الفيزياء الصحية'],
      'optics': ['تقنيات البصريات', 'البصريات'],
      'health': ['تقنيات صحة المجتمع', 'صحة المجتمع'],
      'emergency': ['تقنيات طب الطوارئ', 'طب الطوارئ'],
      'therapy': ['تقنيات العلاج الطبيعي', 'العلاج الطبيعي'],
      'cyber': ['هندسة تقنيات الامن السيبراني والحوسبة السحابية', 'تقنيات الأمن السيبراني', 'تقنيات الامن السيبراني', 'الأمن السيبراني'], // للتوافق مع البيانات القديمة
    };
    
    const departmentNames = systemDepartmentMap[system];
    
    if (!departmentNames || departmentNames.length === 0) {
      return NextResponse.json({ success: false, error: 'نظام غير معروف' }, { status: 400 });
    }
    
    // بناء استعلام SQL - استخدام ILIKE للبحث المرن
    const conditions = departmentNames.map((_, i) => `s.major ILIKE $${i + 1}`).join(' OR ');
    const studentsQuery = `
      SELECT 
        s.id,
        s.university_id,
        COALESCE(s.full_name_ar, s.full_name, s.first_name || ' ' || s.last_name) as full_name,
        s.nickname,
        s.mother_name,
        s.major as department,
        s.level,
        s.admission_type,
        s.semester,
        s.academic_year,
        s.registration_date,
        s.photo,
        s.payment_status,
        s.payment_amount,
        s.payment_date,
        s.status
      FROM student_affairs.students s
      WHERE COALESCE(s.payment_status, 'pending') = 'paid'
        AND s.status = 'active'
        AND (${conditions})
      ORDER BY s.registration_date DESC, s.full_name_ar ASC
    `;
    
    // استخدام LIKE مع % للبحث المرن
    const searchPatterns = departmentNames.map(name => `%${name}%`);
    const result = await query(studentsQuery, searchPatterns);
    
    const students = result.rows.map(row => ({
      id: row.id,
      university_id: row.university_id,
      full_name: row.full_name,
      nickname: row.nickname,
      mother_name: row.mother_name,
      department: row.department,
      level: row.level,
      admission_type: row.admission_type,
      semester: row.semester,
      academic_year: row.academic_year,
      registration_date: row.registration_date,
      photo: row.photo,
      payment_status: row.payment_status || 'paid',
      payment_amount: row.payment_amount,
      payment_date: row.payment_date,
      status: row.status,
    }));
    
    return NextResponse.json({
      success: true,
      data: students,
      count: students.length
    });
    
  } catch (error) {
    console.error('خطأ في جلب طلاب القسم:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب بيانات الطلاب' },
      { status: 500 }
    );
  }
}

