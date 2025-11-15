import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/sub-master-grades/[system]/[subject_id]
 * جلب درجات السب ماستر لطالب معين في مادة معينة
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string; subject_id: string }> }
) {
  try {
    const { system, subject_id } = await params;
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';
    const semester = searchParams.get('semester') || 'first';
    const stage = searchParams.get('stage') || null;
    const studyType = searchParams.get('studyType') || null;

    // خريطة ربط الأقسام بالأنظمة
    // ملاحظة: القيم هنا تطابق القيم الفعلية في قاعدة البيانات (تقنيات الاشعة بالألف المقصورة)
    const systemDepartmentMap: Record<string, string[]> = {
      'dentalindustry': ['تقنيات صناعة الاسنان', 'تقنيات صناعة الأسنان'],
      'anesthesia': ['تقنيات التخدير'],
      'xrays': ['تقنيات الاشعة', 'تقنيات الأشعة'], // القيمة الفعلية في قاعدة البيانات: تقنيات الاشعة
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

    // جلب معلومات المادة التدريسية
    const subjectQuery = `
      SELECT id, department, material_name, instructor_name, semester, academic_year, stage, study_type, units, has_practical
      FROM examination_committee.teaching_subjects
      WHERE id = $1 AND academic_year = $2 AND semester = $3
    `;
    const subjectResult = await query(subjectQuery, [subject_id, academicYear, semester]);
    
    if (subjectResult.rows.length === 0) {
      console.log(`[${system}] المادة ${subject_id} غير موجودة للسنة ${academicYear} والفصل ${semester}`);
      return NextResponse.json({ success: false, error: 'المادة التدريسية غير موجودة' }, { status: 404 });
    }

    const subject = subjectResult.rows[0];
    
    // التحقق من أن المادة تنتمي للقسم الصحيح
    if (!departmentNames.includes(subject.department)) {
      console.log(`[${system}] المادة ${subject_id} تنتمي للقسم "${subject.department}" وليس لـ "${departmentNames.join('" أو "')}"`);
      return NextResponse.json({ success: false, error: 'المادة التدريسية غير موجودة' }, { status: 404 });
    }

    // جلب جميع الطلاب المسجلين في نفس القسم فقط
    // نستخدم مطابقة مباشرة لأن الأقسام مضيفة مرة واحدة ويتم جلبها تلقائياً
    // المعاملات: $1, $2, $3 للـ JOIN، ثم $4, $5, ... للـ departmentNames، ثم باقي الشروط
    const baseParamsCount = 3; // subject_id, academicYear, semester للـ JOIN
    const majorConditions = departmentNames.map((_, i) => `s.major = $${baseParamsCount + i + 1}`).join(' OR ');
    
    // بناء الشروط الديناميكية والمعاملات
    let paramIndex = baseParamsCount + departmentNames.length + 1;
    const conditions = `(${majorConditions})`;
    const dynamicConditions: string[] = [];
    const dynamicParams: (string | null)[] = [];
    
    // إضافة الشروط الديناميكية بناءً على وجود القيم
    if (stage) {
      dynamicConditions.push(`AND s.admission_type = $${paramIndex++}`);
      dynamicParams.push(stage);
    }
    if (semester) {
      dynamicConditions.push(`AND s.semester = $${paramIndex++}`);
      dynamicParams.push(semester);
    }
    dynamicConditions.push(`AND s.academic_year = $${paramIndex++}`);
    dynamicParams.push(academicYear);
    if (studyType) {
      dynamicConditions.push(`AND s.study_type = $${paramIndex++}`);
      dynamicParams.push(studyType);
    }
    
    const studentsQuery = `
      SELECT 
        s.id,
        s.university_id,
        s.major,
        COALESCE(s.full_name_ar, s.full_name, s.first_name || ' ' || s.last_name) as full_name,
        s.admission_type,
        s.semester,
        s.academic_year,
        smg.id as grade_id,
        smg.sae_40,
        smg.first_practical_25,
        smg.first_theory_35,
        smg.first_total_60,
        smg.first_final_100,
        smg.second_practical_25,
        smg.second_theory_35,
        smg.second_total_60,
        smg.second_final_100
      FROM student_affairs.students s
      LEFT JOIN examination_committee.sub_master_grades smg 
        ON s.id = smg.student_id 
        AND smg.subject_id = $1
        AND smg.academic_year = $2
        AND smg.semester = $3
      WHERE ${conditions}
        AND s.payment_status = 'paid'
        ${dynamicConditions.join(' ')}
      ORDER BY s.full_name_ar ASC
    `;

    // بناء قائمة المعاملات بالترتيب الصحيح
    const queryParams: (string | null)[] = [
      subject_id, academicYear, semester, 
      ...departmentNames, 
      ...dynamicParams
    ];
    
    console.log(`[${system}] البحث عن أقسام:`, departmentNames);
    
    const studentsResult = await query(studentsQuery, queryParams);
    
    // تسجيل بسيط للتشخيص
    if (studentsResult.rows.length > 0) {
      const uniqueMajors = [...new Set(studentsResult.rows.map((r: { major?: string }) => r.major))];
      console.log(`[${system}] تم جلب ${studentsResult.rows.length} طالب من الأقسام:`, uniqueMajors);
    } else {
      console.log(`[${system}] لم يتم العثور على أي طلاب`);
    }

    const students = studentsResult.rows.map((row, index) => ({
      sequence: index + 1,
      student_id: row.id,
      university_id: row.university_id,
      full_name: row.full_name,
      admission_type: row.admission_type, // للمساعدة في الفلترة في الواجهة
      semester: row.semester, // للمساعدة في الفلترة في الواجهة
      grade_id: row.grade_id,
      grades: {
        sae_40: row.sae_40,
        first_practical_25: row.first_practical_25,
        first_theory_35: row.first_theory_35,
        first_total_60: row.first_total_60,
        first_final_100: row.first_final_100,
        second_practical_25: row.second_practical_25,
        second_theory_35: row.second_theory_35,
        second_total_60: row.second_total_60,
        second_final_100: row.second_final_100,
      }
    }));

    return NextResponse.json({
      success: true,
      subject: {
        subject_id: subject.id,
        material_name: subject.material_name,
        instructor_name: subject.instructor_name,
        semester: subject.semester,
        academic_year: subject.academic_year,
        units: subject.units,
        stage: subject.stage,
        study_type: subject.study_type,
        has_practical: subject.has_practical ?? true,
      },
      students: students,
      academic_year: academicYear,
      semester: semester,
      departmentNames: departmentNames, // للمساعدة في التشخيص
      studentsCount: students.length
    });
  } catch (error) {
    console.error('خطأ في جلب درجات السب ماستر للمادة:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب درجات السب ماستر للمادة' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sub-master-grades/[system]/[subject_id]
 * حفظ أو تحديث درجات السب ماستر
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ system: string; subject_id: string }> }
) {
  try {
    const { subject_id } = await params;
    const body = await request.json();

    // التحقق من البيانات المطلوبة
    if (!body.student_id) {
      return NextResponse.json(
        { success: false, error: 'معرف الطالب مطلوب' },
        { status: 400 }
      );
    }

    const academicYear = body.academic_year || '2025-2026';
    const semester = body.semester || 'first';

    // التحقق من وجود المادة التدريسية
    const subjectCheck = await query(
      'SELECT id, has_practical FROM examination_committee.teaching_subjects WHERE id = $1',
      [subject_id]
    );
    if (subjectCheck.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المادة التدريسية غير موجودة' },
        { status: 404 }
      );
    }

    const hasPractical = subjectCheck.rows[0].has_practical !== false;

    // حساب المجاميع تلقائياً
    const sae40 = body.sae_40 || null;
    const firstPractical25Raw = body.first_practical_25 || null;
    const firstTheory35 = body.first_theory_35 || null;
    const secondPractical25Raw = body.second_practical_25 || null;
    const secondTheory35 = body.second_theory_35 || null;

    const firstPractical25 = hasPractical ? firstPractical25Raw : null;
    const secondPractical25 = hasPractical ? secondPractical25Raw : null;
    
    // حساب مجموع الدور الأول (عملي + نظر)
    const firstTotalScore = hasPractical
      ? ((firstPractical25 !== null && firstTheory35 !== null)
        ? (Number(firstPractical25) + Number(firstTheory35))
        : null)
      : (firstTheory35 !== null ? Number(firstTheory35) : null);
    
    // حساب الدرجة النهائية للدور الأول (سعي + مجموع)
    const firstFinal100 = (sae40 !== null && firstTotalScore !== null)
      ? (Number(sae40) + Number(firstTotalScore)) : null;
    
    // حساب مجموع الدور الثاني (عملي + نظر)
    const secondTotalScore = hasPractical
      ? ((secondPractical25 !== null && secondTheory35 !== null)
        ? (Number(secondPractical25) + Number(secondTheory35))
        : null)
      : (secondTheory35 !== null ? Number(secondTheory35) : null);
    
    // حساب الدرجة النهائية للدور الثاني (سعي + مجموع)
    const secondFinal100 = (sae40 !== null && secondTotalScore !== null)
      ? (Number(sae40) + Number(secondTotalScore)) : null;

    // حفظ أو تحديث الدرجات
    const upsertQuery = `
      INSERT INTO examination_committee.sub_master_grades (
        subject_id, student_id, academic_year, semester,
        sae_40, first_practical_25, first_theory_35, first_total_60, first_final_100,
        second_practical_25, second_theory_35, second_total_60, second_final_100
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (student_id, subject_id, academic_year, semester)
      DO UPDATE SET
        sae_40 = EXCLUDED.sae_40,
        first_practical_25 = EXCLUDED.first_practical_25,
        first_theory_35 = EXCLUDED.first_theory_35,
        first_total_60 = EXCLUDED.first_total_60,
        first_final_100 = EXCLUDED.first_final_100,
        second_practical_25 = EXCLUDED.second_practical_25,
        second_theory_35 = EXCLUDED.second_theory_35,
        second_total_60 = EXCLUDED.second_total_60,
        second_final_100 = EXCLUDED.second_final_100,
        updated_at = NOW()
      RETURNING id
    `;

    const result = await query(upsertQuery, [
      subject_id,
      body.student_id,
      academicYear,
      semester,
      sae40,
      firstPractical25,
      firstTheory35,
      firstTotalScore,
      firstFinal100,
      secondPractical25,
      secondTheory35,
      secondTotalScore,
      secondFinal100,
    ]);

    return NextResponse.json({
      success: true,
      grade_id: result.rows[0].id,
      message: 'تم حفظ الدرجات بنجاح'
    });
  } catch (error) {
    console.error('خطأ في حفظ درجات السب ماستر:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في حفظ درجات السب ماستر' },
      { status: 500 }
    );
  }
}

