'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  DepartmentStageSummaryEntry,
  SemesterSummaryEntry,
  StageSummaryEntry,
  StudentReportData,
  SimpleStatEntry,
} from '@/src/lib/types/reports';

import type { StageBreakdownEntry, SemesterBreakdownEntry } from '@/src/lib/types/reports';

type ActiveTab = 'students' | 'results' | 'attendance' | 'requests' | 'export';

const EXPORT_COLOR_OVERRIDES = `
  .text-gray-900 { color: #111827 !important; }
  .text-gray-800 { color: #1f2937 !important; }
  .text-gray-700 { color: #374151 !important; }
  .text-gray-600 { color: #4b5563 !important; }
  .text-gray-500 { color: #6b7280 !important; }
  .text-gray-400 { color: #9ca3af !important; }
  .text-gray-300 { color: #d1d5db !important; }
  .text-purple-600 { color: #7c3aed !important; }
  .text-blue-600 { color: #2563eb !important; }
  .text-green-600 { color: #16a34a !important; }
  .text-pink-600 { color: #db2777 !important; }
  .text-white { color: #ffffff !important; }
  .bg-white { background-color: #ffffff !important; }
  .bg-gray-50 { background-color: #f9fafb !important; }
  .bg-blue-100 { background-color: #dbeafe !important; }
  .bg-green-100 { background-color: #dcfce7 !important; }
  .bg-pink-100 { background-color: #fce7f3 !important; }
  .bg-purple-100 { background-color: #f3e8ff !important; }
  .bg-gray-100 { background-color: #f3f4f6 !important; }
  .bg-purple-50 { background-color: #faf5ff !important; }
  .bg-purple-500 { background-color: #8b5cf6 !important; }
  .bg-purple-600 { background-color: #7c3aed !important; }
  .bg-purple-700 { background-color: #6d28d9 !important; }
  .bg-gradient-to-br,
  .from-purple-50,
  .via-pink-50,
  .to-red-50 {
    background-image: none !important;
  }
`;

type UiFilters = {
  departmentId: string;
  stageId: string;
  semesterId: string;
  academicYear: string;
  status: string;
  gender: string;
  admissionChannel: string;
  studyType: string;
  paymentStatus: string;
};

type StageOption = DepartmentStageSummaryEntry | StageSummaryEntry;

type SemesterOption = SemesterSummaryEntry;

const INITIAL_FILTERS: UiFilters = {
  departmentId: 'all',
  stageId: 'all',
  semesterId: 'all',
  academicYear: 'all',
  status: 'all',
  gender: 'all',
  admissionChannel: 'all',
  studyType: 'all',
  paymentStatus: 'all',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'ذكور',
  female: 'إناث',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'مستمر',
  enrollment: 'مستمرة في التسجيل',
  studying: 'مستمر بالدراسة',
  registered: 'مسجل',
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
  applicant: 'متقدم',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  inactive: 'غير نشط',
  blocked: 'محجوب',
  cancelled: 'ملغى',
  canceled: 'ملغى',
  alumni: 'خريج',
  waitlisted: 'قائمة انتظار',
  provisional: 'قبول مشروط',
  enrollment_pending: 'بانتظار التسجيل',
  archival: 'مؤرشف',
  archived: 'مؤرشف',
  default: 'غير محدد',
  unspecified: 'غير محدد',
  unknown: 'غير محدد',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'مدفوع',
  unpaid: 'غير مدفوع',
  pending: 'قيد المعالجة',
  in_progress: 'قيد المعالجة',
  processing: 'قيد المعالجة',
  overdue: 'متأخر',
  delayed: 'متأخر',
  exempted: 'معفى',
  exempt: 'معفى',
  partial: 'مدفوع جزئياً',
  partially_paid: 'مدفوع جزئياً',
  cancelled: 'ملغى',
  canceled: 'ملغى',
  refunded: 'مسترد',
  refund: 'مسترد',
  failed: 'فشل السداد',
  rejected: 'مرفوض',
  draft: 'مسودة',
  registration_pending: 'بانتظار إكمال التسجيل',
  pending_verification: 'بانتظار التحقق',
  awaiting_verification: 'بانتظار التحقق',
  error: 'خطأ في السداد',
  unknown: 'غير محدد',
};

