'use client';

import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  formatMoney,
  RELIEF_KIND_LABEL,
  RELIEF_TYPES_API,
  studentApi,
  type Pagination,
  type ReliefOptions,
  type StudentReliefTypeItem,
} from '../components/types';

const KINDS = ['DISCOUNT', 'SCHOLARSHIP', 'WAIVER'] as const;
type CalcType = 'FIXED_AMOUNT' | 'PERCENTAGE';

export default function StudentReliefTypesPage() {
  const [rows, setRows] = useState<StudentReliefTypeItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 50,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [activeOnly, setActiveOnly] = useState('true');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<ReliefOptions | null>(null);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name_ar: '',
    relief_kind: 'DISCOUNT' as (typeof KINDS)[number],
    calculation_type: 'FIXED_AMOUNT' as CalcType,
    default_value: '',
    max_value: '',
    gl_account_id: '',
    requires_approval: true,
    description: '',
  });

  const loadOptions = useCallback(async () => {
    const res = await studentApi<ReliefOptions>('/api/accounts/student-reliefs/options');
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (q.trim()) params.set('q', q.trim());
    if (kind) params.set('relief_kind', kind);
    if (activeOnly) params.set('is_active', activeOnly);
    const res = await studentApi<StudentReliefTypeItem[]>(
      `${RELIEF_TYPES_API}?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل أنواع التخفيضات');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, kind, activeOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const createType = async () => {
    setSaving(true);
    const res = await studentApi(RELIEF_TYPES_API, {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'فشل الإنشاء');
      return;
    }
    setSuccess('تم إنشاء نوع التخفيض');
    setModal(false);
    void load();
  };

  const deactivate = async (id: string) => {
    const res = await studentApi(`${RELIEF_TYPES_API}/${id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res.success) {
      setError(res.message || 'فشل إلغاء التفعيل');
      return;
    }
    setSuccess('تم إلغاء تفعيل النوع');
    void load();
  };

  return (
    <div className="p-4 md:p-6" dir="rtl">
      <StudentsNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-red-900">أنواع التخفيضات والمنح</h1>
        <button
          type="button"
          onClick={() => setModal(true)}
          className="px-4 py-2 bg-red-900 text-white rounded-md text-sm"
        >
          نوع جديد
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-900 rounded-md text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-3 p-3 bg-green-50 text-green-900 rounded-md text-sm">{success}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="border rounded-md px-3 py-1.5 text-sm"
          placeholder="بحث..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="border rounded-md px-3 py-1.5 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">كل الأنواع</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {RELIEF_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          className="border rounded-md px-3 py-1.5 text-sm"
          value={activeOnly}
          onChange={(e) => setActiveOnly(e.target.value)}
        >
          <option value="true">فعّال فقط</option>
          <option value="false">غير فعّال</option>
          <option value="">الكل</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1.5 bg-gray-100 rounded-md text-sm"
        >
          تحديث
        </button>
      </div>

      {loading ? (
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-right">الرمز</th>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">الحساب</th>
                <th className="px-3 py-2 text-right">الافتراضي</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{r.code}</td>
                  <td className="px-3 py-2">{r.name_ar}</td>
                  <td className="px-3 py-2">
                    {RELIEF_KIND_LABEL[r.relief_kind as keyof typeof RELIEF_KIND_LABEL] ||
                      r.relief_kind}
                  </td>
                  <td className="px-3 py-2">
                    {r.gl_code} — {r.gl_name_ar}
                  </td>
                  <td className="px-3 py-2">{formatMoney(r.default_value)}</td>
                  <td className="px-3 py-2">
                    {r.is_active ? (
                      <span className="text-green-800">فعّال</span>
                    ) : (
                      <span className="text-gray-600">غير فعّال</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.is_active && (
                      <button
                        type="button"
                        onClick={() => void deactivate(r.id)}
                        className="text-red-900 text-xs underline"
                      >
                        إلغاء التفعيل
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    لا توجد أنواع
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pagination.total_pages > 1 && (
        <div className="flex gap-2 mt-4 justify-center">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded-md text-sm disabled:opacity-40"
          >
            السابق
          </button>
          <span className="text-sm py-1">
            {page} / {pagination.total_pages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.total_pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded-md text-sm disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-5" dir="rtl">
            <h2 className="text-lg font-bold text-red-900 mb-4">نوع تخفيض جديد</h2>
            <div className="space-y-3 text-sm">
              <input
                className="w-full border rounded-md px-3 py-2"
                placeholder="الرمز"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
              <input
                className="w-full border rounded-md px-3 py-2"
                placeholder="الاسم بالعربية"
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              />
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.relief_kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    relief_kind: e.target.value as (typeof KINDS)[number],
                  })
                }
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RELIEF_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.calculation_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    calculation_type: e.target.value as CalcType,
                  })
                }
              >
                <option value="FIXED_AMOUNT">مبلغ ثابت</option>
                <option value="PERCENTAGE">نسبة مئوية</option>
              </select>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.gl_account_id}
                onChange={(e) => setForm({ ...form, gl_account_id: e.target.value })}
              >
                <option value="">حساب مصروف التخفيض (EXPENSE)</option>
                {(options?.expense_gl_accounts || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} — {g.name_ar}
                  </option>
                ))}
              </select>
              <input
                className="w-full border rounded-md px-3 py-2"
                placeholder="القيمة الافتراضية"
                value={form.default_value}
                onChange={(e) => setForm({ ...form, default_value: e.target.value })}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.requires_approval}
                  onChange={(e) =>
                    setForm({ ...form, requires_approval: e.target.checked })
                  }
                />
                يتطلب اعتماداً
              </label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="px-4 py-2 border rounded-md"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void createType()}
                className="px-4 py-2 bg-red-900 text-white rounded-md disabled:opacity-50"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
