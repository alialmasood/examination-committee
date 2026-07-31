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
import {
  expectedAnnualFee,
  getAnnualTuitionFee,
} from '../lib/tuitionFees';

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
  discount_percentage?: number | string | null;
  discount_amount?: number | string | null;
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

function resolveChannelDiscount(
  def: ReturnType<typeof getAdmissionChannelDef>,
  annual: number,
  valueRaw: string,
  deanMode: DeanValueMode
): { mode: DiscountMode; input: number; amount: number } {
  if (!def) return { mode: 'none', input: 0, amount: 0 };

  if (def.allowAmountOrPercent) {
    const mode: DiscountMode = deanMode === 'amount' ? 'amount' : 'percent';
    const input = toNumber(valueRaw, 0);
    if (mode === 'amount') {
      return {
        mode,
        input,
        amount: Math.max(0, Math.min(input, annual)),
      };
    }
    const pct = Math.max(0, Math.min(input, 100));
    return { mode, input: pct, amount: (annual * pct) / 100 };
  }

  if (def.fixedPercent != null) {
    return {
      mode: 'percent',
      input: def.fixedPercent,
      amount: (annual * def.fixedPercent) / 100,
    };
  }

  const pct = Math.max(0, Math.min(toNumber(valueRaw, 0), 100));
  return { mode: 'percent', input: pct, amount: (annual * pct) / 100 };
}

function todayInputDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [extraDiscountEnabled, setExtraDiscountEnabled] = useState(false);
  const [extraChannel, setExtraChannel] = useState<AdmissionChannelKey | ''>('');
  const [extraDiscountFeeYears, setExtraDiscountFeeYears] = useState<number[]>([1]);
  const [extraDeanValueMode, setExtraDeanValueMode] =
    useState<DeanValueMode>('percent');
  const [extraDiscountValue, setExtraDiscountValue] = useState('');
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

  /**
   * إن وُجد تخفيض صريح (قناة/نسبة/مبلغ) مدمج في القسط، لا يُعاد خصم القناة في المودال.
   * لا نعتمد على final_fee وحده لأنه قد يكون قسطاً قديماً قبل تعديل الجدول.
   */
  const primaryDiscountAlreadyApplied = useMemo(() => {
    if (!student) return false;
    const pct = toNumber(student.discount_percentage, 0);
    const amt = toNumber(student.discount_amount, 0);
    return hasRegisteredChannel || pct > 0 || amt > 0;
  }, [student, hasRegisteredChannel]);

  const primaryActive = hasRegisteredChannel || discountEnabled;
  /** الخصم الرئيسي يُحتسب في التسديد فقط إن لم يكن مدمجاً مسبقاً في القسط */
  const primaryCountsInCalc = primaryActive && !primaryDiscountAlreadyApplied;

  const activeChannelKey = (
    hasRegisteredChannel
      ? registeredChannel
      : discountEnabled
        ? selectedChannel
        : ''
  ) as AdmissionChannelKey | '';
  const activeChannelDef = getAdmissionChannelDef(activeChannelKey);
  const extraChannelDef = getAdmissionChannelDef(extraChannel);

  const catalogAnnual = useMemo(() => {
    if (!student) return 0;
    const dept = student.department?.trim() || '';
    return getAnnualTuitionFee(dept, student.study_type);
  }, [student]);

  /** القسط المعتمد من الجدول الحالي (+ خصم صريح إن وُجد) — يتجاهل final_fee القديم */
  const baseTotal = useMemo(() => {
    if (!student) return 0;
    return expectedAnnualFee({
      major: student.department?.trim() || '',
      study_type: student.study_type,
      admission_channel: student.admission_channel,
      discount_percentage: toNumber(student.discount_percentage, 0),
      discount_amount: toNumber(student.discount_amount, 0),
      final_fee_after_discount: toNumber(student.final_fee, 0),
    });
  }, [student]);

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
      setExtraDiscountEnabled(false);
      setExtraChannel('');
      setExtraDiscountFeeYears([1]);
      setExtraDeanValueMode('percent');
      setExtraDiscountValue('');
      setFormMessage('');
      setFormError('');
      setSaving(false);
      setHistoryRows([]);
      setHistoryReady(false);
      setYearLocked(false);
      setDiscountFeeYears([1]);
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

        const annual = expectedAnnualFee({
          major: student!.department?.trim() || '',
          study_type: student!.study_type,
          admission_channel: student!.admission_channel,
          discount_percentage: toNumber(student!.discount_percentage, 0),
          discount_amount: toNumber(student!.discount_amount, 0),
          final_fee_after_discount: toNumber(student!.final_fee, 0),
        });

        const state = getOpenYearState(rows, annual);
        const openYear = state.feeYear || 1;
        // مبدأياً: الخصم لسنة واحدة فقط (السنة الأولى) — توسيع السنوات يدوياً من الخانة
        setDiscountFeeYears([1]);

        // استرجاع قناة التخفيض من وصل سابق إن لم تكن مسجّلة على ملف الطالب
        const planReceipt = rows.find(
          (r) => String(r.discount_channel || '').trim()
        );
        if (planReceipt && !hasExistingDiscountChannel) {
          const ch = String(planReceipt.discount_channel || '').trim();
          const chDef = getAdmissionChannelDef(ch);
          if (chDef) {
            setDiscountEnabled(true);
            setSelectedChannel(chDef.key);
            if (chDef.fixedPercent != null) {
              setDiscountValue(String(chDef.fixedPercent));
            }
          }
        }

        if (state.firstReceipt && state.receiptsCount > 0) {
          setYearLocked(true);
          const first = state.firstReceipt;
          const mode = String(first.discount_mode || 'none');
          // سنة جارية بدأ تسديدها: ثبّت السنوات كما حُفظت في أول وصل
          const years = parseDiscountFeeYears(first.discount_fee_years);
          if (years.length > 0) setDiscountFeeYears(years);
          else setDiscountFeeYears([openYear]);
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

    const primary = primaryCountsInCalc
      ? resolveChannelDiscount(
          activeChannelDef,
          annual,
          discountValue,
          deanValueMode
        )
      : { mode: 'none' as DiscountMode, input: 0, amount: 0 };

    const extra =
      extraDiscountEnabled && extraChannelDef
        ? resolveChannelDiscount(
            extraChannelDef,
            annual,
            extraDiscountValue,
            extraDeanValueMode
          )
        : { mode: 'none' as DiscountMode, input: 0, amount: 0 };

    const primaryApplies =
      primaryCountsInCalc && discountFeeYears.includes(currentYearNum);
    const extraApplies =
      extraDiscountEnabled &&
      Boolean(extraChannelDef) &&
      extraDiscountFeeYears.includes(currentYearNum);

    const primaryAmount = primaryApplies ? primary.amount : 0;
    const extraAmount = extraApplies ? extra.amount : 0;
    const amount = Math.max(0, Math.min(annual, primaryAmount + extraAmount));

    const planAmountForYear = (year: number) => {
      let d = 0;
      if (
        primaryCountsInCalc &&
        primary.amount > 0 &&
        discountFeeYears.includes(year)
      ) {
        d += primary.amount;
      }
      if (
        extraDiscountEnabled &&
        extra.amount > 0 &&
        extraDiscountFeeYears.includes(year)
      ) {
        d += extra.amount;
      }
      return Math.max(0, Math.min(annual, d));
    };

    const channelActive =
      (primaryCountsInCalc && Boolean(activeChannelDef)) ||
      (extraDiscountEnabled && Boolean(extraChannelDef));

    let mode: DiscountMode = 'none';
    let input = 0;
    if (primaryApplies && extraApplies) {
      mode = 'amount';
      input = amount;
    } else if (primaryApplies) {
      mode = primary.mode;
      input = primary.input;
    } else if (extraApplies) {
      mode = extra.mode;
      input = extra.input;
    }

    const allPlanYears = [
      ...new Set([
        ...(primaryCountsInCalc ? discountFeeYears : []),
        ...(extraDiscountEnabled ? extraDiscountFeeYears : []),
      ]),
    ].sort((a, b) => a - b);

    return {
      mode,
      input,
      amount,
      primaryAmount,
      extraAmount,
      primary,
      extra,
      planAmountForYear,
      planAmount: planAmountForYear(currentYearNum),
      appliesToCurrentYear: primaryApplies || extraApplies,
      channelActive,
      allPlanYears,
      primaryApplies,
      extraApplies,
      primaryDiscountAlreadyApplied,
    };
  }, [
    baseTotal,
    currentYear,
    discountFeeYears,
    activeChannelDef,
    primaryCountsInCalc,
    primaryDiscountAlreadyApplied,
    deanValueMode,
    discountValue,
    extraDiscountEnabled,
    extraChannelDef,
    extraDiscountFeeYears,
    extraDeanValueMode,
    extraDiscountValue,
  ]);

  /** إجمالي 4 سنوات بعد تطبيق التخفيضات على السنوات المحددة */
  const fourYearsTotal = useMemo(() => {
    const annual = Math.max(0, baseTotal);

    return ([1, 2, 3, 4] as FeeYear[]).reduce((sum, year) => {
      const entry = ledger.years.find((y) => y.year === year);
      if (entry && entry.receiptsCount > 0) {
        return sum + entry.target;
      }
      return sum + Math.max(0, annual - resolvedDiscount.planAmountForYear(year));
    }, 0);
  }, [baseTotal, ledger.years, resolvedDiscount]);

  /** أهداف السنوات للعرض: السنوات غير المبدوءة تعكس خطة الخصم الحالية */
  const yearTargetsPreview = useMemo(() => {
    const annual = Math.max(0, baseTotal);

    return ledger.years.map((entry) => {
      if (entry.receiptsCount > 0) return entry;
      return {
        ...entry,
        target: Math.max(
          0,
          annual - resolvedDiscount.planAmountForYear(entry.year)
        ),
      };
    });
  }, [ledger.years, baseTotal, resolvedDiscount]);

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
    const periodCount = Math.max(1, Math.min(10, periods));
    const requiresFullPay = periodCount === 1;
    const rawPay = Math.max(0, toNumber(payAmount, 0));
    const fullPayMismatch =
      requiresFullPay &&
      outstandingBefore > 0 &&
      Math.abs(rawPay - outstandingBefore) > 0.01;
    const paidAmount =
      requiresFullPay && !fullPayMismatch
        ? outstandingBefore
        : Math.min(rawPay, maxPay);
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
      paid: paidAmount,
      remaining: Math.max(0, outstandingBefore - paidAmount),
      periodCount,
      perPeriod,
      requiresFullPay,
      fullPayMismatch,
      exceedsMax: !requiresFullPay && rawPay > maxPay + 0.0001,
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

  // فترة واحدة = دفع المتبقي كاملاً: تثبيت مبلغ الدفع على المتبقي
  useEffect(() => {
    if (!open || loadingHistory || !historyReady) return;
    if (periods !== 1) return;
    const due = calc.outstandingBefore;
    if (due <= 0) return;
    const next = String(Math.round(due));
    setPayAmount((prev) => (prev === next ? prev : next));
  }, [
    open,
    loadingHistory,
    historyReady,
    periods,
    calc.outstandingBefore,
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
    if (calc.requiresFullPay && calc.fullPayMismatch) {
      setFormError(
        `عند اختيار فترة واحدة يجب أن يساوي مبلغ الدفع المتبقي بذمة الطالب تماماً (${money(calc.outstandingBefore)} IQD)`
      );
      return;
    }
    if (calc.exceedsMax) {
      setFormError(
        `مبلغ الدفع أكبر من المسموح لهذه السنة (${money(calc.maxPay)} IQD)`
      );
      return;
    }

    const wantsPrimary =
      primaryCountsInCalc && discountFeeYears.length > 0;
    if (wantsPrimary && !activeChannelDef) {
      setFormError('يرجى اختيار قناة التخفيض الرئيسية');
      return;
    }
    if (wantsPrimary && discountFeeYears.length === 0) {
      setFormError('يرجى تحديد سنوات التخفيض للخصم الرئيسي');
      return;
    }
    if (
      wantsPrimary &&
      activeChannelDef &&
      !activeChannelDef.allowAmountOrPercent &&
      activeChannelDef.fixedPercent == null &&
      toNumber(discountValue, 0) <= 0
    ) {
      setFormError('يرجى إدخال نسبة التخفيض للخصم الرئيسي');
      return;
    }
    if (
      wantsPrimary &&
      activeChannelDef?.allowAmountOrPercent &&
      toNumber(discountValue, 0) <= 0
    ) {
      setFormError('يرجى إدخال قيمة تخفيض موافقة السيد العميد (الرئيسي)');
      return;
    }

    if (extraDiscountEnabled) {
      if (!extraChannelDef) {
        setFormError('يرجى اختيار قناة الخصم الإضافي');
        return;
      }
      if (extraDiscountFeeYears.length === 0) {
        setFormError('يرجى تحديد سنوات الخصم الإضافي');
        return;
      }
      if (
        !extraChannelDef.allowAmountOrPercent &&
        extraChannelDef.fixedPercent == null &&
        toNumber(extraDiscountValue, 0) <= 0
      ) {
        setFormError('يرجى إدخال نسبة الخصم الإضافي');
        return;
      }
      if (
        extraChannelDef.allowAmountOrPercent &&
        toNumber(extraDiscountValue, 0) <= 0
      ) {
        setFormError('يرجى إدخال قيمة الخصم الإضافي');
        return;
      }
    }

    const saveMode =
      resolvedDiscount.primaryApplies && resolvedDiscount.extraApplies
        ? 'amount'
        : calc.discountMode;
    const saveInput =
      resolvedDiscount.primaryApplies && resolvedDiscount.extraApplies
        ? calc.discountAmount
        : calc.discountInput;
    const saveChannel =
      activeChannelDef?.key || extraChannelDef?.key || null;
    const saveYears =
      resolvedDiscount.allPlanYears.length > 0
        ? resolvedDiscount.allPlanYears
        : discountFeeYears;

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
          discount_mode: saveMode,
          discount_years: Math.max(1, saveYears.length),
          discount_fee_years: saveYears,
          discount_channel: saveChannel,
          assign_admission_channel:
            !hasRegisteredChannel && discountEnabled && Boolean(activeChannelDef),
          discount_base: calc.discountBase,
          discount_input: saveInput,
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
                {yearTargetsPreview.map((y) => (
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
              <p className="text-xs text-gray-500 mb-1">
                {primaryDiscountAlreadyApplied
                  ? 'القسط المعتمد (بعد خصم التسجيل)'
                  : 'القسط الكلي (سنوي)'}
              </p>
              <p className="text-base font-bold text-gray-900" dir="ltr">
                {money(baseTotal)} IQD
              </p>
              {primaryDiscountAlreadyApplied &&
                catalogAnnual > 0 &&
                catalogAnnual !== baseTotal && (
                  <p className="text-[11px] text-gray-500 mt-1" dir="ltr">
                    القسط الأساسي قبل الخصم: {money(catalogAnnual)} IQD
                  </p>
                )}
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <p className="text-xs text-red-800/80 mb-1">إجمالي 4 سنوات</p>
              <p className="text-base font-bold text-red-950" dir="ltr">
                {money(fourYearsTotal)} IQD
              </p>
              <p className="text-[11px] text-red-800/70 mt-1">
                {resolvedDiscount.channelActive &&
                resolvedDiscount.allPlanYears.length > 0 &&
                ([1, 2, 3, 4] as FeeYear[]).some(
                  (y) => resolvedDiscount.planAmountForYear(y) > 0
                )
                  ? `يشمل التخفيض على ${resolvedDiscount.allPlanYears.length} سنة محددة`
                  : 'بدون تخفيض · القسط السنوي × 4'}
              </p>
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
                    min={calc.requiresFullPay ? calc.outstandingBefore : 0}
                    max={calc.maxPay || undefined}
                    step="1000"
                    value={payAmount}
                    onChange={(e) => {
                      if (periods === 1) return;
                      setPayAmount(e.target.value);
                    }}
                    placeholder="أدخل المبلغ المراد دفعه الآن"
                    readOnly={periods === 1}
                    disabled={
                      loadingHistory ||
                      !calc.feeYear ||
                      calc.maxPay <= 0 ||
                      periods === 1
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50 disabled:text-gray-400"
                    dir="ltr"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {periods === 1
                      ? `فترة واحدة: يجب دفع المتبقي كاملاً (${money(calc.outstandingBefore)} IQD) — لا أقل ولا أكثر`
                      : `الحد الأعلى لهذه الدفعة: ${money(calc.maxPay)} IQD (لا يتجاوز القسط السنوي ولا متبقي السنة)`}
                  </p>
                  {calc.fullPayMismatch && (
                    <p className="text-xs text-red-700 mt-1">
                      مبلغ الدفع يجب أن يساوي المتبقي {money(calc.outstandingBefore)} IQD
                    </p>
                  )}
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

              {/* —— الخصم الرئيسي —— */}
              {hasRegisteredChannel && registeredChannelDef ? (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-950 space-y-1">
                  <p className="font-semibold">
                    الخصم الرئيسي:{' '}
                    {formatAdmissionChannelLabel(registeredChannelDef.key)}
                    {registeredChannelDef.fixedPercent != null
                      ? ` (${registeredChannelDef.fixedPercent}%)`
                      : toNumber(student.discount_percentage, 0) > 0
                        ? ` (${toNumber(student.discount_percentage, 0)}%)`
                        : ''}
                  </p>
                  {primaryDiscountAlreadyApplied ? (
                    <p className="text-xs text-indigo-800/90 leading-5">
                      هذا التخفيض مُحتسب مسبقاً ضمن القسط المعتمد (
                      {money(baseTotal)} IQD
                      {catalogAnnual > 0 && catalogAnnual !== baseTotal
                        ? ` من أصل ${money(catalogAnnual)}`
                        : ''}
                      ). لن يُخصم مرة أخرى هنا — يمكنك إضافة خصم آخر فقط إن لزم.
                    </p>
                  ) : (
                    <p className="text-xs text-indigo-800/80 mt-0.5">
                      {registeredChannelDef.fixedPercent != null
                        ? `نسبة التخفيض الثابتة: ${registeredChannelDef.fixedPercent}%`
                        : registeredChannelDef.allowAmountOrPercent
                          ? 'تخفيض موافقة السيد العميد — نسبة أو مبلغ'
                          : 'أدخل نسبة التخفيض يدوياً لهذه القناة'}
                    </p>
                  )}
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
                    بدون خصم رئيسي
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="discountToggle"
                      checked={discountEnabled}
                      disabled={yearLocked}
                      onChange={() => {
                        setDiscountEnabled(true);
                        if (!yearLocked) setDiscountFeeYears([1]);
                      }}
                    />
                    إضافة خصم رئيسي حسب قناة القبول
                  </label>
                </div>
              )}

              {primaryCountsInCalc && (
                <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-xs font-semibold text-slate-700">الخصم الرئيسي</p>

                  {!hasRegisteredChannel && (
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">
                        قناة التخفيض الرئيسية
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
                      السنوات التي يسري عليها التخفيض الرئيسي
                    </p>
                    <p className="text-xs text-gray-500 mb-2">
                      مبدئياً السنة الأولى فقط. أضف سنوات أخرى إن لزم.
                    </p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {([1, 2, 3, 4] as FeeYear[]).map((year) => (
                        <label key={`p-${year}`} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={discountFeeYears.includes(year)}
                            disabled={yearLocked}
                            onChange={(e) => {
                              setDiscountFeeYears((prev) => {
                                if (e.target.checked) {
                                  return [...prev, year].sort((a, b) => a - b);
                                }
                                const next = prev.filter((y) => y !== year);
                                return next.length === 0 ? [1] : next;
                              });
                            }}
                          />
                          {feeYearLabel(year)}
                        </label>
                      ))}
                    </div>
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
                </div>
              )}

              {/* —— خصم إضافي —— */}
              <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/40 p-3 space-y-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-amber-950">
                  <input
                    type="checkbox"
                    checked={extraDiscountEnabled}
                    disabled={yearLocked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setExtraDiscountEnabled(on);
                      if (on && !yearLocked) {
                        setExtraDiscountFeeYears([1]);
                        setExtraChannel('');
                        setExtraDiscountValue('');
                        setExtraDeanValueMode('percent');
                      }
                    }}
                  />
                  إضافة خصم آخر للطالب
                </label>
                <p className="text-xs text-amber-900/70">
                  حتى مع وجود خصم سابق/رئيسي يمكن إضافة خصم ثانٍ (مثلاً موافقة
                  العميد)، مع تحديد سنوات سريانه بشكل مستقل.
                </p>

                {extraDiscountEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">
                        قناة الخصم الإضافي
                      </label>
                      <select
                        value={extraChannel}
                        disabled={yearLocked}
                        onChange={(e) => {
                          const key = e.target.value as AdmissionChannelKey | '';
                          setExtraChannel(key);
                          const def = getAdmissionChannelDef(key);
                          if (def?.fixedPercent != null) {
                            setExtraDiscountValue(String(def.fixedPercent));
                          } else {
                            setExtraDiscountValue('');
                          }
                          if (def?.allowAmountOrPercent) {
                            setExtraDeanValueMode('percent');
                          }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                      >
                        <option value="">اختر قناة الخصم الإضافي</option>
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

                    <div>
                      <p className="text-sm text-gray-700 mb-1.5">
                        السنوات التي يسري عليها الخصم الإضافي
                      </p>
                      <p className="text-xs text-gray-500 mb-2">
                        مبدئياً السنة الأولى فقط — نفس سلوك الخصم الرئيسي.
                      </p>
                      <div className="flex flex-wrap gap-3 text-sm">
                        {([1, 2, 3, 4] as FeeYear[]).map((year) => (
                          <label
                            key={`e-${year}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            <input
                              type="checkbox"
                              checked={extraDiscountFeeYears.includes(year)}
                              disabled={yearLocked}
                              onChange={(e) => {
                                setExtraDiscountFeeYears((prev) => {
                                  if (e.target.checked) {
                                    return [...prev, year].sort((a, b) => a - b);
                                  }
                                  const next = prev.filter((y) => y !== year);
                                  return next.length === 0 ? [1] : next;
                                });
                              }}
                            />
                            {feeYearLabel(year)}
                          </label>
                        ))}
                      </div>
                    </div>

                    {extraChannelDef?.allowAmountOrPercent && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-3 text-sm">
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="extraDeanMode"
                              checked={extraDeanValueMode === 'percent'}
                              disabled={yearLocked}
                              onChange={() => {
                                setExtraDeanValueMode('percent');
                                setExtraDiscountValue('');
                              }}
                            />
                            نسبة مئوية
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="extraDeanMode"
                              checked={extraDeanValueMode === 'amount'}
                              disabled={yearLocked}
                              onChange={() => {
                                setExtraDeanValueMode('amount');
                                setExtraDiscountValue('');
                              }}
                            />
                            مبلغ (IQD)
                          </label>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={
                            extraDeanValueMode === 'percent'
                              ? 100
                              : baseTotal || undefined
                          }
                          step={extraDeanValueMode === 'percent' ? '0.1' : '1000'}
                          value={extraDiscountValue}
                          disabled={yearLocked}
                          onChange={(e) => setExtraDiscountValue(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                          dir="ltr"
                          placeholder={
                            extraDeanValueMode === 'percent'
                              ? 'أدخل نسبة التخفيض'
                              : 'أدخل مبلغ التخفيض'
                          }
                        />
                      </div>
                    )}

                    {extraChannelDef &&
                      !extraChannelDef.allowAmountOrPercent &&
                      extraChannelDef.fixedPercent == null && (
                        <div>
                          <label className="block text-sm text-gray-700 mb-1">
                            نسبة الخصم الإضافي (%)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.1"
                            value={extraDiscountValue}
                            disabled={yearLocked}
                            onChange={(e) => setExtraDiscountValue(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800 focus:border-red-800 disabled:bg-gray-50"
                            dir="ltr"
                            placeholder="أدخل نسبة التخفيض"
                          />
                        </div>
                      )}

                    {extraChannelDef?.fixedPercent != null && (
                      <p className="text-xs text-gray-600">
                        نسبة القناة الثابتة: {extraChannelDef.fixedPercent}%
                      </p>
                    )}
                  </div>
                )}
              </div>

              {(primaryCountsInCalc || extraDiscountEnabled) && (
                <div className="text-xs text-gray-600 space-y-1 border-t border-gray-100 pt-2">
                  {calc.feeYear &&
                    !discountFeeYears.includes(calc.feeYear) &&
                    primaryCountsInCalc && (
                      <p className="text-amber-700">
                        السنة الجارية غير مشمولة بالخصم الرئيسي — القسط بدون هذا
                        الخصم لهذه السنة.
                      </p>
                    )}
                  {calc.feeYear &&
                    extraDiscountEnabled &&
                    !extraDiscountFeeYears.includes(calc.feeYear) && (
                      <p className="text-amber-700">
                        السنة الجارية غير مشمولة بالخصم الإضافي.
                      </p>
                    )}
                  <p>
                    خصم السنة الحالية:{' '}
                    {money(calc.discountAmount)} IQD
                    {resolvedDiscount.primaryAmount > 0
                      ? ` (رئيسي ${money(resolvedDiscount.primaryAmount)}`
                      : ''}
                    {resolvedDiscount.extraAmount > 0
                      ? `${resolvedDiscount.primaryAmount > 0 ? ' +' : ' ('}إضافي ${money(resolvedDiscount.extraAmount)}`
                      : ''}
                    {resolvedDiscount.primaryAmount > 0 ||
                    resolvedDiscount.extraAmount > 0
                      ? ')'
                      : ''}{' '}
                    · من {money(calc.discountBase)} → بعد الخصم{' '}
                    {money(calc.yearTarget)} IQD
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
                calc.outstandingBefore <= 0 ||
                calc.fullPayMismatch
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