const ADMISSION_CHANNEL_LABELS: Record<string, string> = {
  general: 'القبول العام',
  private: 'القبول الخاص',
  evening: 'التعليم المسائي',
  morning: 'التعليم الصباحي',
  direct: 'قبول مباشر',
  parallel: 'التعليم الموازي',
  scholarship: 'بعثة دراسية',
  transfer: 'نقل من جامعة أخرى',
  international: 'قبول دولي',
  external: 'قبول خارجي',
  central: 'قبول مركزي',
  electronic: 'قبول إلكتروني',
  manual: 'قبول يدوي',
  top_student: 'الطلبة الأوائل',
  displaced: 'الطلبة النازحين',
  martyrs: 'عوائل الشهداء',
  disabled: 'ذوي الاحتياجات الخاصة',
  sports: 'القبول الرياضي',
  artistic: 'القبول الفني',
  iq: 'قبول ذوي الاحتياجات الخاصة',
  unknown: 'غير محدد',
};

const STUDY_TYPE_LABELS: Record<string, string> = {
  morning: 'الدراسة الصباحية',
  evening: 'الدراسة المسائية',
  parallel: 'التعليم الموازي',
  weekend: 'التعليم المسائي (العطلات)',
  distance: 'التعليم الإلكتروني',
  e_learning: 'التعليم الإلكتروني',
  online: 'التعليم عبر الإنترنت',
  mixed: 'التعليم المدمج',
};

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function isDepartmentStage(entry: StageOption): entry is DepartmentStageSummaryEntry {
  return (entry as DepartmentStageSummaryEntry).total !== undefined;
}

function localizeStudyTypeLabel(label: string) {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return label;
  }
  return STUDY_TYPE_LABELS[normalized] ?? label;
}

function localizePaymentStatusLabel(label: string) {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return label;
  }
  return PAYMENT_STATUS_LABELS[normalized] ?? label;
}

function localizeAdmissionChannelLabel(label: string) {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return label;
  }
  return ADMISSION_CHANNEL_LABELS[normalized] ?? label;
}

function localizeStatusLabel(label: string) {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return label;
  }
  return STATUS_LABELS[normalized] ?? label;
}

