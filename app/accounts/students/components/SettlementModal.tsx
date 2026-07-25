'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildYearLedger,
  feeYearLabel,
  getOpenYearState,
  type FeeYear,
  type SettlementHistoryRow,
  type YearLedger,
} from '../lib/settlementYearLedger';
import {
  ADMISSION_CHANNEL_DEFS,
  formatAdmissionChannelLabel,
  getAdmissionChannelDef,
  parseDiscountFeeYears,
  type AdmissionChannelKey,
} from '../lib/admissionChannels';

export type SettlementStudent = {
  id: string;
  university_id: string | null;
  name: string | null;
  department: string | null;
  study_type: string | null;
  admission_type: string | null;
  admission_channel?: string | null;
  payment_amount?: number | string | null;
  final_fee?: number | string | null;
};

type DiscountMode = 'none' | 'amount' | 'percent';
type DeanValueMode = 'percent' | 'amount';

type Props = {
  open: boolean;
  student: SettlementStudent | null;
  onClose: () => void;
  onSaved?: (receipt: { id: string; receipt_number: string; student_id: string }) => void;
};

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

function todayInputDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  };
  return fees[department] || 0;
}

function yearStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'مكتملة';
    case 'current':
      return 'جارية';
    default:
      return 'لم تبدأ';
  }
}

