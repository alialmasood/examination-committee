'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type {
  StudentHistorySummary,
  StudentHistoryTimelineEntry,
  SubjectGrade,
  StudentDetails,
} from '@/src/lib/types/student-history';

const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'مستمر',
  studying: 'مستمر بالدراسة',
  registered: 'مسجل',
  enrollment: 'مستمرة في التسجيل',
  enrollment_pending: 'بانتظار التسجيل',
  pending: 'قيد الانتظار',
  probation: 'إنذار أكاديمي',
  warning: 'إنذار',
  dismissed: 'مفصول',
  expelled: 'مطرود',
  graduated: 'متخرج',
  finished: 'منجز الدراسة',
  withdrawn: 'منسحب',
  deferred: 'مؤجل',
  suspended: 'موقوف',
  transferred: 'منقول',
  dropout: 'متسرب',
  alumni: 'خريج',
  inactive: 'غير نشط',
  blocked: 'محجوب',
  cancelled: 'ملغى',
  canceled: 'ملغى',
  provisional: 'قبول مشروط',
  waitlisted: 'قائمة انتظار',
  rejected: 'مرفوض',
  unknown: 'غير محدد',
  default: 'غير محدد',
};

const STUDY_TYPE_LABELS: Record<string, string> = {
  morning: 'صباحية',
  evening: 'مسائية',
  parallel: 'موازية',
  weekend: 'تعليم عطلة نهاية الأسبوع',
  distance: 'تعليم إلكتروني',
};

const SEMESTER_LABELS: Record<string, string> = {
  first: 'الأول',
  second: 'الثاني',
};

type TabType = 'overview' | 'timeline' | 'subjects' | 'grades';

