'use client';

import { JournalEntryListItem, STATUS_LABEL, TYPE_LABEL, statusBadgeClass } from './types';

type Props = {
  rows: JournalEntryListItem[];
  loading: boolean;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
};

export default function EntriesTable({ rows, loading, onOpen, onEdit }: Props) {
  if (loading) {
    return <div className="py-12 text-center text-gray-500">جاري تحميل القيود...</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="py-16 text-center text-gray-500 border border-dashed rounded-lg">
        لا توجد قيود مطابقة للتصفية الحالية
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm text-right">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2 font-medium">رقم القيد</th>
            <th className="px-3 py-2 font-medium">التاريخ</th>
            <th className="px-3 py-2 font-medium">النوع</th>
            <th className="px-3 py-2 font-medium">الوصف</th>
            <th className="px-3 py-2 font-medium">المرجع</th>
            <th className="px-3 py-2 font-medium">مدين</th>
            <th className="px-3 py-2 font-medium">دائن</th>
            <th className="px-3 py-2 font-medium">الحالة</th>
            <th className="px-3 py-2 font-medium">المنشئ</th>
            <th className="px-3 py-2 font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 font-mono text-red-950">{r.entry_number}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.entry_date}</td>
              <td className="px-3 py-2">{TYPE_LABEL[r.entry_type] || r.entry_type}</td>
              <td className="px-3 py-2 max-w-[220px] truncate" title={r.description}>
                {r.description}
              </td>
              <td className="px-3 py-2">{r.reference_number || '—'}</td>
              <td className="px-3 py-2 font-mono">{r.total_debit}</td>
              <td className="px-3 py-2 font-mono">{r.total_credit}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(r.status)}`}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </td>
              <td className="px-3 py-2">{r.created_by_username || '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <button
                  type="button"
                  className="text-slate-700 hover:underline ml-2"
                  onClick={() => onOpen(r.id)}
                >
                  عرض
                </button>
                {r.status === 'DRAFT' && (
                  <button
                    type="button"
                    className="text-blue-700 hover:underline"
                    onClick={() => onEdit(r.id)}
                  >
                    تعديل
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
