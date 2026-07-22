'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  REFUNDS_API,
  REFUND_STATUS_LABEL,
  formatMoney,
  studentApi,
  type StudentRefund,
} from '../../components/types';

type Preview = {
  credit_balance: string;
  available_credit: string;
  allocations_sum_ok: boolean;
  lines: Array<{
    collection_number: string | null;
    collection_amount: string;
    refundable_amount: string;
    allocated_amount: string;
    within_limit: boolean;
  }>;
};

export default function StudentRefundDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<StudentRefund | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const r = await studentApi<StudentRefund>(`${REFUNDS_API}/${id}`);
    if (r.success) setRow(r.data || null);
    else setError(r.message || 'تعذر التحميل');
    const p = await studentApi<Preview>(
      `${REFUNDS_API}/${id}/preview-allocation`,
      { method: 'POST', body: '{}' }
    );
    if (p.success) setPreview(p.data || null);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const act = async (action: string) => {
    if (!row) return;
    const r = await studentApi(`${REFUNDS_API}/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        version: row.version,
        updated_at: row.updated_at,
        reason,
      }),
    });
    if (!r.success) setError(r.message || 'تعذر التنفيذ');
    else void load();
  };

  if (!row) {
    return (
      <div className="p-6" dir="rtl">
        {error || 'جاري التحميل...'}
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <StudentsNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-red-900 font-mono">
          {row.refund_number}
        </h1>
        <Link
          href={`/accounts/students/refunds/${id}/print`}
          className="px-3 py-1.5 border rounded-md text-sm"
        >
          طباعة
        </Link>
      </div>
      <p className="text-sm mb-2">
        {row.reason} — {formatMoney(row.amount)} —{' '}
        {REFUND_STATUS_LABEL[row.status]} — {row.payment_method}
      </p>
      {preview && (
        <div className="border rounded p-3 mb-4 text-sm bg-gray-50">
          <p>
            الرصيد الدائن: {formatMoney(preview.credit_balance)} — المتاح:{' '}
            {formatMoney(preview.available_credit)}
          </p>
          <p>
            مجموع التخصيصات:{' '}
            {preview.allocations_sum_ok ? 'مطابق' : 'غير مطابق'}
          </p>
          <ul className="mt-2 space-y-1">
            {preview.lines.map((line, i) => (
              <li key={i}>
                {line.collection_number || '—'} — تحصيل{' '}
                {formatMoney(line.collection_amount)} — قابل للاسترداد{' '}
                {formatMoney(line.refundable_amount)} — مخصص{' '}
                {formatMoney(line.allocated_amount)}
                {!line.within_limit && (
                  <span className="text-red-900"> (تجاوز)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {row.status === 'DRAFT' && (
          <button
            type="button"
            className="px-3 py-1.5 bg-red-900 text-white rounded"
            onClick={() => void act('submit')}
          >
            إرسال
          </button>
        )}
        {row.status === 'PENDING_APPROVAL' && (
          <>
            <button
              type="button"
              className="px-3 py-1.5 bg-green-800 text-white rounded"
              onClick={() => void act('approve')}
            >
              اعتماد
            </button>
            <button
              type="button"
              className="px-3 py-1.5 border rounded"
              onClick={() => void act('reject')}
            >
              رفض
            </button>
          </>
        )}
        {row.status === 'APPROVED' && (
          <button
            type="button"
            className="px-3 py-1.5 bg-red-900 text-white rounded"
            onClick={() => void act('post')}
          >
            ترحيل
          </button>
        )}
        {!['VOID', 'REJECTED'].includes(row.status) && (
          <>
            <input
              className="border rounded px-2 py-1"
              placeholder="سبب الإلغاء"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="px-3 py-1.5 border border-red-900 text-red-900 rounded"
              onClick={() => void act('void')}
            >
              إلغاء
            </button>
          </>
        )}
      </div>
      {error && <p className="text-red-900 mt-3">{error}</p>}
    </div>
  );
}
