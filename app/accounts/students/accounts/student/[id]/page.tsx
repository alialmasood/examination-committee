'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { printSettlementReceipt } from '../../../components/printSettlementReceipt';
import { printStudentFinancialReport } from '../../../components/printStudentFinancialReport';
import {
  buildYearLedger,
  feeYearLabel,
  type FeeYear,
} from '../../../lib/settlementYearLedger';

type PaidStudentRow = {
  id: string;
  university_id: string | null;
  name: string | null;
  department: string | null;
  study_type: string | null;
  admission_type: string | null;
  academic_year?: string | null;
  payment_amount?: number | string | null;
  final_fee?: number | string | null;
  discount_percentage?: number | string | null;
  discount_amount?: number | string | null;
};

type SettlementReceipt = {
  id: string;
  receipt_number: string;
  student_id: string;
  university_id: string | null;
  student_name: string | null;
  department: string | null;
  study_type: string | null;
  admission_type: string | null;
  settlement_date: string;
  annual_fee: number | string;
  four_years_total: number | string;
  discount_mode: 'none' | 'amount' | 'percent' | string;
  discount_years: number | string;
  discount_base: number | string;
  discount_input: number | string;
  discount_amount: number | string;
  after_discount: number | string;
  pay_amount: number | string;
  remaining_amount: number | string;
  periods: number | string;
  per_period_amount: number | string;
  fee_year?: number | string | null;
  created_at?: string;
};

const DEFAULT_COLLEGE = 'كلية الشرق للعلوم التقنية التخصصية';
const DEFAULT_INSTALLMENT_DURATION = 'سنة دراسية واحدة';

function formatStage(admissionType?: string | null): string {
  switch (admissionType) {
    case 'first':
      return 'الأولى';
    case 'second':
      return 'الثانية';
    case 'third':
      return 'الثالثة';
    case 'fourth':
      return 'الرابعة';
    default:
      return 'غير محدد';
  }
}

