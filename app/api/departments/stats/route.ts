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

type YearKey = 'first' | 'second' | 'third' | 'fourth';
type StudyTypeKey = 'morning' | 'evening';

const emptyYears = () => ({ first: 0, second: 0, third: 0, fourth: 0 });

const normalizeYear = (value: string | null): YearKey | null => {
  if (value === 'first' || value === 'second' || value === 'third' || value === 'fourth') {
    return value;
  }
  return null;
};

const normalizeStudyType = (value: string | null): StudyTypeKey => {
  return value === 'evening' ? 'evening' : 'morning';
};

// GET /api/departments/stats - جلب إحصائيات الأقسام الأكاديمية
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // academic_year=all أو فارغ صراحةً = كل السنوات
    // بدون معامل = السنة الافتراضية (للتوافق مع الصفحات الأخرى)
    const academicYearRaw = searchParams.get('academic_year');
    const academicYear =
      academicYearRaw === 'all' || academicYearRaw === ''
        ? ''
        : academicYearRaw || '2025-2026';

    const yearFilter = academicYear ? 'AND academic_year = $1' : '';
    const yearParams = academicYear ? [academicYear] : [];
    const deptNames = DEPARTMENTS.map((d) => d.arabicName);

    // مفاتيح تطبيع أسماء الأقسام المعروفة + أعداد الطلاب مجمّعة في استعلامين فقط
    const [keyMapResult, countsResult] = await Promise.all([
      query(
        `SELECT name, normalize_arabic(name) AS major_key
         FROM unnest($1::text[]) AS name`,
        [deptNames]
      ),
      query(
        `SELECT
           normalize_arabic(major) AS major_key,
           admission_type,
           COALESCE(study_type, 'morning') AS study_type,
           COUNT(*)::int AS count
         FROM student_affairs.students
         WHERE major IS NOT NULL
           ${yearFilter}
         GROUP BY normalize_arabic(major), admission_type, COALESCE(study_type, 'morning')`,
        yearParams
      ),
    ]);

    const nameToKey = new Map<string, string>();
    for (const row of keyMapResult.rows) {
      nameToKey.set(row.name, row.major_key);
    }

    const statsByMajor = new Map<
      string,
      {
        total: number;
        morning: ReturnType<typeof emptyYears>;
        evening: ReturnType<typeof emptyYears>;
      }
    >();

    for (const row of countsResult.rows) {
      const majorKey = row.major_key as string;
      if (!statsByMajor.has(majorKey)) {
        statsByMajor.set(majorKey, {
          total: 0,
          morning: emptyYears(),
          evening: emptyYears(),
        });
      }
      const bucket = statsByMajor.get(majorKey)!;
      const count = parseInt(row.count, 10) || 0;
      bucket.total += count;

      const year = normalizeYear(row.admission_type);
      const studyType = normalizeStudyType(row.study_type);
      if (year) {
        bucket[studyType][year] += count;
      }
    }

    // مجموع المبالغ من الوصولات الفعلية — استعلام واحد مجمّع حسب القسم
    const amountsByMajor = new Map<string, number>();
    try {
      const amountYearFilter = academicYear ? 'AND s.academic_year = $1' : '';
      const amountsResult = await query(
        `SELECT
           normalize_arabic(s.major) AS major_key,
           COALESCE(SUM(r.pay_amount), 0)::float AS total_amount
         FROM accounts.student_settlement_receipts r
         INNER JOIN student_affairs.students s ON s.id = r.student_id
         WHERE s.major IS NOT NULL
           ${amountYearFilter}
         GROUP BY normalize_arabic(s.major)`,
        yearParams
      );
      for (const row of amountsResult.rows) {
        amountsByMajor.set(row.major_key, parseFloat(row.total_amount) || 0);
      }
    } catch {
      // جدول الوصولات قد لا يكون متاحاً — نترك المبالغ صفراً
    }

    const stats = DEPARTMENTS.map((dept) => {
      const majorKey = nameToKey.get(dept.arabicName) || dept.arabicName;
      const bucket = statsByMajor.get(majorKey) || {
        total: 0,
        morning: emptyYears(),
        evening: emptyYears(),
      };
      const totalAmount = amountsByMajor.get(majorKey) || 0;

      return {
        id: dept.id,
        name: dept.arabicName,
        total: bucket.total,
        totalAmount,
        years: {
          first: bucket.morning.first + bucket.evening.first,
          second: bucket.morning.second + bucket.evening.second,
          third: bucket.morning.third + bucket.evening.third,
          fourth: bucket.morning.fourth + bucket.evening.fourth,
        },
        studyTypes: {
          morning: { ...bucket.morning },
          evening: { ...bucket.evening },
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('خطأ في جلب إحصائيات الأقسام:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
