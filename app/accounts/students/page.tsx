'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from './components/StudentsNav';
import {
  studentApi,
  type Pagination,
  type StudentAccountListItem,
  type StudentChargeListItem,
  type StudentFeeTypeItem,
} from './components/types';

export default function AccountsStudentsPage() {
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [chargesTotal, setChargesTotal] = useState(0);
  const [feeTypesTotal, setFeeTypesTotal] = useState(0);
  const [activeAccounts, setActiveAccounts] = useState(0);
  const [postedCharges, setPostedCharges] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [acc, ch, fees, active, posted] = await Promise.all([
      studentApi<StudentAccountListItem[]>('/api/accounts/student-accounts?page_size=1'),
      studentApi<StudentChargeListItem[]>('/api/accounts/student-charges?page_size=1'),
      studentApi<StudentFeeTypeItem[]>('/api/accounts/student-fee-types?page_size=1'),
      studentApi<StudentAccountListItem[]>(
        '/api/accounts/student-accounts?status=ACTIVE&page_size=1'
      ),
      studentApi<StudentChargeListItem[]>(
        '/api/accounts/student-charges?status=POSTED&page_size=1'
      ),
    ]);
    if (!acc.success || !ch.success || !fees.success) {
      setError(acc.message || ch.message || fees.message || 'تعذر تحميل الملخص');
    } else {
      setError(null);
      setAccountsTotal((acc.pagination as Pagination | undefined)?.total ?? 0);
      setChargesTotal((ch.pagination as Pagination | undefined)?.total ?? 0);
      setFeeTypesTotal((fees.pagination as Pagination | undefined)?.total ?? 0);
      setActiveAccounts((active.pagination as Pagination | undefined)?.total ?? 0);
      setPostedCharges((posted.pagination as Pagination | undefined)?.total ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  return (
    <div className="p-6" dir="rtl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">حسابات الطلبة ومستحقاتهم</h1>
        <p className="text-sm text-gray-600 mt-1">
          تأسيس الحسابات المالية والمطالبات ودفتر الذمم الفرعي (المرحلة 5.A)
        </p>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard title="الحسابات المالية" value={String(accountsTotal)} href="/accounts/students/accounts" />
          <SummaryCard title="حسابات نشطة" value={String(activeAccounts)} href="/accounts/students/accounts?status=ACTIVE" />
          <SummaryCard title="المطالبات" value={String(chargesTotal)} href="/accounts/students/charges" />
          <SummaryCard title="مطالبات مرحّلة" value={String(postedCharges)} href="/accounts/students/charges?status=POSTED" />
          <SummaryCard title="أنواع الرسوم" value={String(feeTypesTotal)} href="/accounts/students/fee-types" />
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">ملاحظة</div>
            <p className="mt-2 text-sm text-gray-700 leading-relaxed">
              الرصيد الدفتري يُحسب من دفتر الطالب الفرعي. القيود المحاسبية (مدين ذمم / دائن إيراد) هي مصدر الحقيقة في الدليل.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickLink href="/accounts/students/accounts" title="إدارة الحسابات" desc="إنشاء وعرض وتعليق/إغلاق" />
        <QuickLink href="/accounts/students/charges" title="المطالبات المالية" desc="مسودة · ترحيل · إلغاء" />
        <QuickLink href="/accounts/students/fee-types" title="أنواع الرسوم" desc="ربط حسابات الإيراد" />
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  href,
}: {
  title: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-gray-200 bg-white p-4 hover:border-red-300 transition-colors"
    >
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    </Link>
  );
}

function QuickLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
    >
      <div className="font-medium text-gray-900">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{desc}</div>
    </Link>
  );
}
