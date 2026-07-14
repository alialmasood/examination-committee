'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StudentsNav from '../components/StudentsNav';
import {
  COLLECTION_OPTIONS_API,
  COLLECTIONS_API,
  COLLECTION_STATUS_LABEL,
  collectionStatusBadge,
  formatDateOnly,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  studentApi,
  type AllocationPreviewRow,
  type CollectionOptions,
  type Pagination,
  type StudentCollectionListItem,
} from '../components/types';

export function StudentCollectionsPageInner() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const initialMethod = searchParams.get('payment_method') || '';

  const [rows, setRows] = useState<StudentCollectionListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 20,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [paymentMethod, setPaymentMethod] = useState(initialMethod);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<CollectionOptions | null>(null);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; account_number: string; student_full_name_ar?: string | null }>
  >([]);
  const [accountBalance, setAccountBalance] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewRows, setPreviewRows] = useState<AllocationPreviewRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);

  const [form, setForm] = useState({
    student_account_id: '',
    collection_date: '2026-01-15',
    amount: '',
    payment_method: 'CASH' as 'CASH' | 'BANK',
    cash_box_id: '',
    cash_box_session_id: '',
    bank_account_id: '',
    payer_name: '',
    description: '',
    auto_allocate: true,
  });

  const loadOptions = useCallback(async () => {
    const [opt, acc] = await Promise.all([
      studentApi<CollectionOptions>(COLLECTION_OPTIONS_API),
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
    if (paymentMethod) params.set('payment_method', paymentMethod);
    const res = await studentApi<StudentCollectionListItem[]>(
      `${COLLECTIONS_API}?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل التحصيلات');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, status, paymentMethod]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  useEffect(() => {
    if (!form.student_account_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear balance when account cleared
      setAccountBalance(null);
      return;
    }
    let cancelled = false;
    void studentApi<{ balance: string }>(
      `/api/accounts/student-accounts/${form.student_account_id}/summary`
    ).then((r) => {
      if (!cancelled && r.success && r.data) setAccountBalance(r.data.balance);
    });
    return () => {
      cancelled = true;
    };
  }, [form.student_account_id]);

  const amountNum = Number(form.amount || 0);
  const balanceNum = Number(accountBalance || 0);
  const overpayment = amountNum > balanceNum && balanceNum > 0;
  const invalidAmount = !Number.isFinite(amountNum) || amountNum <= 0;

  const cashSessionsForBox = useMemo(() => {
    if (!options || !form.cash_box_id) return [];
    return options.open_sessions.filter((s) => s.cash_box_id === form.cash_box_id);
  }, [options, form.cash_box_id]);

  const previewAllocation = async () => {
    if (!form.student_account_id || invalidAmount || overpayment) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewRows([]);

    const draftRes = await studentApi<{ id: string }>(COLLECTIONS_API, {
      method: 'POST',
      body: JSON.stringify({
        student_account_id: form.student_account_id,
        collection_date: form.collection_date,
        amount: form.amount,
        payment_method: form.payment_method,
        cash_box_id: form.payment_method === 'CASH' ? form.cash_box_id : undefined,
        cash_box_session_id:
          form.payment_method === 'CASH' ? form.cash_box_session_id : undefined,
        bank_account_id: form.payment_method === 'BANK' ? form.bank_account_id : undefined,
        payer_name: form.payer_name || undefined,
        description: form.description,
        auto_allocate: false,
      }),
    });

    if (!draftRes.success || !draftRes.data?.id) {
      setPreviewError(draftRes.message || 'تعذر إنشاء مسودة للمعاينة');
      setPreviewLoading(false);
      return;
    }

    const previewRes = await studentApi<AllocationPreviewRow[]>(
      `${COLLECTIONS_API}/${draftRes.data.id}/preview-allocation`,
      {
        method: 'POST',
        body: JSON.stringify({ amount: form.amount }),
      }
    );
    setPreviewLoading(false);
    if (!previewRes.success) {
      setPreviewError(previewRes.message || 'تعذر معاينة التخصيص');
      return;
    }
    setPreviewRows(Array.isArray(previewRes.data) ? previewRes.data : []);
  };

  const createDraft = async () => {
    if (!window.confirm('إنشاء تحصيل مسودة بالتخصيص التلقائي؟')) return;
    setSaving(true);
    setSuccess(null);
    const body: Record<string, unknown> = {
      student_account_id: form.student_account_id,
      collection_date: form.collection_date,
      amount: form.amount,
      payment_method: form.payment_method,
      payer_name: form.payer_name || undefined,
      description: form.description,
      auto_allocate: form.auto_allocate,
    };
    if (form.payment_method === 'CASH') {
      body.cash_box_id = form.cash_box_id;
      body.cash_box_session_id = form.cash_box_session_id;
    } else {
      body.bank_account_id = form.bank_account_id;
    }
    const res = await studentApi<{ id: string }>(COLLECTIONS_API, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || 'تعذر إنشاء التحصيل');
      return;
    }
    setCreateOpen(false);
    setConfirmPost(false);
    setSuccess('تم إنشاء تحصيل مسودة');
    void load();
    const collectionId = (res.data as { id?: string } | undefined)?.id;
    if (collectionId) {
      window.location.href = `/accounts/students/collections/${collectionId}`;
    }
  };

  const canSubmit =
    form.student_account_id &&
    form.description.trim() &&
    !invalidAmount &&
    !overpayment &&
    (form.payment_method === 'CASH'
      ? form.cash_box_id && form.cash_box_session_id
      : form.bank_account_id);

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">التحصيلات</h1>
          <p className="text-sm text-gray-600 mt-1">
            مسودة → ترحيل (سند قبض نقدي/مصرفي) → تخصيص المطالبات
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 bg-red-900 text-white text-sm rounded-md hover:bg-red-800"
        >
          تحصيل مسودة
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
          placeholder="بحث برقم التحصيل / الطالب"
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
          <option value="POSTED">مرحّل</option>
          <option value="VOID">ملغى</option>
        </select>
        <select
          value={paymentMethod}
          onChange={(e) => {
            setPage(1);
            setPaymentMethod(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">كل الطرق</option>
          <option value="CASH">نقدي</option>
          <option value="BANK">مصرفي</option>
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
              <th className="px-3 py-2 text-right font-medium">التاريخ</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ</th>
              <th className="px-3 py-2 text-right font-medium">الطريقة</th>
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
                  لا توجد تحصيلات
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/accounts/students/collections/${row.id}`}
                      className="text-red-900 font-medium hover:underline"
                    >
                      {row.collection_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {row.student_full_name_ar || row.account_number || '—'}
                  </td>
                  <td className="px-3 py-2">{formatDateOnly(row.collection_date)}</td>
                  <td className="px-3 py-2">{formatMoney(row.amount)}</td>
                  <td className="px-3 py-2">
                    {PAYMENT_METHOD_LABEL[row.payment_method]}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${collectionStatusBadge(row.status)}`}
                    >
                      {COLLECTION_STATUS_LABEL[row.status]}
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
          <div
            className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto"
            dir="rtl"
          >
            <h2 className="text-lg font-semibold mb-4">إنشاء تحصيل مسودة</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">الحساب المالي</label>
                <select
                  value={form.student_account_id}
                  onChange={(e) => {
                    setPreviewRows([]);
                    setForm((f) => ({ ...f, student_account_id: e.target.value }));
                  }}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} — {a.student_full_name_ar || ''}
                    </option>
                  ))}
                </select>
                {accountBalance != null && (
                  <p className="text-xs text-gray-500 mt-1">
                    الرصيد المستحق: {formatMoney(accountBalance)}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={form.collection_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, collection_date: e.target.value }))
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">المبلغ</label>
                  <input
                    value={form.amount}
                    onChange={(e) => {
                      setPreviewRows([]);
                      setForm((f) => ({ ...f, amount: e.target.value }));
                    }}
                    className={`w-full border rounded-md px-3 py-2 text-sm ${
                      overpayment ? 'border-red-400 bg-red-50' : ''
                    }`}
                  />
                  {overpayment && (
                    <p className="text-xs text-red-700 mt-1">
                      المبلغ أكبر من الرصيد المستحق — لا يُسمح بالدفع الزائد
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">طريقة الدفع</label>
                <select
                  value={form.payment_method}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      payment_method: e.target.value as 'CASH' | 'BANK',
                    }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="CASH">نقدي</option>
                  <option value="BANK">مصرفي</option>
                </select>
              </div>
              {form.payment_method === 'CASH' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">الصندوق</label>
                    <select
                      value={form.cash_box_id}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          cash_box_id: e.target.value,
                          cash_box_session_id: '',
                        }))
                      }
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">اختر</option>
                      {(options?.cash_boxes || []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">جلسة مفتوحة</label>
                    <select
                      value={form.cash_box_session_id}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cash_box_session_id: e.target.value }))
                      }
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">اختر</option>
                      {cashSessionsForBox.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.cash_box_code} — {s.session_date}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">الحساب المصرفي</label>
                  <select
                    value={form.bank_account_id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bank_account_id: e.target.value }))
                    }
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">اختر</option>
                    {(options?.bank_accounts || []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.account_name_ar} ({b.bank_name_ar})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-600 mb-1">اسم الدافع</label>
                <input
                  value={form.payer_name}
                  onChange={(e) => setForm((f) => ({ ...f, payer_name: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">البيان</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={previewLoading || !canSubmit}
                  onClick={() => void previewAllocation()}
                  className="px-3 py-2 text-sm border rounded-md disabled:opacity-40"
                >
                  {previewLoading ? 'جاري المعاينة...' : 'معاينة التخصيص'}
                </button>
              </div>
              {previewError && (
                <p className="text-sm text-red-700">{previewError}</p>
              )}
              {previewRows.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-right">المطالبة</th>
                        <th className="px-2 py-1 text-right">القسط</th>
                        <th className="px-2 py-1 text-right">المستحق</th>
                        <th className="px-2 py-1 text-right">المخصص</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((p) => (
                        <tr key={`${p.student_charge_id}-${p.student_installment_id}`} className="border-t">
                          <td className="px-2 py-1">{p.charge_number || '—'}</td>
                          <td className="px-2 py-1">{p.installment_number ?? '—'}</td>
                          <td className="px-2 py-1">{formatMoney(p.charge_outstanding)}</td>
                          <td className="px-2 py-1">{formatMoney(p.allocated_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setPreviewRows([]);
                  setPreviewError(null);
                }}
                className="px-3 py-2 border rounded-md text-sm"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving || !canSubmit}
                onClick={() => setConfirmPost(true)}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                حفظ مسودة
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmPost && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-2">تأكيد إنشاء التحصيل</h2>
            <p className="text-sm text-gray-600 mb-3">
              مبلغ {formatMoney(form.amount)} ·{' '}
              {PAYMENT_METHOD_LABEL[form.payment_method]} · تخصيص تلقائي
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmPost(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void createDraft()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {saving ? 'جاري الحفظ...' : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudentCollectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6" dir="rtl">
          <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
        </div>
      }
    >
      <StudentCollectionsPageInner />
    </Suspense>
  );
}