function formatSimpleStat(list: SimpleStatEntry[], formatNumber: (value?: number | null) => string, formatPercentage: (value?: number | null) => string) {
  return list.map((item) => ({
    label: item.label,
    count: formatNumber(item.count),
    percentage: formatPercentage(item.percentage),
  }));
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('students');
  const [filters, setFilters] = useState<UiFilters>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<UiFilters>(INITIAL_FILTERS);
  const [reportData, setReportData] = useState<StudentReportData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const initialDataRef = useRef<StudentReportData | null>(null);
  const reportContentRef = useRef<HTMLDivElement | null>(null);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ar-IQ'), []);
  const percentageFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ar-IQ', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined) {
      return '-';
    }
    return numberFormatter.format(value);
  };

  const formatPercentage = (value?: number | null) => {
    if (value === null || value === undefined) {
      return '-';
    }
    return `${percentageFormatter.format(value)}%`;
  };

  useEffect(() => {
    const controller = new AbortController();

    const loadStatistics = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const searchParams = new URLSearchParams();
        Object.entries(appliedFilters).forEach(([key, value]) => {
          if (value && value !== 'all') {
            searchParams.set(key, value);
          }
        });

        const queryString = searchParams.toString();
        const response = await fetch(queryString ? `/api/reports/students?${queryString}` : '/api/reports/students', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(bodyText || 'تعذر جلب البيانات');
        }

        const payload = await response.json();
        if (controller.signal.aborted) {
          return;
        }

        setReportData(payload.data as StudentReportData);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('فشل في جلب إحصائيات الطلبة:', err);
        setReportData(null);
        setError('تعذر جلب إحصائيات الطلبة. حاول مرة أخرى.');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadStatistics();

    return () => controller.abort();
  }, [appliedFilters]);

  useEffect(() => {
    if (reportData && !initialDataRef.current) {
      initialDataRef.current = reportData;
    }
  }, [reportData]);

  const filtersSource = initialDataRef.current ?? reportData;

  const stageOptions = useMemo<StageOption[]>(() => {
    if (!filtersSource) {
      return [];
    }
    if (filters.departmentId !== 'all') {
      return dedupeById(filtersSource.filters.departmentStages[filters.departmentId] || []);
    }
    return dedupeById(filtersSource.filters.stages);
  }, [filters.departmentId, filtersSource]);

  const semesterOptions = useMemo<SemesterOption[]>(() => {
    if (!filtersSource) {
      return [];
    }
    if (filters.stageId !== 'all') {
      const stage = stageOptions.find((entry) => entry.id === filters.stageId);
      return stage ? dedupeById(stage.semesters) : [];
    }
    if (filters.departmentId !== 'all') {
      const departmentStages = filtersSource.filters.departmentStages[filters.departmentId] || [];
      return dedupeById(departmentStages.flatMap((entry) => entry.semesters));
    }
    return dedupeById(filtersSource.filters.semesters);
  }, [filters.departmentId, filters.stageId, filtersSource, stageOptions]);

  useEffect(() => {
    if (!filtersSource) {
      return;
    }
    if (filters.stageId !== 'all' && !stageOptions.some((stage) => stage.id === filters.stageId)) {
      setFilters((prev) => ({ ...prev, stageId: 'all', semesterId: 'all' }));
    }
  }, [filters.stageId, stageOptions, filtersSource]);

  useEffect(() => {
    if (!filtersSource) {
      return;
    }
    if (filters.semesterId !== 'all' && !semesterOptions.some((semester) => semester.id === filters.semesterId)) {
      setFilters((prev) => ({ ...prev, semesterId: 'all' }));
    }
  }, [filters.semesterId, semesterOptions, filtersSource]);

  const academicYearOptions = filtersSource?.breakdown.academicYears ?? [];
  const statusOptions = filtersSource?.breakdown.statuses ?? [];
  const genderOptions = filtersSource?.breakdown.genders ?? [];
  const admissionChannelOptions = filtersSource?.breakdown.admissionChannels ?? [];
  const studyTypeOptions = filtersSource?.breakdown.studyTypes ?? [];
  const paymentStatusOptions = filtersSource?.breakdown.paymentStatuses ?? [];

  const handleDepartmentChange = (value: string) => {
    setFilters((prev) => ({ ...prev, departmentId: value, stageId: 'all', semesterId: 'all' }));
  };

  const handleStageChange = (value: string) => {
    setFilters((prev) => ({ ...prev, stageId: value, semesterId: 'all' }));
  };

  const handleFilterChange = (key: keyof UiFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters });
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
  };

  const handleRetry = () => {
    setAppliedFilters((prev) => ({ ...prev }));
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!reportData) {
      return;
    }
    setIsExporting(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      if (format === 'pdf') {
        const element = reportContentRef.current;
        if (!element) {
          console.warn('لا يوجد محتوى متاح للتصدير إلى PDF.');
          return;
        }

        const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
          import('html2canvas'),
          import('jspdf'),
        ]);

        const canvas = await html2canvas(element, {
          scale: Math.max(window.devicePixelRatio, 2),
          useCORS: true,
          backgroundColor: '#ffffff',
          onclone: (doc) => {
            const style = doc.createElement('style');
            style.textContent = EXPORT_COLOR_OVERRIDES;
            doc.head.appendChild(style);
          },
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: canvas.width > canvas.height ? 'l' : 'p',
          unit: 'mm',
          format: 'a4',
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        pdf.save(`student-statistics-${timestamp}.pdf`);
        return;
      }

      const csvRows: string[][] = [];
      const escapeValue = (value: string | number) => {
        const str = String(value ?? '');
        if (/[",\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const pushSection = (title: string, header: string[], rows: string[][]) => {
        if (csvRows.length) {
          csvRows.push([]);
        }
        csvRows.push([title]);
        csvRows.push(header);
        rows.forEach((row) => csvRows.push(row));
      };

      pushSection('المؤشرات العامة', ['المؤشر', 'القيمة'], [
        ['إجمالي الطلاب', formatNumber(reportData.totals.totalStudents)],
        ['عدد الذكور', formatNumber(reportData.totals.male ?? 0)],
        ['عدد الإناث', formatNumber(reportData.totals.female ?? 0)],
        ['الطلبة الجدد', formatNumber(reportData.newStudentsCount)],
      ]);

      pushSection(
        'توزيع الأقسام',
        ['القسم', 'عدد الطلبة', 'النسبة المئوية'],
        reportData.breakdown.departments.map((item) => [
          item.name,
          formatNumber(item.count),
          `${percentageFormatter.format(item.percentage)}%`,
        ])
      );

      pushSection(
        'توزيع المراحل',
        ['المرحلة', 'عدد الطلبة', 'النسبة المئوية'],
        reportData.breakdown.stages.map((item: StageBreakdownEntry) => [
          item.name,
          formatNumber(item.count),
          `${percentageFormatter.format(item.percentage)}%`,
        ])
      );

      pushSection(
        'توزيع الفصول الدراسية',
        ['المرحلة', 'الفصل', 'عدد الطلبة', 'النسبة المئوية'],
        reportData.breakdown.semesters.map((item: SemesterBreakdownEntry) => [
          item.stageName,
          item.name,
          formatNumber(item.count),
          `${percentageFormatter.format(item.percentage)}%`,
        ])
      );

      const additionalSections: Array<[string, SimpleStatEntry[]]> = [
        ['توزيع الجنس', reportData.breakdown.genders],
        ['حالات الطالب', reportData.breakdown.statuses],
        ['قنوات القبول', reportData.breakdown.admissionChannels],
        ['أنماط الدراسة', reportData.breakdown.studyTypes],
        ['السنوات الأكاديمية', reportData.breakdown.academicYears],
        ['حالات الدفع', reportData.breakdown.paymentStatuses],
      ];

      additionalSections.forEach(([title, list]) => {
        if (!list.length) {
          return;
        }
        pushSection(
          title,
          ['التصنيف', 'عدد الطلبة', 'النسبة المئوية'],
          list.map((item) => [
            item.label,
            formatNumber(item.count),
            `${percentageFormatter.format(item.percentage)}%`,
          ])
        );
      });

      const csvContent = csvRows.map((row) => row.map(escapeValue).join(',')).join('\r\n');
      const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `student-statistics-${timestamp}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setIsExporting(false);
    }
  };

  const formattedGenders = formatSimpleStat(reportData?.breakdown.genders ?? [], formatNumber, formatPercentage).map((entry) => ({
    ...entry,
    label: GENDER_LABELS[entry.label] || entry.label,
  }));

  const statusSource = reportData?.breakdown.statuses ?? [];
  const formattedStatuses = statusSource.map((item) => {
    const rawLabel = item.label || item.key || 'غير محدد';
    return {
      label: localizeStatusLabel(rawLabel),
      count: formatNumber(item.count),
      percentage: formatPercentage(item.percentage),
    };
  });
  const admissionChannelSource = reportData?.breakdown.admissionChannels ?? [];
  const formattedAdmissionChannels = admissionChannelSource.map((item) => {
    const rawLabel = item.label || item.key || 'غير محدد';
    return {
      label: localizeAdmissionChannelLabel(rawLabel),
      count: formatNumber(item.count),
      percentage: formatPercentage(item.percentage),
    };
  });

  const studyTypeSource = reportData?.breakdown.studyTypes ?? [];
  const formattedStudyTypes = studyTypeSource.map((item) => {
    const rawLabel = item.label || item.key || 'غير محدد';
    return {
      label: localizeStudyTypeLabel(rawLabel),
    count: formatNumber(item.count),
    percentage: formatPercentage(item.percentage),
    };
  });
  const formattedAcademicYears = formatSimpleStat(reportData?.breakdown.academicYears ?? [], formatNumber, formatPercentage);
  const paymentStatusSource = reportData?.breakdown.paymentStatuses ?? [];
  const formattedPaymentStatuses = paymentStatusSource.map((item) => {
    const rawLabel = item.label || item.key || 'غير محدد';
    return {
      label: localizePaymentStatusLabel(rawLabel),
      count: formatNumber(item.count),
      percentage: formatPercentage(item.percentage),
    };
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">الإحصائيات والتقارير</h1>
          <p className="text-gray-600">إنتاج التقارير والإحصائيات الشاملة لجميع المستفيدين من النظام.</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              {[
                { key: 'students', label: 'إحصائية الطلاب' },
                { key: 'results', label: 'النتائج الأكاديمية' },
                { key: 'attendance', label: 'الغيابات والإنذارات' },
                { key: 'requests', label: 'إحصائية الطلبات' },
                { key: 'export', label: 'تصدير التقارير' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as ActiveTab)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.key
                      ? 'border-purple-500 text-purple-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">مرشحات التقارير</h2>
                  <p className="text-sm text-gray-500">حدّد جمهور التقرير ثم اضغط &quot;تطبيق&quot; للحصول على الإحصائيات المحدثة.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleResetFilters}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                    disabled={isLoading && !reportData}
                  >
                    إعادة الضبط
                  </button>
                  <button
                    onClick={handleApplyFilters}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                    disabled={isLoading}
                  >
                    تطبيق الفلاتر
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">القسم</label>
                  <select
                    value={filters.departmentId}
                    onChange={(event) => handleDepartmentChange(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="all">جميع الأقسام</option>
                    {filtersSource?.filters.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name} ({formatNumber(department.count)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">المرحلة الدراسية</label>
                  <select
                    value={filters.stageId}
                    onChange={(event) => handleStageChange(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    disabled={!stageOptions.length}
                  >
                    <option value="all">جميع المراحل</option>
                    {stageOptions.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name} ({formatNumber(isDepartmentStage(stage) ? stage.total : stage.count)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">الفصل الدراسي</label>
                  <select
                    value={filters.semesterId}
                    onChange={(event) => handleFilterChange('semesterId', event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    disabled={!semesterOptions.length}
                  >
                    <option value="all">جميع الفصول</option>
                    {semesterOptions.map((semester) => (
                      <option key={semester.id} value={semester.id}>
                        {semester.name} ({formatNumber(semester.count)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">السنة الأكاديمية</label>
                  <select
                    value={filters.academicYear}
                    onChange={(event) => handleFilterChange('academicYear', event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    disabled={!academicYearOptions.length}
                  >
                    <option value="all">كل السنوات</option>
                    {academicYearOptions.map((year) => (
                      <option key={year.key} value={year.key || 'undefined'}>
                        {year.label} ({formatNumber(year.count)})
                      </option>
                    ))}
                  </select>
                </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">حالة الطالب</label>
      <select
        value={filters.status}
        onChange={(event) => handleFilterChange('status', event.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        disabled={!statusOptions.length}
      >
        <option value="all">جميع الحالات</option>
        {statusOptions.map((status) => {
          const rawLabel = status.label || status.key || 'غير محدد';
          return (
            <option key={status.key} value={status.key}>
              {localizeStatusLabel(rawLabel)} ({formatNumber(status.count)})
            </option>
          );
        })}
      </select>
    </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">الجنس</label>
                  <select
                    value={filters.gender}
                    onChange={(event) => handleFilterChange('gender', event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    disabled={!genderOptions.length}
                  >
                    <option value="all">الجميع</option>
                    {genderOptions.map((gender) => (
                      <option key={gender.key} value={gender.key}>
                        {GENDER_LABELS[gender.key] || gender.label} ({formatNumber(gender.count)})
                      </option>
                    ))}
                  </select>
                </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">قناة القبول</label>
      <select
        value={filters.admissionChannel}
        onChange={(event) => handleFilterChange('admissionChannel', event.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        disabled={!admissionChannelOptions.length}
      >
        <option value="all">جميع القنوات</option>
        {admissionChannelOptions.map((channel) => {
          const rawLabel = channel.label || channel.key || 'غير محدد';
          return (
            <option key={channel.key} value={channel.key}>
              {localizeAdmissionChannelLabel(rawLabel)} ({formatNumber(channel.count)})
            </option>
          );
        })}
      </select>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">نوع الدراسة</label>
      <select
        value={filters.studyType}
        onChange={(event) => handleFilterChange('studyType', event.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        disabled={!studyTypeOptions.length}
      >
        <option value="all">جميع الأنماط</option>
        {studyTypeOptions.map((studyType) => {
          const rawLabel = studyType.label || studyType.key || 'غير محدد';
          return (
            <option key={studyType.key} value={studyType.key}>
              {localizeStudyTypeLabel(rawLabel)} ({formatNumber(studyType.count)})
            </option>
          );
        })}
      </select>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">حالة الدفع</label>
      <select
        value={filters.paymentStatus}
        onChange={(event) => handleFilterChange('paymentStatus', event.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        disabled={!paymentStatusOptions.length}
      >
        <option value="all">كل الحالات</option>
        {paymentStatusOptions.map((paymentStatus) => {
          const rawLabel = paymentStatus.label || paymentStatus.key || 'غير محدد';
          return (
            <option key={paymentStatus.key} value={paymentStatus.key}>
              {localizePaymentStatusLabel(rawLabel)} ({formatNumber(paymentStatus.count)})
            </option>
          );
        })}
      </select>
    </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="font-semibold">حدث خطأ أثناء تحميل البيانات</p>
                  <p className="text-sm mt-1">{error}</p>
                </div>
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-100 transition-colors"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">إحصائية الطلبة</h2>
                <p className="text-sm text-gray-500">جميع الأرقام مبنية على البيانات الفعلية داخل النظام مع المرشحات الحالية.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleExport('csv')}
                  disabled={!reportData || isExporting}
                  className={`px-4 py-2 rounded-lg border border-purple-500 text-purple-600 hover:bg-purple-50 transition-colors ${
                    (!reportData || isExporting) && 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  تصدير جدول البيانات
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  disabled={!reportData || isExporting}
                  className={`px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors ${
                    (!reportData || isExporting) && 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  تصدير تقرير PDF
                </button>
              </div>
            </div>

            {isLoading && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="bg-white rounded-lg shadow-lg p-6 animate-pulse h-28" />
                ))}
              </div>
            )}

            {reportData && (
              <div ref={reportContentRef} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-blue-600 text-xl">👥</span>
                      </div>
                      <div className="mr-4">
                        <p className="text-sm font-medium text-gray-600">إجمالي الطلاب</p>
                        <p className="text-2xl font-bold text-gray-900">{formatNumber(reportData.totals.totalStudents)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                        <span className="text-green-600 text-xl">👨</span>
                      </div>
                      <div className="mr-4">
                        <p className="text-sm font-medium text-gray-600">الذكور</p>
                        <p className="text-2xl font-bold text-gray-900">{formatNumber(reportData.totals.male ?? 0)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center">
                        <span className="text-pink-600 text-xl">👩</span>
                      </div>
                      <div className="mr-4">
                        <p className="text-sm font-medium text-gray-600">الإناث</p>
                        <p className="text-2xl font-bold text-gray-900">{formatNumber(reportData.totals.female ?? 0)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <span className="text-purple-600 text-xl">🎓</span>
                      </div>
                      <div className="mr-4">
                        <p className="text-sm font-medium text-gray-600">الطلبة الجدد</p>
                        <p className="text-2xl font-bold text-gray-900">{formatNumber(reportData.newStudentsCount)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">التوزيع حسب الأقسام</h3>
                    <div className="space-y-3">
                      {reportData.breakdown.departments.map((department) => (
                        <div key={department.id} className="flex items-center justify-between">
                          <div className="text-sm text-gray-700">{department.name}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{formatNumber(department.count)}</span>
                            <span className="text-xs text-gray-500">({formatPercentage(department.percentage)})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">التوزيع حسب المراحل</h3>
                    <div className="space-y-3">
                      {reportData.breakdown.stages.map((stage) => (
                        <div key={stage.id} className="flex items-center justify-between">
                          <div className="text-sm text-gray-700">{stage.name}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{formatNumber(stage.count)}</span>
                            <span className="text-xs text-gray-500">({formatPercentage(stage.percentage)})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">التوزيع حسب الفصول الدراسية</h3>
                  {reportData.breakdown.semesters.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {reportData.breakdown.semesters.map((semester) => (
                        <div key={semester.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="text-sm font-medium text-gray-700">{semester.stageName}</div>
                          <div className="text-lg font-semibold text-gray-900 mt-1">{semester.name}</div>
                          <div className="text-sm text-gray-600 mt-2">{formatNumber(semester.count)} طالب</div>
                          <div className="text-xs text-gray-500">({formatPercentage(semester.percentage)})</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">لا توجد بيانات للفصول الدراسية ضمن هذه الترشيحات.</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  <StatsCard title="توزيع الجنس" items={formattedGenders} />
                  <StatsCard title="حالات الطالب" items={formattedStatuses} />
                  <StatsCard title="قنوات القبول" items={formattedAdmissionChannels} />
                  <StatsCard title="أنماط الدراسة" items={formattedStudyTypes} />
                  <StatsCard title="السنوات الأكاديمية" items={formattedAcademicYears} />
                  <StatsCard title="حالات الدفع" items={formattedPaymentStatuses} />
                </div>
              </div>
            )}

            {!reportData && !isLoading && !error && (
              <div className="bg-white rounded-lg shadow-lg p-6 text-center text-gray-500">
                لا توجد بيانات مطابقة للمرشحات الحالية.
              </div>
            )}
          </div>
        )}

        {activeTab !== 'students' && (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center text-gray-500">
            سيتم تفعيل هذا التقرير قريباً بعد إكمال بياناته التفصيلية.
          </div>
        )}
      </div>
    </div>
  );
}

type StatsCardProps = {
  title: string;
  items: Array<{ label: string; count: string; percentage: string }>;
};

function StatsCard({ title, items }: StatsCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${title}-${item.label}`} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{item.count}</span>
                <span className="text-xs text-gray-500">({item.percentage})</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">لا توجد بيانات متاحة.</p>
      )}
    </div>
  );
}