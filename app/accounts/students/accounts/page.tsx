'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import StudentsNav from '../components/StudentsNav';

type PaidStudentRow = {
  id: string;
  university_id: string | null;
  name: string | null;
  department: string | null;
  study_type: string | null;
  admission_type: string | null;
};

type DepartmentStat = {
  id: string;
  name: string;
  total: number;
  totalAmount: number;
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

export default function StudentAccountsPage() {
  const [rows, setRows] = useState<PaidStudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [paidRes, deptRes] = await Promise.all([
        fetch('/api/accounts/installments/paid/list', {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch('/api/departments/stats?academic_year=all', {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);

      const paidBody = await paidRes.json().catch(() => ({}));
      const deptBody = await deptRes.json().catch(() => ({}));

      if (!paidRes.ok || !paidBody.success) {
        setError(
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
    } catch {
      setError('تعذر الاتصال بالخادم');
      setRows([]);
      setDepartments([]);
    } finally {
      setLoading(false);
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

  return (
    <div className="p-6" dir="rtl">
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
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-red-950 text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-right font-medium">التسلسل</th>
                    <th className="px-3 py-2.5 text-right font-medium">اسم الطالب</th>
                    <th className="px-3 py-2.5 text-right font-medium">المرحلة</th>
                    <th className="px-3 py-2.5 text-right font-medium">القسم</th>
                    <th className="px-3 py-2.5 text-right font-medium">نوع الدراسة</th>
                    <th className="px-3 py-2.5 text-right font-medium">رقم الطالب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, index) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-700">{index + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">
                        {row.name?.trim() || '—'}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
