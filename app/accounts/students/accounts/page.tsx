'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import SettlementModal, {
  type SettlementStudent,
} from '../components/SettlementModal';
import YearStatusBoxes, {
  YearStatusLegend,
} from '../components/YearStatusBoxes';
import {
  printStudentAccountsTable,
  type StudentAccountsExportData,
} from '../components/printStudentAccountsTable';
import {
  paymentCategoryFromYearStatus,
  type YearVisualEntry,
} from '../lib/settlementYearLedger';

type PaidStudentRow = SettlementStudent;

type DepartmentStat = {
  id: string;
  name: string;
  total: number;
  totalAmount: number;
};

type StudentYearStatus = {
  current_year: number | null;
  all_completed: boolean;
  years: YearVisualEntry[];
  receipts_count?: number;
};

function formatStage(admissionType?: string | null): string {
  switch (admissionType) {
    case 'first':
      return 'الأولى';
    case 'second':
      return 'الثانية';
    case 'third':
      return 'الثالثة';
    case 'fourth':
      return 'الرابعة';
    default:
      return 'غير محدد';
  }
}

function formatStudyType(studyType?: string | null): string {
  switch (String(studyType || '').toLowerCase()) {
    case 'morning':
    case 'صباحي':
      return 'صباحي';
    case 'evening':
    case 'مسائي':
      return 'مسائي';
    default:
      return studyType?.trim() || '—';
  }
}

