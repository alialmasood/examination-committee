'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTES_API,
  formatMoney,
  studentApi,
  type StudentCreditNote,
} from '../../components/types';

export default function StudentCreditNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<StudentCreditNote | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const r = await studentApi<StudentCreditNote>(`${CREDIT_NOTES_API}/${id}`);
    if (r.success) setRow(r.data || null);
    else setError(r.message || '???? ???????');
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const act = async (action: string) => {
    if (!row) return;
    const r = await studentApi(`${CREDIT_NOTES_API}/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        version: row.version,
        updated_at: row.updated_at,
        reason,
      }),
    });
    if (!r.success) setError(r.message || '???? ???????');
    else void load();
  };

  if (!row) {
    return (
      <div className="p-6" dir="rtl">
        {error || '???? ????????'}
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <StudentsNav />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-red-900 font-mono">
          {row.credit_note_number}
        </h1>
        <Link
          href={`/accounts/students/credit-notes/${id}/print`}
          className="px-3 py-1.5 border rounded-md text-sm"
        >
          ?????
        </Link>
      </div>
      <p className="text-sm text-gray-700 mb-2">
        {row.reason} ? {formatMoney(row.amount)} ?{' '}
        {CREDIT_NOTE_STATUS_LABEL[row.status]}
      </p>
      <p className="text-sm mb-4">
        ????????: <span className="font-mono">{row.charge_number || '?'}</span>
        {row.journal_entry_id && (
          <>
            {' '}
            ? ?????: <span className="font-mono text-xs">{row.journal_entry_id}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2 mt-4">
        {row.status === 'DRAFT' && (
          <button
            type="button"
            className="px-3 py-1.5 bg-red-900 text-white rounded"
            onClick={() => void act('submit')}
          >
            ?????
          </button>
        )}
        {row.status === 'PENDING_APPROVAL' && (
          <>
            <button
              type="button"
              className="px-3 py-1.5 bg-green-800 text-white rounded"
              onClick={() => void act('approve')}
            >
              ??????
            </button>
            <button
              type="button"
              className="px-3 py-1.5 border rounded"
              onClick={() => void act('reject')}
            >
              ???
            </button>
          </>
        )}
        {row.status === 'APPROVED' && (
          <button
            type="button"
            className="px-3 py-1.5 bg-red-900 text-white rounded"
            onClick={() => void act('post')}
          >
            ?????
          </button>
        )}
        {!['VOID', 'REJECTED'].includes(row.status) && (
          <>
            <input
              className="border rounded px-2 py-1"
              placeholder="??? ???????"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="px-3 py-1.5 border border-red-900 text-red-900 rounded"
              onClick={() => void act('void')}
            >
              ?????
            </button>
          </>
        )}
      </div>
      {error && <p className="text-red-900 mt-3">{error}</p>}
    </div>
  );
}