export default function SettlementModal({ open, student, onClose, onSaved }: Props) {
  const [payAmount, setPayAmount] = useState('');
  const [settlementDate, setSettlementDate] = useState(todayInputDate);
  const [periods, setPeriods] = useState(2);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<AdmissionChannelKey | ''>('');
  const [discountFeeYears, setDiscountFeeYears] = useState<number[]>([1]);
  const [deanValueMode, setDeanValueMode] = useState<DeanValueMode>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyRows, setHistoryRows] = useState<SettlementHistoryRow[]>([]);
  const [yearLocked, setYearLocked] = useState(false);

  const registeredChannel = String(student?.admission_channel || '').trim();
  const registeredChannelDef = getAdmissionChannelDef(registeredChannel);
  const hasRegisteredChannel = Boolean(
    registeredChannelDef && registeredChannelDef.key !== 'general'
  );

  const activeChannelKey = (
    hasRegisteredChannel
      ? registeredChannel
      : discountEnabled
        ? selectedChannel
        : ''
  ) as AdmissionChannelKey | '';
  const activeChannelDef = getAdmissionChannelDef(activeChannelKey);

  const baseTotal = useMemo(() => {
    if (!student) return 0;
    const dept = student.department?.trim() || '';
    const annual = getAnnualTuitionFee(dept, student.study_type);
    const finalFee = toNumber(student.final_fee, 0);
    return finalFee > 0 ? finalFee : annual;
  }, [student]);

  const fourYearsTotal = baseTotal * 4;

  const ledger: YearLedger = useMemo(
    () => buildYearLedger(historyRows, baseTotal),
    [historyRows, baseTotal]
  );

  const openState = useMemo(
    () => getOpenYearState(historyRows, baseTotal),
    [historyRows, baseTotal]
  );

  const currentYear: FeeYear | null = openState.feeYear;

  useEffect(() => {
    if (!open || !student) return;

    let cancelled = false;

    async function loadPreviousSettlements() {
      setPayAmount('');
      setSettlementDate(todayInputDate());
      setPeriods(2);
      setDiscountEnabled(false);
      setSelectedChannel('');
      setDeanValueMode('percent');
      setDiscountValue('');
      setFormMessage('');
      setFormError('');
      setSaving(false);
      setHistoryRows([]);
      setHistoryReady(false);
      setYearLocked(false);
      setLoadingHistory(true);

      const existingChannel = String(student!.admission_channel || '').trim();
      const existingDef = getAdmissionChannelDef(existingChannel);
      const hasExistingDiscountChannel = Boolean(
        existingDef && existingDef.key !== 'general'
      );
      if (hasExistingDiscountChannel && existingDef) {
        setDiscountEnabled(true);
        setSelectedChannel(existingDef.key);
        if (existingDef.fixedPercent != null) {
          setDiscountValue(String(existingDef.fixedPercent));
        }
      }

      try {
        const res = await fetch(
          `/api/accounts/student-settlements?student_id=${encodeURIComponent(student!.id)}`,
          { credentials: 'include', cache: 'no-store' }
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !body.success || !Array.isArray(body.data)) {
          setFormError(body.error || 'تعذر قراءة التسديدات السابقة');
          setHistoryReady(false);
          return;
        }

        const rows = body.data as SettlementHistoryRow[];
        setHistoryRows(rows);
        setHistoryReady(true);

        const annual = (() => {
          const dept = student!.department?.trim() || '';
          const a = getAnnualTuitionFee(dept, student!.study_type);
          const finalFee = toNumber(student!.final_fee, 0);
          return finalFee > 0 ? finalFee : a;
        })();

        const state = getOpenYearState(rows, annual);
        const openYear = state.feeYear || 1;
        setDiscountFeeYears([openYear]);

        // استرجاع خطة تخفيض سابقة إن وُجدت على أي وصل
        const planReceipt = rows.find(
          (r) =>
            String(r.discount_channel || '').trim() ||
            parseDiscountFeeYears(r.discount_fee_years).length > 0
        );

        if (planReceipt) {
          const years = parseDiscountFeeYears(planReceipt.discount_fee_years);
          if (years.length > 0) setDiscountFeeYears(years);
          const ch = String(planReceipt.discount_channel || '').trim();
          const chDef = getAdmissionChannelDef(ch);
          if (chDef && !hasExistingDiscountChannel) {
            setDiscountEnabled(true);
            setSelectedChannel(chDef.key);
          }
        }

        if (state.firstReceipt && state.receiptsCount > 0) {
          setYearLocked(true);
          const first = state.firstReceipt;
          const mode = String(first.discount_mode || 'none');
          const years = parseDiscountFeeYears(first.discount_fee_years);
          if (years.length > 0) setDiscountFeeYears(years);
          const ch = String(first.discount_channel || existingChannel || '').trim();
          const chDef = getAdmissionChannelDef(ch);
          if (mode === 'none' || !chDef) {
            setDiscountEnabled(false);
            setDiscountValue('');
          } else {
            setDiscountEnabled(true);
            setSelectedChannel(chDef.key);
            if (chDef.allowAmountOrPercent) {
              setDeanValueMode(mode === 'amount' ? 'amount' : 'percent');
            }
            const input = toNumber(first.discount_input, 0);
            setDiscountValue(input > 0 ? String(input) : '');
          }
          setPeriods(
            Math.max(1, Math.min(10, toNumber(state.firstReceipt.periods, 2)))
          );
        }
      } catch {
        if (!cancelled) {
          setFormError('تعذر الاتصال بالخادم لقراءة التسديدات السابقة');
          setHistoryReady(false);
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    void loadPreviousSettlements();
    return () => {
      cancelled = true;
    };
  }, [open, student]);

  const resolvedDiscount = useMemo(() => {
    const annual = Math.max(0, baseTotal);
    const currentYearNum = currentYear || 1;
    const appliesToCurrentYear = discountFeeYears.includes(currentYearNum);

    let mode: DiscountMode = 'none';
    let input = 0;
    let amount = 0;

    const shouldApply =
      appliesToCurrentYear &&
      Boolean(activeChannelDef) &&
      (hasRegisteredChannel || discountEnabled);

    if (shouldApply && activeChannelDef) {
      if (activeChannelDef.allowAmountOrPercent) {
        mode = deanValueMode === 'amount' ? 'amount' : 'percent';
        input = toNumber(discountValue, 0);
        if (mode === 'amount') {
          amount = Math.max(0, Math.min(input, annual));
        } else {
          const pct = Math.max(0, Math.min(input, 100));
          amount = (annual * pct) / 100;
          input = pct;
        }
      } else if (activeChannelDef.fixedPercent != null) {
        mode = 'percent';
        input = activeChannelDef.fixedPercent;
        amount = (annual * input) / 100;
      } else {
        mode = 'percent';
        input = Math.max(0, Math.min(toNumber(discountValue, 0), 100));
        amount = (annual * input) / 100;
      }
    }

    return { mode, input, amount, appliesToCurrentYear };
  }, [
    baseTotal,
    currentYear,
    discountFeeYears,
    activeChannelDef,
    hasRegisteredChannel,
    discountEnabled,
    deanValueMode,
    discountValue,
  ]);

  const calc = useMemo(() => {
    const annual = Math.max(0, baseTotal);
    const discountBase = annual;
    const discountMode = resolvedDiscount.mode;
    const discountAmount = resolvedDiscount.amount;

    // مصدر الحقيقة: مجموع المدفوع السابق للسنة من الوصولات المحفوظة
    let yearTarget = openState.yearTarget;
    let yearPaidBefore = openState.yearPaidBefore;
    let outstandingBefore = openState.outstandingBefore;

    if (openState.receiptsCount === 0) {
      // سنة جديدة: المستحق من نموذج الخصم الحالي
      yearTarget = Math.max(0, discountBase - discountAmount);
      if (annual > 0) yearTarget = Math.min(yearTarget, annual);
      yearPaidBefore = 0;
      outstandingBefore = yearTarget;
    } else {
      // سنة جارية: لا نعيد احتساب المستحق من الصفر
      yearTarget = openState.yearTarget;
      yearPaidBefore = openState.yearPaidBefore;
      outstandingBefore = openState.outstandingBefore;
    }

    const maxPay = Math.min(
      outstandingBefore,
      annual > 0 ? annual : outstandingBefore
    );
    const rawPay = Math.max(0, toNumber(payAmount, 0));
    const paid = Math.min(rawPay, maxPay);
    const remaining = Math.max(0, outstandingBefore - paid);
    const periodCount = Math.max(1, Math.min(10, periods));
    const perPeriod =
      periodCount > 0 ? outstandingBefore / periodCount : outstandingBefore;

    return {
      feeYear: currentYear,
      discountMode,
      discountInput: resolvedDiscount.input,
      discountBase,
      discountAmount:
        openState.receiptsCount > 0
          ? Math.max(0, annual - yearTarget)
          : discountAmount,
      yearTarget,
      yearPaidBefore,
      outstandingBefore,
      maxPay,
      paid,
      remaining,
      periodCount,
      perPeriod,
      exceedsMax: rawPay > maxPay + 0.0001,
      historyCount: historyRows.length,
      appliesDiscount: resolvedDiscount.appliesToCurrentYear && discountMode !== 'none',
    };
  }, [
    baseTotal,
    resolvedDiscount,
    payAmount,
    periods,
    currentYear,
    openState,
    historyRows.length,
  ]);

  if (!open || !student) return null;

  async function handleComplete() {
    if (!student) return;
    setFormMessage('');
    setFormError('');

    if (loadingHistory || !historyReady) {
      setFormError('يرجى الانتظار حتى اكتمال قراءة التسديدات السابقة');
      return;
    }
    if (!calc.feeYear) {
      setFormError('تم استيفاء أقساط السنوات الأربع لهذا الطالب');
      return;
    }
    if (!settlementDate) {
      setFormError('يرجى تحديد تاريخ التسديد');
      return;
    }
    if (calc.outstandingBefore <= 0) {
      setFormError('لا يوجد متبقي على السنة الحالية');
      return;
    }
    if (toNumber(payAmount, 0) <= 0) {
      setFormError('يرجى إدخال مبلغ الدفع الحالي');
      return;
    }
    if (calc.exceedsMax) {
      setFormError(
        `مبلغ الدفع أكبر من المسموح لهذه السنة (${money(calc.maxPay)} IQD)`
      );
      return;
    }

    const wantsDiscount =
      (hasRegisteredChannel || discountEnabled) && discountFeeYears.length > 0;
    if (wantsDiscount && !activeChannelDef) {
      setFormError('يرجى اختيار قناة التخفيض');
      return;
    }
    if (wantsDiscount && discountFeeYears.length === 0) {
      setFormError('يرجى تحديد السنوات التي يسري عليها التخفيض');
      return;
    }
    if (
      wantsDiscount &&
      activeChannelDef &&
      !activeChannelDef.allowAmountOrPercent &&
      activeChannelDef.fixedPercent == null &&
      toNumber(discountValue, 0) <= 0
    ) {
      setFormError('يرجى إدخال نسبة التخفيض لهذه القناة');
      return;
    }
    if (
      wantsDiscount &&
      activeChannelDef?.allowAmountOrPercent &&
      toNumber(discountValue, 0) <= 0
    ) {
      setFormError('يرجى إدخال قيمة تخفيض موافقة السيد العميد');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/accounts/student-settlements', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: student.id,
          university_id: student.university_id,
          student_name: student.name,
          department: student.department,
          study_type: student.study_type,
          admission_type: student.admission_type,
          settlement_date: settlementDate,
          annual_fee: baseTotal,
          four_years_total: fourYearsTotal,
          fee_year: calc.feeYear,
          discount_mode: calc.discountMode,
          discount_years: Math.max(1, discountFeeYears.length),
          discount_fee_years: discountFeeYears,
          discount_channel: activeChannelDef?.key || null,
          assign_admission_channel:
            !hasRegisteredChannel && discountEnabled && Boolean(activeChannelDef),
          discount_base: calc.discountBase,
          discount_input: calc.discountInput,
          discount_amount: calc.discountAmount,
          after_discount: calc.yearTarget,
          pay_amount: calc.paid,
          remaining_amount: calc.remaining,
          periods: calc.periodCount,
          per_period_amount: calc.perPeriod,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setFormError(body.error || 'تعذر حفظ وصل التسديد');
        return;
      }

      const journalNote = body.data?.journal_entry?.entry_number
        ? ` ورُحِّل القيد ${body.data.journal_entry.entry_number} إلى دفتر اليومية`
        : body.journal_warning
          ? ` (تنبيه: ${body.journal_warning})`
          : '';
      setFormMessage(
        `تم حفظ وصل ${feeYearLabel(calc.feeYear)} رقم ${body.data?.receipt_number || ''}${journalNote}`
      );
      onSaved?.({
        id: body.data.id,
        receipt_number: body.data.receipt_number,
        student_id: student.id,
      });
      if (!onSaved) {
        setTimeout(() => onClose(), 700);
      }
    } catch {
      setFormError('تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto border border-gray-200">
        <div className="bg-red-950 text-white px-5 py-3 rounded-t-xl flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-red-100/80 mb-0.5">نموذج تسديد رسمي</p>
            <h3 className="text-lg font-semibold">تسديد قسط الطالب</h3>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-left" dir="ltr">
              <p className="text-xs text-red-100/80 mb-0.5">رقم الطالب</p>
              <p className="font-mono font-semibold text-white">
                {student.university_id?.trim() || '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-red-100 hover:text-white text-xl leading-none px-1"
              aria-label="إغلاق"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <section className="rounded-lg border border-gray-200 bg-slate-50 px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">اسم الطالب</p>
              <p className="font-semibold text-gray-900">
                {student.name?.trim() || '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">المرحلة</p>
              <p className="font-semibold text-gray-900">
                {formatStage(student.admission_type)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">القسم</p>
              <p className="font-semibold text-gray-900">
                {student.department?.trim() || '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">نوع الدراسة</p>
              <p className="font-semibold text-gray-900">
                {formatStudyType(student.study_type)}
              </p>
            </div>
          </section>

          {loadingHistory ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-gray-600">
              جارٍ قراءة تسديدات السنوات السابقة…
            </div>
          ) : (
            <section className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-4 py-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-indigo-800/80">السنة الجارية للتسديد</p>
                  <p className="text-base font-bold text-indigo-950">
                    {calc.feeYear
                      ? feeYearLabel(calc.feeYear)
                      : 'اكتملت السنوات الأربع'}
                  </p>
                </div>
                <p className="text-xs text-indigo-900/80">
                  كل سنة لها حساب مستقل بحد أقصى = القسط السنوي
                </p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {ledger.years.map((y) => (
                  <div
                    key={y.year}
                    className={`rounded-md border px-2.5 py-2 text-xs ${
                      y.status === 'current'
                        ? 'border-indigo-400 bg-white'
                        : y.status === 'completed'
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-gray-200 bg-white/70'
                    }`}
                  >
                    <p className="font-semibold text-gray-900">{y.label}</p>
                    <p className="text-gray-500 mt-0.5">{yearStatusLabel(y.status)}</p>
                    <p className="mt-1" dir="ltr">
                      {money(y.paid)} / {money(y.target)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 px-3 py-3">
              <p className="text-xs text-gray-500 mb-1">القسط الكلي (سنوي)</p>
              <p className="text-base font-bold text-gray-900" dir="ltr">
                {money(baseTotal)} IQD
              </p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <p className="text-xs text-red-800/80 mb-1">إجمالي 4 سنوات (مرجعي)</p>
              <p className="text-base font-bold text-red-950" dir="ltr">
                {money(fourYearsTotal)} IQD
              </p>
              <p className="text-[11px] text-red-800/70 mt-1">لا يُخلط مع تسديد السنة</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-xs text-emerald-800/80 mb-1">مستحق السنة الحالية</p>
              <p className="text-base font-bold text-emerald-900" dir="ltr">
                {money(calc.yearTarget)} IQD
              </p>
              <p className="text-[11px] text-emerald-800/70 mt-1">
                مدفوع سابقاً لهذه السنة: {money(calc.yearPaidBefore)}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-xs text-amber-800/80 mb-1">المتبقي الآن (قبل الدفع)</p>
              <p className="text-base font-bold text-amber-900" dir="ltr">
                {money(calc.outstandingBefore)} IQD
              </p>
              <p className="text-[11px] text-amber-800/70 mt-1">
                بعد هذه الدفعة: {money(calc.remaining)}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    مبلغ الدفع الحالي
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={calc.maxPay || undefined}
                    step="1000"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="أدخل المبلغ المراد دفعه الآن"
                    disabled={
                      loadingHistory || !calc.feeYear || calc.maxPay <= 0
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50 disabled:text-gray-400"
                    dir="ltr"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    الحد الأعلى لهذه الدفعة: {money(calc.maxPay)} IQD (لا يتجاوز
                    القسط السنوي ولا متبقي السنة)
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    تاريخ التسديد
                  </label>
                  <input
                    type="date"
                    value={settlementDate}
                    onChange={(e) => setSettlementDate(e.target.value)}
                    onKeyDown={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                    onDrop={(e) => e.preventDefault()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  مدة التسديد (عدد الفترات) — للسنة الحالية
                </label>
                <select
                  value={periods}
                  onChange={(e) => setPeriods(Number(e.target.value))}
                  disabled={yearLocked}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'فترة واحدة (دفع المتبقي كله)' : `${n} فترات`}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {calc.periodCount === 1
                    ? `دفع كامل متبقي السنة: ${money(calc.perPeriod)} IQD`
                    : `تجزئة متبقي السنة: ${money(calc.perPeriod)} IQD لكل فترة`}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <p className="text-sm font-medium text-gray-800">
                خصم / تخفيض على قسط السنوات المحددة
              </p>
              {yearLocked && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                  تم تثبيت الخصم والفترات حسب أول تسديد لهذه السنة حتى لا تختلط
                  الحسابات.
                </p>
              )}

              {hasRegisteredChannel && registeredChannelDef ? (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
                  <p className="font-semibold">
                    الطالب مشمول بتخفيض:{' '}
                    {formatAdmissionChannelLabel(registeredChannelDef.key)}
                  </p>
                  <p className="text-xs text-indigo-800/80 mt-0.5">
                    {registeredChannelDef.fixedPercent != null
                      ? `نسبة التخفيض الثابتة: ${registeredChannelDef.fixedPercent}%`
                      : registeredChannelDef.allowAmountOrPercent
                        ? 'تخفيض موافقة السيد العميد — نسبة أو مبلغ'
                        : 'أدخل نسبة التخفيض يدوياً لهذه القناة'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="discountToggle"
                      checked={!discountEnabled}
                      disabled={yearLocked}
                      onChange={() => {
                        setDiscountEnabled(false);
                        setSelectedChannel('');
                        setDiscountValue('');
                      }}
                    />
                    بدون خصم / تخفيض
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="discountToggle"
                      checked={discountEnabled}
                      disabled={yearLocked}
                      onChange={() => setDiscountEnabled(true)}
                    />
                    إضافة تخفيض حسب قناة القبول
                  </label>
                </div>
              )}

              {(hasRegisteredChannel || discountEnabled) && (
                <div className="space-y-3">
                  {!hasRegisteredChannel && (
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">
                        قناة التخفيض
                      </label>
                      <select
                        value={selectedChannel}
                        disabled={yearLocked}
                        onChange={(e) => {
                          const key = e.target.value as AdmissionChannelKey | '';
                          setSelectedChannel(key);
                          const def = getAdmissionChannelDef(key);
                          if (def?.fixedPercent != null) {
                            setDiscountValue(String(def.fixedPercent));
                          } else {
                            setDiscountValue('');
                          }
                          if (def?.allowAmountOrPercent) {
                            setDeanValueMode('percent');
                          }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                      >
                        <option value="">اختر قناة التخفيض</option>
                        {ADMISSION_CHANNEL_DEFS.filter((c) => c.key !== 'general').map(
                          (channel) => (
                            <option key={channel.key} value={channel.key}>
                              {channel.label}
                              {channel.fixedPercent != null
                                ? ` (${channel.fixedPercent}%)`
                                : channel.allowAmountOrPercent
                                  ? ' (نسبة أو مبلغ)'
                                  : ' (نسبة يدوية)'}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  )}

                  <div>
                    <p className="text-sm text-gray-700 mb-1.5">
                      السنوات التي يسري عليها التخفيض
                    </p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {([1, 2, 3, 4] as FeeYear[]).map((year) => (
                        <label key={year} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={discountFeeYears.includes(year)}
                            disabled={yearLocked}
                            onChange={(e) => {
                              setDiscountFeeYears((prev) => {
                                if (e.target.checked) {
                                  return [...prev, year].sort((a, b) => a - b);
                                }
                                return prev.filter((y) => y !== year);
                              });
                            }}
                          />
                          {feeYearLabel(year)}
                        </label>
                      ))}
                    </div>
                    {calc.feeYear && !discountFeeYears.includes(calc.feeYear) && (
                      <p className="text-xs text-amber-700 mt-1">
                        السنة الجارية ({feeYearLabel(calc.feeYear)}) غير مشمولة
                        بالتخفيض — سيُحتسب القسط كاملاً لهذه السنة.
                      </p>
                    )}
                  </div>

                  {activeChannelDef?.allowAmountOrPercent && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3 text-sm">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="deanMode"
                            checked={deanValueMode === 'percent'}
                            disabled={yearLocked}
                            onChange={() => {
                              setDeanValueMode('percent');
                              setDiscountValue('');
                            }}
                          />
                          نسبة مئوية
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="deanMode"
                            checked={deanValueMode === 'amount'}
                            disabled={yearLocked}
                            onChange={() => {
                              setDeanValueMode('amount');
                              setDiscountValue('');
                            }}
                          />
                          مبلغ (IQD)
                        </label>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={deanValueMode === 'percent' ? 100 : baseTotal || undefined}
                        step={deanValueMode === 'percent' ? '0.1' : '1000'}
                        value={discountValue}
                        disabled={yearLocked}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                        dir="ltr"
                        placeholder={
                          deanValueMode === 'percent'
                            ? 'أدخل نسبة التخفيض'
                            : 'أدخل مبلغ التخفيض'
                        }
                      />
                    </div>
                  )}

                  {activeChannelDef &&
                    !activeChannelDef.allowAmountOrPercent &&
                    activeChannelDef.fixedPercent == null && (
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          نسبة التخفيض (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={discountValue}
                          disabled={yearLocked}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                          dir="ltr"
                          placeholder="أدخل نسبة التخفيض"
                        />
                      </div>
                    )}

                  {activeChannelDef?.fixedPercent != null && (
                    <p className="text-xs text-gray-600">
                      نسبة القناة الثابتة: {activeChannelDef.fixedPercent}%
                    </p>
                  )}

                  <p className="text-xs text-gray-500">
                    قيمة الخصم على السنة الحالية:{' '}
                    {money(calc.discountAmount)} IQD من القسط السنوي
                    {activeChannelDef
                      ? ` · ${formatAdmissionChannelLabel(activeChannelDef.key)}`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className="rounded-lg border border-gray-100 bg-slate-50 px-3 py-2 text-xs text-gray-600">
            <p>
              {calc.feeYear ? feeYearLabel(calc.feeYear) : '—'} · مستحق{' '}
              {money(calc.yearTarget)} − مدفوع سابقاً لهذه السنة{' '}
              {money(calc.yearPaidBefore)} = متبقي {money(calc.outstandingBefore)} ·
              دفع الآن {money(calc.paid)} · المتبقي بعد الدفع {money(calc.remaining)}
              {calc.remaining <= 0 && calc.feeYear && calc.feeYear < 4
                ? ' · بعد الإكمال يُفتح تسديد السنة التالية'
                : ''}
            </p>
          </div>

          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </div>
          )}

          {formMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {formMessage}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleComplete}
              disabled={
                saving ||
                loadingHistory ||
                !historyReady ||
                !calc.feeYear ||
                calc.outstandingBefore <= 0
              }
              className="bg-red-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'جارٍ الحفظ…' : 'إكمال الدفع'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
