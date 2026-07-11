'use client';

import Link from 'next/link';
import CashBoxStatusBadge from './CashBoxStatusBadge';
import { CashBoxListItem, canActivateChecklist, formatIqd } from './types';

type Props = {
  rows: CashBoxListItem[];
  loading: boolean;
  onEdit: (row: CashBoxListItem) => void;
  onActivate: (row: CashBoxListItem) => void;
};

export default function CashBoxesTable({
  rows,
  loading,
  onEdit,
  onActivate,
}: Props) {
  if (loading) {
    return (
      <div className="py-12 text-center text-gray-500 text-sm">
        جاري تحميل الصناديق…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center border border-dashed border-gray-300 rounded-lg">
        <p className="text-gray-700 font-medium">لا توجد صناديق مطابقة</p>
        <p className="text-sm text-gray-500 mt-1">
          أنشئ صندوقاً جديداً أو عدّل عوامل التصفية.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-red-950 text-white">
          <tr>
            <th className="px-3 py-2 text-right font-medium">الكود</th>
            <th className="px-3 py-2 text-right font-medium">الاسم</th>
            <th className="px-3 py-2 text-right font-medium">النوع</th>
            <th className="px-3 py-2 text-right font-medium">الحساب</th>
            <th className="px-3 py-2 text-right font-medium">الأمين</th>
            <th className="px-3 py-2 text-right font-medium">الحالة</th>
            <th className="px-3 py-2 text-right font-medium">السقف</th>
            <th className="px-3 py-2 text-right font-medium">الرصيد الدفتري</th>
            <th className="px-3 py-2 text-right font-medium">آخر تحديث</th>
            <th className="px-3 py-2 text-right font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => {
            const checklist = canActivateChecklist(row);
            return (
              <tr key={row.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                <td className="px-3 py-2">{row.name_ar}</td>
                <td className="px-3 py-2">
                  {row.box_type_name_ar || row.box_type_code}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.account_code
                    ? `${row.account_code} — ${row.account_name_ar || ''}`
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  {row.primary_custodian_username || '—'}
                </td>
                <td className="px-3 py-2">
                  <CashBoxStatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatIqd(row.ceiling_amount)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-medium">
                  {formatIqd(row.book_balance)}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {row.updated_at
                    ? new Date(row.updated_at).toLocaleString('ar-IQ')
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Link
                      href={`/accounts/cashbox/${row.id}`}
                      className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                    >
                      تفاصيل
                    </Link>
                    {row.status !== 'CLOSED' && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                        onClick={() => onEdit(row)}
                      >
                        تعديل
                      </button>
                    )}
                    <Link
                      href={`/accounts/cashbox/${row.id}#custodians`}
                      className="px-2 py-1 rounded border text-xs hover:bg-gray-50"
                    >
                      أمناء
                    </Link>
                    {row.status === 'DRAFT' && checklist.ok && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-red-900 text-white text-xs hover:bg-red-800"
                        onClick={() => onActivate(row)}
                      >
                        تفعيل
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
