import Link from 'next/link';

export default function AccountsReportsPage() {
  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">التقارير</h1>
        <p className="text-gray-600 mb-6">تقارير مالية أساسية لنظام الحسابات.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Link
            href="/accounts/reports/journal"
            className="block border rounded-lg p-4 hover:border-red-900 hover:bg-red-50/40 transition"
          >
            <h2 className="font-medium text-red-950">دفتر اليومية</h2>
            <p className="text-sm text-gray-600 mt-1">
              عرض سطور القيود المرحلة مع التصفية حسب التاريخ والحساب.
            </p>
          </Link>
          <div className="border rounded-lg p-4 opacity-60">
            <h2 className="font-medium text-gray-800">دفتر الأستاذ</h2>
            <p className="text-sm text-gray-600 mt-1">سيُضاف في خطوة لاحقة.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