function formatStudyType(studyType?: string | null): string {
  switch (String(studyType || '').toLowerCase()) {
    case 'morning':
    case 'صباحي':
      return 'صباحي';
    case 'evening':
    case 'مسائي':
      return 'مسائي';
    default:
      return studyType?.trim() || 'غير محدد';
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(value);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

function discountModeLabel(mode?: string | null): string {
  switch (mode) {
    case 'amount':
      return 'خصم بمبلغ';
    case 'percent':
      return 'خصم بنسبة مئوية';
    default:
      return 'بدون خصم';
  }
}

function discountYearsLabel(years: number): string {
  if (years <= 1) return 'من القسط السنوي (سنة واحدة)';
  if (years === 2) return 'من قسط سنتين';
  if (years === 3) return 'من قسط 3 سنوات';
  return 'من قسط 4 سنوات';
}

function getAnnualTuitionFee(department: string, studyType?: string | null): number {
  const isEvening = studyType === 'evening';
  const fees: Record<string, number> = {
    'تقنيات التخدير': isEvening ? 2750000 : 3000000,
    'تقنيات الاشعة': isEvening ? 2750000 : 3000000,
    'تقنيات الأشعة': isEvening ? 2750000 : 3000000,
    'تقنيات صناعة الاسنان': isEvening ? 2250000 : 2500000,
    'تقنيات صناعة الأسنان': isEvening ? 2250000 : 2500000,
    'تقنيات البصريات': 2750000,
    'تقنيات طب الطوارئ': 2750000,
    'تقنيات صحة المجتمع': 2750000,
    'تقنيات العلاج الطبيعي': 2750000,
    'هندسة تقنيات البناء والانشاءات': 2500000,
    'تقنيات البناء والاستشارات': 2500000,
    'تقنيات هندسة النفط والغاز': 2500000,
    'تقنيات الفيزياء الصحية': 2500000,
    'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 3000000,
    'تقنيات الامن السيبراني': 3000000,
    'تقنيات الأمن السيبراني': 3000000,
    القانون: 0,
  };
  return fees[department] || 0;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function MoneyCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'danger'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-gray-200 bg-white text-gray-900';

  return (
    <div className={`rounded-lg border px-4 py-4 ${toneClass}`}>
      <p className="text-xs font-medium opacity-80 mb-1">{label}</p>
      <p className="text-lg font-bold tracking-tight" dir="ltr">
        {value} <span className="text-xs font-semibold">IQD</span>
      </p>
    </div>
  );
}

function OfficialReceiptCard({ receipt }: { receipt: SettlementReceipt }) {
  const periods = toNumber(receipt.periods, 1);
  const discountYears = toNumber(receipt.discount_years, 1);
  const hasDiscount = receipt.discount_mode !== 'none' && toNumber(receipt.discount_amount) > 0;

  return (
    <article className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <div className="bg-red-950 text-white px-5 py-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-red-100/80 mb-0.5">وصل تسديد رسمي</p>
          <h3 className="text-base font-semibold tracking-tight">
            {receipt.receipt_number}
          </h3>
          <p className="text-xs text-red-100/90 mt-1">
            {feeYearLabel(Math.max(1, Math.min(4, toNumber(receipt.fee_year, 1))))}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="text-left text-sm ml-2" dir="ltr">
            <p className="text-red-100/80 text-xs mb-0.5">تاريخ التسديد</p>
            <p className="font-semibold">{formatDate(receipt.settlement_date)}</p>
          </div>
          <button
            type="button"
            onClick={() => printSettlementReceipt(receipt, 'A5')}
            className="rounded-md bg-white text-red-950 hover:bg-red-50 px-3 py-1.5 text-xs font-semibold"
          >
            طباعة A5
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">اسم الطالب</p>
            <p className="font-semibold text-gray-900">
              {receipt.student_name?.trim() || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">رقم الطالب</p>
            <p className="font-mono font-semibold text-gray-900" dir="ltr">
              {receipt.university_id?.trim() || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">القسم</p>
            <p className="font-semibold text-gray-900">
              {receipt.department?.trim() || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">المرحلة</p>
            <p className="font-semibold text-gray-900">
              {formatStage(receipt.admission_type)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-200 px-3 py-3">
            <p className="text-xs text-gray-500 mb-1">القسط السنوي</p>
            <p className="text-sm font-bold text-gray-900" dir="ltr">
              {money(toNumber(receipt.annual_fee))} IQD
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
            <p className="text-xs text-emerald-800/80 mb-1">المبلغ المدفوع</p>
            <p className="text-sm font-bold text-emerald-900" dir="ltr">
              {money(toNumber(receipt.pay_amount))} IQD
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-xs text-amber-800/80 mb-1">المتبقي</p>
            <p className="text-sm font-bold text-amber-900" dir="ltr">
              {money(toNumber(receipt.remaining_amount))} IQD
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 px-3 py-3">
            <p className="text-xs text-gray-500 mb-1">عدد الفترات</p>
            <p className="text-sm font-bold text-gray-900">
              {periods === 1 ? 'فترة واحدة' : `${periods} فترات`}
            </p>
            <p className="text-[11px] text-gray-500 mt-1" dir="ltr">
              {money(toNumber(receipt.per_period_amount))} / فترة
            </p>
          </div>
        </div>

        {hasDiscount ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-gray-700 space-y-1">
            <p>
              <span className="text-gray-500">نوع الخصم:</span>{' '}
              <span className="font-semibold">{discountModeLabel(receipt.discount_mode)}</span>
            </p>
            <p>
              <span className="text-gray-500">طريقة الخصم:</span>{' '}
              <span className="font-semibold">{discountYearsLabel(discountYears)}</span>
            </p>
            <p>
              <span className="text-gray-500">أساس الخصم:</span>{' '}
              <span className="font-semibold" dir="ltr">
                {money(toNumber(receipt.discount_base))} IQD
              </span>
              {' · '}
              <span className="text-gray-500">قيمة الخصم:</span>{' '}
              <span className="font-semibold" dir="ltr">
                {money(toNumber(receipt.discount_amount))} IQD
              </span>
              {' · '}
              <span className="text-gray-500">بعد الخصم:</span>{' '}
              <span className="font-semibold" dir="ltr">
                {money(toNumber(receipt.after_discount))} IQD
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-gray-600">
            بدون خصم · بعد الخصم:{' '}
            <span className="font-semibold" dir="ltr">
              {money(toNumber(receipt.after_discount))} IQD
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

export default function StudentAccountsStudentPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [student, setStudent] = useState<PaidStudentRow | null>(null);
  const [receipts, setReceipts] = useState<SettlementReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiptsError, setReceiptsError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setReceiptsError('');
    try {
      const [paidRes, settlementsRes] = await Promise.all([
        fetch('/api/accounts/installments/paid/list', {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`/api/accounts/student-settlements?student_id=${encodeURIComponent(id)}`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      ]);

      const paidBody = await paidRes.json().catch(() => ({}));
      if (!paidRes.ok || !paidBody.success || !Array.isArray(paidBody.data)) {
        setError(paidBody.error || 'تعذر تحميل بيانات الطالب');
        setStudent(null);
      } else {
        const found =
          (paidBody.data as PaidStudentRow[]).find((s) => s.id === id) || null;
        if (!found) {
          setError('الطالب غير موجود ضمن قائمة المسددين');
          setStudent(null);
        } else {
          setStudent(found);
        }
      }

      const settlementsBody = await settlementsRes.json().catch(() => ({}));
      if (!settlementsRes.ok || !settlementsBody.success || !Array.isArray(settlementsBody.data)) {
        setReceipts([]);
        setReceiptsError(settlementsBody.error || 'تعذر تحميل تسديدات الطالب');
      } else {
        setReceipts(settlementsBody.data as SettlementReceipt[]);
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
      setStudent(null);
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => {
    const department = student?.department?.trim() || 'غير محدد';
    const studyType = student?.study_type || null;
    const annual = getAnnualTuitionFee(department, studyType);
    const totalInstallment = toNumber(student?.final_fee, annual > 0 ? annual : 0);
    const settlementsPaid = receipts.reduce(
      (sum, r) => sum + toNumber(r.pay_amount),
      0
    );
    const paidAmount =
      settlementsPaid > 0 ? settlementsPaid : toNumber(student?.payment_amount, 0);
    const ledger = buildYearLedger(receipts, totalInstallment);
    const current = ledger.years.find((y) => y.year === ledger.currentYear);
    const remaining = current
      ? current.remaining
      : ledger.allYearsCompleted
        ? 0
        : Math.max(0, totalInstallment - paidAmount);
    const paidInstallmentsCount = receipts.length;

    return {
      name: student?.name?.trim() || 'الطالب',
      universityId: student?.university_id?.trim() || '—',
      college: DEFAULT_COLLEGE,
      department,
      studyType: formatStudyType(studyType),
      stage: formatStage(student?.admission_type),
      currentStage: formatStage(student?.admission_type),
      academicYear: student?.academic_year?.trim() || '—',
      totalInstallment,
      paidAmount,
      remaining,
      paidInstallmentsCount,
      duration: DEFAULT_INSTALLMENT_DURATION,
      ledger,
    };
  }, [student, receipts]);

  const receiptsByYear = useMemo(() => {
    return ([1, 2, 3, 4] as FeeYear[]).map((year) => {
      const ledgerYear = view.ledger.years.find((entry) => entry.year === year);
      return {
        year,
        label: feeYearLabel(year),
        status: ledgerYear?.status || ('pending' as const),
        target: ledgerYear?.target || view.totalInstallment,
        paid: ledgerYear?.paid || 0,
        remaining: ledgerYear?.remaining || view.totalInstallment,
        items: receipts.filter(
          (receipt) =>
            Math.max(1, Math.min(4, toNumber(receipt.fee_year, 1))) === year
        ),
      };
    });
  }, [receipts, view.ledger.years, view.totalInstallment]);

  function handlePrintFinancialReport() {
    if (!student) return;
    printStudentFinancialReport({
      name: view.name,
      universityId: view.universityId,
      college: view.college,
      department: view.department,
      studyType: view.studyType,
      stage: view.stage,
      academicYear: view.academicYear,
      duration: view.duration,
      totalInstallment: view.totalInstallment,
      paidAmount: view.paidAmount,
      remaining: view.remaining,
      paidInstallmentsCount: view.paidInstallmentsCount,
      ledger: view.ledger,
      receipts,
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/accounts/students/accounts"
          className="text-sm text-red-900 hover:underline"
        >
          ← العودة إلى الحسابات
        </Link>
        {!loading && !error && student ? (
          <button
            type="button"
            onClick={handlePrintFinancialReport}
            className="inline-flex items-center rounded-md bg-red-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-900 shadow-sm"
          >
            طباعة سيرة مالية
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-500 text-sm">جارٍ تحميل بيانات الطالب…</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : (
        <div className="space-y-5">
          <header className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="bg-red-950 text-white px-5 py-4">
              <p className="text-xs text-red-100/80 mb-1">بطاقة حساب الطالب</p>
              <h1 className="text-xl font-semibold tracking-tight">{view.name}</h1>
              <p className="text-sm text-red-100/90 mt-1 font-mono" dir="ltr">
                {view.universityId}
              </p>
            </div>
            <div className="px-5 py-2 bg-slate-50 border-t border-gray-100 text-xs text-gray-600">
              العام الدراسي:{' '}
              <span className="font-semibold text-gray-800">{view.academicYear}</span>
            </div>
          </header>

          <section className="bg-white border border-gray-200 rounded-lg shadow-sm px-5 py-2">
            <h2 className="text-sm font-semibold text-gray-900 pt-3 pb-1">البيانات الأساسية</h2>
            <InfoRow label="اسم الطالب" value={view.name} />
            <InfoRow label="الكلية" value={view.college} />
            <InfoRow label="القسم" value={view.department} />
            <InfoRow label="نوع الدراسة" value={view.studyType} />
            <InfoRow label="المرحلة" value={view.stage} />
            <InfoRow label="المرحلة الحالية" value={view.currentStage} />
            <InfoRow label="مدة القسط" value={view.duration} />
            <InfoRow
              label="عدد الأقساط المدفوعة"
              value={String(view.paidInstallmentsCount)}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">الملخص المالي</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <MoneyCard
                label="القسط السنوي"
                value={money(view.totalInstallment)}
                tone="neutral"
              />
              <MoneyCard
                label="إجمالي المدفوع (كل السنوات)"
                value={money(view.paidAmount)}
                tone="success"
              />
              <MoneyCard
                label="متبقي السنة الجارية"
                value={money(view.remaining)}
                tone={view.remaining > 0 ? 'warning' : 'success'}
              />
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
                <p className="text-xs font-medium text-gray-500 mb-1">عدد التسديدات</p>
                <p className="text-lg font-bold text-gray-900">
                  {view.paidInstallmentsCount}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {view.ledger.currentYear
                    ? `الجارية: ${feeYearLabel(view.ledger.currentYear)}`
                    : 'اكتملت السنوات الأربع'}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
              {view.ledger.years.map((y) => (
                <div
                  key={y.year}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    y.status === 'current'
                      ? 'border-indigo-300 bg-indigo-50'
                      : y.status === 'completed'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-gray-200 bg-white'
                  }`}
                >
                  <p className="font-semibold text-gray-900">{y.label}</p>
                  <p className="text-gray-500 mt-0.5">
                    {y.status === 'completed'
                      ? 'مكتملة'
                      : y.status === 'current'
                        ? 'جارية'
                        : 'لم تبدأ'}
                  </p>
                  <p className="mt-1 font-medium" dir="ltr">
                    {money(y.paid)} / {money(y.target)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">تسديدات الطالب حسب السنوات</h2>
              <span className="text-xs text-gray-500">
                {receipts.length} وصل
              </span>
            </div>

            {receiptsError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {receiptsError}
              </div>
            ) : (
              <div className="space-y-6">
                {receiptsByYear.map((group) => (
                  <div
                    key={group.year}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-slate-50 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-950 text-sm font-bold text-white">
                          {group.year}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-red-950">
                            ملف {group.label}
                          </h3>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {group.items.length} وصل محفوظ
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          group.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : group.status === 'current'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {group.status === 'completed'
                          ? 'مكتملة'
                          : group.status === 'current'
                            ? 'جارية'
                            : 'لم تبدأ'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-px border-b border-gray-200 bg-gray-200 text-xs">
                      <div className="bg-white px-3 py-2">
                        <p className="text-gray-500">مستحق السنة</p>
                        <p className="mt-1 font-bold text-gray-900" dir="ltr">
                          {money(group.target)} IQD
                        </p>
                      </div>
                      <div className="bg-white px-3 py-2">
                        <p className="text-gray-500">المدفوع</p>
                        <p className="mt-1 font-bold text-emerald-800" dir="ltr">
                          {money(group.paid)} IQD
                        </p>
                      </div>
                      <div className="bg-white px-3 py-2">
                        <p className="text-gray-500">المتبقي</p>
                        <p className="mt-1 font-bold text-amber-800" dir="ltr">
                          {money(group.remaining)} IQD
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 p-4">
                      {group.items.length > 0 ? (
                        group.items.map((receipt) => (
                          <OfficialReceiptCard key={receipt.id} receipt={receipt} />
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
                          لا توجد وصولات ضمن {group.label}.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
