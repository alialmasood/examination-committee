'use client';

import { useEffect, useState } from 'react';
import { DocumentSequence, FiscalYear, accountsFetch } from './types';

const TYPE_LABELS: Record<string, string> = {
  JOURNAL_ENTRY: 'قيد يومية',
  RECEIPT_VOUCHER: 'سند قبض',
  PAYMENT_VOUCHER: 'سند صرف',
  FINANCIAL_TRANSFER: 'تحويل مالي',
  OPENING_BALANCE: 'رصيد افتتاحي',
};

export default function DocumentSequencesPanel() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState<DocumentSequence[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await accountsFetch<FiscalYear[]>('/api/accounts/fiscal-years');
      if (res.success && res.data) {
        setYears(res.data);
        if (res.data.length > 0) setYearId(res.data[0].id);
      }
    })();
  }, []);

  const load = async (id: string) => {
    if (!id) return;
    const res = await accountsFetch<DocumentSequence[]>(
      `/api/accounts/document-sequences?fiscal_year_id=${id}`
    );
    if (res.success && res.data) setRows(res.data);
    else setError(res.message || 'تعذر جلب التسلسلات');
  };

  /* eslint-disable react-hooks/set-state-in-effect -- تحميل عند تغيير السنة */
  useEffect(() => {
    if (yearId) void load(yearId);
  }, [yearId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveRow = async (row: DocumentSequence) => {
    const res = await accountsFetch('/api/accounts/document-sequences', {
      method: 'PUT',
      body: JSON.stringify({
        id: row.id,
        prefix: row.prefix,
        current_number: row.current_number,
        padding_length: row.padding_length,
        is_active: row.is_active,
      }),
    });
    setError(res.success ? null : res.message || 'فشل الحفظ');
    setMessage(res.success ? res.message || 'تم الحفظ' : null);
    if (res.success) await load(yearId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm text-gray-700">السنة المالية</label>
        <select
          className="border rounded-md px-3 py-2"
          value={yearId}
          onChange={(e) => setYearId(e.target.value)}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.code} — {y.name_ar}
            </option>
          ))}
        </select>
      </div>

      {message && <p className="text-green-700 text-sm">{message}</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-right">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">نوع المستند</th>
              <th className="p-2">البادئة</th>
              <th className="p-2">الرقم الحالي</th>
              <th className="p-2">الخانات</th>
              <th className="p-2">سنوي</th>
              <th className="p-2">مثال الرقم التالي</th>
              <th className="p-2">نشط</th>
              <th className="p-2">حفظ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="border-b">
                <td className="p-2">{TYPE_LABELS[row.document_type] || row.document_type}</td>
                <td className="p-2">
                  <input
                    className="border rounded px-2 py-1 w-20"
                    value={row.prefix}
                    onChange={(e) => {
                      const next = [...rows];
                      next[index] = { ...row, prefix: e.target.value };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min={row.current_number}
                    className="border rounded px-2 py-1 w-24"
                    value={row.current_number}
                    onChange={(e) => {
                      const next = [...rows];
                      next[index] = { ...row, current_number: Number(e.target.value) };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    className="border rounded px-2 py-1 w-20"
                    value={row.padding_length}
                    onChange={(e) => {
                      const next = [...rows];
                      next[index] = { ...row, padding_length: Number(e.target.value) };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="p-2">{row.reset_yearly ? 'نعم' : 'لا'}</td>
                <td className="p-2 font-mono text-xs">{row.preview_next_number}</td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={row.is_active}
                    onChange={(e) => {
                      const next = [...rows];
                      next[index] = { ...row, is_active: e.target.checked };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="p-2">
                  <button
                    className="text-red-900 hover:underline"
                    onClick={() => saveRow(rows[index])}
                  >
                    حفظ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-center text-gray-500 py-6">
            لا توجد تسلسلات — أنشئ سنة مالية أولاً ليتم توليد التسلسلات تلقائياً
          </p>
        )}
      </div>
    </div>
  );
}
