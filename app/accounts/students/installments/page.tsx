'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  formatDateOnly,
  formatMoney,
  INSTALLMENT_STATUS_LABEL,
  installmentStatusBadge,
  INSTALLMENTS_API,
  studentApi,
  type StudentInstallmentItem,
} from '../components/types';

type FlatInstallment = StudentInstallmentItem & {
  plan_number?: string;
  student_full_name_ar?: string | null;
  account_number?: string | null;
};

export default function StudentInstallmentsPage() {
  const [rows, setRows] = useState<FlatInstallment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      plan_status: 'ACTIVE',
      page_size: '100',
    });
    if (statusFilter) params.set('status', statusFilter);
    if (q.trim()) params.set('q', q.trim());

    const res = await studentApi<FlatInstallment[]>(
      `${INSTALLMENTS_API}?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الأقساط');
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(res.data || []);
    setError(null);
    setLoading(false);
  }, [q, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6" dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">الأقساط</h1>
        <p className="text-sm text-gray-600 mt-1">
          أقساط الخطط الفعّالة — قائمة موحّدة من واجهة الأقساط
        </p>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث بالطالب / الخطة / رقم القسط"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">كل الحالات</option>
          <option value="PENDING">قادم</option>
          <option value="DUE">مستحق</option>
          <option value="PARTIALLY_PAID">مسدد جزئياً</option>
          <option value="PAID">مسدد</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm hover:bg-gray-50"
        >
          تحديث
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-right font-medium">الخطة</th>
              <th className="px-3 py-2 text-right font-medium">الطالب</th>
              <th className="px-3 py-2 text-right font-medium">#</th>
              <th className="px-3 py-2 text-right font-medium">الاستحقاق</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ</th>
              <th className="px-3 py-2 text-right font-medium">المتبقي</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  لا توجد أقساط
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-gray-100 ${
                    row.due_date < today && row.status !== 'PAID'
                      ? 'bg-red-50/50'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/accounts/students/billing-plans/${row.billing_plan_id}`}
                      className="text-red-900 hover:underline"
                    >
                      {row.plan_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {row.student_full_name_ar || row.account_number || '—'}
                  </td>
                  <td className="px-3 py-2">{row.installment_number}</td>
                  <td className="px-3 py-2">{formatDateOnly(row.due_date)}</td>
                  <td className="px-3 py-2">{formatMoney(row.amount)}</td>
                  <td className="px-3 py-2">{formatMoney(row.outstanding_amount)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${installmentStatusBadge(row.status)}`}
                    >
                      {INSTALLMENT_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
