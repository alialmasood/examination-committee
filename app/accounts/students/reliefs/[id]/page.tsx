'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  formatDateOnly,
  formatMoney,
  RELIEF_KIND_LABEL,
  RELIEF_STATUS_LABEL,
  RELIEFS_API,
  reliefStatusBadge,
  studentApi,
  type StudentReliefDetail,
} from '../../components/types';

export default function StudentReliefDetailPage() {
  const params = useParams();
  const id = String(params.id || '');

  const [relief, setRelief] = useState<StudentReliefDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await studentApi<StudentReliefDetail>(`${RELIEFS_API}/${id}`);
    if (!res.success || !res.data) {
      setError(res.message || 'طلب التخفيض غير موجود');
      setRelief(null);
    } else {
      setRelief(res.data);
      setApprovedAmount(res.data.approved_amount || res.data.requested_amount);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const action = async (path: string, body: Record<string, unknown> = {}) => {
    if (!relief) return;
    setBusy(true);
    const res = await studentApi(`${RELIEFS_API}/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify({
        version: relief.version,
        updated_at: relief.updated_at,
        ...body,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشلت العملية');
      return;
    }
    setSuccess('تمت العملية بنجاح');
    void load();
  };

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
    <div className="p-4 md:p-6" dir="rtl">
      <StudentsNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-red-900 font-mono">
            {relief.relief_number}
          </h1>
          <p className="text-sm text-gray-600 mt-1">{relief.reason}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/students/reliefs/${id}/print`}
            className="px-3 py-1.5 border rounded-md text-sm"
          >
            طباعة
          </Link>
          {relief.status === 'DRAFT' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('submit')}
              className="px-3 py-1.5 bg-red-900 text-white rounded-md text-sm disabled:opacity-50"
            >
              إرسال للاعتماد
            </button>
          )}
          {relief.status === 'PENDING_APPROVAL' && (
            <>
              <input
                className="border rounded-md px-2 py-1 text-sm w-28"
                placeholder="المبلغ المعتمد"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void action('approve', { approved_amount: approvedAmount })}
                className="px-3 py-1.5 bg-green-800 text-white rounded-md text-sm"
              >
                اعتماد
              </button>
              <input
                className="border rounded-md px-2 py-1 text-sm"
                placeholder="سبب الرفض"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void action('reject', { reason: rejectReason })}
                className="px-3 py-1.5 bg-orange-700 text-white rounded-md text-sm"
              >
                رفض
              </button>
            </>
          )}
          {relief.status === 'APPROVED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('post')}
              className="px-3 py-1.5 bg-red-900 text-white rounded-md text-sm"
            >
              ترحيل
            </button>
          )}
          {relief.status !== 'VOID' && relief.status !== 'REJECTED' && (
            <>
              <input
                className="border rounded-md px-2 py-1 text-sm"
                placeholder="سبب الإلغاء"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void action('void', { reason: voidReason })}
                className="px-3 py-1.5 border border-red-900 text-red-900 rounded-md text-sm"
              >
                إلغاء
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-900 rounded-md text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-3 p-3 bg-green-50 text-green-900 rounded-md text-sm">{success}</div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">الحالة</span>
            <span className={`px-2 py-0.5 rounded text-xs ${reliefStatusBadge(relief.status)}`}>
              {RELIEF_STATUS_LABEL[relief.status]}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">الطالب</span>
            <span>{relief.student_full_name_ar}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">الحساب</span>
            <span className="font-mono">{relief.account_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">المطالبة</span>
            <span className="font-mono">{relief.charge_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">متبقي المطالبة</span>
            <span>{formatMoney(relief.charge_outstanding)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">نوع التخفيض</span>
            <span>
              {relief.relief_type_name_ar} (
              {RELIEF_KIND_LABEL[relief.relief_kind as keyof typeof RELIEF_KIND_LABEL] ||
                relief.relief_kind}
              )
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">التاريخ</span>
            <span>{formatDateOnly(relief.relief_date)}</span>
          </div>
        </div>
        <div className="border rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">المطلوب</span>
            <span className="font-semibold">{formatMoney(relief.requested_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">المعتمد</span>
            <span>{formatMoney(relief.approved_amount)}</span>
          </div>
          {relief.journal_entry_id && (
            <div className="flex justify-between">
              <span className="text-gray-600">قيد اليومية</span>
              <span className="font-mono text-xs">{relief.journal_entry_id}</span>
            </div>
          )}
          {relief.posted_at && (
            <div className="flex justify-between">
              <span className="text-gray-600">تاريخ الترحيل</span>
              <span>{formatDateOnly(relief.posted_at)}</span>
            </div>
          )}
          {relief.rejection_reason && (
            <div className="text-red-900">سبب الرفض: {relief.rejection_reason}</div>
          )}
          {relief.void_reason && (
            <div className="text-gray-700">سبب الإلغاء: {relief.void_reason}</div>
          )}
        </div>
      </div>
    </div>
  );
}
