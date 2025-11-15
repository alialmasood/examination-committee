'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StudentHistoryMeta, StudentHistorySummary } from '@/src/lib/types/student-history';

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
  applicant: 'متقدم',
  accepted: 'مقبول',
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

const PAGE_SIZE = 10;

export default function StudentHistoryPage() {
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
 
   const [students, setStudents] = useState<StudentHistorySummary[]>([]);
   const [filtersMeta, setFiltersMeta] = useState<StudentHistoryMeta>({
     years: [],
     departments: [],
     stages: [],
     statuses: [],
   });
   const [isLoading, setIsLoading] = useState<boolean>(false);
   const [error, setError] = useState<string | null>(null);
   const [page, setPage] = useState<number>(1);
   const [total, setTotal] = useState<number>(0);
   const [totalPages, setTotalPages] = useState<number>(1);
  const router = useRouter();

  const yearOptions = useMemo(
    () =>
      filtersMeta.years.map((year) => ({
        value: year,
        label: year,
      })),
    [filtersMeta.years]
  );

  const departmentOptions = useMemo(
    () =>
      filtersMeta.departments.map((department) => ({
        value: department,
        label: department,
      })),
    [filtersMeta.departments]
  );

  const stageOptions = useMemo(
    () =>
      filtersMeta.stages.map((stageCode) => ({
        value: stageCode,
        label: STAGE_LABELS[stageCode] ?? stageCode,
      })),
    [filtersMeta.stages]
  );

  const statusOptions = useMemo(
    () =>
      filtersMeta.statuses.map((statusCode) => ({
        value: statusCode,
        label: STATUS_LABELS[statusCode] ?? statusCode,
      })),
    [filtersMeta.statuses]
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [selectedYear, selectedDepartment, selectedStage, selectedStatus, debouncedSearch]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedYear !== 'all') params.set('year', selectedYear);
    if (selectedDepartment !== 'all') params.set('department', selectedDepartment);
    if (selectedStage !== 'all') params.set('stage', selectedStage);
    if (selectedStatus !== 'all') params.set('status', selectedStatus);
    if (debouncedSearch) params.set('search', debouncedSearch);
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    return params.toString();
  }, [selectedYear, selectedDepartment, selectedStage, selectedStatus, debouncedSearch, page]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const queryString = buildQueryString();
        const response = await fetch(`/api/students/history?${queryString}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('فشل في جلب سجل الطلبة');
        }

        const payload = await response.json();
        if (!payload.success) {
          throw new Error(payload.error || 'تعذر جلب البيانات');
        }

        setFiltersMeta({
          years: payload.meta?.years ?? [],
          departments: payload.meta?.departments ?? [],
          stages: payload.meta?.stages ?? [],
          statuses: payload.meta?.statuses ?? [],
        });
        setStudents(payload.data.students);
        setPage(payload.data.page);
        setTotal(payload.data.total);
        setTotalPages(payload.data.totalPages);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('خطأ في تحميل سجل الطلبة:', err);
          setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
          setStudents([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => controller.abort();
  }, [buildQueryString]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleViewHistory = useCallback(
    (studentId: string) => {
      router.push(`/student-affairs/history/${studentId}`);
    },
    [router]
  );

  const hasResults = students.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-purple-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">السجل الأكاديمي للطلبة</h1>
          <p className="text-gray-600">
            تتبع رحلة الطالب عبر السنوات الدراسية والمراحل، واطلع على حالة التسجيل والمعدلات السابقة.
          </p>
        </header>

        <section className="bg-white rounded-xl shadow-lg border border-purple-100/60 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">مرشحات السجل</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">السنة الأكاديمية</label>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">جميع السنوات</option>
                {yearOptions.map((year) => (
                  <option key={year.value} value={year.value}>
                    {year.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">القسم</label>
              <select
                value={selectedDepartment}
                onChange={(event) => setSelectedDepartment(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">جميع الأقسام</option>
                {departmentOptions.map((department) => (
                  <option key={department.value} value={department.value}>
                    {department.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">المرحلة</label>
              <select
                value={selectedStage}
                onChange={(event) => setSelectedStage(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">جميع المراحل</option>
                {stageOptions.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">حالة الطالب</label>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">جميع الحالات</option>
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">بحث عن طالب</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ابحث باسم الطالب أو رقمه الجامعي"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-lg border border-purple-100/60">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">الطلبة المطابقون</h2>
              <p className="text-sm text-gray-500">
                سيتم هنا عرض الطلبة المسجلين في السنة والمرحلة المحددة، مع إمكانية استعراض السيرة الأكاديمية لكل طالب.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 rounded-lg border border-purple-500 text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-50"
                disabled={!hasResults}
              >
                تصدير النتائج
              </button>
              <button className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                إضافة ملاحظة عامة
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الطالب</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">السنة الأكاديمية</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">المرحلة</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">القسم</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الحالة</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">المعدل</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  [...Array(5)].map((_, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4">
                        <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                        <div className="h-3 w-24 bg-gray-100 rounded mt-2 animate-pulse" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                      </td>
                      <td className="px-6 py-4 text-left">
                        <div className="h-8 w-24 bg-gray-200 rounded-full animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : hasResults ? (
                  students.map((student) => (
                    <tr key={`${student.studentId}-${student.academicYear}`}>
                      <td className="px-6 py-2 whitespace-nowrap align-middle">
                        <div className="text-sm font-semibold text-gray-900 leading-tight">{student.fullName}</div>
                        <div className="text-xs text-gray-500 leading-tight mt-0.5">{student.universityId}</div>
                        {student.studyType && (
                          <div className="text-2xs text-gray-400 mt-0.5 leading-tight">
                            {STUDY_TYPE_LABELS[student.studyType] ?? student.studyType}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-700">{student.academicYear}</td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-700">{student.stage}</td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-700">{student.department}</td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-700">{student.statusLabel}</td>
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-700">
                        {student.gpa != null ? student.gpa.toFixed(2) : '—'}
                      </td>
                      <td className="px-6 py-2 whitespace-nowrap text-left">
                        <button
                          onClick={() => handleViewHistory(student.studentId)}
                          className="px-3 py-1.5 rounded-md bg-purple-100 text-purple-600 hover:bg-purple-200 text-sm font-medium transition-colors"
                        >
                          عرض السيرة
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {error || 'لا توجد بيانات مطابقة للمرشحات الحالية.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-6 py-4 border-t border-gray-100">
            <div className="text-sm text-gray-500">
              {hasResults ? (
                <>
                  عرض {students.length} من {total} طالب
                </>
              ) : (
                'لا توجد نتائج للعرض'
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(Math.max(page - 1, 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                السابقة
              </button>
              <span className="text-sm text-gray-600">
                صفحة {page} من {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(Math.min(page + 1, totalPages))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                التالية
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
