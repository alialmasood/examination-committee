'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  ['/accounts/payroll', 'لوحة'],
  ['/accounts/payroll/people', 'الأشخاص'],
  ['/accounts/payroll/contracts', 'العقود'],
  ['/accounts/payroll/assignments', 'التكليفات'],
  ['/accounts/payroll/components', 'المكوّنات'],
  ['/accounts/payroll/calendars', 'التقويمات'],
  ['/accounts/payroll/periods', 'الفترات'],
  ['/accounts/payroll/runs', 'التشغيلات'],
  ['/accounts/payroll/account-mappings', 'خرائط الحسابات'],
] as const;

export default function PayrollNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200 mb-4">
      {tabs.map(([href, label]) => {
        const active =
          href === '/accounts/payroll'
            ? pathname === '/accounts/payroll'
            : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 text-sm font-semibold border-b-2 ${
              active
                ? 'border-red-700 text-red-800'
                : 'border-transparent text-gray-600 hover:text-red-700'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
