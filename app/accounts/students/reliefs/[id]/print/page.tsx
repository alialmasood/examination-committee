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

  return (
    <div className="max-w-2xl mx-auto p-8 print:p-4" dir="rtl">
      <div className="text-center border-b-2 border-red-900 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-red-900">مستند تخفيض / منحة طالب</h1>
        <p className="font-mono text-lg mt-2">{relief.relief_number}</p>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span>الحالة:</span>
          <strong>{RELIEF_STATUS_LABEL[relief.status]}</strong>
        </div>
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
          <span>
            {relief.relief_type_name_ar} —{' '}
            {RELIEF_KIND_LABEL[relief.relief_kind as keyof typeof RELIEF_KIND_LABEL]}
          </span>
        </div>
        <div className="flex justify-between">
          <span>التاريخ:</span>
          <span>{formatDateOnly(relief.relief_date)}</span>
        </div>
        <div className="flex justify-between text-base font-bold border-t pt-3 mt-4">
          <span>المبلغ المعتمد:</span>
          <span>{formatMoney(relief.approved_amount || relief.requested_amount)}</span>
        </div>
        <div className="mt-4 p-3 bg-gray-50 rounded">
          <p className="text-gray-600 mb-1">السبب:</p>
          <p>{relief.reason}</p>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-8 text-center print:block">
        طُبع من نظام الحسابات — {new Date().toLocaleString('ar-IQ')}
      </p>
    </div>
  );
}
