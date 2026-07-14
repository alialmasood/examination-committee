'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from './components/StudentsNav';
import {
  COLLECTIONS_API,
  formatDateOnly,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  studentApi,
  sumMoneyValues,
  type StudentAccountListItem,
  type StudentBillingPlanDetail,
  type StudentChargeListItem,
  type StudentCollectionListItem,
} from './components/types';

type SummaryState = {
  totalReceivables: number;
  totalCollected: number;
  remaining: number;
  dueInstallments: number;
  overdueInstallments: number;
  cashCollected: number;
  bankCollected: number;
  recentCollections: StudentCollectionListItem[];
};

export default function AccountsStudentsPage() {
  const [summary, setSummary] = useState<SummaryState>({
    totalReceivables: 0,
    totalCollected: 0,
    remaining: 0,
    dueInstallments: 0,
    overdueInstallments: 0,
    cashCollected: 0,
    bankCollected: 0,
    recentCollections: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    const [chargesRes, collectionsRes, accountsRes, plansRes] = await Promise.all([
      studentApi<StudentChargeListItem[]>(
        '/api/accounts/student-charges?page_size=100&status=POSTED'
      ),
      studentApi<StudentCollectionListItem[]>(`${COLLECTIONS_API}?page_size=50`),
      studentApi<StudentAccountListItem[]>('/api/accounts/student-accounts?page_size=100'),
      studentApi<StudentBillingPlanDetail[]>(
        '/api/accounts/student-billing-plans?status=ACTIVE&page_size=20'
      ),
    ]);

    const partialRes = await studentApi<StudentChargeListItem[]>(
      '/api/accounts/student-charges?page_size=100&status=PARTIALLY_SETTLED'
    );

    if (!chargesRes.success && !collectionsRes.success) {
      setError(chargesRes.message || collectionsRes.message || 'تعذر تحميل الملخص');
      setLoading(false);
      return;
    }

    const charges = [...(chargesRes.data || []), ...(partialRes.data || [])];
    const collections = collectionsRes.data || [];
    const postedCollections = collections.filter((c) => c.status === 'POSTED');

    const totalReceivables = sumMoneyValues(
      charges.map((c) => c.original_amount)
    );
    const remaining = sumMoneyValues(charges.map((c) => c.outstanding_amount));
    const totalCollected = sumMoneyValues(
      postedCollections.map((c) => c.amount)
    );
    const cashCollected = sumMoneyValues(
      postedCollections
        .filter((c) => c.payment_method === 'CASH')
        .map((c) => c.amount)
    );
    const bankCollected = sumMoneyValues(
      postedCollections
        .filter((c) => c.payment_method === 'BANK')
        .map((c) => c.amount)
    );

    let dueInstallments = 0;
    let overdueInstallments = 0;
    const activePlans = plansRes.data || [];
    const planDetails = await Promise.all(
      activePlans.slice(0, 10).map((p) =>
        studentApi<StudentBillingPlanDetail>(`/api/accounts/student-billing-plans/${p.id}`)
      )
    );
    for (const detail of planDetails) {
      if (!detail.success || !detail.data?.installments) continue;
      for (const inst of detail.data.installments) {
        if (inst.status === 'DUE' || inst.status === 'PARTIALLY_PAID') {
          dueInstallments += 1;
          if (inst.due_date < today) overdueInstallments += 1;
        } else if (
          inst.status === 'PENDING' &&
          inst.due_date <= today &&
          Number(inst.outstanding_amount) > 0
        ) {
          overdueInstallments += 1;
        }
      }
    }

    const accountBalanceFallback = sumMoneyValues(
      (accountsRes.data || []).map((a) => a.balance)
    );

    setSummary({
      totalReceivables: totalReceivables || accountBalanceFallback,
      totalCollected,
      remaining: remaining || accountBalanceFallback,
      dueInstallments,
      overdueInstallments,
      cashCollected,
      bankCollected,
      recentCollections: collections.slice(0, 5),
    });
    setError(null);
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
          خطط الرسوم والأقساط والتحصيل (المرحلة 5.B)
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
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              title="إجمالي الذمم"
              value={formatMoney(summary.totalReceivables)}
              href="/accounts/students/charges?status=POSTED"
            />
            <SummaryCard
              title="إجمالي المحصل"
              value={formatMoney(summary.totalCollected)}
              href="/accounts/students/collections?status=POSTED"
            />
            <SummaryCard
              title="المتبقي"
              value={formatMoney(summary.remaining)}
              href="/accounts/students/accounts?has_balance=true"
            />
            <SummaryCard
              title="أقساط مستحقة"
              value={String(summary.dueInstallments)}
              href="/accounts/students/installments"
            />
            <SummaryCard
              title="متأخرة"
              value={String(summary.overdueInstallments)}
              href="/accounts/students/installments"
            />
            <SummaryCard
              title="تحصيل نقدي"
              value={formatMoney(summary.cashCollected)}
              href="/accounts/students/collections?payment_method=CASH"
            />
            <SummaryCard
              title="تحصيل مصرفي"
              value={formatMoney(summary.bankCollected)}
              href="/accounts/students/collections?payment_method=BANK"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-900">آخر التحصيلات</h2>
              <Link
                href="/accounts/students/collections"
                className="text-sm text-red-900 hover:underline"
              >
                عرض الكل
              </Link>
            </div>
            {summary.recentCollections.length === 0 ? (
              <p className="text-sm text-gray-500">لا توجد تحصيلات بعد</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="py-1 text-right font-medium">الرقم</th>
                      <th className="py-1 text-right font-medium">الطالب</th>
                      <th className="py-1 text-right font-medium">التاريخ</th>
                      <th className="py-1 text-right font-medium">المبلغ</th>
                      <th className="py-1 text-right font-medium">الطريقة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentCollections.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="py-2">
                          <Link
                            href={`/accounts/students/collections/${c.id}`}
                            className="text-red-900 hover:underline"
                          >
                            {c.collection_number}
                          </Link>
                        </td>
                        <td className="py-2">{c.student_full_name_ar || '—'}</td>
                        <td className="py-2">{formatDateOnly(c.collection_date)}</td>
                        <td className="py-2">{formatMoney(c.amount)}</td>
                        <td className="py-2">
                          {PAYMENT_METHOD_LABEL[c.payment_method] || c.payment_method}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickLink
          href="/accounts/students/billing-plans"
          title="خطط الرسوم"
          desc="إنشاء وتفعيل جداول الأقساط"
        />
        <QuickLink
          href="/accounts/students/collections"
          title="التحصيلات"
          desc="قبض نقدي/مصرفي وتخصيص المطالبات"
        />
        <QuickLink
          href="/accounts/students/installments"
          title="الأقساط"
          desc="متابعة الاستحقاق والسداد"
        />
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
