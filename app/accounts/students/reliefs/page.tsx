'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../components/StudentsNav';
import {
  formatDateOnly,
  formatMoney,
  RELIEF_OPTIONS_API,
  RELIEF_STATUS_LABEL,
  RELIEFS_API,
  reliefStatusBadge,
  studentApi,
  type Pagination,
  type ReliefOptions,
  type StudentReliefListItem,
} from '../components/types';

export default function StudentReliefsPage() {
  const [rows, setRows] = useState<StudentReliefListItem[]>([]);
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
  const [options, setOptions] = useState<ReliefOptions | null>(null);
  const [charges, setCharges] = useState<
    Array<{
      id: string;
      charge_number: string;
      outstanding_amount: string;
      student_account_id: string;
    }>
  >([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    student_charge_id: '',
    relief_type_id: '',
    calculation_type: 'FIXED_AMOUNT',
    requested_amount: '',
    percentage_value: '',
    reason: '',
  });

  const loadOptions = useCallback(async () => {
    const [opt, ch] = await Promise.all([
      studentApi<ReliefOptions>(RELIEF_OPTIONS_API),
      studentApi<
        Array<{
          id: string;
          charge_number: string;
          outstanding_amount: string;
          student_account_id: string;
        }>
      >('/api/accounts/student-charges?page_size=100&status=POSTED'),
    ]);
    if (opt.success && opt.data) setOptions(opt.data);
    const partial = await studentApi<
      Array<{
        id: string;
        charge_number: string;
        outstanding_amount: string;
        student_account_id: string;
      }>
    >('/api/accounts/student-charges?page_size=100&status=PARTIALLY_SETTLED');
    const all = [...(ch.data || []), ...(partial.data || [])];
    setCharges(all);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    const res = await studentApi<StudentReliefListItem[]>(
      `${RELIEFS_API}?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل التخفيضات');
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
    const body: Record<string, unknown> = {
      student_charge_id: form.student_charge_id,
      relief_type_id: form.relief_type_id,
      calculation_type: form.calculation_type,
      reason: form.reason,
    };
    if (form.calculation_type === 'PERCENTAGE') {
      body.percentage_value = form.percentage_value;
    } else {
      body.requested_amount = form.requested_amount;
    }
    const res = await studentApi(RELIEFS_API, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'فشل إنشاء المسودة');
      return;
    }
    setSuccess('تم إنشاء مسودة التخفيض');
    setCreateOpen(false);
    void load();
  };

  return (
    <div className="p-4 md:p-6" dir="rtl">
      <StudentsNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-red-900">الخصومات والمنح والإعفاءات</h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 bg-red-900 text-white rounded-md text-sm"
        >
          مسودة جديدة
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
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">كل الحالات</option>
          {(options?.statuses || []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.name_ar}
            </option>
          ))}
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
                <th className="px-3 py-2 text-right">الرقم</th>
                <th className="px-3 py-2 text-right">الطالب</th>
                <th className="px-3 py-2 text-right">المطالبة</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">المبلغ</th>
                <th className="px-3 py-2 text-right">التاريخ</th>
                <th className="px-3 py-2 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/accounts/students/reliefs/${r.id}`}
                      className="text-red-900 font-mono hover:underline"
                    >
                      {r.relief_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.student_full_name_ar || '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.charge_number}</td>
                  <td className="px-3 py-2">{r.relief_type_name_ar}</td>
                  <td className="px-3 py-2">
                    {formatMoney(r.approved_amount || r.requested_amount)}
                  </td>
                  <td className="px-3 py-2">{formatDateOnly(r.relief_date)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${reliefStatusBadge(r.status)}`}
                    >
                      {RELIEF_STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    لا توجد طلبات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-5" dir="rtl">
            <h2 className="text-lg font-bold text-red-900 mb-4">مسودة تخفيض جديدة</h2>
            <div className="space-y-3 text-sm">
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.student_charge_id}
                onChange={(e) =>
                  setForm({ ...form, student_charge_id: e.target.value })
                }
              >
                <option value="">المطالبة المالية</option>
                {charges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.charge_number} — متبقي {formatMoney(c.outstanding_amount)}
                  </option>
                ))}
              </select>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.relief_type_id}
                onChange={(e) =>
                  setForm({ ...form, relief_type_id: e.target.value })
                }
              >
                <option value="">نوع التخفيض</option>
                {(options?.relief_types || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name_ar}
                  </option>
                ))}
              </select>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.calculation_type}
                onChange={(e) =>
                  setForm({ ...form, calculation_type: e.target.value })
                }
              >
                <option value="FIXED_AMOUNT">مبلغ ثابت</option>
                <option value="PERCENTAGE">نسبة مئوية</option>
              </select>
              {form.calculation_type === 'PERCENTAGE' ? (
                <input
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="النسبة %"
                  value={form.percentage_value}
                  onChange={(e) =>
                    setForm({ ...form, percentage_value: e.target.value })
                  }
                />
              ) : (
                <input
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="المبلغ"
                  value={form.requested_amount}
                  onChange={(e) =>
                    setForm({ ...form, requested_amount: e.target.value })
                  }
                />
              )}
              <textarea
                className="w-full border rounded-md px-3 py-2"
                placeholder="السبب"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 border rounded-md"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void createDraft()}
                className="px-4 py-2 bg-red-900 text-white rounded-md disabled:opacity-50"
              >
                حفظ مسودة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
