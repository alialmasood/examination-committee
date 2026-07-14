'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  FEE_CATEGORY_LABEL,
  formatMoney,
  studentApi,
  type Pagination,
  type StudentFeeTypeItem,
  type StudentOptions,
} from '../components/types';

const CATEGORIES = [
  'TUITION',
  'REGISTRATION',
  'LAB',
  'EXAM',
  'SERVICE',
  'TRANSPORT',
  'ACCOMMODATION',
  'OTHER',
] as const;

export default function StudentFeeTypesPage() {
  const [rows, setRows] = useState<StudentFeeTypeItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 50,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [activeOnly, setActiveOnly] = useState('true');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<StudentOptions | null>(null);

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<StudentFeeTypeItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name_ar: '',
    category: 'TUITION',
    revenue_gl_account_id: '',
    default_amount: '',
    is_tuition: true,
    is_refundable: false,
    description: '',
  });

  const loadOptions = useCallback(async () => {
    const res = await studentApi<StudentOptions>('/api/accounts/student-options');
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '50',
    });
    if (q.trim()) params.set('q', q.trim());
    if (category) params.set('category', category);
    if (activeOnly) params.set('is_active', activeOnly);
    const res = await studentApi<StudentFeeTypeItem[]>(
      `/api/accounts/student-fee-types?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل أنواع الرسوم');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, category, activeOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      code: '',
      name_ar: '',
      category: 'TUITION',
      revenue_gl_account_id: '',
      default_amount: '',
      is_tuition: true,
      is_refundable: false,
      description: '',
    });
    setModal(true);
  };

  const openEdit = (row: StudentFeeTypeItem) => {
    setEditing(row);
    setForm({
      code: row.code,
      name_ar: row.name_ar,
      category: row.category,
      revenue_gl_account_id: row.revenue_gl_account_id,
      default_amount: row.default_amount ? String(row.default_amount) : '',
      is_tuition: row.is_tuition,
      is_refundable: row.is_refundable,
      description: row.description || '',
    });
    setModal(true);
  };

  const save = async () => {
    setSaving(true);
    setSuccess(null);
    if (editing) {
      const res = await studentApi(`/api/accounts/student-fee-types/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: editing.version,
          updated_at: editing.updated_at,
          name_ar: form.name_ar,
          category: form.category,
          revenue_gl_account_id: form.revenue_gl_account_id,
          default_amount: form.default_amount || null,
          is_tuition: form.is_tuition,
          is_refundable: form.is_refundable,
          description: form.description,
        }),
      });
      setSaving(false);
      if (!res.success) {
        setError(res.message || 'تعذر التعديل');
        return;
      }
      setSuccess('تم تحديث نوع الرسم');
    } else {
      const res = await studentApi('/api/accounts/student-fee-types', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          default_amount: form.default_amount || undefined,
        }),
      });
      setSaving(false);
      if (!res.success) {
        setError(res.message || 'تعذر الإنشاء');
        return;
      }
      setSuccess('تم إنشاء نوع الرسم');
    }
    setModal(false);
    void load();
  };

  const deactivate = async (row: StudentFeeTypeItem) => {
    if (!window.confirm(`تعطيل نوع الرسم ${row.code}؟`)) return;
    const res = await studentApi(`/api/accounts/student-fee-types/${row.id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ version: row.version, updated_at: row.updated_at }),
    });
    if (!res.success) {
      setError(res.message || 'تعذر التعطيل');
      return;
    }
    setSuccess('تم التعطيل');
    void load();
  };

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">أنواع الرسوم</h1>
          <p className="text-sm text-gray-600 mt-1">يجب ربط كل نوع بحساب إيراد REVENUE ترحيلي</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 bg-red-900 text-white text-sm rounded-md hover:bg-red-800"
        >
          نوع رسم جديد
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

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="بحث بالرمز / الاسم"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">كل الفئات</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {FEE_CATEGORY_LABEL[c] || c}
            </option>
          ))}
        </select>
        <select
          value={activeOnly}
          onChange={(e) => {
            setPage(1);
            setActiveOnly(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">الكل</option>
          <option value="true">فعّال فقط</option>
          <option value="false">معطّل فقط</option>
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
              <th className="px-3 py-2 text-right font-medium">الرمز</th>
              <th className="px-3 py-2 text-right font-medium">الاسم</th>
              <th className="px-3 py-2 text-right font-medium">الفئة</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ الافتراضي</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
              <th className="px-3 py-2 text-right font-medium">إجراءات</th>
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
                  لا توجد أنواع رسوم
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{row.code}</td>
                  <td className="px-3 py-2">{row.name_ar}</td>
                  <td className="px-3 py-2">{FEE_CATEGORY_LABEL[row.category] || row.category}</td>
                  <td className="px-3 py-2">{formatMoney(row.default_amount)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {row.is_active ? 'فعّال' : 'معطّل'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => openEdit(row)}
                      >
                        تعديل
                      </button>
                      {row.is_active && (
                        <button
                          type="button"
                          className="text-xs text-red-800 underline"
                          onClick={() => void deactivate(row)}
                        >
                          تعطيل
                        </button>
                      )}
                    </div>
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

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-4">
              {editing ? 'تعديل نوع رسم' : 'نوع رسم جديد'}
            </h2>
            <div className="space-y-3">
              {!editing && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">الرمز</label>
                  <input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-600 mb-1">الاسم بالعربية</label>
                <input
                  value={form.name_ar}
                  onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">الفئة</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {FEE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">حساب الإيراد</label>
                <select
                  value={form.revenue_gl_account_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, revenue_gl_account_id: e.target.value }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {(options?.revenue_gl_accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">المبلغ الافتراضي</label>
                <input
                  value={form.default_amount}
                  onChange={(e) => setForm((f) => ({ ...f, default_amount: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_tuition}
                  onChange={(e) => setForm((f) => ({ ...f, is_tuition: e.target.checked }))}
                />
                قسط دراسي
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_refundable}
                  onChange={(e) => setForm((f) => ({ ...f, is_refundable: e.target.checked }))}
                />
                قابل للاسترداد
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setModal(false)} className="px-3 py-2 border rounded-md text-sm">
                إلغاء
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !form.name_ar ||
                  !form.revenue_gl_account_id ||
                  (!editing && !form.code)
                }
                onClick={() => void save()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
