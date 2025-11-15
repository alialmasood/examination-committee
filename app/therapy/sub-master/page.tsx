'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface Subject {
  subject_id: string;
  material_name: string;
  instructor_name: string;
  semester: string;
  academic_year: string;
  stage?: string;
  study_type?: string;
  has_practical?: boolean;
  student_count: number;
}

interface StudentGrade {
  sequence: number;
  student_id: string;
  university_id: string;
  full_name: string;
  grade_id?: string;
  grades: {
    sae_40?: number;
    first_practical_25?: number;
    first_theory_35?: number;
    first_total_60?: number;
    first_final_100?: number;
    second_practical_25?: number;
    second_theory_35?: number;
    second_total_60?: number;
    second_final_100?: number;
  };
}

interface SubjectWithGrades {
  subject: {
    subject_id: string;
    material_name: string;
    instructor_name: string;
    semester: string;
    academic_year: string;
    stage?: string;
    study_type?: string;
    units?: number | null;
    has_practical?: boolean;
  };
  students: StudentGrade[];
}

const departmentDetails: Record<string, { ar: string; en: string }> = {
  anesthesia: {
    ar: 'قسم تقنيات التخدير',
    en: 'Department of Anesthesia Techniques'
  },
  xrays: {
    ar: 'قسم تقنيات الأشعة',
    en: 'Department of Radiology Techniques'
  },
  dentalindustry: {
    ar: 'قسم تقنيات صناعة الأسنان',
    en: 'Department of Dental Industry Techniques'
  },
  construction: {
    ar: 'قسم تقنيات البناء والاستشارات',
    en: 'Department of Construction Technologies'
  },
  oil: {
    ar: 'قسم تقنيات هندسة النفط والغاز',
    en: 'Department of Oil and Gas Engineering Technologies'
  },
  physics: {
    ar: 'قسم تقنيات الفيزياء الصحية',
    en: 'Department of Health Physics Technologies'
  },
  optics: {
    ar: 'قسم تقنيات البصريات',
    en: 'Department of Optical Technologies'
  },
  health: {
    ar: 'قسم تقنيات صحة المجتمع',
    en: 'Department of Community Health Technologies'
  },
  emergency: {
    ar: 'قسم تقنيات طب الطوارئ',
    en: 'Department of Emergency Medicine Technologies'
  },
  therapy: {
    ar: 'قسم تقنيات العلاج الطبيعي',
    en: 'Department of Physical Therapy Technologies'
  },
  cyber: {
    ar: 'قسم هندسة تقنيات الأمن السيبراني',
    en: 'Department of Cybersecurity Engineering Technologies'
  }
};

