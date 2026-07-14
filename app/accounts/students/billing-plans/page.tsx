'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  BILLING_PLAN_API,
  BILLING_PLAN_STATUS_LABEL,
  billingPlanStatusBadge,
  formatMoney,
  studentApi,
  type Pagination,
  type StudentBillingPlanListItem,
  type StudentOptions,
} from '../components/types';

export default function StudentBillingPlansPage() {
  const [rows, setRows] = useState<StudentBillingPlanListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 20,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; account_number: string; student_full_name_ar?: string | null }>
  >([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    student_account_id: '',
    fee_type_id: '',
    total_amount: '',
    installment_count: '4',
    split_mode: 'equal' as 'equal' | 'manual',
    first_due_date: '2026-01-15',
    description: '',
  });

  const loadOptions = useCallback(async () => {
    const [opt, acc] = await Promise.all([
      studentApi<StudentOptions>('/api/accounts/student-options'),
      studentApi<
        Array<{ id: string; account_number: string; student_full_name_ar?: string | null }>
      >('/api/accounts/student-accounts?page_size=100&status=ACTIVE'),
    ]);
    if (opt.success && opt.data) setOptions(opt.data);
    if (acc.success) setAccounts(acc.data || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    const res = await studentApi<StudentBillingPlanListItem[]>(
      `${BILLING_PLAN_API}?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل خطط الرسوم');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const createDraft = async () => {
    setSaving(true);
    setSuccess(null);
    const body: Record<string, unknown> = {
      student_account_id: form.student_account_id,
      fee_type_id: form.fee_type_id,
      total_amount: form.total_amount,
      description: form.description,
    };
    if (form.split_mode === 'equal') {
      body.installment_count = Number(form.installment_count);
      body.first_due_date = form.first_due_date;
    }
    const res = await studentApi<{ id: string }>(BILLING_PLAN_API, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'تعذر إنشاء المسودة');
      return;
    }
    setCreateOpen(false);
    setSuccess('تم إنشاء خطة رسوم مسودة');
    void load();
    const planId = (res.data as { id?: string } | undefined)?.id;
    if (planId) {
      window.location.href = `/accounts/students/billing-plans/${planId}`;
    }
  };

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">خطط الرسوم</h1>
          <p className="text-sm text-gray-600 mt-1">
            مسودة → تفعيل (مطالبة لكل قسط) → متابعة السداد
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 bg-red-900 text-white text-sm rounded-md hover:bg-red-800"
        >
          خطة مسودة
        </button>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="بحث برقم الخطة / البيان"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">كل الحالات</option>
          <option value="DRAFT">مسودة</option>
          <option value="ACTIVE">فعّالة</option>
          <option value="COMPLETED">مكتملة</option>
          <option value="CANCELLED">ملغاة</option>
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
              <th className="px-3 py-2 text-right font-medium">الرقم</th>
              <th className="px-3 py-2 text-right font-medium">الطالب</th>
              <th className="px-3 py-2 text-right font-medium">نوع الرسم</th>
              <th className="px-3 py-2 text-right font-medium">الإجمالي</th>
              <th className="px-3 py-2 text-right font-medium">الأقساط</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  لا توجد خطط
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/accounts/students/billing-plans/${row.id}`}
                      className="text-red-900 font-medium hover:underline"
                    >
                      {row.plan_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {row.student_full_name_ar || row.account_number || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.fee_type_code
                      ? `${row.fee_type_code} — ${row.fee_type_name_ar || ''}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{formatMoney(row.total_amount)}</td>
                  <td className="px-3 py-2">{row.installment_count}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${billingPlanStatusBadge(row.status)}`}
                    >
                      {BILLING_PLAN_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
        <span>
          صفحة {pagination.page} من {pagination.total_pages} · {pagination.total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            السابق
          </button>
          <button
            type="button"
            disabled={page >= pagination.total_pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-4">إنشاء خطة رسوم مسودة</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">الحساب المالي</label>
                <select
                  value={form.student_account_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, student_account_id: e.target.value }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} — {a.student_full_name_ar || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">نوع الرسم</label>
                <select
                  value={form.fee_type_id}
                  onChange={(e) => {
                    const fee = options?.fee_types.find((f) => f.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      fee_type_id: e.target.value,
                      total_amount: fee?.default_amount
                        ? String(fee.default_amount)
                        : f.total_amount,
                    }));
                  }}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {(options?.fee_types || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} — {f.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">إجمالي الخطة</label>
                <input
                  value={form.total_amount}
                  onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">طريقة التقسيم</label>
                <select
                  value={form.split_mode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      split_mode: e.target.value as 'equal' | 'manual',
                    }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="equal">أقساط متساوية</option>
                  <option value="manual">يدوي (بعد الإنشاء)</option>
                </select>
              </div>
              {form.split_mode === 'equal' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">عدد الأقساط</label>
                    <input
                      type="number"
                      min={1}
                      value={form.installment_count}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, installment_count: e.target.value }))
                      }
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      تاريخ استحقاق أول قسط
                    </label>
                    <input
                      type="date"
                      value={form.first_due_date}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, first_due_date: e.target.value }))
                      }
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm text-gray-600 mb-1">البيان</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !form.student_account_id ||
                  !form.fee_type_id ||
                  !form.total_amount ||
                  !form.description.trim()
                }
                onClick={() => void createDraft()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ مسودة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
