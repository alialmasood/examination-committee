'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  formatDateOnly,
  formatMoney,
  RELIEF_KIND_LABEL,
  RELIEF_STATUS_LABEL,
  RELIEFS_API,
  studentApi,
  type StudentReliefDetail,
} from '../../../components/types';

export default function StudentReliefPrintPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [relief, setRelief] = useState<StudentReliefDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await studentApi<StudentReliefDetail>(`${RELIEFS_API}/${id}`);
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل المستند');
    } else {
      setRelief(res.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && relief) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [loading, relief]);

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!relief) {
    return (
      <div className="p-6 text-red-900" dir="rtl">
        {error || 'غير موجود'}
      </div>
    );
  }

  const approved = relief.approved_amount || relief.requested_amount;
  const outstanding = relief.charge_outstanding || '—';

  return (
    <div className="max-w-3xl mx-auto p-8 print:p-4" dir="rtl">
      <div className="text-center border-b-2 border-red-900 pb-4 mb-6">
        <p className="text-sm text-gray-600">كلية الشرق</p>
        <h1 className="text-2xl font-bold text-red-900 mt-1">
          طلب خصم / منحة / إعفاء طالب
        </h1>
        <p className="font-mono text-lg mt-2">{relief.relief_number}</p>
        <p className="text-sm mt-1">
          {RELIEF_KIND_LABEL[relief.relief_kind as keyof typeof RELIEF_KIND_LABEL] ||
            relief.relief_kind}{' '}
          — {RELIEF_STATUS_LABEL[relief.status]}
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>الطالب:</span>
          <span>{relief.student_full_name_ar}</span>
        </div>
        <div className="flex justify-between">
          <span>رقم الحساب:</span>
          <span className="font-mono">{relief.account_number}</span>
        </div>
        <div className="flex justify-between">
          <span>المطالبة:</span>
          <span className="font-mono">{relief.charge_number}</span>
        </div>
        <div className="flex justify-between">
          <span>نوع التخفيض:</span>
          <span>{relief.relief_type_name_ar}</span>
        </div>
        <div className="flex justify-between">
          <span>طريقة الحساب:</span>
          <span>
            {relief.calculation_type === 'PERCENTAGE'
              ? `نسبة ${relief.percentage_value ?? ''}%`
              : 'مبلغ ثابت'}
          </span>
        </div>
        <div className="flex justify-between">
          <span>تاريخ الطلب:</span>
          <span>{formatDateOnly(relief.relief_date)}</span>
        </div>
        <div className="flex justify-between">
          <span>المبلغ المطلوب:</span>
          <span>{formatMoney(relief.requested_amount)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>المبلغ المعتمد:</span>
          <span>{formatMoney(approved)}</span>
        </div>
        <div className="flex justify-between">
          <span>رصيد المطالبة الحالي (متبقي):</span>
          <span>
            {typeof outstanding === 'string' && outstanding !== '—'
              ? formatMoney(outstanding)
              : outstanding}
          </span>
        </div>
        {relief.external_reference && (
          <div className="flex justify-between">
            <span>المرجع:</span>
            <span className="font-mono">{relief.external_reference}</span>
          </div>
        )}
        {relief.journal_entry_id && (
          <div className="flex justify-between">
            <span>القيد المحاسبي:</span>
            <span className="font-mono text-xs">{relief.journal_entry_id}</span>
          </div>
        )}
        {relief.reversal_journal_entry_id && (
          <div className="flex justify-between">
            <span>قيد العكس:</span>
            <span className="font-mono text-xs">
              {relief.reversal_journal_entry_id}
            </span>
          </div>
        )}
        <div className="mt-4 p-3 bg-gray-50 rounded">
          <p className="text-gray-600 mb-1">السبب:</p>
          <p>{relief.reason}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-10 text-sm">
        <div className="border-t pt-3 text-center">
          <p>مقدم الطلب</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
        <div className="border-t pt-3 text-center">
          <p>المحاسب</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
        <div className="border-t pt-3 text-center">
          <p>شؤون الطلبة</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
        <div className="border-t pt-3 text-center">
          <p>المدير المالي</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
        <div className="border-t pt-3 text-center">
          <p>العميد / المخول</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
        <div className="border-t pt-3 text-center">
          <p>التدقيق</p>
          <p className="mt-8 text-gray-400">................</p>
        </div>
      </div>

      <div className="mt-8 flex justify-center print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 bg-red-900 text-white rounded-md text-sm"
        >
          طباعة
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-8 text-center">
        طُبع من نظام الحسابات — كلية الشرق — {new Date().toLocaleString('ar-IQ')}
      </p>
    </div>
  );
}
