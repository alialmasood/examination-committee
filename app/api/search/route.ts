import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: 'student' | 'grade' | 'document' | 'department' | 'course';
  url: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q || q.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = `%${q.trim()}%`;
    const results: SearchResult[] = [];

    // البحث في الطلاب
    try {
      const studentsQuery = `
        SELECT 
          id,
          university_id,
          full_name_ar,
          first_name,
          last_name,
          national_id,
          department
        FROM student_affairs.students 
        WHERE 
          full_name_ar ILIKE $1 OR
          first_name ILIKE $1 OR
          last_name ILIKE $1 OR
          university_id::text ILIKE $1 OR
          national_id ILIKE $1 OR
          department ILIKE $1
        LIMIT 10
      `;
      
      const studentsResult = await query(studentsQuery, [searchTerm]);
      
      studentsResult.rows.forEach((student: any) => {
        results.push({
          id: `student-${student.id}`,
          title: `${student.full_name_ar} (${student.university_id})`,
          description: `الرقم الوطني: ${student.national_id} - ${student.department || 'غير محدد'}`,
          type: 'student',
          url: `/student-affairs/students?search=${encodeURIComponent(student.university_id)}`
        });
      });
    } catch (error) {
      console.error('خطأ في البحث عن الطلاب:', error);
    }

    // البحث في الأقسام (محدد مسبقاً)
    const departments = [
      { name: 'تقنيات التخدير', id: 'anesthesia' },
      { name: 'تقنيات الأشعة', id: 'radiology' },
      { name: 'تقنيات صناعة الأسنان', id: 'dental' },
      { name: 'هندسة تقنيات البناء والانشاءات', id: 'construction' },
      { name: 'تقنيات النفط والغاز', id: 'oil-gas' },
      { name: 'تقنيات الفيزياء الصحية', id: 'health-physics' },
      { name: 'تقنيات البصريات', id: 'optics' },
      { name: 'تقنيات صحة المجتمع', id: 'community-health' },
      { name: 'تقنيات طب الطوارئ', id: 'emergency-medicine' },
      { name: 'تقنيات العلاج الطبيعي', id: 'physical-therapy' },
      { name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', id: 'cybersecurity' },
      { name: 'القانون', id: 'law' }
    ];

    departments.forEach(dept => {
      if (dept.name.includes(q.trim()) || dept.name.toLowerCase().includes(q.toLowerCase())) {
        results.push({
          id: `dept-${dept.id}`,
          title: dept.name,
          description: 'قسم أكاديمي',
          type: 'department',
          url: `/student-affairs/students?department=${dept.id}`
        });
      }
    });

    // البحث في الوثائق (محدد مسبقاً)
    const documents = [
      { name: 'شهادة التخرج', type: 'graduation' },
      { name: 'كشف الدرجات', type: 'transcript' },
      { name: 'شهادة التسجيل', type: 'enrollment' },
      { name: 'شهادة الحضور', type: 'attendance' },
      { name: 'شهادة النقل', type: 'transfer' }
    ];

    documents.forEach(doc => {
      if (doc.name.includes(q.trim()) || doc.name.toLowerCase().includes(q.toLowerCase())) {
        results.push({
          id: `doc-${doc.type}`,
          title: doc.name,
          description: 'وثيقة رسمية',
          type: 'document',
          url: `/student-affairs/documents?type=${doc.type}`
        });
      }
    });

    // البحث في المقررات (محدد مسبقاً)
    const courses = [
      { name: 'مقدمة في التخدير', code: 'ANES101' },
      { name: 'أساسيات الأشعة', code: 'RAD101' },
      { name: 'تقنيات الأسنان', code: 'DENT101' },
      { name: 'مبادئ البناء', code: 'CONS101' },
      { name: 'هندسة النفط', code: 'OIL101' },
      { name: 'الفيزياء الطبية', code: 'PHYS101' },
      { name: 'البصريات التطبيقية', code: 'OPT101' },
      { name: 'صحة المجتمع', code: 'COMM101' },
      { name: 'طب الطوارئ', code: 'EMER101' },
      { name: 'العلاج الطبيعي', code: 'THER101' },
      { name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', code: 'CYB101' },
      { name: 'مبادئ القانون', code: 'LAW101' }
    ];

    courses.forEach(course => {
      if (course.name.includes(q.trim()) || course.code.includes(q.trim()) || 
          course.name.toLowerCase().includes(q.toLowerCase())) {
        results.push({
          id: `course-${course.code}`,
          title: `${course.name} (${course.code})`,
          description: 'مقرر دراسي',
          type: 'course',
          url: `/student-affairs/grades?course=${course.code}`
        });
      }
    });

    // البحث في النتائج والدرجات
    try {
      const gradesQuery = `
        SELECT DISTINCT
          s.full_name_ar,
        s.university_id
        FROM student_affairs.students s
        WHERE 
          s.full_name_ar ILIKE $1 OR
          s.university_id::text ILIKE $1
        LIMIT 5
      `;
      
      const gradesResult = await query(gradesQuery, [searchTerm]);
      
      gradesResult.rows.forEach((student: any) => {
        results.push({
          id: `grade-${student.university_id}`,
          title: `نتائج ${student.full_name_ar}`,
          description: `عرض درجات الطالب ${student.university_id}`,
          type: 'grade',
          url: `/student-affairs/grades?student=${student.university_id}`
        });
      });
    } catch (error) {
      console.error('خطأ في البحث عن الدرجات:', error);
    }

    // ترتيب النتائج حسب النوع والأهمية
    const typeOrder = ['student', 'department', 'course', 'grade', 'document'];
    results.sort((a, b) => {
      const aIndex = typeOrder.indexOf(a.type);
      const bIndex = typeOrder.indexOf(b.type);
      return aIndex - bIndex;
    });

    return NextResponse.json({ 
      results: results.slice(0, 20), // حد أقصى 20 نتيجة
      total: results.length 
    });

  } catch (error) {
    console.error('خطأ في البحث:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'خطأ في البحث: ' + (error instanceof Error ? error.message : String(error)) 
      },
      { status: 500 }
    );
  }
}