export default function StudentHistoryDetailPage() {
  const params = useParams<{ studentId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = params?.studentId;
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedYear, setSelectedYear] = useState<string>('all');

  const [student, setStudent] = useState<StudentHistorySummary | null>(null);
  const [timeline, setTimeline] = useState<StudentHistoryTimelineEntry[]>([]);
  const [subjects, setSubjects] = useState<SubjectGrade[]>([]);
  const [studentDetails, setStudentDetails] = useState<StudentDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // جلب السنوات المتاحة من جميع المصادر
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    
    // إضافة السنوات من الخط الزمني
    timeline.forEach((entry) => {
      if (entry.academicYear && entry.academicYear !== 'غير محدد') {
        years.add(entry.academicYear);
      }
    });
    
    // إضافة السنوات من المواد الدراسية
    subjects.forEach((subject) => {
      if (subject.academicYear && subject.academicYear !== 'غير محدد') {
        years.add(subject.academicYear);
      }
    });
    
    // إضافة السنة الحالية للطالب إذا كانت موجودة
    if (student?.academicYear && student.academicYear !== 'غير محدد') {
      years.add(student.academicYear);
    }
    
    return Array.from(years).sort().reverse();
  }, [timeline, subjects, student?.academicYear]);

  useEffect(() => {
    if (!studentId) {
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const yearParam = selectedYear !== 'all' ? `?academicYear=${selectedYear}` : '';
        const response = await fetch(`/api/students/history/${studentId}${yearParam}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('تعذر جلب بيانات السيرة الأكاديمية لهذا الطالب');
        }

        const payload = await response.json();
        if (!payload.success) {
          throw new Error(payload.error || 'تعذر جلب بيانات السيرة الأكاديمية');
        }

        setStudent(payload.data.student);
        setTimeline(payload.data.timeline ?? []);
        setSubjects(payload.data.subjects ?? []);
        setStudentDetails(payload.data.studentDetails ?? null);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('خطأ في تحميل السيرة الأكاديمية للطالب:', err);
          setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
          setStudent(null);
          setTimeline([]);
          setSubjects([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => controller.abort();
  }, [studentId, selectedYear]);

  const studyTypeLabel = useMemo(() => {
    if (!student?.studyType) {
      return '—';
    }
    return STUDY_TYPE_LABELS[student.studyType] ?? student.studyType;
  }, [student?.studyType]);

  const stageLabel = useMemo(() => {
    if (!student?.stageCode) {
      return student?.stage ?? 'غير محدد';
    }
    return STAGE_LABELS[student.stageCode] ?? student.stage;
  }, [student?.stage, student?.stageCode]);

  const statusLabel = useMemo(() => {
    if (!student?.status) {
      return student?.statusLabel ?? 'غير محدد';
    }
    return STATUS_LABELS[student.status] ?? student.statusLabel ?? student.status;
  }, [student?.status, student?.statusLabel]);

  // تجميع المواد حسب السنة والفصل
  const subjectsByYear = useMemo(() => {
    const grouped: Record<string, Record<string, SubjectGrade[]>> = {};
    subjects.forEach((subject) => {
      if (!grouped[subject.academicYear]) {
        grouped[subject.academicYear] = {};
      }
      if (!grouped[subject.academicYear][subject.semester]) {
        grouped[subject.academicYear][subject.semester] = [];
      }
      grouped[subject.academicYear][subject.semester].push(subject);
    });
    return grouped;
  }, [subjects]);

  // حساب المعدل لكل سنة
  const gpaByYear = useMemo(() => {
    const gpa: Record<string, number> = {};
    Object.keys(subjectsByYear).forEach((year) => {
      const yearSubjects: SubjectGrade[] = [];
      Object.values(subjectsByYear[year]).forEach((semesterSubjects) => {
        yearSubjects.push(...semesterSubjects);
      });
      if (yearSubjects.length > 0) {
        const total = yearSubjects.reduce((sum, sub) => sum + (sub.finalGrade ?? 0), 0);
        gpa[year] = total / yearSubjects.length;
      }
    });
    return gpa;
  }, [subjectsByYear]);

  const handleExport = (type: 'full' | 'current' | 'year' | 'all') => {
    const printContent = document.getElementById('print-content');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const logoPath = '/logo.png';
    const currentYear = new Date().getFullYear();
    const currentYearStr = `${currentYear}-${currentYear + 1}`;

    let title = 'السيرة الأكاديمية الكاملة';
    let filteredSubjects = subjects;
    let filteredTimeline = timeline;

    if (type === 'current') {
      title = `السيرة الأكاديمية - العام الدراسي ${currentYearStr}`;
      filteredSubjects = subjects.filter((s) => s.academicYear === currentYearStr);
      filteredTimeline = timeline.filter((t) => t.academicYear === currentYearStr);
    } else if (type === 'year' && selectedYear !== 'all') {
      title = `السيرة الأكاديمية - العام الدراسي ${selectedYear}`;
      filteredSubjects = subjects.filter((s) => s.academicYear === selectedYear);
      filteredTimeline = timeline.filter((t) => t.academicYear === selectedYear);
    }

    const printHTML = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>${title} - ${student?.fullName}</title>
          <style>
            @page {
              size: A4;
              margin: 20mm;
            }
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Arial', 'Tahoma', sans-serif;
              font-size: 11pt;
              line-height: 1.6;
              color: #1f2937;
              background: white;
            }
            .header {
              text-align: center;
              margin-bottom: 20pt;
              border-bottom: 2pt solid #2563eb;
              padding-bottom: 15pt;
            }
            .header img {
              max-width: 80pt;
              max-height: 80pt;
              margin-bottom: 10pt;
            }
            .header h1 {
              font-size: 18pt;
              font-weight: bold;
              color: #1f2937;
              margin-bottom: 5pt;
            }
            .header h2 {
              font-size: 16pt;
              color: #4b5563;
              margin-bottom: 10pt;
            }
            .student-info {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10pt;
              margin-bottom: 20pt;
              padding: 15pt;
              background: #f9fafb;
              border-radius: 5pt;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              padding: 5pt 0;
              border-bottom: 1pt solid #e5e7eb;
            }
            .info-label {
              font-weight: 600;
              color: #4b5563;
            }
            .info-value {
              color: #1f2937;
            }
            .section {
              margin-bottom: 25pt;
              page-break-inside: avoid;
            }
            .section-title {
              font-size: 14pt;
              font-weight: bold;
              color: #1f2937;
              margin-bottom: 10pt;
              padding-bottom: 5pt;
              border-bottom: 2pt solid #2563eb;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 15pt;
              font-size: 10pt;
            }
            th, td {
              padding: 8pt;
              text-align: right;
              border: 1pt solid #d1d5db;
            }
            th {
              background: #2563eb;
              color: white;
              font-weight: 600;
            }
            tr:nth-child(even) {
              background: #f9fafb;
            }
            .grade-cell {
              text-align: center;
              font-weight: 600;
            }
            .footer {
              margin-top: 30pt;
              padding-top: 15pt;
              border-top: 2pt solid #2563eb;
              text-align: center;
              font-size: 9pt;
              color: #6b7280;
            }
            @media print {
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logoPath}" alt="شعار الكلية" onerror="this.style.display='none'">
            <h1>كلية الشرق للعلوم التقنية التخصصية</h1>
            <h2>${title}</h2>
            <p style="font-size: 12pt; color: #4b5563;">${student?.fullName} - ${student?.universityId}</p>
          </div>

          <div class="student-info">
            <div class="info-row">
              <span class="info-label">الاسم الكامل:</span>
              <span class="info-value">${student?.fullName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">الرقم الجامعي:</span>
              <span class="info-value">${student?.universityId}</span>
            </div>
            <div class="info-row">
              <span class="info-label">القسم:</span>
              <span class="info-value">${student?.department}</span>
            </div>
            <div class="info-row">
              <span class="info-label">المرحلة:</span>
              <span class="info-value">${stageLabel}</span>
            </div>
            <div class="info-row">
              <span class="info-label">حالة الطالب:</span>
              <span class="info-value">${statusLabel}</span>
            </div>
            <div class="info-row">
              <span class="info-label">نوع الدراسة:</span>
              <span class="info-value">${studyTypeLabel}</span>
            </div>
            ${studentDetails?.nationalId ? `
            <div class="info-row">
              <span class="info-label">الرقم الوطني:</span>
              <span class="info-value">${studentDetails.nationalId}</span>
            </div>
            ` : ''}
            ${studentDetails?.registrationDate ? `
            <div class="info-row">
              <span class="info-label">تاريخ التسجيل:</span>
              <span class="info-value">${new Date(studentDetails.registrationDate).toLocaleDateString('ar-EG')}</span>
            </div>
            ` : ''}
            <div class="info-row">
              <span class="info-label">المعدل التراكمي:</span>
              <span class="info-value" style="font-weight: bold; font-size: 12pt; color: #2563eb;">
                ${student?.gpa != null ? student.gpa.toFixed(2) : '—'}
              </span>
            </div>
          </div>

          ${filteredTimeline.length > 0 ? `
          <div class="section">
            <div class="section-title">الخط الزمني الأكاديمي</div>
            <table>
              <thead>
                <tr>
                  <th>السنة الأكاديمية</th>
                  <th>الفصل</th>
                  <th>المرحلة</th>
                  <th>الحالة</th>
                  <th>عدد المواد</th>
                  <th>المعدل</th>
                </tr>
              </thead>
              <tbody>
                ${filteredTimeline.map((entry) => `
                  <tr>
                    <td>${entry.academicYear}</td>
                    <td>${entry.semester ? SEMESTER_LABELS[entry.semester] || entry.semester : '—'}</td>
                    <td>${entry.stage}</td>
                    <td>${entry.statusLabel}</td>
                    <td>${entry.subjectsCount ?? '—'}</td>
                    <td class="grade-cell">${entry.gpa != null ? entry.gpa.toFixed(2) : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${filteredSubjects.length > 0 ? `
          <div class="section">
            <div class="section-title">المواد الدراسية والدرجات</div>
            ${Object.keys(subjectsByYear).filter(year => {
              if (type === 'current') return year === currentYearStr;
              if (type === 'year' && selectedYear !== 'all') return year === selectedYear;
              return true;
            }).map((year) => `
              <div style="margin-bottom: 20pt;">
                <h3 style="font-size: 12pt; font-weight: bold; color: #2563eb; margin-bottom: 10pt;">
                  السنة الأكاديمية: ${year} - المعدل: ${gpaByYear[year] ? gpaByYear[year].toFixed(2) : '—'}
                </h3>
                ${Object.keys(subjectsByYear[year]).map((semester) => `
                  <div style="margin-bottom: 15pt;">
                    <h4 style="font-size: 11pt; font-weight: 600; color: #4b5563; margin-bottom: 8pt;">
                      الفصل الدراسي: ${SEMESTER_LABELS[semester] || semester}
                    </h4>
                    <table>
                      <thead>
                        <tr>
                          <th>اسم المادة</th>
                          <th>المدرس</th>
                          <th>السعي (40)</th>
                          <th>الدور الأول (60)</th>
                          <th>الدور الأول (100)</th>
                          <th>الدور الثاني (60)</th>
                          <th>الدور الثاني (100)</th>
                          <th>الدرجة النهائية</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${subjectsByYear[year][semester].map((subject) => `
                          <tr>
                            <td>${subject.subjectName}</td>
                            <td>${subject.instructorName}</td>
                            <td class="grade-cell">${subject.sae_40 ?? '—'}</td>
                            <td class="grade-cell">${subject.first_total_60 ?? '—'}</td>
                            <td class="grade-cell">${subject.first_final_100 ?? '—'}</td>
                            <td class="grade-cell">${subject.second_total_60 ?? '—'}</td>
                            <td class="grade-cell">${subject.second_final_100 ?? '—'}</td>
                            <td class="grade-cell" style="font-weight: bold; color: #2563eb;">
                              ${subject.finalGrade != null ? subject.finalGrade.toFixed(2) : '—'}
                            </td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
          ` : ''}

          <div class="footer">
            <p>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <p>نظام SHAU لإدارة شؤون الطلبة</p>
            <p>كلية الشرق للعلوم التقنية التخصصية</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const renderSkeleton = () => (
    <div className="animate-pulse space-y-6">
      <div className="h-24 bg-white/60 rounded-2xl border border-purple-100" />
      <div className="space-y-4">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="h-28 bg-white/50 rounded-xl border border-purple-100/60" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-purple-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">السيرة الأكاديمية للطالب</h1>
            <p className="text-gray-600 mt-2">
              تتبع الرحلة الأكاديمية الكاملة للطالب من التسجيل حتى التخرج
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-full border border-purple-200 text-purple-700 hover:bg-purple-100 transition-colors"
          >
            العودة
          </button>
        </div>

        {isLoading ? (
          renderSkeleton()
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 text-center">
            <p className="font-semibold mb-2">حدث خطأ أثناء تحميل السيرة الأكاديمية</p>
            <p className="text-sm mb-6">{error}</p>
            <button
              onClick={() => router.refresh()}
              className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : !student ? (
          <div className="bg-white border border-purple-100 rounded-lg p-6 text-center text-gray-500">
            لم يتم العثور على بيانات لهذا الطالب.
          </div>
        ) : (
          <div id="print-content" className="space-y-6">
            {/* معلومات الطالب */}
            <section className="bg-white rounded-2xl shadow-lg border border-purple-100/60 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-2xl font-bold text-gray-900">{student.fullName}</h2>
                    {studentDetails?.phone && (
                      <a
                        href={`https://wa.me/${studentDetails.phone.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-green-500 bg-transparent hover:bg-green-50 transition-colors shadow-sm hover:shadow-md"
                        title="فتح واتساب"
                      >
                        <svg
                          className="w-4 h-4 text-green-600"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="px-4 py-2 rounded-lg border-2 border-purple-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">الرقم الجامعي</span>
                      <span className="text-sm font-semibold text-purple-700">{student.universityId}</span>
                    </div>
                    <div className="px-4 py-2 rounded-lg border-2 border-blue-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">القسم</span>
                      <span className="text-sm font-semibold text-blue-700">{student.department}</span>
                    </div>
                    <div className="px-4 py-2 rounded-lg border-2 border-green-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">المرحلة</span>
                      <span className="text-sm font-semibold text-green-700">{stageLabel}</span>
                    </div>
                    <div className="px-4 py-2 rounded-lg border-2 border-amber-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">الحالة</span>
                      <span className="text-sm font-semibold text-amber-700">{statusLabel}</span>
                    </div>
                    <div className="px-4 py-2 rounded-lg border-2 border-sky-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">نوع الدراسة</span>
                      <span className="text-sm font-semibold text-sky-700">{studyTypeLabel}</span>
                    </div>
                    <div className="px-4 py-2 rounded-lg border-2 border-pink-300 bg-transparent">
                      <span className="text-xs text-gray-500 block mb-1">المعدل التراكمي</span>
                      <span className="text-sm font-semibold text-pink-700">
                        {student.gpa != null ? student.gpa.toFixed(2) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 lg:ml-6">
                  {studentDetails?.photo ? (
                    <img
                      src={`/api/students/${studentId}/photo`}
                      alt={student.fullName}
                      className="w-24 h-24 rounded-lg object-cover border-2 border-gray-200 shadow-md"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        if (target.nextElementSibling) {
                          (target.nextElementSibling as HTMLElement).style.display = 'flex';
                        }
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-24 h-24 rounded-lg border-2 border-gray-200 bg-gray-100 flex items-center justify-center shadow-md ${
                      studentDetails?.photo ? 'hidden' : 'flex'
                    }`}
                  >
                    <svg
                      className="w-12 h-12 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </section>

            {/* الفلاتر وأزرار التصدير */}
            <section className="bg-white rounded-xl shadow-lg border border-purple-100/60 p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <label className="text-xs font-medium text-gray-700">فلترة حسب السنة:</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="px-3 py-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">جميع السنوات</option>
                    {availableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleExport('full')}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors text-sm font-medium"
                  >
                    تصدير السيرة الكاملة
                  </button>
                  <button
                    onClick={() => handleExport('current')}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    تصدير العام الحالي
                  </button>
                  {selectedYear !== 'all' && (
                    <button
                      onClick={() => handleExport('year')}
                      className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors text-sm font-medium"
                    >
                      تصدير {selectedYear}
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* التبويبات */}
            <section className="bg-white rounded-xl shadow-lg border border-purple-100/60">
              <div className="border-b border-gray-200">
                <nav className="flex -mb-px">
                  {[
                    { id: 'overview' as TabType, label: 'نظرة عامة' },
                    { id: 'timeline' as TabType, label: 'الخط الزمني' },
                    { id: 'subjects' as TabType, label: 'المواد الدراسية' },
                    { id: 'grades' as TabType, label: 'الدرجات التفصيلية' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? 'border-purple-500 text-purple-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-6">
                {/* تبويب النظرة العامة */}
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                        <p className="text-sm text-purple-600 mb-1">إجمالي السنوات الدراسية</p>
                        <p className="text-3xl font-bold text-purple-700">{timeline.length}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-blue-600 mb-1">إجمالي المواد</p>
                        <p className="text-3xl font-bold text-blue-700">{subjects.length}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                        <p className="text-sm text-green-600 mb-1">المعدل التراكمي</p>
                        <p className="text-3xl font-bold text-green-700">
                          {student.gpa != null ? student.gpa.toFixed(2) : '—'}
                        </p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                        <p className="text-sm text-amber-600 mb-1">آخر سنة أكاديمية</p>
                        <p className="text-3xl font-bold text-amber-700">
                          {timeline.length > 0 ? timeline[timeline.length - 1].academicYear : '—'}
                        </p>
                      </div>
                    </div>

                    {studentDetails && (
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">معلومات إضافية</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          {studentDetails.nationalId && (
                            <div>
                              <span className="text-gray-600">الرقم الوطني: </span>
                              <span className="font-medium">{studentDetails.nationalId}</span>
                            </div>
                          )}
                          {studentDetails.birthDate && (
                            <div>
                              <span className="text-gray-600">تاريخ الميلاد: </span>
                              <span className="font-medium">
                                {new Date(studentDetails.birthDate).toLocaleDateString('ar-EG')}
                              </span>
                            </div>
                          )}
                          {studentDetails.phone && (
                            <div>
                              <span className="text-gray-600">الهاتف: </span>
                              <span className="font-medium">{studentDetails.phone}</span>
                            </div>
                          )}
                          {studentDetails.email && (
                            <div>
                              <span className="text-gray-600">البريد الإلكتروني: </span>
                              <span className="font-medium">{studentDetails.email}</span>
                            </div>
                          )}
                          {studentDetails.registrationDate && (
                            <div>
                              <span className="text-gray-600">تاريخ التسجيل: </span>
                              <span className="font-medium">
                                {new Date(studentDetails.registrationDate).toLocaleDateString('ar-EG')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* تبويب الخط الزمني */}
                {activeTab === 'timeline' && (
                  <div>
                    {timeline.length ? (
                      <div className="space-y-4">
                        {timeline.map((entry, index) => (
                          <div
                            key={`${entry.academicYear}-${entry.semester}-${index}`}
                            className="relative border border-purple-100 rounded-xl p-5 bg-purple-50/40"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div>
                                <h4 className="text-lg font-semibold text-purple-700">
                                  {entry.academicYear}
                                  {entry.semester && ` - الفصل ${SEMESTER_LABELS[entry.semester] || entry.semester}`}
                                </h4>
                                <p className="text-sm text-gray-700">
                                  {entry.stage} · {entry.statusLabel}
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                {entry.gpa != null && (
                                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white text-purple-700 text-sm font-semibold border border-purple-200">
                                    المعدل: {entry.gpa.toFixed(2)}
                                  </span>
                                )}
                                {entry.subjectsCount != null && (
                                  <span className="text-sm text-gray-600">
                                    {entry.subjectsCount} مادة
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-purple-200 rounded-xl">
                        لا توجد سجلات أكاديمية متاحة لهذا الطالب حتى الآن.
                      </div>
                    )}
                  </div>
                )}

                {/* تبويب المواد الدراسية */}
                {activeTab === 'subjects' && (
                  <div>
                    {Object.keys(subjectsByYear).length > 0 ? (
                      <div className="space-y-6">
                        {Object.keys(subjectsByYear)
                          .sort()
                          .reverse()
                          .map((year) => (
                            <div key={year} className="border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">
                                  السنة الأكاديمية: {year}
                                </h3>
                                {gpaByYear[year] && (
                                  <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-semibold">
                                    المعدل: {gpaByYear[year].toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {Object.keys(subjectsByYear[year]).map((semester) => (
                                <div key={semester} className="mb-4 last:mb-0">
                                  <h4 className="text-md font-medium text-gray-700 mb-2">
                                    الفصل الدراسي: {SEMESTER_LABELS[semester] || semester}
                                  </h4>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                            اسم المادة
                                          </th>
                                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                            المدرس
                                          </th>
                                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                            المرحلة
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {subjectsByYear[year][semester].map((subject) => (
                                          <tr key={subject.subjectId}>
                                            <td className="px-4 py-2 text-sm text-gray-900">
                                              {subject.subjectName}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-600">
                                              {subject.instructorName}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-600">
                                              {subject.stage ? STAGE_LABELS[subject.stage] || subject.stage : '—'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-purple-200 rounded-xl">
                        لا توجد مواد دراسية مسجلة لهذا الطالب حتى الآن.
                      </div>
                    )}
                  </div>
                )}

                {/* تبويب الدرجات التفصيلية */}
                {activeTab === 'grades' && (
                  <div>
                    {Object.keys(subjectsByYear).length > 0 ? (
                      <div className="space-y-6">
                        {Object.keys(subjectsByYear)
                          .sort()
                          .reverse()
                          .map((year) => (
                            <div key={year} className="border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">
                                  السنة الأكاديمية: {year}
                                </h3>
                                {gpaByYear[year] && (
                                  <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-semibold">
                                    المعدل: {gpaByYear[year].toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {Object.keys(subjectsByYear[year]).map((semester) => (
                                <div key={semester} className="mb-4 last:mb-0">
                                  <h4 className="text-md font-medium text-gray-700 mb-2">
                                    الفصل الدراسي: {SEMESTER_LABELS[semester] || semester}
                                  </h4>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                            المادة
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            السعي
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            الدور الأول (60)
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            الدور الأول (100)
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            الدور الثاني (60)
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            الدور الثاني (100)
                                          </th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                            النهائية
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {subjectsByYear[year][semester].map((subject) => (
                                          <tr key={subject.subjectId}>
                                            <td className="px-3 py-2 text-sm text-gray-900">
                                              {subject.subjectName}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center text-gray-600">
                                              {subject.sae_40 ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center text-gray-600">
                                              {subject.first_total_60 ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center text-gray-600">
                                              {subject.first_final_100 ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center text-gray-600">
                                              {subject.second_total_60 ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center text-gray-600">
                                              {subject.second_final_100 ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-center font-semibold text-purple-700">
                                              {subject.finalGrade != null ? subject.finalGrade.toFixed(2) : '—'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 text-sm py-8 border border-dashed border-purple-200 rounded-xl">
                        لا توجد درجات مسجلة لهذا الطالب حتى الآن.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
