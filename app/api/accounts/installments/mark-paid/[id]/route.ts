import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { getSystemPathByDepartment } from '@/src/lib/department-system-map';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 0) || null;
    let discountPercentage = Number(body?.discount_percentage ?? 0) || 0;

    // الحصول على معلومات الطالب قبل التحديث (القسم، نوع الدراسة، قناة القبول)
    const studentResult = await query(
      `SELECT major, university_id, study_type, admission_channel FROM student_affairs.students WHERE id = $1`,
      [id]
    );
    
    if (studentResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطالب غير موجود' }, { status: 404 });
    }
    
    const department = studentResult.rows[0].major;
    const studyType = studentResult.rows[0].study_type;
    const admissionChannel = studentResult.rows[0].admission_channel;
    const systemPath = getSystemPathByDepartment(department);
    
    // تحديد النسب الثابتة لكل قناة
    const fixedDiscounts: Record<string, number> = {
      'general': 0,
      'martyrs': 50,
      'social_care': 50,
      'siblings_married': 10,
      'top_students': 10,
      'health_ministry': 20
    };

    // إذا كانت قناة القبول لديها نسبة ثابتة، نستخدم القيمة الثابتة ونتجاهل القيمة المرسلة
    if (admissionChannel && fixedDiscounts.hasOwnProperty(admissionChannel)) {
      discountPercentage = fixedDiscounts[admissionChannel];
    }

    // حساب القسط السنوي (نفس منطق الواجهة الأمامية)
    const getAnnualTuitionFee = (dept: string, st?: string) => {
      const isEvening = st === 'evening';
      const fees: Record<string, number> = {
        'تقنيات التخدير': isEvening ? 2750000 : 3000000,
        'تقنيات الاشعة': isEvening ? 2750000 : 3000000,
        'تقنيات صناعة الاسنان': isEvening ? 2250000 : 2500000,
        'تقنيات البصريات': 2750000,
        'تقنيات طب الطوارئ': 2750000,
        'تقنيات صحة المجتمع': 2750000,
        'تقنيات العلاج الطبيعي': 2750000,
        'هندسة تقنيات البناء والانشاءات': 2500000,
        'تقنيات البناء والاستشارات': 2500000, // للتوافق مع البيانات القديمة
        'تقنيات هندسة النفط والغاز': 2500000,
        'تقنيات الفيزياء الصحية': 2500000,
        'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 3000000,
        'تقنيات الامن السيبراني': 3000000, // للتوافق مع البيانات القديمة
        'تقنيات الأمن السيبراني': 3000000, // للتوافق مع البيانات القديمة
      };
      return fees[dept] || 0;
    };

    const annualFee = getAnnualTuitionFee(department, studyType);
    const discountAmount = (annualFee * discountPercentage) / 100;
    const finalFeeAfterDiscount = annualFee - discountAmount;
    
    // التحقق من وجود عمود discount_percentage وإنشاؤه إن لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0
      `);
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0
      `);
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
      `);
    } catch (error) {
      console.log('الأعمدة موجودة بالفعل أو حدث خطأ في التحقق:', error);
    }

    // تحديث حالة الدفع مع نسبة التخفيض ومبلغ التخفيض والقسط النهائي
    await query(
      `UPDATE student_affairs.students 
       SET payment_status = 'paid', 
           payment_amount = COALESCE($2, payment_amount), 
           payment_date = COALESCE(payment_date, NOW()), 
           discount_percentage = $3,
           discount_amount = $4,
           final_fee_after_discount = $5,
           updated_at = NOW() 
       WHERE id = $1`,
      [id, amount, discountPercentage, discountAmount, finalFeeAfterDiscount]
    );
    
    // إرجاع معلومات إضافية للنظام المرتبط
    return NextResponse.json({ 
      success: true,
      systemPath: systemPath || null,
      department: department || null
    });
  } catch (e) {
    console.error('خطأ في تحديث حالة الدفع:', e);
    return NextResponse.json({ success: false, error: 'خطأ في تحديث حالة الدفع' }, { status: 500 });
  }
}


