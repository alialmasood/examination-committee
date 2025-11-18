import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// GET /api/students/stats - جلب إحصائيات الطلاب
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academic_year') || '2025-2026';

    // جلب إجمالي عدد الطلاب
    const totalQuery = academicYear
      ? 'SELECT COUNT(*) as total FROM student_affairs.students WHERE academic_year = $1'
      : 'SELECT COUNT(*) as total FROM student_affairs.students';
    const totalParams = academicYear ? [academicYear] : [];
    const totalResult = await query(totalQuery, totalParams);
    const total = parseInt(totalResult.rows[0].total);

    // جلب عدد الطلاب النشطين
    // الطالب النشط: academic_status = 'مستمر' AND payment_status = 'paid'
    // التحقق من وجود عمود academic_status و payment_status
    const academicStatusColumnCheck = await query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'student_affairs' 
          AND table_name = 'students' 
          AND column_name = 'academic_status'
      ) as exists
    `);
    
    const paymentStatusColumnCheck = await query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'student_affairs' 
          AND table_name = 'students' 
          AND column_name = 'payment_status'
      ) as exists
    `);
    
    const hasAcademicStatusColumn = academicStatusColumnCheck.rows[0]?.exists || false;
    const hasPaymentStatusColumn = paymentStatusColumnCheck.rows[0]?.exists || false;
    
    let active = 0;
    
    if (hasAcademicStatusColumn && hasPaymentStatusColumn) {
      // الطالب النشط: academic_status = 'مستمر' AND payment_status = 'paid'
      const activeQuery = academicYear
        ? `SELECT COUNT(*) as active 
           FROM student_affairs.students 
           WHERE academic_status = $1 
             AND COALESCE(payment_status, '') = $2
             AND academic_year = $3`
        : `SELECT COUNT(*) as active 
           FROM student_affairs.students 
           WHERE academic_status = $1 
             AND COALESCE(payment_status, '') = $2`;
      const activeParams = academicYear 
        ? ['مستمر', 'paid', academicYear]
        : ['مستمر', 'paid'];
      const activeResult = await query(activeQuery, activeParams);
      active = parseInt(activeResult.rows[0].active);
    } else if (hasAcademicStatusColumn) {
      // إذا كان academic_status موجوداً فقط، نستخدمه
      const activeQuery = academicYear
        ? 'SELECT COUNT(*) as active FROM student_affairs.students WHERE academic_status = $1 AND academic_year = $2'
        : 'SELECT COUNT(*) as active FROM student_affairs.students WHERE academic_status = $1';
      const activeParams = academicYear ? ['مستمر', academicYear] : ['مستمر'];
      const activeResult = await query(activeQuery, activeParams);
      active = parseInt(activeResult.rows[0].active);
    } else {
      // إذا لم يكن academic_status موجوداً، نستخدم status القديم
      const activeQuery = academicYear
        ? 'SELECT COUNT(*) as active FROM student_affairs.students WHERE status = $1 AND academic_year = $2'
        : 'SELECT COUNT(*) as active FROM student_affairs.students WHERE status = $1';
      const activeParams = academicYear ? ['active', academicYear] : ['active'];
      const activeResult = await query(activeQuery, activeParams);
      active = parseInt(activeResult.rows[0].active);
    }

    // جلب عدد طلاب المرحلة الأولى (طلبة جدد)
    const firstYearQuery = academicYear
      ? 'SELECT COUNT(*) as count FROM student_affairs.students WHERE admission_type = $1 AND academic_year = $2'
      : 'SELECT COUNT(*) as count FROM student_affairs.students WHERE admission_type = $1';
    const firstYearParams = academicYear ? ['first', academicYear] : ['first'];
    const firstYearResult = await query(firstYearQuery, firstYearParams);
    const firstYearCount = parseInt(firstYearResult.rows[0].count);

    // جلب إحصائيات قنوات القبول
    const admissionChannels = [
      'general',
      'martyrs',
      'social_care',
      'special_needs',
      'political_prisoners',
      'siblings_married',
      'minister_directive',
      'dean_approval',
      'faculty_children',
      'top_students',
      'health_ministry'
    ];

    const channelStats: Record<string, number> = {};
    
    // التحقق من وجود عمود admission_channel
    const channelColumnCheck = await query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'student_affairs' 
          AND table_name = 'students' 
          AND column_name = 'admission_channel'
      ) as exists
    `);
    
    const hasAdmissionChannelColumn = channelColumnCheck.rows[0]?.exists || false;

    if (hasAdmissionChannelColumn) {
      // جلب الإحصائيات من قاعدة البيانات
      for (const channel of admissionChannels) {
        const channelQuery = academicYear
          ? 'SELECT COUNT(*) as count FROM student_affairs.students WHERE admission_channel = $1 AND academic_year = $2'
          : 'SELECT COUNT(*) as count FROM student_affairs.students WHERE admission_channel = $1';
        const channelParams = academicYear ? [channel, academicYear] : [channel];
        const result = await query(channelQuery, channelParams);
        channelStats[channel] = parseInt(result.rows[0].count);
      }
      
      // حساب الطلاب الذين ليس لديهم قناة قبو (NULL أو empty)
      const nullChannelQuery = academicYear
        ? 'SELECT COUNT(*) as count FROM student_affairs.students WHERE (admission_channel IS NULL OR admission_channel = \'\') AND academic_year = $1'
        : 'SELECT COUNT(*) as count FROM student_affairs.students WHERE admission_channel IS NULL OR admission_channel = \'\'';
      const nullChannelParams = academicYear ? [academicYear] : [];
      const nullChannelResult = await query(nullChannelQuery, nullChannelParams);
      channelStats['general'] = (channelStats['general'] || 0) + parseInt(nullChannelResult.rows[0].count);
    } else {
      // إذا لم يكن العمود موجوداً، نستخدم القيم الافتراضية
      for (const channel of admissionChannels) {
        channelStats[channel] = 0;
      }
      // "القناة العامة" تحصل على إجمالي الطلاب كنقطة انطلاق
      channelStats['general'] = total;
    }

    // جلب إحصائيات حالات الطالب الأكاديمية
    const academicStatuses = [
      'مستمر',
      'مرقن بسبب الغياب',
      'مرقن بسبب عدم تسليم وثيقة الإعدادية',
      'مرقن بسبب الوفاة',
      'مرقن بسبب الرسوب سنتين',
      'مرقن بسبب الرسوب بمواد التحميل',
      'راسب بسبب الغياب',
      'راسب بسبب عقوبة انضباطية',
      'راسب بالمواد الدراسية',
      'محمل من المرحلة السابقة',
      'مؤجّل',
      'حالات أخرى'
    ];

    const statusStats: Record<string, number> = {};

    // إعادة استخدام hasAcademicStatusColumn الذي تم التحقق منه سابقاً
    if (hasAcademicStatusColumn) {
      // جلب الإحصائيات من قاعدة البيانات
      for (const status of academicStatuses) {
        const statusQuery = academicYear
          ? 'SELECT COUNT(*) as count FROM student_affairs.students WHERE academic_status = $1 AND academic_year = $2'
          : 'SELECT COUNT(*) as count FROM student_affairs.students WHERE academic_status = $1';
        const statusParams = academicYear ? [status, academicYear] : [status];
        const result = await query(statusQuery, statusParams);
        statusStats[status] = parseInt(result.rows[0].count);
      }
      
      // حساب "حالات أخرى" للطلاب الذين لديهم حالة غير موجودة في القائمة
      const knownStatuses = [
        'مستمر',
        'مرقن بسبب الغياب',
        'مرقن بسبب عدم تسليم وثيقة الإعدادية',
        'مرقن بسبب الوفاة',
        'مرقن بسبب الرسوب سنتين',
        'مرقن بسبب الرسوب بمواد التحميل',
        'راسب بسبب الغياب',
        'راسب بسبب عقوبة انضباطية',
        'راسب بالمواد الدراسية',
        'محمل من المرحلة السابقة',
        'مؤجّل'
      ];
      
      const placeholders = knownStatuses.map((_, i) => `$${i + 1}`).join(', ');
      const othersQuery = academicYear
        ? `SELECT COUNT(*) as count 
           FROM student_affairs.students 
           WHERE academic_status IS NOT NULL 
             AND academic_status NOT IN (${placeholders})
             AND academic_year = $${knownStatuses.length + 1}`
        : `SELECT COUNT(*) as count 
           FROM student_affairs.students 
           WHERE academic_status IS NOT NULL 
             AND academic_status NOT IN (${placeholders})`;
      const othersParams = academicYear 
        ? [...knownStatuses, academicYear]
        : knownStatuses;
      const othersResult = await query(othersQuery, othersParams);
      statusStats['حالات أخرى'] = parseInt(othersResult.rows[0].count);
    } else {
      // إذا لم يكن العمود موجوداً، نستخدم القيم الافتراضية
      for (const status of academicStatuses) {
        statusStats[status] = 0;
      }
      // "مستمر" يحصل على إجمالي الطلاب كنقطة انطلاق
      statusStats['مستمر'] = total;
    }

    return NextResponse.json({
      success: true,
      data: {
        total,
        active,
        firstYear: firstYearCount,
        academicStatuses: statusStats,
        admissionChannels: channelStats
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الإحصائيات:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
