import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // التحقق من المصادقة
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    // التحقق من صحة Access Token
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    // التحقق من وجود المستخدم
    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // التحقق من البيانات المطلوبة
    if (!body.subject_id || !body.student_id || !body.academic_year || !body.semester) {
      return NextResponse.json(
        { success: false, error: 'بيانات غير كاملة' },
        { status: 400 }
      );
    }

    const {
      subject_id,
      student_id,
      academic_year,
      semester,
      month1_score,
      month2_score,
      month3_score,
      help_score,
      notes
    } = body;

    // حساب السعي تلقائياً
    let semester_attendance_score: number | null = null;
    const scores: number[] = [];
    
    if (month1_score !== null && month1_score !== undefined && month1_score !== '') {
      scores.push(Number(month1_score));
    }
    if (month2_score !== null && month2_score !== undefined && month2_score !== '') {
      scores.push(Number(month2_score));
    }
    if (month3_score !== null && month3_score !== undefined && month3_score !== '') {
      scores.push(Number(month3_score));
    }

    if (scores.length > 0) {
      const sum = scores.reduce((acc, score) => acc + score, 0);
      semester_attendance_score = sum / scores.length;
    }

    // التحقق من وجود جدول monthly_exams وإنشاؤه إذا لم يكن موجوداً
    let hasMonthlyExamsTable = false;
    try {
      const checkTableQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'examination_committee' 
          AND table_name = 'monthly_exams'
      `;
      const tableCheck = await query(checkTableQuery, []);
      hasMonthlyExamsTable = tableCheck.rows.length > 0;
    } catch {
      hasMonthlyExamsTable = false;
    }

    if (!hasMonthlyExamsTable) {
      // محاولة إنشاء الجدول تلقائياً
      try {
        const createTableQuery = `
          CREATE TABLE IF NOT EXISTS examination_committee.monthly_exams (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subject_id UUID NOT NULL REFERENCES examination_committee.teaching_subjects(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
            academic_year VARCHAR(10) NOT NULL,
            semester VARCHAR(20) NOT NULL CHECK (semester IN ('first', 'second')),
            
            month1_exam_date DATE,
            month1_theory_score DECIMAL(5,2),
            month1_practical_score DECIMAL(5,2),
            month1_total_score DECIMAL(5,2),
            
            month2_exam_date DATE,
            month2_theory_score DECIMAL(5,2),
            month2_practical_score DECIMAL(5,2),
            month2_total_score DECIMAL(5,2),
            
            month3_exam_date DATE,
            month3_theory_score DECIMAL(5,2),
            month3_practical_score DECIMAL(5,2),
            month3_total_score DECIMAL(5,2),
            
            semester_attendance_score DECIMAL(5,2) DEFAULT 0,
            semester_attendance_max DECIMAL(5,2) DEFAULT 40,
            
            final_total_score DECIMAL(5,2),
            
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            created_by UUID REFERENCES student_affairs.users(id),
            updated_by UUID REFERENCES student_affairs.users(id),
            
            UNIQUE(student_id, subject_id, academic_year, semester)
          );
          
          CREATE INDEX IF NOT EXISTS idx_monthly_exams_subject ON examination_committee.monthly_exams(subject_id);
          CREATE INDEX IF NOT EXISTS idx_monthly_exams_student ON examination_committee.monthly_exams(student_id);
          CREATE INDEX IF NOT EXISTS idx_monthly_exams_year_semester ON examination_committee.monthly_exams(academic_year, semester);
        `;
        
        await query(createTableQuery, []);
        console.log('تم إنشاء جدول monthly_exams تلقائياً');
      } catch (createError) {
        console.error('خطأ في إنشاء جدول monthly_exams:', createError);
        return NextResponse.json(
          { success: false, error: 'فشل في إنشاء جدول الدرجات. يرجى تشغيل migration يدوياً.' },
          { status: 500 }
        );
      }
    }

    // حفظ أو تحديث الدرجات
    const upsertQuery = `
      INSERT INTO examination_committee.monthly_exams (
        subject_id,
        student_id,
        academic_year,
        semester,
        month1_total_score,
        month2_total_score,
        month3_total_score,
        semester_attendance_score,
        help_score,
        notes,
        updated_at,
        updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
      ON CONFLICT (student_id, subject_id, academic_year, semester)
      DO UPDATE SET
        month1_total_score = EXCLUDED.month1_total_score,
        month2_total_score = EXCLUDED.month2_total_score,
        month3_total_score = EXCLUDED.month3_total_score,
        semester_attendance_score = EXCLUDED.semester_attendance_score,
        help_score = EXCLUDED.help_score,
        notes = EXCLUDED.notes,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING id, month1_total_score, month2_total_score, month3_total_score, semester_attendance_score, help_score, notes
    `;

    const result = await query(upsertQuery, [
      subject_id,
      student_id,
      academic_year,
      semester,
      month1_score !== null && month1_score !== undefined && month1_score !== '' ? Number(month1_score) : null,
      month2_score !== null && month2_score !== undefined && month2_score !== '' ? Number(month2_score) : null,
      month3_score !== null && month3_score !== undefined && month3_score !== '' ? Number(month3_score) : null,
      semester_attendance_score,
      help_score !== null && help_score !== undefined && help_score !== '' ? Number(help_score) : null,
      notes || null,
      user.id
    ]);

    return NextResponse.json({
      success: true,
      data: {
        grade_id: result.rows[0].id,
        month1_score: result.rows[0].month1_total_score ? Number(result.rows[0].month1_total_score) : null,
        month2_score: result.rows[0].month2_total_score ? Number(result.rows[0].month2_total_score) : null,
        month3_score: result.rows[0].month3_total_score ? Number(result.rows[0].month3_total_score) : null,
        semester_attendance_score: result.rows[0].semester_attendance_score ? Number(result.rows[0].semester_attendance_score) : null,
        help_score: result.rows[0].help_score ? Number(result.rows[0].help_score) : null,
        notes: result.rows[0].notes
      },
      message: 'تم حفظ الدرجات بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في حفظ الدرجات:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في حفظ الدرجات: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

