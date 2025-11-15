'use client';

import Link from 'next/link';

export default function AccountsDashboard() {
  const tiles = [
    { title: 'إدارة العمليات', color: 'bg-blue-500', link: '/accounts/exams' },
    { title: 'الحسابات الطلابية', color: 'bg-green-500', link: '/accounts/students' },
    { title: 'كشوفات مالية', color: 'bg-purple-500', link: '/accounts/results' },
    { title: 'التقارير', color: 'bg-indigo-500', link: '/accounts/reports' },
  ];

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiles.map((t) => (
          <Link key={t.link} href={t.link} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center">
              <div className={`${t.color} text-white p-3 rounded-lg`}></div>
              <div className="mr-4">
                <p className="text-lg font-bold text-gray-900">{t.title}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}


