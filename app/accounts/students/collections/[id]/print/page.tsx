'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COLLECTIONS_API,
  COLLECTION_STATUS_LABEL,
  formatDateOnly,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  studentApi,
  type StudentAccountDetail,
  type StudentAccountSummary,
  type StudentCollectionDetail,
} from '../../../components/types';

export default function StudentCollectionPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [collection, setCollection] = useState<StudentCollectionDetail | null>(null);
  const [account, setAccount] = useState<StudentAccountDetail | null>(null);
  const [summary, setSummary] = useState<StudentAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const colRes = await studentApi<StudentCollectionDetail>(`${COLLECTIONS_API}/${id}`);
    if (!colRes.success || !colRes.data) {
      setError(colRes.message || 'تعذر تحميل الإيصال');
      setLoading(false);
      return;
    }
    setCollection(colRes.data);

    const [accRes, sumRes] = await Promise.all([
      studentApi<StudentAccountDetail>(
        `/api/accounts/student-accounts/${colRes.data.student_account_id}`
      ),
      studentApi<StudentAccountSummary>(
        `/api/accounts/student-accounts/${colRes.data.student_account_id}/summary`
      ),
    ]);
    setAccount(accRes.data || null);
    setSummary(sumRes.data || null);
    setError(null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch receipt for print
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && collection) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [loading, collection]);

  const allocatedTotal = useMemo(() => {
    if (!collection?.allocations) return 0;
    return collection.allocations.reduce(
      (s, a) => s + Number(a.allocated_amount || 0),
      0
    );
  }, [collection]);

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'الإيصال غير موجود'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline print:hidden">
          رجوع
        </button>
      </div>
    );
  }

  const major =
    account?.student?.major || account?.student_major || '—';
  const voucherNo =
    collection.cash_voucher_number || collection.bank_voucher_number || '—';
  const remainingBalance = summary?.balance ?? '0';

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
          <h1 className="text-xl font-bold text-gray-900">إيصال قبض طالب</h1>
          <p className="text-sm text-gray-600 mt-1">
            كلية الشرق للعلوم التقنية التخصصية — نظام الحسابات
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <span className="text-gray-500">رقم الإيصال: </span>
            <strong>{collection.collection_number}</strong>
          </div>
          <div>
            <span className="text-gray-500">الحالة: </span>
            <strong>{COLLECTION_STATUS_LABEL[collection.status]}</strong>
          </div>
          <div>
            <span className="text-gray-500">اسم الطالب: </span>
            <strong>{collection.student_full_name_ar || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">الرقم الجامعي: </span>
            <strong>
              {collection.student_university_id ||
                account?.student?.university_id ||
                account?.student?.student_number ||
                '—'}
            </strong>
          </div>
          <div>
            <span className="text-gray-500">القسم / التخصص: </span>
            <strong>{major}</strong>
          </div>
          <div>
            <span className="text-gray-500">رقم الحساب: </span>
            <strong>{collection.account_number}</strong>
          </div>
          <div>
            <span className="text-gray-500">تاريخ التحصيل: </span>
            <strong>{formatDateOnly(collection.collection_date)}</strong>
          </div>
          <div>
            <span className="text-gray-500">المبلغ المحصّل: </span>
            <strong>{formatMoney(collection.amount)}</strong>
          </div>
          <div>
            <span className="text-gray-500">طريقة الدفع: </span>
            <strong>{PAYMENT_METHOD_LABEL[collection.payment_method]}</strong>
          </div>
          <div>
            <span className="text-gray-500">رقم السند: </span>
            <strong>{voucherNo}</strong>
          </div>
          <div>
            <span className="text-gray-500">اسم الدافع: </span>
            <strong>{collection.payer_name || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">الرصيد المتبقي: </span>
            <strong>{formatMoney(remainingBalance)}</strong>
          </div>
        </section>

        <p className="text-sm text-gray-700 mb-4">
          <span className="text-gray-500">البيان: </span>
          {collection.description}
        </p>

        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-2 text-right">المطالبة</th>
              <th className="py-2 text-right">القسط</th>
              <th className="py-2 text-right">استحقاق</th>
              <th className="py-2 text-right">المبلغ المخصص</th>
            </tr>
          </thead>
          <tbody>
            {(collection.allocations || []).map((a) => (
              <tr key={a.id} className="border-b border-gray-200">
                <td className="py-2">{a.charge_number || '—'}</td>
                <td className="py-2">{a.installment_number ?? '—'}</td>
                <td className="py-2">{formatDateOnly(a.installment_due_date)}</td>
                <td className="py-2">{formatMoney(a.allocated_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-medium">
              <td className="py-2" colSpan={3}>
                إجمالي المخصص
              </td>
              <td className="py-2">{formatMoney(allocatedTotal)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">توقيع المحاسب</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">توقيع شؤون الطلبة</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">توقيع المدير المالي (CFO)</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
          <div className="border-t border-gray-400 pt-2 min-h-[4.5rem]">
            <p className="font-medium">توقيع التدقيق</p>
            <p className="text-xs text-gray-500 mt-6">الاسم / التوقيع</p>
          </div>
        </section>

        <footer className="mt-6 pt-4 border-t border-gray-300 text-xs text-gray-500 flex justify-between">
          <span>تاريخ الطباعة: {new Date().toLocaleString('ar-IQ')}</span>
          <span>إيصال قبض تشغيلي — المرحلة 5.B</span>
        </footer>
      </div>
    </div>
  );
}
