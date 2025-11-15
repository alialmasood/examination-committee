import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/teaching-subjects/[system]
 * جلب المواد التدريسية لقسم معين
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;

    await query(`
      ALTER TABLE examination_committee.teaching_subjects
      ADD COLUMN IF NOT EXISTS units INTEGER DEFAULT 0
    `);
    
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
    
    // بناء استعلام SQL - استخدام مطابقة دقيقة
    const conditions = departmentNames.map((_, i) => `department = $${i + 1}`).join(' OR ');
    const subjectsQuery = `
      SELECT 
        id,
        department,
        material_name,
        instructor_name,
        semester,
        academic_year,
        stage,
        study_type,
        has_practical,
        units,
        created_at,
        updated_at
      FROM examination_committee.teaching_subjects
      WHERE ${conditions}
      ORDER BY academic_year DESC, semester DESC, material_name ASC
    `;
    
    // استخدام القيم مباشرة للمطابقة الدقيقة
    const result = await query(subjectsQuery, departmentNames);
    
    const subjects = result.rows.map(row => ({
      id: row.id,
      department: row.department,
      material_name: row.material_name,
      instructor_name: row.instructor_name,
      semester: row.semester,
      academic_year: row.academic_year,
      stage: row.stage,
      study_type: row.study_type,
      has_practical: row.has_practical ?? true,
      units: row.units !== null ? Number(row.units) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return NextResponse.json({
      success: true,
      data: subjects
    });
  } catch (error) {
    console.error('خطأ في جلب المواد التدريسية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب المواد التدريسية' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/teaching-subjects/[system]
 * إضافة مادة تدريسية جديدة
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    const body = await request.json().catch(() => ({}));
    
    await query(`
      ALTER TABLE examination_committee.teaching_subjects
      ADD COLUMN IF NOT EXISTS units INTEGER DEFAULT 0
    `);

    // التحقق من البيانات المطلوبة
    if (!body.material_name || !body.instructor_name || !body.semester || !body.academic_year || !body.stage || !body.study_type) {
      return NextResponse.json(
        { success: false, error: 'جميع الحقول مطلوبة' },
        { status: 400 }
      );
    }

    const unitsValue = Number(body.units);
    if (!Number.isFinite(unitsValue) || unitsValue <= 0) {
      return NextResponse.json(
        { success: false, error: 'عدد الوحدات مطلوب ويجب أن يكون رقماً أكبر من صفر' },
        { status: 400 }
      );
    }
    
    // خريطة ربط الأقسام بالأنظمة (للإضافة - نستخدم القيمة الأساسية)
    const systemDepartmentMap: Record<string, string> = {
      'dentalindustry': 'تقنيات صناعة الاسنان',
      'anesthesia': 'تقنيات التخدير',
      'xrays': 'تقنيات الاشعة',
      'construction': 'هندسة تقنيات البناء والانشاءات',
      'oil': 'تقنيات هندسة النفط والغاز',
      'physics': 'تقنيات الفيزياء الصحية',
      'optics': 'تقنيات البصريات',
      'health': 'تقنيات صحة المجتمع',
      'emergency': 'تقنيات طب الطوارئ',
      'therapy': 'تقنيات العلاج الطبيعي',
      'cyber': 'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
    };
    
    const department = systemDepartmentMap[system];
    
    if (!department) {
      return NextResponse.json({ success: false, error: 'نظام غير معروف' }, { status: 400 });
    }
    
    // إدخال المادة التدريسية
    const insertQuery = `
      INSERT INTO examination_committee.teaching_subjects (
        department,
        material_name,
        instructor_name,
        semester,
        academic_year,
        stage,
        study_type,
        has_practical,
        units
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, department, material_name, instructor_name, semester, academic_year, stage, study_type, has_practical, units, created_at, updated_at
    `;
    
    const result = await query(insertQuery, [
      department,
      body.material_name,
      body.instructor_name,
      body.semester,
      body.academic_year,
      body.stage,
      body.study_type,
      body.has_practical !== undefined ? body.has_practical : true,
      unitsValue
    ]);
    
    const subject = {
      id: result.rows[0].id,
      department: result.rows[0].department,
      material_name: result.rows[0].material_name,
      instructor_name: result.rows[0].instructor_name,
      semester: result.rows[0].semester,
      academic_year: result.rows[0].academic_year,
      stage: result.rows[0].stage,
      study_type: result.rows[0].study_type,
      has_practical: result.rows[0].has_practical,
      units: result.rows[0].units !== null ? Number(result.rows[0].units) : null,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    };
    
    return NextResponse.json({
      success: true,
      data: subject
    });
  } catch (error) {
    console.error('خطأ في إضافة المادة التدريسية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في إضافة المادة التدريسية' },
      { status: 500 }
    );
  }
}

