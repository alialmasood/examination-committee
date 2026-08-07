'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StudentFormModal from '../students/components/StudentFormModal';
import {
  buildApplicationPrintHtml,
  type ApplicationSnapshot,
  type PrintMode,
} from '@/src/lib/student-application-print';
import { buildBrowserPublicApplicationUrl } from '@/src/lib/site-url';

const DEPARTMENTS = [
  'تقنيات التخدير',
  'تقنيات الاشعة',
  'تقنيات صناعة الاسنان',
  'هندسة تقنيات البناء والانشاءات',
  'تقنيات هندسة النفط والغاز',
  'تقنيات الفيزياء الصحية',
  'تقنيات البصريات',
  'تقنيات صحة المجتمع',
  'تقنيات طب الطوارئ',
  'تقنيات العلاج الطبيعي',
  'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
  'القانون',
];

type RegistrationRow = {
  id: string;
  code: string;
  full_name: string;
  national_id: string;
  phone: string;
  preference_1: string;
  preference_2: string;
  preference_3: string;
  study_type: string;
  academic_year: string;
  status: string;
  confirmed_department?: string | null;
  student_id?: string | null;
  university_id?: string | null;
  payload?: ApplicationSnapshot;
  created_at: string;
};

type Stats = {
  total: number;
  today: number;
  morning: number;
  evening: number;
  byDepartment: { dept: string; count: number }[];
};

