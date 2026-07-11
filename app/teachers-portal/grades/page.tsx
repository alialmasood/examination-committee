'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TeacherSubject {
  subject_id: string;
  subject_name: string;
  department: string;
  stage: string;
  study_type: string;
  academic_year: string;
  semester: string;
  units: number | null;
}

interface StudentGrade {
  student_id: string;
  university_id: string;
  full_name_ar: string;
  full_name: string;
  month1_score: number | null;
  month2_score: number | null;
  month3_score: number | null;
  semester_attendance_score: number | null;
  help_score?: number | null;
  notes: string | null;
  grade_id?: string;
  isSaving?: boolean;
}

interface SubjectWithGrades {
  subject: TeacherSubject;
  students: StudentGrade[];
}

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  department: string;
}

const stageLabelMap: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة'
};

const studyTypeLabelMap: Record<string, string> = {
  morning: 'صباحي',
  evening: 'مسائي'
};

const semesterLabelMap: Record<string, string> = {
  first: 'الفصل الأول',
  second: 'الفصل الثاني'
};

export default function GradesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [subjectsGrades, setSubjectsGrades] = useState<SubjectWithGrades[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStudyType, setFilterStudyType] = useState<string>('all');
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');

  useEffect(() => {
    fetchData();
  }, []);

  // إغلاق القائمة عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        isMenuOpen &&
        menuRef.current &&
        menuButtonRef.current &&
        !menuRef.current.contains(target) &&
        !menuButtonRef.current.contains(target)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/teachers-portal/grades');
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        const errorMsg = data.error || data.message || 'حدث خطأ في جلب البيانات';
        const details = data.details ? `\n\nالتفاصيل: ${data.details}` : '';
        throw new Error(`${errorMsg}${details}`);
      }

      setTeacher(data.teacher);
      setSubjectsGrades(data.data || []);
      
      if (data.message) {
        console.log('رسالة من الخادم:', data.message);
      }
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالخادم';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Filtered data
  const filteredSubjectsGrades = useMemo(() => {
    let result = [...subjectsGrades];

    // Filter by subject
    if (filterSubject !== 'all') {
      result = result.filter((item) => item.subject.subject_id === filterSubject);
    }

    // Filter by stage
    if (filterStage !== 'all') {
      result = result.filter((item) => item.subject.stage === filterStage);
    }

    // Filter by study type
    if (filterStudyType !== 'all') {
      result = result.filter((item) => item.subject.study_type === filterStudyType);
    }

    // Filter by academic year
    if (filterAcademicYear !== 'all') {
      result = result.filter((item) => item.subject.academic_year === filterAcademicYear);
    }

    // Filter by semester
    if (filterSemester !== 'all') {
      result = result.filter((item) => item.subject.semester === filterSemester);
    }

    // Search filter (search in student names or university IDs)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.map((item) => ({
        ...item,
        students: item.students.filter(
          (student) =>
            student.full_name_ar.toLowerCase().includes(query) ||
            student.full_name.toLowerCase().includes(query) ||
            student.university_id.toLowerCase().includes(query)
        )
      })).filter((item) => item.students.length > 0);
    }

    return result;
  }, [subjectsGrades, searchQuery, filterSubject, filterStage, filterStudyType, filterAcademicYear, filterSemester]);

  // Get unique values for filters
  const uniqueSubjects = useMemo(() => {
    const subjects = subjectsGrades.map((item) => ({
      id: item.subject.subject_id,
      name: item.subject.subject_name
    }));
    return Array.from(new Map(subjects.map((s) => [s.id, s])).values());
  }, [subjectsGrades]);

  const uniqueStages = useMemo(() => {
    return Array.from(new Set(subjectsGrades.map((item) => item.subject.stage))).sort();
  }, [subjectsGrades]);

  const uniqueStudyTypes = useMemo(() => {
    return Array.from(new Set(subjectsGrades.map((item) => item.subject.study_type))).sort();
  }, [subjectsGrades]);

  const uniqueAcademicYears = useMemo(() => {
    return Array.from(new Set(subjectsGrades.map((item) => item.subject.academic_year))).sort().reverse();
  }, [subjectsGrades]);

  // Statistics - Grades Specific
  const stats = useMemo(() => {
    const totalStudents = filteredSubjectsGrades.reduce((sum, item) => sum + item.students.length, 0);
    const totalSubjects = filteredSubjectsGrades.length;
    
    // حساب عدد الدرجات المُدخلة
    let enteredGradesCount = 0;
    let totalGradesSum = 0;
    let totalGradesCount = 0;
    
    filteredSubjectsGrades.forEach((item) => {
      item.students.forEach((student) => {
        const grades = [
          student.month1_score,
          student.month2_score,
          student.month3_score
        ].filter((score) => score !== null && score !== undefined);
        
        if (grades.length > 0) {
          enteredGradesCount++;
          grades.forEach((score) => {
            if (score !== null && score !== undefined) {
              totalGradesSum += score;
              totalGradesCount++;
            }
          });
        }
      });
    });
    
    const averageGrade = totalGradesCount > 0 ? totalGradesSum / totalGradesCount : 0;
    
    return { 
      totalStudents, 
      totalSubjects, 
      enteredGradesCount,
      averageGrade: averageGrade > 0 ? averageGrade : null
    };
  }, [filteredSubjectsGrades]);

  // حساب السعي تلقائياً (متوسط الدرجات)
  const calculateAttendanceScore = (month1: number | null, month2: number | null, month3: number | null): number | null => {
    const scores: number[] = [];
    
    if (month1 !== null && month1 !== undefined && !isNaN(Number(month1))) {
      scores.push(Number(month1));
    }
    if (month2 !== null && month2 !== undefined && !isNaN(Number(month2))) {
      scores.push(Number(month2));
    }
    if (month3 !== null && month3 !== undefined && !isNaN(Number(month3))) {
      scores.push(Number(month3));
    }

    if (scores.length === 0) {
      return null;
    }

    const sum = scores.reduce((acc, score) => acc + score, 0);
    return sum / scores.length;
  };

  // تحديث درجة طالب
  const updateStudentGrade = (
    subjectId: string,
    studentId: string,
    month1: number | null,
    month2: number | null,
    month3: number | null,
    helpScore: number | null,
    notes: string | null
  ) => {
    setSubjectsGrades((prev) =>
      prev.map((subjectGroup) => {
        if (subjectGroup.subject.subject_id === subjectId) {
          const calculatedAttendance = calculateAttendanceScore(month1, month2, month3);
          
          return {
            ...subjectGroup,
            students: subjectGroup.students.map((student) => {
              if (student.student_id === studentId) {
                return {
                  ...student,
                  month1_score: month1 !== null && month1 !== undefined && !isNaN(Number(month1)) ? Number(month1) : null,
                  month2_score: month2 !== null && month2 !== undefined && !isNaN(Number(month2)) ? Number(month2) : null,
                  month3_score: month3 !== null && month3 !== undefined && !isNaN(Number(month3)) ? Number(month3) : null,
                  semester_attendance_score: calculatedAttendance,
                  help_score: helpScore !== null && helpScore !== undefined && !isNaN(Number(helpScore)) ? Number(helpScore) : null,
                  notes: notes || null
                };
              }
              return student;
            })
          };
        }
        return subjectGroup;
      })
    );
  };

  // حفظ الدرجات
  const saveGrade = async (
    subject: TeacherSubject,
    student: StudentGrade,
    month1: number | null,
    month2: number | null,
    month3: number | null,
    helpScore: number | null,
    notes: string | null
  ) => {
    // تحديث حالة الحفظ
    setSubjectsGrades((prev) =>
      prev.map((subjectGroup) => {
        if (subjectGroup.subject.subject_id === subject.subject_id) {
          return {
            ...subjectGroup,
            students: subjectGroup.students.map((s) => {
              if (s.student_id === student.student_id) {
                return { ...s, isSaving: true };
              }
              return s;
            })
          };
        }
        return subjectGroup;
      })
    );

    try {
      const response = await fetch('/api/teachers-portal/grades/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: subject.subject_id,
          student_id: student.student_id,
          academic_year: subject.academic_year,
          semester: subject.semester,
          month1_score: month1 !== null ? Number(month1) : null,
          month2_score: month2 !== null ? Number(month2) : null,
          month3_score: month3 !== null ? Number(month3) : null,
          help_score: helpScore !== null ? Number(helpScore) : null,
          notes: notes || null
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // في حالة انتهاء صلاحية access token (401)، محاولة تجديده
        if (response.status === 401) {
          try {
            const refreshResponse = await fetch('/api/auth/refresh', {
              method: 'POST'
            });
            
            const refreshData = await refreshResponse.json();
            
            if (refreshResponse.ok && refreshData.success) {
              // إعادة محاولة حفظ الدرجات بعد تجديد token
              const retryResponse = await fetch('/api/teachers-portal/grades/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subject_id: subject.subject_id,
                  student_id: student.student_id,
                  academic_year: subject.academic_year,
                  semester: subject.semester,
                  month1_score: month1 !== null ? Number(month1) : null,
                  month2_score: month2 !== null ? Number(month2) : null,
                  month3_score: month3 !== null ? Number(month3) : null,
                  help_score: helpScore !== null ? Number(helpScore) : null,
                  notes: notes || null
                })
              });

              const retryData = await retryResponse.json();

              if (retryResponse.ok && retryData.success) {
                // تحديث الدرجات المحفوظة
                setSubjectsGrades((prev) =>
                  prev.map((subjectGroup) => {
                    if (subjectGroup.subject.subject_id === subject.subject_id) {
                      return {
                        ...subjectGroup,
                        students: subjectGroup.students.map((s) => {
                          if (s.student_id === student.student_id) {
                            return {
                              ...s,
                    month1_score: retryData.data.month1_score,
                    month2_score: retryData.data.month2_score,
                    month3_score: retryData.data.month3_score,
                    semester_attendance_score: retryData.data.semester_attendance_score,
                    help_score: retryData.data.help_score,
                    notes: retryData.data.notes,
                    grade_id: retryData.data.grade_id,
                    isSaving: false
                            };
                          }
                          return s;
                        })
                      };
                    }
                    return subjectGroup;
                  })
                );
                return; // نجحت إعادة المحاولة
              }
            }
          } catch (refreshError) {
            console.error('خطأ في تجديد token:', refreshError);
          }
          
          // إذا فشل تجديد token، إعادة توجيه لتسجيل الدخول
          alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'حدث خطأ في حفظ الدرجات');
      }

      // تحديث الدرجات المحفوظة والسعي المحسوب
      setSubjectsGrades((prev) =>
        prev.map((subjectGroup) => {
          if (subjectGroup.subject.subject_id === subject.subject_id) {
            return {
              ...subjectGroup,
              students: subjectGroup.students.map((s) => {
                if (s.student_id === student.student_id) {
                  return {
                    ...s,
                    month1_score: data.data.month1_score,
                    month2_score: data.data.month2_score,
                    month3_score: data.data.month3_score,
                    semester_attendance_score: data.data.semester_attendance_score,
                    help_score: data.data.help_score,
                    notes: data.data.notes,
                    grade_id: data.data.grade_id,
                    isSaving: false
                  };
                }
                return s;
              })
            };
          }
          return subjectGroup;
        })
      );
    } catch (error) {
      console.error('خطأ في حفظ الدرجات:', error);
      alert(error instanceof Error ? error.message : 'حدث خطأ في حفظ الدرجات');
      
      // إزالة حالة الحفظ عند الخطأ
      setSubjectsGrades((prev) =>
        prev.map((subjectGroup) => {
          if (subjectGroup.subject.subject_id === subject.subject_id) {
            return {
              ...subjectGroup,
              students: subjectGroup.students.map((s) => {
                if (s.student_id === student.student_id) {
                  return { ...s, isSaving: false };
                }
                return s;
              })
            };
          }
          return subjectGroup;
        })
      );
    }
  };

  const handleExportToExcel = async (subject: TeacherSubject, students: StudentGrade[]) => {
    try {
      // Dynamic import for ExcelJS
      const ExcelJS = (await import('exceljs')).default;
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(`${subject.subject_name} - الدرجات`);

      // Set columns
      worksheet.columns = [
        { header: 'التسلسل', key: 'sequence', width: 12 },
        { header: 'اسم الطالب', key: 'name', width: 30 },
        { header: 'درجة الامتحان الأول', key: 'month1', width: 18 },
        { header: 'درجة الامتحان الثاني', key: 'month2', width: 18 },
        { header: 'درجة الامتحان الثالث', key: 'month3', width: 18 },
        { header: 'درجة السعي', key: 'attendance', width: 15 },
        { header: 'مساعدة', key: 'help', width: 12 },
        { header: 'ملاحظات', key: 'notes', width: 40 }
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDC2626' }
      };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Add subject info as first rows
      worksheet.insertRow(1, ['المادة:', subject.subject_name]);
      worksheet.insertRow(2, ['القسم:', subject.department]);
      worksheet.insertRow(3, ['المرحلة:', stageLabelMap[subject.stage] || subject.stage]);
      worksheet.insertRow(4, ['نوع الدراسة:', studyTypeLabelMap[subject.study_type] || subject.study_type]);
      worksheet.insertRow(5, ['السنة الأكاديمية:', subject.academic_year]);
      worksheet.insertRow(6, ['الفصل:', semesterLabelMap[subject.semester] || subject.semester]);
      worksheet.insertRow(7, []); // Empty row

      // Add students data
      students.forEach((student, index) => {
        worksheet.addRow({
          sequence: index + 1,
          name: student.full_name_ar || student.full_name,
          month1: student.month1_score ?? '-',
          month2: student.month2_score ?? '-',
          month3: student.month3_score ?? '-',
          attendance: student.semester_attendance_score ?? '-',
          help: student.help_score ?? '-',
          notes: student.notes || '-'
        });
      });

      // Style all cells
      worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
      });

      // Generate buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `درجات_${subject.subject_name}_${subject.academic_year}_${subject.semester}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      alert('تم تصدير الجدول بنجاح!');
    } catch (error) {
      console.error('خطأ في تصدير الجدول:', error);
      alert('حدث خطأ في تصدير الجدول. يرجى المحاولة مرة أخرى.');
    }
  };

  const handlePrint = (subject: TeacherSubject, students: StudentGrade[]) => {
    // Create a new window with print-friendly content
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>درجات ${subject.subject_name}</title>
          <style>
            @media print {
              @page {
                size: A4 landscape;
                margin: 1cm;
              }
            }
            body {
              font-family: 'Arial', 'Tahoma', sans-serif;
              margin: 0;
              padding: 20px;
              direction: rtl;
            }
            .header {
              text-align: center;
              margin-bottom: 20px;
              border-bottom: 3px solid #DC2626;
              padding-bottom: 10px;
            }
            .header h1 {
              color: #DC2626;
              margin: 5px 0;
              font-size: 24px;
            }
            .info {
              display: flex;
              justify-content: space-around;
              margin-bottom: 20px;
              font-size: 14px;
            }
            .info span {
              margin: 0 10px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
              font-size: 12px;
            }
            th {
              background-color: #DC2626;
              color: white;
              padding: 10px;
              text-align: center;
              border: 1px solid #000;
              font-weight: bold;
            }
            td {
              padding: 8px;
              text-align: center;
              border: 1px solid #000;
            }
            tr:nth-child(even) {
              background-color: #f5f5f5;
            }
            .footer {
              margin-top: 30px;
              text-align: center;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>جدول درجات الطلاب</h1>
            <h2>${subject.subject_name}</h2>
          </div>
          <div class="info">
            <span><strong>القسم:</strong> ${subject.department}</span>
            <span><strong>المرحلة:</strong> ${stageLabelMap[subject.stage] || subject.stage}</span>
            <span><strong>نوع الدراسة:</strong> ${studyTypeLabelMap[subject.study_type] || subject.study_type}</span>
            <span><strong>السنة:</strong> ${subject.academic_year}</span>
            <span><strong>الفصل:</strong> ${semesterLabelMap[subject.semester] || subject.semester}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>اسم الطالب</th>
                <th>درجة الامتحان الأول</th>
                <th>درجة الامتحان الثاني</th>
                <th>درجة الامتحان الثالث</th>
                <th>درجة السعي</th>
                <th>مساعدة</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((student, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${student.full_name_ar || student.full_name}</td>
                  <td>${student.month1_score ?? '-'}</td>
                  <td>${student.month2_score ?? '-'}</td>
                  <td>${student.month3_score ?? '-'}</td>
                  <td>${student.semester_attendance_score ?? '-'}</td>
                  <td>${student.help_score ?? '-'}</td>
                  <td>${student.notes || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">
            <p>تم الطباعة في: ${new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    
    // Wait for content to load then print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/teachers-portal');
    } catch (error) {
      console.error('خطأ في تسجيل الخروج:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <Link href="/teachers-portal/dashboard" className="text-lg sm:text-xl font-bold text-red-600">
                بوابة التدريسين
              </Link>
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-gray-700 px-3 py-2 text-sm font-medium"
              >
                خروج
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-center">
            <p className="whitespace-pre-line">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 safe-area-inset">
      {/* Main Content */}
      <main className="pb-20 sm:pb-8">
        {teacher ? (
          <>
            {/* Welcome Section - Merged Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 shadow-lg sticky top-0 z-40">
              <div className="w-full px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
                <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
                  {/* Left Side - Welcome */}
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                    {/* Mobile Menu Button */}
                    <button
                      ref={menuButtonRef}
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="sm:hidden p-2 text-white hover:bg-white/10 rounded transition-colors touch-manipulation"
                      aria-label="القائمة"
                      aria-expanded={isMenuOpen}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isMenuOpen ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                      </svg>
                    </button>
                    {/* Desktop Welcome */}
                    <div className="hidden sm:block">
                      <h1 className="text-base sm:text-lg md:text-xl font-bold text-white truncate">مرحباً {teacher.full_name_ar}</h1>
                      <p className="text-xs sm:text-sm text-red-100 truncate">القسم: {teacher.department}</p>
                    </div>
                    {/* Mobile Welcome */}
                    <div className="sm:hidden min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">مرحباً {teacher.full_name_ar}</div>
                      <div className="text-[10px] text-red-100 truncate">القسم: {teacher.department}</div>
                    </div>
                  </div>
                  
                  {/* Right Side - User, Logout */}
                  <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                    {/* اسم المستخدم */}
                    <span className="text-white text-xs sm:text-sm font-medium hidden xs:inline truncate max-w-[120px] sm:max-w-none">
                      {teacher.full_name_ar}
                    </span>
                    {/* زر الخروج */}
                    <button
                      onClick={handleLogout}
                      className="text-white hover:text-red-100 active:text-red-200 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium touch-manipulation whitespace-nowrap border border-white/30 hover:border-white/50 rounded transition-colors flex-shrink-0"
                    >
                      خروج
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Menu - Overlay */}
            {isMenuOpen && (
              <div ref={menuRef} className="fixed left-0 right-0 bg-white border-t border-gray-200 shadow-xl z-[50] sm:hidden overflow-y-auto" style={{ top: '73px', maxHeight: 'calc(100vh - 73px)' }}>
                  <div className="px-4 py-3 space-y-2">
                  <Link
                    href="/teachers-portal/dashboard"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الصفحة الرئيسية</h3>
                      <p className="text-xs text-gray-600">لوحة التحكم</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">ملفي الشخصي</h3>
                      <p className="text-xs text-gray-600">عرض وتعديل بياناتي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/my-students"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">طلابي</h3>
                      <p className="text-xs text-gray-600">عرض وإدارة طلابي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/grades"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-green-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الدرجات</h3>
                      <p className="text-xs text-gray-600">إدخال درجات الامتحانات</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/attendance"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-yellow-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الحضور والغياب</h3>
                      <p className="text-xs text-gray-600">تسجيل الحضور اليومي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/subjects"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-purple-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">موادي التدريسية</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والحضور</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/calendar"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">التقويم الجامعي</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والامتحانات والأحداث</p>
                    </div>
                  </Link>
                  </div>
                </div>
            )}

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
              {/* Statistics Cards - Grades Specific */}
              {stats.totalSubjects > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                  {/* Total Students Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الطلاب</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalStudents}</p>
                      <p className="text-xs text-gray-500 mt-1">طالب مسجل</p>
                    </div>
                  </div>

                  {/* Total Subjects Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">عدد المواد</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalSubjects}</p>
                      <p className="text-xs text-gray-500 mt-1">مادة دراسية</p>
                    </div>
                  </div>

                  {/* Entered Grades Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">الدرجات المُدخلة</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.enteredGradesCount}</p>
                      <p className="text-xs text-gray-500 mt-1">من {stats.totalStudents} طالب</p>
                    </div>
                  </div>

                  {/* Average Grade Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">المتوسط العام</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">
                        {stats.averageGrade !== null ? stats.averageGrade.toFixed(2) : '-'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">من 100</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Filters and Search */}
              {subjectsGrades.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4 sm:mb-6 hover:shadow-md transition-shadow">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">البحث والتصفية</h2>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 md:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {/* Search */}
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          بحث
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ابحث باسم الطالب أو الرقم الجامعي..."
                            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          />
                          <svg className="absolute right-3 top-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      </div>

                      {/* Subject Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          المادة
                        </label>
                        <select
                          value={filterSubject}
                          onChange={(e) => setFilterSubject(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueSubjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name.length > 30 ? `${subject.name.substring(0, 30)}...` : subject.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Stage Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          المرحلة
                        </label>
                        <select
                          value={filterStage}
                          onChange={(e) => setFilterStage(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stageLabelMap[stage] || stage}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Study Type Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          نوع الدراسة
                        </label>
                        <select
                          value={filterStudyType}
                          onChange={(e) => setFilterStudyType(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueStudyTypes.map((type) => (
                            <option key={type} value={type}>
                              {studyTypeLabelMap[type] || type}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Academic Year Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          السنة الأكاديمية
                        </label>
                        <select
                          value={filterAcademicYear}
                          onChange={(e) => setFilterAcademicYear(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueAcademicYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Semester Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          الفصل
                        </label>
                        <select
                          value={filterSemester}
                          onChange={(e) => setFilterSemester(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          <option value="first">الأول</option>
                          <option value="second">الثاني</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

        {/* Subjects and Grades Tables */}
        {filteredSubjectsGrades.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm sm:text-base font-medium text-gray-900">
              {subjectsGrades.length === 0 ? 'لا توجد مواد دراسية' : 'لا توجد نتائج'}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {subjectsGrades.length === 0 
                ? 'لا توجد مواد دراسية مرتبطة بك حالياً' 
                : 'لم يتم العثور على طلاب تطابق معايير البحث'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredSubjectsGrades.map((item) => {
              const { subject, students } = item;
              
              return (
                <div key={subject.subject_id} className="bg-white rounded-none sm:rounded-xl shadow-sm border-x-0 sm:border-x border-t border-b sm:border border-gray-200 overflow-hidden hover:shadow-md transition-shadow -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto">
                  {/* Subject Header */}
                  <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 px-4 sm:px-6 py-4 sm:py-5 text-white">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2">
                          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                            </div>
                            <h3 className="text-base sm:text-lg md:text-xl font-bold truncate">
                              {subject.subject_name}
                            </h3>
                          </div>
                          {/* Number of Students and Buttons - Mobile Only */}
                          <div className="sm:hidden flex items-center gap-1 flex-shrink-0">
                            <div className="flex items-center gap-1 bg-white/10 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/20">
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                              <span className="text-xs font-bold text-white">{students.length}</span>
                            </div>
                            <button
                              onClick={() => handleExportToExcel(subject, students)}
                              className="p-1 text-white hover:text-red-100 transition-colors flex items-center justify-center"
                              title="تصدير إلى Excel"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handlePrint(subject, students)}
                              className="p-1 text-white hover:text-red-100 transition-colors flex items-center justify-center"
                              title="طباعة"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30 whitespace-nowrap flex-shrink-0">
                            {stageLabelMap[subject.stage] || subject.stage}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30 whitespace-nowrap flex-shrink-0">
                            {studyTypeLabelMap[subject.study_type] || subject.study_type}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30 whitespace-nowrap flex-shrink-0">
                            {semesterLabelMap[subject.semester] || subject.semester}
                          </span>
                          <span className="text-[10px] sm:text-xs text-red-100 whitespace-nowrap flex-shrink-0">
                            {subject.academic_year}
                          </span>
                          {subject.units && (
                            <span className="text-[10px] sm:text-xs text-red-100 whitespace-nowrap flex-shrink-0">
                              {subject.units} وحدة
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 sm:gap-3 flex-wrap">
                        <div className="flex items-center gap-2 sm:gap-3 bg-white/10 backdrop-blur-sm px-3 sm:px-4 py-2 rounded-lg border border-white/20">
                          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          <div>
                            <div className="text-lg sm:text-xl md:text-2xl font-bold">{students.length}</div>
                            <div className="text-xs text-red-100">{students.length === 1 ? 'طالب' : 'طالب'}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleExportToExcel(subject, students)}
                          className="px-2 sm:px-3 py-1.5 sm:py-2 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white rounded-lg transition-all text-xs sm:text-sm font-medium border border-white/30 hover:border-white/50 flex items-center justify-center gap-1.5 sm:gap-2"
                          title="تصدير إلى Excel"
                        >
                          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="hidden sm:inline">تصدير</span>
                        </button>
                        <button
                          onClick={() => handlePrint(subject, students)}
                          className="px-2 sm:px-3 py-1.5 sm:py-2 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white rounded-lg transition-all text-xs sm:text-sm font-medium border border-white/30 hover:border-white/50 flex items-center justify-center gap-1.5 sm:gap-2"
                          title="طباعة"
                        >
                          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                          <span className="hidden sm:inline">طباعة</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Grades Table */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-red-50 to-red-100">
                        <tr>
                          <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            #
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            اسم الطالب
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            درجة الامتحان الأول
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            درجة الامتحان الثاني
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            درجة الامتحان الثالث
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            درجة السعي
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            مساعدة
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-red-200">
                            ملاحظات
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {students.map((student, index) => (
                          <tr key={student.student_id} className="hover:bg-red-50 transition-colors">
                            <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 bg-red-100 text-red-700 rounded-full text-xs sm:text-sm font-bold">
                                  {index + 1}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 sm:px-4 py-3 sm:py-4 text-sm text-gray-900 min-w-[150px]">
                              <div className="font-semibold">{student.full_name_ar || student.full_name}</div>
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-3 whitespace-nowrap">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={student.month1_score !== null && student.month1_score !== undefined ? student.month1_score : ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                  updateStudentGrade(
                                    subject.subject_id,
                                    student.student_id,
                                    value,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                onBlur={() => {
                                  saveGrade(
                                    subject,
                                    student,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white hover:border-red-300 transition-colors"
                                placeholder="-"
                                disabled={student.isSaving}
                              />
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-3 whitespace-nowrap">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={student.month2_score !== null && student.month2_score !== undefined ? student.month2_score : ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                  updateStudentGrade(
                                    subject.subject_id,
                                    student.student_id,
                                    student.month1_score,
                                    value,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                onBlur={() => {
                                  saveGrade(
                                    subject,
                                    student,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white hover:border-red-300 transition-colors"
                                placeholder="-"
                                disabled={student.isSaving}
                              />
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-3 whitespace-nowrap">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={student.month3_score !== null && student.month3_score !== undefined ? student.month3_score : ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                  updateStudentGrade(
                                    subject.subject_id,
                                    student.student_id,
                                    student.month1_score,
                                    student.month2_score,
                                    value,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                onBlur={() => {
                                  saveGrade(
                                    subject,
                                    student,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white hover:border-red-300 transition-colors"
                                placeholder="-"
                                disabled={student.isSaving}
                              />
                            </td>
                            <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-sm text-center">
                              {student.semester_attendance_score !== null && student.semester_attendance_score !== undefined ? (
                                <span className="inline-flex items-center justify-center font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                                  {student.semester_attendance_score.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-3 whitespace-nowrap">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={student.help_score !== null && student.help_score !== undefined ? student.help_score : ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                  updateStudentGrade(
                                    subject.subject_id,
                                    student.student_id,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    value,
                                    student.notes
                                  );
                                }}
                                onBlur={() => {
                                  saveGrade(
                                    subject,
                                    student,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-center border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white hover:border-red-300 transition-colors"
                                placeholder="-"
                                disabled={student.isSaving}
                              />
                            </td>
                            <td className="px-2 sm:px-3 py-3 sm:py-4">
                              <textarea
                                value={student.notes || ''}
                                onChange={(e) => {
                                  updateStudentGrade(
                                    subject.subject_id,
                                    student.student_id,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    e.target.value || null
                                  );
                                }}
                                onBlur={() => {
                                  saveGrade(
                                    subject,
                                    student,
                                    student.month1_score,
                                    student.month2_score,
                                    student.month3_score,
                                    student.help_score ?? null,
                                    student.notes
                                  );
                                }}
                                className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-right border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none bg-white hover:border-red-300 transition-colors"
                                placeholder="اكتب ملاحظات..."
                                rows={2}
                                disabled={student.isSaving}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
            </div>
            </>
        ) : null}
      </main>
    </div>
  );
}

