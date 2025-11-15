'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface Subject {
  subject_id: string;
  material_name: string;
  instructor_name: string;
  semester: string;
  has_practical?: boolean;
}

interface Student {
  id: string;
  sequence: number;
  university_id: string;
  full_name: string;
  admission_type?: string;
}

interface GradeData {
  semester: string;
  sae_40?: number;
  first_practical_25?: number;
  first_theory_35?: number;
  first_total_60?: number;
  first_final_100?: number;
  second_practical_25?: number;
  second_theory_35?: number;
  second_total_60?: number;
  second_final_100?: number;
}

interface MasterSheetData {
  students: Student[];
  firstSemesterSubjects: Subject[];
  secondSemesterSubjects: Subject[];
  grades: Record<string, Record<string, GradeData>>;
  academic_year: string;
}

export default function MasterSheetPage() {
  const pathname = usePathname();
  const system = pathname.split('/')[1] || 'xrays';
  
  const [data, setData] = useState<MasterSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [stage, setStage] = useState<string>('first');
  const [studyType, setStudyType] = useState<string>('morning');

  useEffect(() => {
    fetchMasterSheetData();
  }, [academicYear, stage, studyType, system]);

  const fetchMasterSheetData = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        academicYear,
        ...(stage && { stage }),
        ...(studyType && { studyType })
      });
      const res = await fetch(`/api/master-sheet/${system}?${params}`);
      const result = await res.json();
      if (result.success) {
        setData(result);
      } else {
        setError(result.error || 'خطأ في جلب البيانات');
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatSemester = (sem: string) => {
    switch (sem) {
      case 'first': return 'الأول';
      case 'second': return 'الثاني';
      default: return sem;
    }
  };

  const formatStage = (stage?: string) => {
    switch (stage) {
      case 'first': return 'الأولى';
      case 'second': return 'الثانية';
      case 'third': return 'الثالثة';
      case 'fourth': return 'الرابعة';
      default: return 'غير محدد';
    }
  };

  const formatStudyType = (type?: string) => {
    switch (type) {
      case 'morning': return 'صباحي';
      case 'evening': return 'مسائي';
      default: return 'غير محدد';
    }
  };

  // حساب عدد الوحدات (قيمة افتراضية - يمكن إضافتها كحقل في قاعدة البيانات لاحقاً)
  const getSubjectUnits = (subject: Subject): number => {
    // قيمة افتراضية - يمكن جلبها من قاعدة البيانات
    return 3;
  };

  // حساب مجموع الوحدات للطالب
  const getTotalUnits = (studentId: string): number => {
    if (!data) return 0;
    let total = 0;
    data.firstSemesterSubjects.forEach(subj => {
      const grade = data.grades[studentId]?.[subj.subject_id];
      if (grade && grade.first_final_100 !== null && grade.first_final_100 !== undefined) {
        total += getSubjectUnits(subj);
      }
    });
    data.secondSemesterSubjects.forEach(subj => {
      const grade = data.grades[studentId]?.[subj.subject_id];
      if (grade && grade.second_final_100 !== null && grade.second_final_100 !== undefined) {
        total += getSubjectUnits(subj);
      }
    });
    return total;
  };

  // حساب المعدل
  const calculateGPA = (studentId: string): number => {
    if (!data) return 0;
    let totalPoints = 0;
    let totalUnits = 0;
    
    data.firstSemesterSubjects.forEach(subj => {
      const grade = data.grades[studentId]?.[subj.subject_id];
      if (grade && grade.first_final_100 !== null && grade.first_final_100 !== undefined) {
        const units = getSubjectUnits(subj);
        totalPoints += (grade.first_final_100 / 100) * 4 * units; // تحويل إلى نظام 4 نقاط
        totalUnits += units;
      }
    });
    
    data.secondSemesterSubjects.forEach(subj => {
      const grade = data.grades[studentId]?.[subj.subject_id];
      if (grade && grade.second_final_100 !== null && grade.second_final_100 !== undefined) {
        const units = getSubjectUnits(subj);
        totalPoints += (grade.second_final_100 / 100) * 4 * units;
        totalUnits += units;
      }
    });
    
    if (totalUnits === 0) return 0;
    return totalPoints / totalUnits;
  };

  // حساب النتيجة (نجح/راسب/معلق)
  const getResult = (studentId: string): string => {
    if (!data) return '-';
    // منطق بسيط: إذا كان المعدل >= 2.0 فهو ناجح
    const gpa = calculateGPA(studentId);
    if (gpa >= 2.0) return 'ناجح';
    if (gpa > 0) return 'راسب';
    return '-';
  };

  const departmentNames: Record<string, string> = {
    'xrays': 'تقنيات الأشعة',
    'anesthesia': 'تقنيات التخدير',
    'dentalindustry': 'تقنيات صناعة الأسنان',
    'construction': 'هندسة تقنيات البناء والانشاءات',
    'oil': 'تقنيات هندسة النفط والغاز',
    'physics': 'تقنيات الفيزياء الصحية',
    'optics': 'تقنيات البصريات',
    'health': 'تقنيات صحة المجتمع',
    'emergency': 'تقنيات طب الطوارئ',
    'therapy': 'تقنيات العلاج الطبيعي',
    'cyber': 'هندسة تقنيات الامن السيبراني والحوسبة السحابية'
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700 mx-auto"></div>
              <p className="mt-4 text-gray-600">جاري تحميل البيانات...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12">
              <p className="text-gray-600">لا توجد بيانات للعرض</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalColsFirst = data.firstSemesterSubjects.length * 6; // 6 (السعي + الدور الأول + المجموع + الدور الثاني + المجموع + الاستحقاق)
  const totalColsSecond = data.secondSemesterSubjects.length * 6;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-full mx-auto">
        {/* الرأس */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">الماستر شيت</h1>
              <p className="text-gray-600">{departmentNames[system] || system}</p>
            </div>
          </div>

          {/* الفلاتر */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">السنة الأكاديمية</label>
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              >
                <option value="2024-2025">2024-2025</option>
                <option value="2025-2026">2025-2026</option>
                <option value="2026-2027">2026-2027</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المرحلة</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              >
                <option value="first">الأولى</option>
                <option value="second">الثانية</option>
                <option value="third">الثالثة</option>
                <option value="fourth">الرابعة</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">نوع الدراسة</label>
              <select
                value={studyType}
                onChange={(e) => setStudyType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              >
                <option value="morning">صباحي</option>
                <option value="evening">مسائي</option>
              </select>
            </div>
          </div>
        </div>

        {/* الجدول */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 sticky left-0 bg-gray-50 z-10 w-12">
                  ت
                </th>
                <th rowSpan={3} className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase border border-gray-300 sticky left-12 bg-gray-50 z-10 min-w-[150px]">
                  اسم الطالب
                </th>
                
                {/* الفصل الدراسي الأول */}
                {data.firstSemesterSubjects.length > 0 && (
                  <>
                    <th colSpan={totalColsFirst} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">
                      الفصل الدراسي الأول
                    </th>
                  </>
                )}
                
                {/* الفصل الدراسي الثاني */}
                {data.secondSemesterSubjects.length > 0 && (
                  <>
                    <th colSpan={totalColsSecond} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">
                      الفصل الدراسي الثاني
                    </th>
                  </>
                )}
                
                {/* الأعمدة الإضافية */}
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-yellow-50">
                  مجموع الوحدات
                </th>
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-yellow-50">
                  النتيجة
                </th>
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-yellow-50">
                  المعدل
                </th>
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-yellow-50">
                  حصة التخرج
                </th>
                <th rowSpan={3} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-yellow-50 min-w-[100px]">
                  الملاحظات
                </th>
              </tr>
              <tr>
                {/* رؤوس المواد للفصل الأول */}
                {data.firstSemesterSubjects.map((subject) => (
                  <th key={subject.subject_id} colSpan={6} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">
                    {subject.material_name}
                  </th>
                ))}
                
                {/* رؤوس المواد للفصل الثاني */}
                {data.secondSemesterSubjects.map((subject) => (
                  <th key={subject.subject_id} colSpan={6} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">
                    {subject.material_name}
                  </th>
                ))}
              </tr>
              <tr>
                {/* رؤوس التفاصيل للفصل الأول */}
                {data.firstSemesterSubjects.map((subject) => (
                  <React.Fragment key={subject.subject_id}>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">السعي</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">الدور الأول</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">المجموع</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">الدور الثاني</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">المجموع</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-blue-50">الاستحقاق</th>
                  </React.Fragment>
                ))}
                
                {/* رؤوس التفاصيل للفصل الثاني */}
                {data.secondSemesterSubjects.map((subject) => (
                  <React.Fragment key={subject.subject_id}>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">السعي</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">الدور الأول</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">المجموع</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">الدور الثاني</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">المجموع</th>
                    <th className="px-1 py-2 text-center text-[10px] font-medium text-gray-500 uppercase border border-gray-300 bg-green-50">الاستحقاق</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.students.map((student) => {
                const studentGrades = data.grades[student.id] || {};
                
                return (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 sticky left-0 bg-white z-10">
                      {student.sequence}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-gray-900 border border-gray-300 sticky left-12 bg-white z-10 font-medium">
                      {student.full_name}
                    </td>
                    
                    {/* بيانات الفصل الدراسي الأول */}
                    {data.firstSemesterSubjects.map((subject) => {
                      const grade = studentGrades[subject.subject_id];
                      const firstTotal = grade?.first_total_60 || '-';
                      const firstFinal = grade?.first_final_100 || '-';
                      const secondTotal = grade?.second_total_60 || '-';
                      const secondFinal = grade?.second_final_100 || '-';
                      const sae = grade?.sae_40 || '-';
                      const eligibility = firstFinal !== '-' && Number(firstFinal) >= 50 ? 'نعم' : secondFinal !== '-' && Number(secondFinal) >= 50 ? 'نعم' : 'لا';
                      
                      return (
                        <React.Fragment key={subject.subject_id}>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50">{sae}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50">{firstTotal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50 font-semibold">{firstFinal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50">{secondTotal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50 font-semibold">{secondFinal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-blue-50">{eligibility}</td>
                        </React.Fragment>
                      );
                    })}
                    
                    {/* بيانات الفصل الدراسي الثاني */}
                    {data.secondSemesterSubjects.map((subject) => {
                      const grade = studentGrades[subject.subject_id];
                      const firstTotal = grade?.first_total_60 || '-';
                      const firstFinal = grade?.first_final_100 || '-';
                      const secondTotal = grade?.second_total_60 || '-';
                      const secondFinal = grade?.second_final_100 || '-';
                      const sae = grade?.sae_40 || '-';
                      const eligibility = firstFinal !== '-' && Number(firstFinal) >= 50 ? 'نعم' : secondFinal !== '-' && Number(secondFinal) >= 50 ? 'نعم' : 'لا';
                      
                      return (
                        <React.Fragment key={subject.subject_id}>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50">{sae}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50">{firstTotal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50 font-semibold">{firstFinal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50">{secondTotal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50 font-semibold">{secondFinal}</td>
                          <td className="px-1 py-2 text-center text-[10px] text-gray-700 border border-gray-300 bg-green-50">{eligibility}</td>
                        </React.Fragment>
                      );
                    })}
                    
                    {/* الأعمدة الإضافية */}
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 bg-yellow-50 font-semibold">
                      {getTotalUnits(student.id)}
                    </td>
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 bg-yellow-50 font-semibold">
                      {getResult(student.id)}
                    </td>
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 bg-yellow-50 font-semibold">
                      {calculateGPA(student.id).toFixed(2)}
                    </td>
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 bg-yellow-50">
                      -
                    </td>
                    <td className="px-2 py-3 text-center text-xs text-gray-900 border border-gray-300 bg-yellow-50">
                      -
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
