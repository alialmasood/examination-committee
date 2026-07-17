'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  ['/accounts/purchasing', 'لوحة'],
  ['/accounts/purchasing/requisitions', 'طلبات'],
  ['/accounts/purchasing/orders', 'أوامر'],
  ['/accounts/purchasing/receipts', 'استلامات'],
  ['/accounts/purchasing/matching', 'مطابقة'],
] as const;

export default function PurchasingNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200 mb-4">
      {tabs.map(([href, label]) => {
        const active =
          href === '/accounts/purchasing'
            ? pathname === '/accounts/purchasing'
            : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 text-sm font-semibold border-b-2 ${
              active
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-blue-600'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
