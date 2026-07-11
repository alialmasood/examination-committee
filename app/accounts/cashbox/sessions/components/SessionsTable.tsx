'use client';

import Link from 'next/link';
import SessionStatusBadge from './SessionStatusBadge';
import {
  CashSessionListItem,
  formatDateOnly,
  formatDateTime,
  formatIqd,
  shortId,
} from './session-types';

export default function SessionsTable({
  rows,
  loading,
}: {
  rows: CashSessionListItem[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="border border-dashed border-gray-300 rounded-lg px-4 py-10 text-center text-sm text-gray-500">
        لا توجد جلسات مطابقة للبحث أو الفلاتر.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-right px-3 py-2 font-medium">رقم الجلسة</th>
            <th className="text-right px-3 py-2 font-medium">الصندوق</th>
            <th className="text-right px-3 py-2 font-medium">الأمين</th>
            <th className="text-right px-3 py-2 font-medium">السنة</th>
            <th className="text-right px-3 py-2 font-medium">الفترة</th>
            <th className="text-right px-3 py-2 font-medium">تاريخ الفتح</th>
            <th className="text-right px-3 py-2 font-medium">الحالة</th>
            <th className="text-right px-3 py-2 font-medium">الرصيد الافتتاحي</th>
            <th className="text-right px-3 py-2 font-medium">آخر تحديث</th>
            <th className="text-right px-3 py-2 font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/80">
              <td className="px-3 py-2 font-mono text-xs">{shortId(row.id)}</td>
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900">
                  {row.cash_box_code || '—'}
                </div>
                <div className="text-xs text-gray-500">{row.cash_box_name_ar}</div>
              </td>
              <td className="px-3 py-2">
                {row.primary_custodian_name ||
                  row.primary_custodian_username ||
                  '—'}
              </td>
              <td className="px-3 py-2">{row.fiscal_year_code || '—'}</td>
              <td className="px-3 py-2">{row.fiscal_period_code || '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <div>{formatDateOnly(row.session_date)}</div>
                <div className="text-xs text-gray-500">{formatDateTime(row.opened_at)}</div>
              </td>
              <td className="px-3 py-2">
                <SessionStatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatIqd(row.opening_book_balance)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                {formatDateTime(row.updated_at)}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/accounts/cashbox/sessions/${row.id}`}
                  className="text-red-900 hover:underline text-sm"
                >
                  تفاصيل
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
