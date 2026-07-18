'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  ['/accounts/fixed-assets', 'لوحة'],
  ['/accounts/fixed-assets/assets', 'الأصول'],
  ['/accounts/fixed-assets/movements', 'الحركات'],
  ['/accounts/fixed-assets/depreciation', 'الإهلاك'],
  ['/accounts/fixed-assets/disposals', 'الاستبعاد'],
  ['/accounts/fixed-assets/purchasing-candidates', 'مرشّحو المشتريات'],
  ['/accounts/fixed-assets/categories', 'التصنيفات'],
  ['/accounts/fixed-assets/locations', 'المواقع'],
] as const;

export default function FixedAssetsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200 mb-4">
      {tabs.map(([href, label]) => {
        const active =
          href === '/accounts/fixed-assets'
            ? pathname === '/accounts/fixed-assets'
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
