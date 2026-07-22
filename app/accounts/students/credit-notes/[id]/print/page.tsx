'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTES_API,
  formatMoney,
  studentApi,
  type StudentCreditNote,
} from '../../../components/types';

export default function StudentCreditNotePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<StudentCreditNote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await studentApi<StudentCreditNote>(`${CREDIT_NOTES_API}/${id}`);
    if (r.success && r.data) setRow(r.data);
    else setError(r.message || 'تعذر تحميل الإشعار');
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  useEffect(() => {
    if (row) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [row]);

  if (!row) {
    return (
      <div className="p-6" dir="rtl">
        {error || 'جاري التحميل...'}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8 print:p-4" dir="rtl">
      <div className="text-center border-b-2 border-red-900 pb-4 mb-6">
        <p className="text-sm text-gray-600">كلية الشرق</p>
        <h1 className="text-2xl font-bold text-red-900 mt-1">إشعار دائن للطالب</h1>
        <p className="font-mono text-lg mt-2">{row.credit_note_number}</p>
        <p className="text-sm mt-1">{CREDIT_NOTE_STATUS_LABEL[row.status]}</p>
      </div>
      <div className="space-y-2 text-sm">
        <p>
          <strong>الطالب:</strong> {row.student_full_name_ar || '—'}
        </p>
        <p>
          <strong>الحساب:</strong>{' '}
          <span className="font-mono">{row.account_number || '—'}</span>
        </p>
        <p>
          <strong>المطالبة:</strong>{' '}
          <span className="font-mono">{row.charge_number || '—'}</span>
        </p>
        <p>
          <strong>رمز السبب:</strong> {row.reason_code}
        </p>
        <p>
          <strong>السبب:</strong> {row.reason}
        </p>
        <p>
          <strong>المبلغ:</strong> {formatMoney(row.amount)}
        </p>
        <p>
          <strong>الوضع:</strong> {row.application_mode}
        </p>
        {row.journal_entry_id && (
          <p>
            <strong>القيد:</strong>{' '}
            <span className="font-mono text-xs">{row.journal_entry_id}</span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-4 mt-10 text-center text-sm">
        <div>
          <div className="border-t pt-2">المحاسب</div>
        </div>
        <div>
          <div className="border-t pt-2">المدقق</div>
        </div>
        <div>
          <div className="border-t pt-2">المدير</div>
        </div>
      </div>
      <button
        type="button"
        className="print:hidden mt-6 px-4 py-2 bg-red-900 text-white rounded"
        onClick={() => window.print()}
      >
        طباعة
      </button>
    </div>
  );
}
