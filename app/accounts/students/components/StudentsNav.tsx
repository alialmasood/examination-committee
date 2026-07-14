'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/accounts/students', label: 'الملخص', exact: true },
  { href: '/accounts/students/accounts', label: 'الحسابات' },
  { href: '/accounts/students/billing-plans', label: 'خطط الرسوم' },
  { href: '/accounts/students/installments', label: 'الأقساط' },
  { href: '/accounts/students/collections', label: 'التحصيلات' },
  { href: '/accounts/students/charges', label: 'المطالبات' },
  { href: '/accounts/students/reliefs', label: 'الخصومات والمنح' },
  { href: '/accounts/students/fee-types', label: 'أنواع الرسوم' },
  { href: '/accounts/students/relief-types', label: 'أنواع التخفيضات' },
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
