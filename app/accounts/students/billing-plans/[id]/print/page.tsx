'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BILLING_PLAN_API,
  BILLING_PLAN_STATUS_LABEL,
  formatDateOnly,
  formatMoney,
  INSTALLMENT_STATUS_LABEL,
  studentApi,
  type StudentBillingPlanDetail,
} from '../../../components/types';

export default function StudentBillingPlanPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [plan, setPlan] = useState<StudentBillingPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await studentApi<StudentBillingPlanDetail>(`${BILLING_PLAN_API}/${id}`);
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل جدول الأقساط');
      setPlan(null);
    } else {
      setPlan(res.data);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch for print
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && plan) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [loading, plan]);

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'الخطة غير موجودة'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline print:hidden">
          رجوع
        </button>
      </div>
    );
  }

  const installments = plan.installments || [];

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
          <h1 className="text-xl font-bold text-gray-900">جدول أقساط الرسوم الدراسية</h1>
          <p className="text-sm text-gray-600 mt-1">
            كلية الشرق للعلوم التقنية التخصصية — نظام الحسابات
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <span className="text-gray-500">رقم الخطة: </span>
            <strong>{plan.plan_number}</strong>
          </div>
          <div>
            <span className="text-gray-500">الحالة: </span>
            <strong>{BILLING_PLAN_STATUS_LABEL[plan.status]}</strong>
          </div>
          <div>
            <span className="text-gray-500">اسم الطالب: </span>
            <strong>{plan.student_full_name_ar || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">الرقم الجامعي: </span>
            <strong>{plan.student_university_id || '—'}</strong>
          </div>
          <div>
            <span className="text-gray-500">رقم الحساب: </span>
            <strong>{plan.account_number}</strong>
          </div>
          <div>
            <span className="text-gray-500">نوع الرسم: </span>
            <strong>
              {plan.fee_type_code} — {plan.fee_type_name_ar}
            </strong>
          </div>
          <div>
            <span className="text-gray-500">إجمالي الخطة: </span>
            <strong>{formatMoney(plan.total_amount)}</strong>
          </div>
          <div>
            <span className="text-gray-500">عدد الأقساط: </span>
            <strong>{plan.installment_count}</strong>
          </div>
        </section>

        <p className="text-sm text-gray-700 mb-4">{plan.description}</p>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-2 text-right">#</th>
              <th className="py-2 text-right">تاريخ الاستحقاق</th>
              <th className="py-2 text-right">المبلغ</th>
              <th className="py-2 text-right">المسدد</th>
              <th className="py-2 text-right">المتبقي</th>
              <th className="py-2 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((inst) => (
              <tr key={inst.id} className="border-b border-gray-200">
                <td className="py-2">{inst.installment_number}</td>
                <td className="py-2">{formatDateOnly(inst.due_date)}</td>
                <td className="py-2">{formatMoney(inst.amount)}</td>
                <td className="py-2">{formatMoney(inst.paid_amount)}</td>
                <td className="py-2">{formatMoney(inst.outstanding_amount)}</td>
                <td className="py-2">{INSTALLMENT_STATUS_LABEL[inst.status]}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-medium">
              <td className="py-2" colSpan={2}>
                الإجمالي
              </td>
              <td className="py-2">{formatMoney(plan.total_amount)}</td>
              <td colSpan={3} />
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
          <span>جدول أقساط تشغيلي — المرحلة 5.B</span>
        </footer>
      </div>
    </div>
  );
}
