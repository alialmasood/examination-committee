'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const tabs=[['/accounts/suppliers','الموردون'],['/accounts/suppliers/invoices','الفواتير'],['/accounts/suppliers/payments','الدفعات'],['/accounts/suppliers/expenses','المصروفات المباشرة'],['/accounts/suppliers/invoice-types','أنواع الفواتير'],['/accounts/suppliers/expense-types','أنواع المصروفات']] as const;
export default function SuppliersNav(){const pathname=usePathname();return <nav className="flex flex-wrap gap-2 border-b border-gray-200 mb-6">{tabs.map(([href,label])=>{const active=href==='/accounts/suppliers'?pathname==='/accounts/suppliers':pathname?.startsWith(href);return <Link key={href} href={href} className={`px-4 py-3 text-sm font-semibold border-b-2 ${active?'border-blue-600 text-blue-700':'border-transparent text-gray-600 hover:text-blue-600'}`}>{label}</Link>})}</nav>}