export default function NewRegistrationsPage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [studyType, setStudyType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    today: 0,
    morning: 0,
    evening: 0,
    byDepartment: [],
  });
  const [showForm, setShowForm] = useState(false);
  const [editRegistrationId, setEditRegistrationId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [confirmRow, setConfirmRow] = useState<RegistrationRow | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const closeActionMenu = () => {
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  const openActionMenu = (rowId: string, button: HTMLButtonElement) => {
    if (openMenuId === rowId) {
      closeActionMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 168;
    const menuHeight = 200;
    const gap = 4;
    let top = rect.bottom + gap;
    let left = rect.right - menuWidth;

    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - gap);
    }
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }

    setMenuPosition({ top, left });
    setOpenMenuId(rowId);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    if (searchParams.get('openForm') === 'new') {
      setEditRegistrationId(null);
      setShowForm(true);
      window.history.replaceState({}, '', '/student-affairs/new-registrations');
    }
  }, [searchParams]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode === 'new_application' || !detail?.mode) {
        setEditRegistrationId(null);
        setShowForm(true);
      }
    };
    window.addEventListener('openAddStudentModal', handler);
    return () => window.removeEventListener('openAddStudentModal', handler);
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const onScrollOrResize = () => closeActionMenu();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [openMenuId]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        page: String(page),
        limit: '40',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (department) params.set('department', department);
      if (studyType) params.set('study_type', studyType);

      const res = await fetch(`/api/new-registrations?${params}`);
      const data = await res.json();
      if (!data.success) {
        setRows([]);
        setError(data.error || 'تعذر جلب الطلبات');
        return;
      }
      setRows(data.rows || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.total_pages || 1);
      setStats(
        data.stats || {
          total: 0,
          today: 0,
          morning: 0,
          evening: 0,
          byDepartment: [],
        }
      );
    } catch (err) {
      console.error(err);
      setError('تعذر الاتصال بالخادم');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, department, studyType]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const topDepartments = useMemo(() => stats.byDepartment.slice(0, 6), [stats.byDepartment]);
  const openMenuRow = useMemo(
    () => (openMenuId ? rows.find((r) => r.id === openMenuId) || null : null),
    [openMenuId, rows]
  );

  const printHtmlDocument = (html: string) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'عرض استمارة الطالب');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe);
      alert('تعذر فتح الاستمارة');
      return;
    }
    const htmlNoAuto = html.replace(/window\.onload\s*=\s*function\s*\(\)\s*\{[\s\S]*?\};\s*/m, '');
    doc.open();
    doc.write(htmlNoAuto);
    doc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1500);
      }
    }, 700);
  };

  const handleView = async (row: RegistrationRow) => {
    closeActionMenu();
    try {
      let snapshot = row.payload;
      if (!snapshot) {
        const res = await fetch(`/api/new-registrations/${row.id}`);
        const data = await res.json();
        if (!data.success) {
          alert(data.error || 'تعذر جلب الاستمارة');
          return;
        }
        snapshot = data.data?.payload;
      }
      if (!snapshot) {
        alert('لا توجد بيانات استمارة لهذا الطلب');
        return;
      }
      const publicUrl = buildBrowserPublicApplicationUrl(row.code);
      const html = buildApplicationPrintHtml({
        snapshot,
        code: row.code,
        publicUrl,
        mode: 'form' as PrintMode,
        autoPrint: false,
      });
      printHtmlDocument(html);
    } catch (err) {
      console.error(err);
      alert('تعذر عرض الاستمارة');
    }
  };

  const handleEdit = (row: RegistrationRow) => {
    closeActionMenu();
    if (row.status === 'confirmed') {
      alert('لا يمكن تعديل طلب مثبت');
      return;
    }
    setEditRegistrationId(row.id);
    setShowForm(true);
  };

  const handleDelete = async (row: RegistrationRow) => {
    closeActionMenu();
    if (row.status === 'confirmed') {
      alert('لا يمكن حذف طلب مثبت');
      return;
    }
    if (!window.confirm(`هل تريد حذف طلب «${row.full_name}»؟`)) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/new-registrations/${row.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'تعذر الحذف');
        return;
      }
      void fetchData();
    } catch (err) {
      console.error(err);
      alert('تعذر الاتصال بالخادم');
    } finally {
      setActionLoading(false);
    }
  };

  const openConfirm = (row: RegistrationRow) => {
    closeActionMenu();
    if (row.status === 'confirmed') {
      alert('الطلب مثبت مسبقاً');
      return;
    }
    setConfirmRow(row);
    setSelectedDepartment(row.preference_1 || '');
  };

  const submitConfirm = async () => {
    if (!confirmRow || !selectedDepartment) {
      alert('اختر قسماً للتثبيت');
      return;
    }
    try {
      setActionLoading(true);
      const res = await fetch(`/api/new-registrations/${confirmRow.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department: selectedDepartment }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'تعذر تثبيت الطلب');
        return;
      }
      setConfirmRow(null);
      setSelectedDepartment('');
      void fetchData();
      alert(
        data.message ||
          `تم التثبيت بنجاح\nالرقم الجامعي: ${data.student?.university_id || ''}`
      );
    } catch (err) {
      console.error(err);
      alert('تعذر الاتصال بالخادم');
    } finally {
      setActionLoading(false);
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'confirmed') return 'مثبت';
    return 'قيد الانتظار';
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-[#053E37]">شؤون الطلبة</p>
          <h1 className="text-2xl font-bold text-slate-800">التسجيل الجديد</h1>
          <p className="mt-1 text-sm text-slate-600">طلبات التسجيل برغبات ثلاثية قبل الاعتماد الرسمي</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditRegistrationId(null);
            setShowForm(true);
          }}
          className="rounded-lg bg-[#E8913A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d17c28]"
        >
          تسجيل طالب جديد
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-[#053E37]/20 bg-gradient-to-l from-[#053E37]/10 to-white p-4 shadow-sm">
          <p className="text-xs text-[#053E37]">إجمالي الطلبات</p>
          <p className="mt-1 text-2xl font-bold text-[#053E37]">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-[#E8913A]/30 bg-gradient-to-l from-[#E8913A]/10 to-white p-4 shadow-sm">
          <p className="text-xs text-[#b86f1f]">طلبات اليوم</p>
          <p className="mt-1 text-2xl font-bold text-[#E8913A]">{stats.today}</p>
        </div>
        <div className="rounded-xl border border-[#053E37]/15 bg-gradient-to-l from-emerald-50 to-white p-4 shadow-sm">
          <p className="text-xs text-[#053E37]">صباحي</p>
          <p className="mt-1 text-2xl font-bold text-[#053E37]">{stats.morning}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-gradient-to-l from-amber-50 to-white p-4 shadow-sm">
          <p className="text-xs text-amber-700">مسائي</p>
          <p className="mt-1 text-2xl font-bold text-amber-800">{stats.evening}</p>
        </div>
      </div>

      {topDepartments.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-slate-800">أكثر الأقسام اختياراً في الرغبات</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topDepartments.map((item) => (
              <div
                key={item.dept}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <span className="text-xs font-medium text-slate-700">{item.dept}</span>
                <span className="rounded-full bg-[#053E37]/15 px-2 py-0.5 text-xs font-bold text-[#E8913A]">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">بحث</label>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="الاسم، الهوية، الهاتف، الرمز..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-[#053E37] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">القسم (ضمن الرغبات)</label>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-[#053E37] focus:bg-white"
            >
              <option value="">كل الأقسام</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">نوع الدراسة</label>
            <select
              value={studyType}
              onChange={(e) => {
                setStudyType(e.target.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-[#053E37] focus:bg-white"
            >
              <option value="">الكل</option>
              <option value="morning">صباحي</option>
              <option value="evening">مسائي</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead className="bg-[#053E37] text-white">
              <tr className="border-b-4 border-[#E8913A]">
                <th className="px-3 py-3 text-xs font-semibold">#</th>
                <th className="px-3 py-3 text-xs font-semibold">الرمز</th>
                <th className="px-3 py-3 text-xs font-semibold">الاسم</th>
                <th className="px-3 py-3 text-xs font-semibold">الهوية</th>
                <th className="px-3 py-3 text-xs font-semibold">الهاتف</th>
                <th className="px-3 py-3 text-xs font-semibold">الرغبة 1</th>
                <th className="px-3 py-3 text-xs font-semibold">الرغبة 2</th>
                <th className="px-3 py-3 text-xs font-semibold">الرغبة 3</th>
                <th className="px-3 py-3 text-xs font-semibold">الدراسة</th>
                <th className="px-3 py-3 text-xs font-semibold">الحالة</th>
                <th className="px-3 py-3 text-xs font-semibold">التاريخ</th>
                <th className="px-3 py-3 text-xs font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                    جاري التحميل...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                    لا توجد طلبات مطابقة
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const isConfirmed = row.status === 'confirmed';
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}`}
                    >
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {(page - 1) * 40 + index + 1}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-[#E8913A]" dir="ltr">
                        {row.code}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.full_name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">
                        {row.national_id || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">
                        {row.phone || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">{row.preference_1 || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{row.preference_2 || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{row.preference_3 || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.study_type === 'morning'
                          ? 'صباحي'
                          : row.study_type === 'evening'
                            ? 'مسائي'
                            : row.study_type || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            isConfirmed
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {statusLabel(row.status)}
                        </span>
                        {isConfirmed && row.confirmed_department ? (
                          <div className="mt-1 text-[10px] text-slate-500">{row.confirmed_department}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleDateString('ar-IQ')
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={(e) => openActionMenu(row.id, e.currentTarget)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          إجراء
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-600">
            الصفحة {page} من {totalPages} · {total} طلب
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50"
            >
              التالي
            </button>
          </div>
        </div>
      </div>

      {openMenuRow && menuPosition && (
        <div className="fixed inset-0 z-[9998]">
          <div className="absolute inset-0" onClick={closeActionMenu} />
          <div
            className="fixed overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              width: 168,
              zIndex: 10000,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="block w-full px-3 py-2.5 text-right text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => void handleView(openMenuRow)}
            >
              عرض
            </button>
            {openMenuRow.status !== 'confirmed' ? (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-2.5 text-right text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => handleEdit(openMenuRow)}
                >
                  تعديل
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2.5 text-right text-xs font-semibold text-[#053E37] hover:bg-emerald-50"
                  onClick={() => openConfirm(openMenuRow)}
                >
                  تثبيت
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2.5 text-right text-xs text-red-600 hover:bg-red-50"
                  onClick={() => void handleDelete(openMenuRow)}
                >
                  حذف
                </button>
              </>
            ) : (
              <div className="border-t border-slate-100 px-3 py-2.5 text-[11px] text-slate-500">
                مثبت · {openMenuRow.university_id || '—'}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" dir="rtl">
            <h3 className="text-lg font-bold text-slate-800">تثبيت الطلب</h3>
            <p className="mt-2 text-sm text-slate-600">
              اختر قسماً واحداً من رغبات «{confirmRow.full_name}» لإنشاء طالب رسمي وترحيله للحسابات.
              سيبقى الطلب بحالة <strong>مثبت</strong>.
            </p>
            <div className="mt-4 space-y-2">
              {[confirmRow.preference_1, confirmRow.preference_2, confirmRow.preference_3]
                .filter(Boolean)
                .map((dept) => (
                  <label
                    key={dept}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      selectedDepartment === dept
                        ? 'border-[#053E37] bg-[#053E37]/5'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="confirm-dept"
                      checked={selectedDepartment === dept}
                      onChange={() => setSelectedDepartment(dept)}
                    />
                    <span>{dept}</span>
                  </label>
                ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  setConfirmRow(null);
                  setSelectedDepartment('');
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={actionLoading || !selectedDepartment}
                onClick={() => void submitConfirm()}
                className="rounded-lg bg-[#053E37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#042e29] disabled:opacity-50"
              >
                {actionLoading ? 'جاري التثبيت...' : 'تأكيد التثبيت'}
              </button>
            </div>
          </div>
        </div>
      )}

      <StudentFormModal
        isOpen={showForm}
        mode="new_application"
        editRegistrationId={editRegistrationId}
        onClose={() => {
          setShowForm(false);
          setEditRegistrationId(null);
        }}
        onSuccess={() => {
          setShowForm(false);
          setEditRegistrationId(null);
          void fetchData();
        }}
      />
    </div>
  );
}