function normalizeDeptName(value?: string | null): string {
  return String(value || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

/** مقارن أبجدي عربي يتجاهل فروق الهمزات والتاء المربوطة */
const arabicNameCollator = new Intl.Collator('ar', { sensitivity: 'base' });

function normalizeArabicName(value?: string | null): string {
  return String(value || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function compareStudentsByName(
  a: { name?: string | null },
  b: { name?: string | null }
): number {
  const nameA = normalizeArabicName(a.name);
  const nameB = normalizeArabicName(b.name);
  // الأسماء الفارغة في نهاية القائمة
  if (!nameA && !nameB) return 0;
  if (!nameA) return 1;
  if (!nameB) return -1;
  return arabicNameCollator.compare(nameA, nameB);
}

export default function StudentAccountsPage() {
  const [rows, setRows] = useState<PaidStudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settlementStudent, setSettlementStudent] =
    useState<SettlementStudent | null>(null);
  const [yearStatusByStudent, setYearStatusByStudent] = useState<
    Record<string, StudentYearStatus>
  >({});
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterStudyType, setFilterStudyType] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<
    '' | 'settled' | 'partial' | 'unpaid'
  >('');
  const [filterFeeYear, setFilterFeeYear] = useState<'' | 1 | 2 | 3 | 4>('');
  const [tablePage, setTablePage] = useState(1);
  const [yearStatusReady, setYearStatusReady] = useState(false);
  const PAGE_SIZE = 50;

  function getPaymentCategory(
    studentId: string
  ): 'settled' | 'partial' | 'unpaid' {
    return paymentCategoryFromYearStatus(
      yearStatusByStudent[studentId],
      filterFeeYear || undefined
    );
  }

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError('');
    try {
      const [paidRes, deptRes, yearRes] = await Promise.all([
        fetch('/api/accounts/installments/paid/list', {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch('/api/departments/stats?academic_year=all', {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch('/api/accounts/student-settlements/year-status', {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);

      const paidBody = await paidRes.json().catch(() => ({}));
      const deptBody = await deptRes.json().catch(() => ({}));
      const yearBody = await yearRes.json().catch(() => ({}));

      const errors: string[] = [];

      if (!paidRes.ok || !paidBody.success) {
        errors.push(
          paidBody.error || paidBody.message || 'تعذر تحميل قائمة الطلبة المسددين'
        );
        setRows([]);
      } else {
        setRows(Array.isArray(paidBody.data) ? paidBody.data : []);
      }

      if (deptRes.ok && deptBody.success && Array.isArray(deptBody.data)) {
        setDepartments(deptBody.data);
      } else {
        setDepartments([]);
      }

      if (yearRes.ok && yearBody.success && yearBody.data) {
        setYearStatusByStudent(yearBody.data as Record<string, StudentYearStatus>);
        setYearStatusReady(true);
      } else {
        setYearStatusByStudent({});
        setYearStatusReady(false);
        setFilterPaymentStatus('');
        setFilterFeeYear('');
        errors.push(
          yearBody.error ||
            'تعذر تحميل حالة التسديد — فلتر مسدّدون/جزئي/غير مسدّدين غير موثوق حالياً'
        );
      }

      setError(errors.join(' · '));
    } catch {
      setError('تعذر الاتصال بالخادم');
      setRows([]);
      setDepartments([]);
      setYearStatusByStudent({});
      setYearStatusReady(false);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const paidCountByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const dept of departments) {
      const key = normalizeDeptName(dept.name);
      const count = rows.filter(
        (row) => normalizeDeptName(row.department) === key
      ).length;
      map.set(dept.id, count);
    }
    return map;
  }, [departments, rows]);

  const departmentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      const name = row.department?.trim();
      if (name) names.add(name);
    }
    for (const dept of departments) {
      if (dept.name?.trim()) names.add(dept.name.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [rows, departments]);

  const sortedRows = useMemo(
    () => [...rows].sort(compareStudentsByName),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedRows.filter((row) => {
      if (filterDepartment && row.department?.trim() !== filterDepartment) {
        return false;
      }
      if (filterStage && String(row.admission_type || '') !== filterStage) {
        return false;
      }
      if (filterStudyType) {
        const st = String(row.study_type || '').toLowerCase();
        if (filterStudyType === 'morning') {
          if (st !== 'morning' && st !== 'صباحي') return false;
        } else if (filterStudyType === 'evening') {
          if (st !== 'evening' && st !== 'مسائي') return false;
        }
      }
      if (filterPaymentStatus) {
        if (getPaymentCategory(row.id) !== filterPaymentStatus) return false;
      }
      if (!q) return true;
      const name = (row.name || '').toLowerCase();
      const uni = (row.university_id || '').toLowerCase();
      const dept = (row.department || '').toLowerCase();
      return name.includes(q) || uni.includes(q) || dept.includes(q);
    });
  }, [
    sortedRows,
    searchQuery,
    filterDepartment,
    filterStage,
    filterStudyType,
    filterPaymentStatus,
    filterFeeYear,
    yearStatusByStudent,
  ]);

  const totalTablePages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  const pagedRows = useMemo(() => {
    const safePage = Math.min(Math.max(tablePage, 1), totalTablePages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, tablePage, totalTablePages]);

  useEffect(() => {
    setTablePage(1);
  }, [
    searchQuery,
    filterDepartment,
    filterStage,
    filterStudyType,
    filterPaymentStatus,
    filterFeeYear,
  ]);

  useEffect(() => {
    if (tablePage > totalTablePages) {
      setTablePage(totalTablePages);
    }
  }, [tablePage, totalTablePages]);

  const pageRangeLabel = useMemo(() => {
    if (filteredRows.length === 0) return '0';
    const safePage = Math.min(Math.max(tablePage, 1), totalTablePages);
    const start = (safePage - 1) * PAGE_SIZE + 1;
    const end = Math.min(safePage * PAGE_SIZE, filteredRows.length);
    return `${start}–${end}`;
  }, [filteredRows.length, tablePage, totalTablePages]);

  const hasActiveFilters =
    !!searchQuery.trim() ||
    !!filterDepartment ||
    !!filterStage ||
    !!filterStudyType ||
    !!filterPaymentStatus ||
    !!filterFeeYear;

  /** أعداد الصباحي/المسائي وفق الفلاتر الأخرى (بدون نوع الدراسة) */
  const studyTypeCounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let morning = 0;
    let evening = 0;
    let other = 0;
    for (const row of sortedRows) {
      if (filterDepartment && row.department?.trim() !== filterDepartment) {
        continue;
      }
      if (filterStage && String(row.admission_type || '') !== filterStage) {
        continue;
      }
      if (filterPaymentStatus) {
        if (getPaymentCategory(row.id) !== filterPaymentStatus) continue;
      }
      if (q) {
        const name = (row.name || '').toLowerCase();
        const uni = (row.university_id || '').toLowerCase();
        const dept = (row.department || '').toLowerCase();
        if (!name.includes(q) && !uni.includes(q) && !dept.includes(q)) {
          continue;
        }
      }
      const st = String(row.study_type || '').toLowerCase();
      if (st === 'morning' || st === 'صباحي') morning += 1;
      else if (st === 'evening' || st === 'مسائي') evening += 1;
      else other += 1;
    }
    return {
      morning,
      evening,
      all: morning + evening + other,
    };
  }, [
    sortedRows,
    searchQuery,
    filterDepartment,
    filterStage,
    filterPaymentStatus,
    filterFeeYear,
    yearStatusByStudent,
  ]);

  /** أعداد حالة التسديد وفق الفلاتر الأخرى (بدون حالة التسديد) */
  const paymentStatusCounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let settled = 0;
    let partial = 0;
    let unpaid = 0;
    for (const row of sortedRows) {
      if (filterDepartment && row.department?.trim() !== filterDepartment) {
        continue;
      }
      if (filterStage && String(row.admission_type || '') !== filterStage) {
        continue;
      }
      if (filterStudyType) {
        const st = String(row.study_type || '').toLowerCase();
        if (filterStudyType === 'morning') {
          if (st !== 'morning' && st !== 'صباحي') continue;
        } else if (filterStudyType === 'evening') {
          if (st !== 'evening' && st !== 'مسائي') continue;
        }
      }
      if (q) {
        const name = (row.name || '').toLowerCase();
        const uni = (row.university_id || '').toLowerCase();
        const dept = (row.department || '').toLowerCase();
        if (!name.includes(q) && !uni.includes(q) && !dept.includes(q)) {
          continue;
        }
      }
      const cat = getPaymentCategory(row.id);
      if (cat === 'settled') settled += 1;
      else if (cat === 'partial') partial += 1;
      else unpaid += 1;
    }
    return {
      settled,
      partial,
      unpaid,
      all: settled + partial + unpaid,
    };
  }, [
    sortedRows,
    searchQuery,
    filterDepartment,
    filterStage,
    filterStudyType,
    filterFeeYear,
    yearStatusByStudent,
  ]);

  function resetFilters() {
    setSearchQuery('');
    setFilterDepartment('');
    setFilterStage('');
    setFilterStudyType('');
    setFilterPaymentStatus('');
    setFilterFeeYear('');
    setTablePage(1);
  }

  function buildExportQuery(): string {
    const params = new URLSearchParams();
    const q = searchQuery.trim();
    if (q) params.set('search', q);
    if (filterDepartment) params.set('department', filterDepartment);
    if (filterStage) params.set('stage', filterStage);
    if (filterStudyType) params.set('study_type', filterStudyType);
    if (filterPaymentStatus) params.set('payment_status', filterPaymentStatus);
    if (filterFeeYear) params.set('fee_year', String(filterFeeYear));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  async function handleExportExcel() {
    setExporting('excel');
    try {
      const res = await fetch(
        `/api/accounts/students/export/excel${buildExportQuery()}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      if (!res.ok) {
        alert('تعذر تصدير ملف الإكسل');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `حسابات-الطلبة-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('تعذر الاتصال بالخادم لتصدير الإكسل');
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPdf() {
    setExporting('pdf');
    try {
      const res = await fetch(
        `/api/accounts/students/export/data${buildExportQuery()}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success || !body.data) {
        alert(body.error || 'تعذر تحميل بيانات التقرير');
        return;
      }
      printStudentAccountsTable(body.data as StudentAccountsExportData);
    } catch {
      alert('تعذر الاتصال بالخادم لتوليد التقرير');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">الحسابات</h1>
        <p className="text-sm text-gray-600 mt-1">
          الطلبة الذين تم تأكيد دفعهم من صفحة الأقساط
        </p>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-500 text-sm">جارٍ التحميل…</div>
      ) : (
        <>
          {departments.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">الأقسام</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {departments.map((dept) => {
                  const paidCount = paidCountByDepartment.get(dept.id) || 0;
                  return (
                    <Link
                      key={dept.id}
                      href={`/accounts/students/accounts/departments/${dept.id}`}
                      className="text-right bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-red-300 transition-all block"
                    >
                      <div className="flex items-center justify-between mb-3 gap-2">
                        <h3 className="text-base font-bold text-gray-800 leading-snug">
                          {dept.name}
                        </h3>
                        <span className="text-sm font-semibold text-gray-600 shrink-0">
                          {paidCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-sm text-gray-600">المسددون</span>
                        <span className="text-sm font-bold text-emerald-700">
                          {paidCount} طالب
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-sm text-gray-600">إجمالي المبالغ</span>
                        <span className="text-sm font-bold text-gray-800">
                          {money(dept.totalAmount || 0)} IQD
                        </span>
                      </div>
                      <p className="text-[11px] text-red-800/80 pt-2">
                        اضغط لعرض تفاصيل القسم ←
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {rows.length === 0 && !error ? (
            <div className="py-12 text-center border border-dashed border-gray-300 rounded-lg">
              <p className="text-gray-700 font-medium">لا يوجد طلبة مسددون حالياً</p>
              <p className="text-sm text-gray-500 mt-1">
                يظهر هنا الطلبة بعد تأكيد الدفع من صفحة الأقساط.
              </p>
            </div>
          ) : rows.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
                <div className="bg-red-950 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-red-100/80">بحث وفلترة</p>
                    <p className="text-sm font-semibold">قائمة الطلبة المسددين</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-red-100/90 ml-2">
                      النتائج: {filteredRows.length} من {rows.length}
                      {filteredRows.length > 0
                        ? ` · عرض ${pageRangeLabel}`
                        : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleExportExcel()}
                      disabled={exporting !== null}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {exporting === 'excel' ? 'جارٍ التصدير…' : 'تصدير Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExportPdf()}
                      disabled={exporting !== null}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-red-950 hover:bg-red-50 disabled:opacity-50"
                    >
                      {exporting === 'pdf' ? 'جارٍ التجهيز…' : 'تصدير PDF'}
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-4">
                      <label className="block text-xs text-gray-500 mb-1">
                        بحث
                      </label>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="الاسم أو رقم الطالب…"
                        className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm leading-none focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">
                        القسم
                      </label>
                      <select
                        value={filterDepartment}
                        onChange={(e) => setFilterDepartment(e.target.value)}
                        className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm leading-none focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
                      >
                        <option value="">الكل</option>
                        {departmentOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">
                        المرحلة
                      </label>
                      <select
                        value={filterStage}
                        onChange={(e) => setFilterStage(e.target.value)}
                        className="box-border h-10 w-full border border-gray-300 rounded-md px-3 text-sm leading-none focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
                      >
                        <option value="">الكل</option>
                        <option value="first">الأولى</option>
                        <option value="second">الثانية</option>
                        <option value="third">الثالثة</option>
                        <option value="fourth">الرابعة</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">
                        نوع الدراسة
                      </label>
                      <div
                        className="flex w-full rounded-md border border-gray-300 overflow-hidden"
                        role="group"
                        aria-label="فلتر نوع الدراسة"
                      >
                        {(
                          [
                            {
                              value: '',
                              label: 'الكل',
                              count: studyTypeCounts.all,
                            },
                            {
                              value: 'morning',
                              label: 'صباحي',
                              count: studyTypeCounts.morning,
                            },
                            {
                              value: 'evening',
                              label: 'مسائي',
                              count: studyTypeCounts.evening,
                            },
                          ] as const
                        ).map((opt, idx) => {
                          const active = filterStudyType === opt.value;
                          return (
                            <button
                              key={opt.value || 'all'}
                              type="button"
                              onClick={() => setFilterStudyType(opt.value)}
                              className={[
                                'flex-1 h-10 px-2 text-sm font-semibold whitespace-nowrap transition-colors',
                                idx > 0 ? 'border-r border-gray-300' : '',
                                active
                                  ? 'bg-red-950 text-white'
                                  : 'bg-white text-gray-700 hover:bg-gray-100',
                              ].join(' ')}
                            >
                              {opt.label}
                              <span
                                className={[
                                  'mr-1 inline-flex min-w-[1.1rem] justify-center rounded px-1 text-[11px] font-bold',
                                  active
                                    ? 'bg-white/20 text-white'
                                    : 'bg-gray-100 text-gray-600',
                                ].join(' ')}
                              >
                                {opt.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="sm:col-span-12">
                      <label className="block text-xs text-gray-500 mb-1">
                        سنة القسط
                        <span className="text-gray-400 mr-1">
                          (تقييم حالة التسديد حسب السنة — الافتراضي: الجارية)
                        </span>
                      </label>
                      <div
                        className="flex w-full rounded-md border border-gray-300 overflow-hidden"
                        role="group"
                        aria-label="فلتر سنة القسط"
                      >
                        {(
                          [
                            { value: '' as const, label: 'الجارية' },
                            { value: 1 as const, label: 'الأولى' },
                            { value: 2 as const, label: 'الثانية' },
                            { value: 3 as const, label: 'الثالثة' },
                            { value: 4 as const, label: 'الرابعة' },
                          ] as const
                        ).map((opt, idx) => {
                          const active = filterFeeYear === opt.value;
                          const disabled = !yearStatusReady && opt.value !== '';
                          return (
                            <button
                              key={opt.value === '' ? 'fee-year-current' : `fee-year-${opt.value}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => setFilterFeeYear(opt.value)}
                              className={[
                                'flex-1 h-10 px-2 text-sm font-semibold whitespace-nowrap transition-colors',
                                idx > 0 ? 'border-r border-gray-300' : '',
                                disabled
                                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                  : active
                                    ? 'bg-red-950 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100',
                              ].join(' ')}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="sm:col-span-12">
                      <label className="block text-xs text-gray-500 mb-1">
                        حالة التسديد
                        {!yearStatusReady ? (
                          <span className="text-amber-600 mr-1">
                            (غير متاحة حالياً)
                          </span>
                        ) : null}
                      </label>
                      <div
                        className="flex w-full rounded-md border border-gray-300 overflow-hidden"
                        role="group"
                        aria-label="فلتر حالة التسديد"
                      >
                        {(
                          [
                            {
                              value: '' as const,
                              label: 'الكل',
                              count: paymentStatusCounts.all,
                            },
                            {
                              value: 'settled' as const,
                              label: 'مسدّدون',
                              count: paymentStatusCounts.settled,
                            },
                            {
                              value: 'partial' as const,
                              label: 'تسديد جزئي',
                              count: paymentStatusCounts.partial,
                            },
                            {
                              value: 'unpaid' as const,
                              label: 'غير مسدّدين',
                              count: paymentStatusCounts.unpaid,
                            },
                          ] as const
                        ).map((opt, idx) => {
                          const active = filterPaymentStatus === opt.value;
                          const disabled = !yearStatusReady && opt.value !== '';
                          return (
                            <button
                              key={opt.value || 'payment-all'}
                              type="button"
                              disabled={disabled}
                              onClick={() => setFilterPaymentStatus(opt.value)}
                              className={[
                                'flex-1 h-10 px-2 text-sm font-semibold whitespace-nowrap transition-colors',
                                idx > 0 ? 'border-r border-gray-300' : '',
                                disabled
                                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                  : active
                                    ? 'bg-red-950 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100',
                              ].join(' ')}
                            >
                              {opt.label}
                              <span
                                className={[
                                  'mr-1 inline-flex min-w-[1.1rem] justify-center rounded px-1 text-[11px] font-bold',
                                  active && !disabled
                                    ? 'bg-white/20 text-white'
                                    : 'bg-gray-100 text-gray-600',
                                ].join(' ')}
                              >
                                {opt.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
                  <YearStatusLegend />
                  <button
                    type="button"
                    onClick={resetFilters}
                    disabled={!hasActiveFilters}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    إعادة تعيين
                  </button>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-gray-300 rounded-lg bg-white">
                  <p className="text-gray-700 font-medium">لا توجد نتائج مطابقة</p>
                  <p className="text-sm text-gray-500 mt-1">
                    عدّل البحث أو الفلاتر ثم أعد المحاولة.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-red-950 text-white">
                        <tr>
                          <th className="px-3 py-2.5 text-right font-medium">التسلسل</th>
                          <th className="px-3 py-2.5 text-right font-medium">اسم الطالب</th>
                          <th className="px-3 py-2.5 text-right font-medium">الوصولات</th>
                          <th className="px-3 py-2.5 text-right font-medium">المرحلة</th>
                          <th className="px-3 py-2.5 text-right font-medium">القسم</th>
                          <th className="px-3 py-2.5 text-right font-medium">نوع الدراسة</th>
                          <th className="px-3 py-2.5 text-right font-medium">رقم الطالب</th>
                          <th className="px-3 py-2.5 text-right font-medium">إجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pagedRows.map((row, index) => {
                          const rowNumber =
                            (Math.min(Math.max(tablePage, 1), totalTablePages) - 1) *
                              PAGE_SIZE +
                            index +
                            1;
                          const receiptsCount =
                            yearStatusByStudent[row.id]?.receipts_count ?? 0;
                          return (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-700">{rowNumber}</td>
                            <td className="px-3 py-2.5 font-medium text-gray-900">
                              <div className="flex items-center gap-2 min-w-0">
                                <YearStatusBoxes
                                  years={yearStatusByStudent[row.id]?.years}
                                />
                                {row.name?.trim() ? (
                                  <Link
                                    href={`/accounts/students/accounts/student/${row.id}`}
                                    className="text-red-900 hover:underline truncate"
                                  >
                                    {row.name.trim()}
                                  </Link>
                                ) : (
                                  <span>—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className={[
                                  'inline-flex min-w-[2.25rem] justify-center rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums',
                                  receiptsCount > 0
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : 'bg-slate-50 border-slate-200 text-slate-500',
                                ].join(' ')}
                                title="عدد وصولات التسديد المقطوعة"
                              >
                                {receiptsCount}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {formatStage(row.admission_type)}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {row.department?.trim() || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {formatStudyType(row.study_type)}
                            </td>
                            <td
                              className="px-3 py-2.5 font-mono text-xs text-gray-800"
                              dir="ltr"
                            >
                              {row.university_id?.trim() || '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                onClick={() => setSettlementStudent(row)}
                                className="inline-flex items-center rounded-md bg-red-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
                              >
                                تسديد
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <p className="text-sm text-gray-600">
                      عرض {pageRangeLabel} من {filteredRows.length} طالب
                      <span className="mx-1 text-gray-400">·</span>
                      الصفحة {Math.min(tablePage, totalTablePages)} من {totalTablePages}
                      <span className="mx-1 text-gray-400">·</span>
                      50 صف لكل صفحة
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                        disabled={tablePage <= 1}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        السابق
                      </button>
                      <span className="inline-flex min-w-10 items-center justify-center rounded-md bg-red-900 px-3 py-1.5 text-sm font-semibold text-white">
                        {Math.min(tablePage, totalTablePages)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setTablePage((page) => Math.min(totalTablePages, page + 1))
                        }
                        disabled={tablePage >= totalTablePages}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        التالي
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      <SettlementModal
        open={!!settlementStudent}
        student={settlementStudent}
        onClose={() => setSettlementStudent(null)}
        onSaved={() => {
          setSettlementStudent(null);
          // البقاء في نفس الصفحة مع الحفاظ على الفلاتر، وتحديث البيانات بصمت
          void load({ silent: true });
        }}
      />
    </div>
  );
}
