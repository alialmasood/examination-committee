'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/accounts/students', label: 'الملخص', exact: true },
  { href: '/accounts/students/accounts', label: 'الحسابات' },
  { href: '/accounts/students/aggregate-accounts', label: 'حسابات إجمالية' },
  { href: '/accounts/students/payment-schedules', label: 'خطة التسديدات' },
  { href: '/accounts/students/department-installments', label: 'أقساط الأقسام' },
  { href: '/accounts/students/student-fees', label: 'رسوم الطلبة' },
  { href: '/accounts/students/discounts', label: 'تخفيضات وخصومات' },
];

export default function StudentsNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 mb-4" dir="rtl">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              active
                ? 'bg-red-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
