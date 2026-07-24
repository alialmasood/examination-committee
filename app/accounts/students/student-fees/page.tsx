'use client';

import StudentsNav from '../components/StudentsNav';

export default function StudentFeesPage() {
  return (
    <div className="p-6" dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">رسوم الطلبة</h1>
        <p className="text-sm text-gray-600 mt-1">
          إدارة رسوم الطلبة وأنواعها المرتبطة بالحسابات المالية
        </p>
      </div>

      <StudentsNav />

      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        سيتم بناء محتوى رسوم الطلبة هنا.
      </div>
    </div>
  );
}
