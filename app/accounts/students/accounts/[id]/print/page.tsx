'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ACCOUNT_STATUS_LABEL,
  formatDateOnly,
  formatMoney,
  studentApi,
  type StudentAccountDetail,
  type StudentAccountSummary,
  type StudentLedgerEntry,
} from '../../../components/types';

export default function StudentAccountPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [account, setAccount] = useState<StudentAccountDetail | null>(null);
  const [summary, setSummary] = useState<StudentAccountSummary | null>(null);
  const [ledger, setLedger] = useState<StudentLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [accRes, sumRes, ledRes] = await Promise.all([
      studentApi<StudentAccountDetail>(`/api/accounts/student-accounts/${id}`),
      studentApi<StudentAccountSummary>(`/api/accounts/student-accounts/${id}/summary`),
      studentApi<StudentLedgerEntry[]>(
        `/api/accounts/student-accounts/${id}/ledger?page_size=200`
      ),
    ]);
    if (!accRes.success || !accRes.data) {
      setError(accRes.message || 'تعذر تحميل كشف الحساب');
      setLoading(false);
      return;
    }
    setAccount(accRes.data);
    setSummary(sumRes.data || null);
    setLedger(Array.isArray(ledRes.data) ? ledRes.data : []);
    setError(null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch statement for print
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && account) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [loading, account]);

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'كشف حساب الطالب غير موجود'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline print:hidden">
          رجوع
        </button>
      </div>
    );
  }

  const ledgerWithRunning = ledger.reduce<
    Array<StudentLedgerEntry & { running_balance: number }>
  >((acc, e) => {
    const prev = acc.length ? acc[acc.length - 1].running_balance : 0;
    const next =
      prev + Number(e.debit_amount || 0) - Number(e.credit_amount || 0);
    acc.push({ ...e, running_balance: next });
    return acc;
  }, []);

  return (
    <div className="p-6" dir="rtl">
      <div className="print:hidden mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-3 py-2 text-sm bg-red-900 text-white rounded-md"
        >
          طباعة
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-3 py-2 text-sm border rounded-md"
        >
          رجوع
        </button>
      </div>

      <div className="print-container bg-white border border-gray-200 rounded-lg p-6 max-w-4xl mx-auto">
        <header className="border-b border-gray-300 pb-4 mb-4 text-center">
          <h1 className="text-xl font-bold text-gray-900">كشف حساب طالب</h1>
          <p className="text-sm text-gray-600 mt-1">كلية الشرق للعلوم التقنية التخصصية — نظام الحسابات</p>
        </header>

        <section className="grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <span className="text-gray-500">رقم الحساب: </span>
            <strong>{account.account_number}</strong>
          </div>
          <div>
            <span className="text-gray-500">الحالة: </span>
            <strong>{ACCOUNT_STATUS_LABEL[account.status]}</strong>
          </div>
          <div>
            <span className="text-gray-500">اسم الطالب: </span>
            <strong>{account.student?.full_name_ar || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">الرقم الجامعي: </span>
            <strong>{account.student?.university_id || account.student?.student_number || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">حساب الذمم: </span>
            <strong>
              {account.receivable_gl_code} — {account.receivable_gl_name_ar}
            </strong>
          </div>
          <div>
            <span className="text-gray-500">الرصيد الحالي: </span>
            <strong>{formatMoney(summary?.balance ?? '0')}</strong>
          </div>
        </section>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-right">مدين</th>
              <th className="py-2 text-right">دائن</th>
              <th className="py-2 text-right">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {ledgerWithRunning.map((e) => (
                <tr key={e.id} className="border-b border-gray-200">
                  <td className="py-2">{formatDateOnly(e.entry_date)}</td>
                  <td className="py-2">{e.description}</td>
                  <td className="py-2">{formatMoney(e.debit_amount)}</td>
                  <td className="py-2">{formatMoney(e.credit_amount)}</td>
                  <td className="py-2">{formatMoney(e.running_balance)}</td>
                </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-6 pt-4 border-t border-gray-300 text-xs text-gray-500 flex justify-between">
          <span>تاريخ الطباعة: {new Date().toLocaleString('ar-IQ')}</span>
          <span>دفتر فرعي تشغيلي — مصدر الحقيقة: القيود المرحّلة</span>
        </footer>
      </div>
    </div>
  );
}
