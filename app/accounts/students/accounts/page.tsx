'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  ACCOUNT_STATUS_LABEL,
  accountStatusBadge,
  studentApi,
  type Pagination,
  type StudentAccountListItem,
  type StudentOptions,
} from '../components/types';

export default function StudentAccountsListPage() {
  const [rows, setRows] = useState<StudentAccountListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 20,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [hasBalance, setHasBalance] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    student_id: '',
    receivable_gl_account_id: '',
    academic_year: '',
    notes: '',
  });

  const loadOptions = useCallback(async () => {
    const res = await studentApi<StudentOptions>('/api/accounts/student-options?student_limit=50');
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (hasBalance) params.set('has_balance', hasBalance);
    const res = await studentApi<StudentAccountListItem[]>(
      `/api/accounts/student-accounts?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الحسابات');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, status, hasBalance]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const createAccount = async () => {
    setSaving(true);
    setSuccess(null);
    const res = await studentApi('/api/accounts/student-accounts', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'تعذر إنشاء الحساب');
      return;
    }
    setModal(false);
    setSuccess('تم إنشاء الحساب المالي');
    setForm({ student_id: '', receivable_gl_account_id: '', academic_year: '', notes: '' });
    void load();
  };

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">الحسابات المالية للطلبة</h1>
          <p className="text-sm text-gray-600 mt-1">حساب واحد لكل طالب/عملة · ترقيم STA</p>
        </div>
        <button
          type="button"
          onClick={() => setModal(true)}
          className="px-4 py-2 bg-red-900 text-white text-sm rounded-md hover:bg-red-800"
        >
          حساب جديد
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

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="بحث بالاسم / الرقم الجامعي / رقم الحساب"
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
            <option value="ACTIVE">نشط</option>
            <option value="SUSPENDED">معلّق</option>
            <option value="CLOSED">مغلق</option>
          </select>
          <select
            value={hasBalance}
            onChange={(e) => {
              setPage(1);
              setHasBalance(e.target.value);
            }}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">كل الأرصدة</option>
            <option value="true">له رصيد</option>
            <option value="false">رصيد صفر</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm hover:bg-gray-50"
          >
            تحديث
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-right font-medium">رقم الحساب</th>
              <th className="px-3 py-2 text-right font-medium">الطالب</th>
              <th className="px-3 py-2 text-right font-medium">الرقم الجامعي</th>
              <th className="px-3 py-2 text-right font-medium">القسم/التخصص</th>
              <th className="px-3 py-2 text-right font-medium">المرحلة</th>
              <th className="px-3 py-2 text-right font-medium">حساب الذمم</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
              <th className="px-3 py-2 text-right font-medium">العملة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  لا توجد حسابات
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/accounts/students/accounts/${row.id}`}
                      className="text-red-900 font-medium hover:underline"
                    >
                      {row.account_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.student_full_name_ar || '—'}</td>
                  <td className="px-3 py-2">
                    {row.student_university_id || row.student_number || '—'}
                  </td>
                  <td className="px-3 py-2">{row.student_major || '—'}</td>
                  <td className="px-3 py-2">{row.student_admission_type || '—'}</td>
                  <td className="px-3 py-2">
                    {row.receivable_gl_code
                      ? `${row.receivable_gl_code} — ${row.receivable_gl_name_ar || ''}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs ${accountStatusBadge(row.status)}`}
                    >
                      {ACCOUNT_STATUS_LABEL[row.status] || row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.currency_code}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
        <span>
          صفحة {pagination.page} من {pagination.total_pages} · الإجمالي {pagination.total}
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

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-4">إنشاء حساب مالي للطالب</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">الطالب</label>
                <select
                  value={form.student_id}
                  onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر طالباً</option>
                  {(options?.students || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name_ar} ({s.university_id || s.student_number})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">حساب الذمم (أصل)</label>
                <select
                  value={form.receivable_gl_account_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, receivable_gl_account_id: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر حساباً</option>
                  {(options?.receivable_gl_accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">السنة الدراسية</label>
                <input
                  value={form.academic_year}
                  onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ملاحظات</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
              <p className="text-xs text-gray-500">
                العملة IQD فقط في هذه المرحلة. الرصيد الافتتاحي المرجعي لا يُحتسب في الدفتر.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="px-3 py-2 text-sm border rounded-md"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving || !form.student_id || !form.receivable_gl_account_id}
                onClick={() => void createAccount()}
                className="px-3 py-2 text-sm bg-red-900 text-white rounded-md disabled:opacity-40"
              >
                {saving ? 'جاري الحفظ...' : 'إنشاء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
