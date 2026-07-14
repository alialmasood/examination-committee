'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  BILLING_PLAN_API,
  BILLING_PLAN_STATUS_LABEL,
  billingPlanStatusBadge,
  formatDateOnly,
  formatMoney,
  installmentSettlementLabel,
  installmentStatusBadge,
  studentApi,
  type StudentBillingPlanDetail,
  type StudentInstallmentItem,
  type StudentOptions,
} from '../../components/types';

export default function StudentBillingPlanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [plan, setPlan] = useState<StudentBillingPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [editForm, setEditForm] = useState({
    fee_type_id: '',
    description: '',
    installments: [] as Array<{
      installment_number: number;
      due_date: string;
      amount: string;
      notes: string;
    }>,
  });
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await studentApi<StudentBillingPlanDetail>(`${BILLING_PLAN_API}/${id}`);
    if (!res.success || !res.data) {
      setError(res.message || 'الخطة غير موجودة');
      setPlan(null);
    } else {
      setPlan(res.data);
      setEditForm({
        fee_type_id: res.data.fee_type_id,
        description: res.data.description,
        installments: (res.data.installments || []).map((i) => ({
          installment_number: i.installment_number,
          due_date: i.due_date,
          amount: i.amount,
          notes: i.notes || '',
        })),
      });
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    void studentApi<StudentOptions>('/api/accounts/student-options').then((r) => {
      if (r.success && r.data) setOptions(r.data);
    });
  }, [load]);

  const activate = async () => {
    if (!plan) return;
    if (!window.confirm('تفعيل الخطة سيُنشئ ويرحّل مطالبة لكل قسط. هل تريد المتابعة؟')) return;
    setBusy(true);
    const res = await studentApi(`${BILLING_PLAN_API}/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify({ version: plan.version, updated_at: plan.updated_at }),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشل التفعيل');
      return;
    }
    setSuccess('تم تفعيل الخطة');
    void load();
  };

  const cancel = async () => {
    if (!plan) return;
    setBusy(true);
    const res = await studentApi(`${BILLING_PLAN_API}/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        version: plan.version,
        updated_at: plan.updated_at,
        reason: cancelReason || 'إلغاء من الواجهة',
      }),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشل الإلغاء');
      return;
    }
    setShowCancel(false);
    setCancelReason('');
    setSuccess('تم إلغاء الخطة');
    void load();
  };

  const saveDraft = async () => {
    if (!plan) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      version: plan.version,
      updated_at: plan.updated_at,
      fee_type_id: editForm.fee_type_id,
      description: editForm.description,
    };
    if (plan.status === 'DRAFT' && editForm.installments.length > 0) {
      body.installments = editForm.installments.map((i) => ({
        installment_number: i.installment_number,
        due_date: i.due_date,
        amount: i.amount,
        notes: i.notes || null,
      }));
      body.total_amount = editForm.installments
        .reduce((s, i) => s + Number(i.amount || 0), 0)
        .toString();
    }
    const res = await studentApi(`${BILLING_PLAN_API}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشل الحفظ');
      return;
    }
    setEditOpen(false);
    setSuccess('تم حفظ التعديلات');
    void load();
  };

  const updateInstallment = (
    index: number,
    field: 'due_date' | 'amount' | 'notes',
    value: string
  ) => {
    setEditForm((f) => {
      const next = [...f.installments];
      next[index] = { ...next[index], [field]: value };
      return { ...f, installments: next };
    });
  };

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'الخطة غير موجودة'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline">
          رجوع
        </button>
      </div>
    );
  }

  const installments = plan.installments || [];

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">خطة رسوم {plan.plan_number}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {plan.student_full_name_ar || plan.account_number} ·{' '}
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs ${billingPlanStatusBadge(plan.status)}`}
            >
              {BILLING_PLAN_STATUS_LABEL[plan.status]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/students/billing-plans/${id}/print`}
            className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            طباعة الجدول
          </Link>
          {plan.status === 'DRAFT' && (
            <>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="px-3 py-2 text-sm border rounded-md"
              >
                تعديل المسودة
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void activate()}
                className="px-3 py-2 text-sm bg-green-700 text-white rounded-md disabled:opacity-40"
              >
                تفعيل
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowCancel(true)}
                className="px-3 py-2 text-sm border border-red-300 text-red-800 rounded-md"
              >
                إلغاء
              </button>
            </>
          )}
          {plan.status === 'ACTIVE' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCancel(true)}
              className="px-3 py-2 text-sm border border-red-300 text-red-800 rounded-md"
            >
              إلغاء الخطة
            </button>
          )}
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm space-y-2">
          <div>
            <span className="text-gray-500">الحساب: </span>
            <Link
              href={`/accounts/students/accounts/${plan.student_account_id}`}
              className="text-red-900 hover:underline"
            >
              {plan.account_number}
            </Link>
          </div>
          <div>
            <span className="text-gray-500">نوع الرسم: </span>
            {plan.fee_type_code} — {plan.fee_type_name_ar}
          </div>
          <div>
            <span className="text-gray-500">الإجمالي: </span>
            {formatMoney(plan.total_amount)}
          </div>
          <div>
            <span className="text-gray-500">عدد الأقساط: </span>
            {plan.installment_count}
          </div>
          {plan.activated_at && (
            <div>
              <span className="text-gray-500">تاريخ التفعيل: </span>
              {formatDateOnly(plan.activated_at)}
            </div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
          <div className="text-gray-500 mb-1">البيان</div>
          <p className="text-gray-800">{plan.description}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-right font-medium">#</th>
              <th className="px-3 py-2 text-right font-medium">تاريخ الاستحقاق</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ</th>
              <th className="px-3 py-2 text-right font-medium">المحصّل</th>
              <th className="px-3 py-2 text-right font-medium">المعفى</th>
              <th className="px-3 py-2 text-right font-medium">المتبقي</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
              <th className="px-3 py-2 text-right font-medium">المطالبة</th>
            </tr>
          </thead>
          <tbody>
            {installments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  لا توجد أقساط
                </td>
              </tr>
            ) : (
              installments.map((inst: StudentInstallmentItem) => (
                <tr key={inst.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{inst.installment_number}</td>
                  <td className="px-3 py-2">{formatDateOnly(inst.due_date)}</td>
                  <td className="px-3 py-2">{formatMoney(inst.amount)}</td>
                  <td className="px-3 py-2">{formatMoney(inst.paid_amount)}</td>
                  <td className="px-3 py-2">
                    {formatMoney(inst.relief_amount || '0')}
                  </td>
                  <td className="px-3 py-2">{formatMoney(inst.outstanding_amount)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${installmentStatusBadge(inst.status)}`}
                    >
                      {installmentSettlementLabel(inst)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{inst.student_charge_id ? 'مرتبطة' : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" dir="rtl">
            <h2 className="text-lg font-semibold mb-4">تعديل مسودة الخطة</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">نوع الرسم</label>
                <select
                  value={editForm.fee_type_id}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, fee_type_id: e.target.value }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  {(options?.fee_types || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} — {f.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">البيان</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-right">#</th>
                      <th className="px-2 py-1 text-right">الاستحقاق</th>
                      <th className="px-2 py-1 text-right">المبلغ</th>
                      <th className="px-2 py-1 text-right">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editForm.installments.map((inst, idx) => (
                      <tr key={inst.installment_number} className="border-t">
                        <td className="px-2 py-1">{inst.installment_number}</td>
                        <td className="px-2 py-1">
                          <input
                            type="date"
                            value={inst.due_date}
                            onChange={(e) =>
                              updateInstallment(idx, 'due_date', e.target.value)
                            }
                            className="w-full border rounded px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={inst.amount}
                            onChange={(e) => updateInstallment(idx, 'amount', e.target.value)}
                            className="w-full border rounded px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={inst.notes}
                            onChange={(e) => updateInstallment(idx, 'notes', e.target.value)}
                            className="w-full border rounded px-2 py-1 text-xs"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveDraft()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-2">إلغاء خطة الرسوم</h2>
            <p className="text-sm text-gray-600 mb-3">
              {plan.plan_number} · {formatMoney(plan.total_amount)}
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="سبب الإلغاء"
              className="w-full border rounded-md px-3 py-2 text-sm mb-3"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancel()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {busy ? '...' : 'تأكيد الإلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