export default function SubMasterPage() {
  const pathname = usePathname();
  const system = pathname.split('/')[1] || 'xrays';
  
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [subjectGrades, setSubjectGrades] = useState<SubjectWithGrades | null>(null);
  const [loading, setLoading] = useState(true);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [semester, setSemester] = useState('first');
  const [stage, setStage] = useState<string>('first');
  const [studyType, setStudyType] = useState<string>('morning');

  useEffect(() => {
    fetchSubjects();
  }, [academicYear, semester, system]);
  
  // فلترة المواد حسب المرحلة ونوع الدراسة
  const filteredSubjects = subjects.filter(subject => 
    subject.stage === stage && subject.study_type === studyType
  );

  useEffect(() => {
    if (selectedSubjectId) {
      fetchSubjectGrades(selectedSubjectId);
    }
  }, [selectedSubjectId, academicYear, semester, stage, studyType, system]);
  
  // عند تغيير المرحلة أو نوع الدراسة، إذا كانت المادة المحددة غير موجودة في القائمة المصفاة، اختر الأولى
  useEffect(() => {
    if (filteredSubjects.length > 0) {
      if (!selectedSubjectId || !filteredSubjects.find(sub => sub.subject_id === selectedSubjectId)) {
        setSelectedSubjectId(filteredSubjects[0].subject_id);
      }
    } else if (filteredSubjects.length === 0) {
      setSelectedSubjectId(null);
    }
  }, [stage, studyType, filteredSubjects]);
  
  // عند تغيير السنة، الفصل، أو نوع الدراسة، أزل المادة المحددة أولاً
  useEffect(() => {
    setSubjectGrades(null);
  }, [academicYear, semester, studyType]);

  const fetchSubjects = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/sub-master-grades/${system}?academicYear=${academicYear}&semester=${semester}`);
      const data = await res.json();
      if (data.success) {
        setSubjects(data.data);
        if (data.data.length > 0 && !selectedSubjectId) {
          setSelectedSubjectId(data.data[0].subject_id);
        }
      } else {
        setError('تعذر جلب بيانات المواد التدريسية');
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const fetchSubjectGrades = async (subjectId: string) => {
    try {
      setGradesLoading(true);
      const url = `/api/sub-master-grades/${system}/${subjectId}?academicYear=${academicYear}&semester=${semester}&stage=${stage}&studyType=${studyType}`;
      console.log('🔍 جلب بيانات الطلاب من:', url);
      const res = await fetch(url);
      const data = await res.json();
      const studentsCount = data.students?.length || 0;
      console.log('📊 بيانات الطلاب المستلمة:', {
        success: data.success,
        studentsCount: studentsCount,
        subject: data.subject,
        hasStudents: studentsCount > 0
      });
      if (studentsCount > 0) {
        console.log('✅ الطلاب المستلمون:', data.students);
      } else {
        console.warn('⚠️ لم يتم جلب أي طلاب!', {
          departmentNames: data.departmentNames,
          system: system
        });
      }
      if (data.success) {
        setSubjectGrades(data);
      } else {
        // لا نعرض خطأ إذا كانت المادة غير موجودة (قد تكون بسبب تغيير الفلاتر)
        if (data.error !== 'المادة التدريسية غير موجودة') {
          console.error('❌ خطأ في جلب البيانات:', data.error);
        }
        setSubjectGrades(null);
      }
    } catch (err) {
      console.error('❌ خطأ في الاتصال:', err);
      setSubjectGrades(null);
    } finally {
      setGradesLoading(false);
    }
  };

  const handleSaveGrade = async (studentId: string, gradeId: string | undefined, grades: any) => {
    if (!selectedSubjectId) return;
    
    try {
      const res = await fetch(`/api/sub-master-grades/${system}/${selectedSubjectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          academic_year: academicYear,
          semester: semester,
          ...grades
        })
      });
      
      const data = await res.json();
      if (data.success) {
        fetchSubjectGrades(selectedSubjectId);
      } else {
        alert('خطأ في حفظ الدرجات');
      }
    } catch (err) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const handleExportPDF = () => {
    if (!subjectGrades) return;
    
    const department = departmentDetails[system] ?? {
      ar: 'القسم',
      en: 'Department'
    };
    const displayedStage = formatStage(subjectGrades.subject.stage ?? stage);
    const displayedStudyType = formatStudyType(subjectGrades.subject.study_type ?? studyType);
    const unitsValue = subjectGrades.subject.units ?? '-';
    
    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>استمارة الدرجات - ${subjectGrades.subject.material_name}</title>
          <style>
            @page {
              size: A4;
              margin: 12mm;
            }
            body {
              font-family: 'Arial', sans-serif;
              padding: 12px;
              margin: 0;
              direction: rtl;
              text-align: right;
              font-size: 15px;
              border: 2px solid #2563eb;
              box-sizing: border-box;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 20px;
              padding-bottom: 15px;
              border-bottom: 2px solid #2563eb;
              gap: 10px;
              direction: ltr;
            }
            .header-section {
              flex: 1;
              font-size: 15px;
              line-height: 1.25;
              color: #1f2937;
            }
            .header-section p {
              margin: 2px 0;
            }
            .header-section.ar {
              text-align: right;
              direction: rtl;
              font-weight: 600;
              font-size: 15px;
            }
            .header-section.en {
              text-align: left;
              direction: ltr;
              font-size: 13px;
            }
            .header-logo {
              flex: 0 0 120px;
              text-align: center;
            }
            .header-logo img {
              max-height: 80px;
              width: auto;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin-bottom: 12px;
              direction: rtl;
            }
            .info-block {
              flex: 1;
              font-size: 9px;
              line-height: 1.2;
              color: #111827;
            }
            .info-block.left {
              text-align: right;
            }
            .info-block.right {
              text-align: left;
              direction: rtl;
            }
            .info-block p {
              margin: 1px 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
              font-size: 15px;
            }
            th, td {
              border: 1px solid #333;
              padding: 4px;
              text-align: center;
              vertical-align: middle;
              white-space: normal;
              word-break: break-word;
            }
            th {
              background-color: #f8f9fa;
              font-weight: bold;
              color: #2c3e50;
              font-size: 15px;
            }
            td {
              background-color: white;
              font-size: 15px;
            }
            .bg-red-50 {
              background-color: #fef2f2 !important;
            }
            .bg-blue-50 {
              background-color: #eff6ff !important;
            }
            .footer {
              margin-top: 20px;
              text-align: center;
              font-size: 8px;
              color: #7f8c8d;
              border-top: 1px solid #ddd;
              padding-top: 8px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-section en">
              <p>Ministry of Higher Education and Scientific Research</p>
              <p>AL-SHARQ College of Specialized Technical Sciences</p>
              <p>(${department.en})</p>
            </div>
            <div class="header-logo">
              <img src="/logos/college-logo.png" alt="شعار الكلية" />
            </div>
            <div class="header-section ar">
              <p>وزارة التعليم العالي والبحث العلمي</p>
              <p>كلية الشرق للعلوم التقنية التخصصية</p>
              <p>اللجنة الامتحانية - ${department.ar}</p>
            </div>
          </div>

          <div class="info-row">
            <div class="info-block left">
              <p>القسم : ${department.ar}</p>
              <p>المرحلة : ${displayedStage}</p>
              <p>نوع الدراسة : ${displayedStudyType}</p>
            </div>
            <div class="info-block right">
              <p>المادة الدراسية : ${subjectGrades.subject.material_name}</p>
              <p>مدرس المادة : ${subjectGrades.subject.instructor_name}</p>
              <p>عدد الوحدات : ${unitsValue}</p>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th rowspan="${subjectGrades.subject.has_practical !== false ? '2' : '2'}">ت</th>
                <th rowspan="${subjectGrades.subject.has_practical !== false ? '2' : '2'}">اسم الطالب</th>
                <th rowspan="${subjectGrades.subject.has_practical !== false ? '2' : '2'}">السعي<br/>40</th>
                ${subjectGrades.subject.has_practical !== false ? `
                  <th colspan="3" class="bg-red-50">الدور الأول</th>
                  <th rowspan="2">النهائية<br/>100</th>
                  <th colspan="3" class="bg-blue-50">الدور الثاني</th>
                  <th rowspan="2">النهائية<br/>100</th>
                ` : `
                  <th rowspan="2" class="bg-red-50">نظري<br/>70</th>
                  <th rowspan="2">النهائية<br/>100</th>
                  <th rowspan="2" class="bg-blue-50">نظري<br/>70</th>
                  <th rowspan="2">النهائية<br/>100</th>
                `}
              </tr>
              ${subjectGrades.subject.has_practical !== false ? `
                <tr>
                  <th class="bg-red-50">عملي<br/>25</th>
                  <th class="bg-red-50">نظري<br/>35</th>
                  <th class="bg-red-50">مجموع<br/>60</th>
                  <th class="bg-blue-50">عملي<br/>25</th>
                  <th class="bg-blue-50">نظري<br/>35</th>
                  <th class="bg-blue-50">مجموع<br/>60</th>
                </tr>
              ` : ''}
            </thead>
            <tbody>
              ${subjectGrades.students.map(student => `
                <tr>
                  <td>${student.sequence}</td>
                  <td>${student.full_name}</td>
                  <td>${student.grades.sae_40 ?? ''}</td>
                  ${subjectGrades.subject.has_practical !== false ? `
                    <td>${student.grades.first_practical_25 ?? ''}</td>
                    <td>${student.grades.first_theory_35 ?? ''}</td>
                    <td>${student.grades.first_total_60 ?? ''}</td>
                    <td>${student.grades.first_final_100 ?? ''}</td>
                    <td>${student.grades.second_practical_25 ?? ''}</td>
                    <td>${student.grades.second_theory_35 ?? ''}</td>
                    <td>${student.grades.second_total_60 ?? ''}</td>
                    <td>${student.grades.second_final_100 ?? ''}</td>
                  ` : `
                    <td>${student.grades.first_theory_35 ?? ''}</td>
                    <td>${student.grades.first_final_100 ?? ''}</td>
                    <td>${student.grades.second_theory_35 ?? ''}</td>
                    <td>${student.grades.second_final_100 ?? ''}</td>
                  `}
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="footer">
            <p>تم إنشاء هذا التقرير تلقائياً من نظام اللجنة الامتحانية</p>
          </div>
        </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
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
      default: return '-';
    }
  };

  const formatStudyType = (studyType?: string) => {
    switch (studyType) {
      case 'morning': return 'صباحية';
      case 'evening': return 'مسائية';
      default: return '-';
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-12 text-red-600">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">تقرير السب ماستر</h1>
          
          {/* فلتر السنة الأكاديمية والفصل الدراسي */}
          <div className="flex gap-4">
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-2">السنة الأكاديمية</label>
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              >
                <option value="2024-2025">2024-2025</option>
                <option value="2025-2026">2025-2026</option>
                <option value="2026-2027">2026-2027</option>
                <option value="2027-2028">2027-2028</option>
              </select>
            </div>
            <div className="w-28">
              <label className="block text-sm font-medium text-gray-700 mb-2">الفصل الدراسي</label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              >
                <option value="first">الأول</option>
                <option value="second">الثاني</option>
              </select>
            </div>
            <div className="w-32">
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
            <div className="w-28">
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

        {subjects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد مواد تدريسية</h3>
              <p className="mt-1 text-sm text-gray-500">يرجى إضافة مواد تدريسية أولاً من صفحة التدريسات</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* قائمة المواد */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">المواد التدريسية</h2>
                </div>
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {filteredSubjects.map((subject) => (
                    <button
                      key={subject.subject_id}
                      onClick={() => setSelectedSubjectId(subject.subject_id)}
                      className={`w-full text-right py-2 px-3 transition-colors ${
                        selectedSubjectId === subject.subject_id
                          ? 'bg-red-50 border-r-4 border-red-600'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {subject.material_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{formatStage(subject.stage)} - {formatStudyType(subject.study_type)} - {subject.instructor_name}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* جدول السب ماستر */}
            <div className="lg:col-span-4">
              {gradesLoading ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">جاري التحميل...</p>
                  </div>
                </div>
              ) : subjectGrades ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="p-4 border-b border-gray-200">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h2 className="text-lg font-bold text-gray-900 flex justify-between items-center">
                          <span>استمارة الدرجات للعام الدراسي {subjectGrades.subject.academic_year} - الفصل الدراسي {formatSemester(subjectGrades.subject.semester)}</span>
                          <span className="text-gray-500 font-normal">({subjectGrades.students.length} طالب)</span>
                        </h2>
                        <p className="text-sm text-gray-600 mt-1">
                          {subjectGrades.subject.material_name} - {subjectGrades.subject.instructor_name}
                        </p>
                      </div>
                      <button
                        onClick={handleExportPDF}
                        className="border-2 border-red-700 text-red-700 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 mr-4 font-medium"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        حفظ وطباعة
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-12">
                            ت
                          </th>
                          <th rowSpan={2} className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                            اسم الطالب
                          </th>
                          <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-20">
                            السعي<br/>40
                          </th>
                          {subjectGrades.subject.has_practical !== false ? (
                            <>
                              <th colSpan={3} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 bg-red-50">
                                الدور الأول
                              </th>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-20">
                                النهائية<br/>100
                              </th>
                              <th colSpan={3} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 bg-blue-50">
                                الدور الثاني
                              </th>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-20">
                                النهائية<br/>100
                              </th>
                            </>
                          ) : (
                            <>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 bg-red-50">
                                نظري<br/>70
                              </th>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-20">
                                النهائية<br/>100
                              </th>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 bg-blue-50">
                                نظري<br/>70
                              </th>
                              <th rowSpan={2} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200 w-20">
                                النهائية<br/>100
                              </th>
                            </>
                          )}
                        </tr>
                        {subjectGrades.subject.has_practical !== false && (
                          <tr>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              عملي<br/>25
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              نظري<br/>35
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              مجموع<br/>60
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              عملي<br/>25
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              نظري<br/>35
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase border-l border-gray-200">
                              مجموع<br/>60
                            </th>
                          </tr>
                        )}
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {subjectGrades.students.length === 0 ? (
                          <tr>
                            <td colSpan={subjectGrades.subject.has_practical !== false ? 11 : 7} className="px-4 py-8 text-center text-gray-500">
                              <div className="flex flex-col items-center">
                                <svg className="h-12 w-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                                <p className="text-sm font-medium">لا توجد طلاب مسجلين</p>
                                <p className="text-xs text-gray-400 mt-1">لم يتم العثور على أي طلاب في قاعدة البيانات لهذا القسم</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          subjectGrades.students.map((student) => (
                          <tr key={student.student_id} className="hover:bg-gray-50">
                            <td className="px-2 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 w-12">
                              {student.sequence}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900 border-l border-gray-200">
                              {student.full_name}
                            </td>
                            <td className="px-2 py-3 whitespace-nowrap border-l border-gray-200 text-center w-20">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="40"
                                className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                defaultValue={student.grades.sae_40 || ''}
                                onBlur={(e) => handleSaveGrade(
                                  student.student_id,
                                  student.grade_id,
                                  { ...student.grades, sae_40: e.target.value ? parseFloat(e.target.value) : null }
                                )}
                              />
                            </td>
                            {subjectGrades.subject.has_practical !== false ? (
                              <>
                                <td className="px-3 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-red-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="25"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.first_practical_25 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, first_practical_25: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-red-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="35"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.first_theory_35 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, first_theory_35: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-red-50">
                                  {student.grades.first_total_60 || '-'}
                                </td>
                                <td className="px-2 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-gray-50 font-semibold w-20">
                                  {student.grades.first_final_100 || '-'}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-blue-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="25"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.second_practical_25 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, second_practical_25: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-blue-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="35"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.second_theory_35 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, second_theory_35: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-blue-50">
                                  {student.grades.second_total_60 || '-'}
                                </td>
                                <td className="px-2 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-gray-50 font-semibold w-20">
                                  {student.grades.second_final_100 || '-'}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-2 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-red-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="70"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.first_theory_35 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, first_theory_35: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-2 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-gray-50 font-semibold w-20">
                                  {student.grades.first_final_100 || '-'}
                                </td>
                                <td className="px-2 py-3 whitespace-nowrap border-l border-gray-200 text-center bg-blue-50">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="70"
                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                    defaultValue={student.grades.second_theory_35 || ''}
                                    onBlur={(e) => handleSaveGrade(
                                      student.student_id,
                                      student.grade_id,
                                      { ...student.grades, second_theory_35: e.target.value ? parseFloat(e.target.value) : null }
                                    )}
                                  />
                                </td>
                                <td className="px-2 py-3 whitespace-nowrap text-sm text-center text-gray-900 border-l border-gray-200 bg-gray-50 font-semibold w-20">
                                  {student.grades.second_final_100 || '-'}
                                </td>
                              </>
                            )}
                          </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد درجات</h3>
                    <p className="mt-1 text-sm text-gray-500">لا توجد درجات مسجلة لهذه المادة</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
