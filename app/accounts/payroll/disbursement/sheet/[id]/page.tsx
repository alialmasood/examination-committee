'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PayrollNav from '../../../PayrollNav';
import {
  disbursementSheetCopyPreviousUrl,
  disbursementSheetDisburseUrl,
  disbursementSheetLockUrl,
  disbursementSheetUnlockUrl,
  disbursementSheetUrl,
  errMsg,
  fetchJson,
} from '../../../_lib';
import { printDisbursementSheet } from '../../printDisbursementSheet';
import { printSocialSecurityAnnex } from '../../printSocialSecurityAnnex';

type AssignmentLine = {
  id: string;
  payroll_assignment_id: string;
  assignment_code_snapshot: string;
  assignment_title_snapshot: string;
  amount: string;
  is_partial: boolean;
};

type Line = {
  id: string;
  payroll_person_id: string;
  person_code_snapshot: string;
  person_name_snapshot: string;
  base_amount: string;
  allowances_amount: string;
  deductions_amount: string;
  notes: string | null;
  line_status: string;
  academic_title: string | null;
  degree: string | null;
  job_title: string | null;
  department_name: string | null;
  assignments: AssignmentLine[];
  assignments_total: string;
  grand_total: string;
};

type PreviousMonthLine = {
  payroll_person_id: string;
  person_name: string;
  base_amount: string;
  assignments_total: string;
  allowances_amount: string;
  deductions_amount: string;
};

type SheetDetail = {
  sheet: {
    id: string;
    version: number;
    status: string;
    person_category: string;
    category_label: string;
    year_label: string;
    month_number: number;
    month_label: string;
    month_status: string;
    lecturer_hour_rate?: string;
  };
  lines: Line[];
  summary: {
    people_count: number;
    entered_count: number;
    base_total: string;
    assignments_total: string;
    allowances_total: string;
    deductions_total: string;
    grand_total: string;
    hours_total?: string | null;
  };
  previous_month: {
    month_number: number;
    month_label: string;
    lecturer_hour_rate?: string;
    lines: PreviousMonthLine[];
  } | null;
};

type ComparisonChange = {
  payroll_person_id: string;
  person_name: string;
  reason: string;
  previous_total: number;
  current_total: number;
  diff: number;
};

type LineDraft = {
  base_amount: string;
  allowances_amount: string;
  deductions_amount: string;
  assignments: Record<string, string>;
};

const STATUS_LABEL: Record<string, string> = {
  EMPTY: 'فارغ',
  DRAFT: 'مسودة',
  SAVED: 'محفوظ',
  LOCKED: 'مقفل',
  DISBURSED: 'مصروف',
  ENTERED: 'مُدخل',
};

const CATEGORY_SHORT: Record<string, string> = {
  TEACHING_STAFF: 'التدريسيين',
  EXTERNAL_LECTURER: 'المحاضرين',
  EMPLOYEE: 'الموظفين',
  DAILY_WORKER: 'الأجور اليومية',
};

function money(v: string | number) {
  return Number(v || 0);
}

function lineNet(base: number, asg: number, allowances: number, deductions: number) {
  return base + asg + allowances - deductions;
}

function formatMoney(v: string | number) {
  return money(v).toLocaleString('en-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-red-900 focus:ring-1 focus:ring-red-900';

export default function DisbursementSheetPage() {
  const params = useParams<{ id: string }>();
  const sheetId = params?.id;
  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, LineDraft>>({});
  const [lecturerHourRate, setLecturerHourRate] = useState('0');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [reasonsOpen, setReasonsOpen] = useState(false);

  const readOnly = detail?.sheet.status === 'LOCKED' || detail?.sheet.status === 'DISBURSED';
  const isLecturerSheet = detail?.sheet.person_category === 'EXTERNAL_LECTURER';

  function lineSalary(hoursOrBase: number): number {
    if (!isLecturerSheet) return hoursOrBase;
    return hoursOrBase * money(lecturerHourRate);
  }

  const hydrateDraft = useCallback((lines: Line[]) => {
    const next: Record<string, LineDraft> = {};
    for (const line of lines) {
      next[line.id] = {
        base_amount: line.base_amount,
        allowances_amount: line.allowances_amount || '0',
        deductions_amount: line.deductions_amount || '0',
        assignments: Object.fromEntries(line.assignments.map((a) => [a.id, a.amount])),
      };
    }
    setDraft(next);
  }, []);

  const load = useCallback(async () => {
    if (!sheetId) return;
    setLoading(true);
    setError('');
    const r = await fetchJson(disbursementSheetUrl(sheetId));
    if (!r.__ok) {
      setError(errMsg(r));
      setDetail(null);
      setLoading(false);
      return;
    }
    setDetail(r.data);
    hydrateDraft(r.data.lines || []);
    setLecturerHourRate(r.data?.sheet?.lecturer_hour_rate ?? '0');
    setLoading(false);
  }, [sheetId, hydrateDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleLines = useMemo(() => {
    if (!detail) return [];
    return detail.lines.filter((line) => {
      const text = `${line.person_name_snapshot} ${line.person_code_snapshot}`.toLowerCase();
      if (q.trim() && !text.includes(q.trim().toLowerCase())) return false;
      if (incompleteOnly) {
        const d = draft[line.id];
        const base = money(d?.base_amount ?? line.base_amount);
        const asg = Object.values(d?.assignments || {}).reduce((s, a) => s + money(a), 0);
        const allowances = money(d?.allowances_amount ?? line.allowances_amount);
        const deductions = money(d?.deductions_amount ?? line.deductions_amount);
        if (base > 0 || asg > 0 || allowances > 0 || deductions > 0) return false;
      }
      return true;
    });
  }, [detail, draft, q, incompleteOnly]);

  const liveSummary = useMemo(() => {
    if (!detail) {
      return { people: 0, entered: 0, hours: 0, base: 0, asg: 0, allowances: 0, deductions: 0, grand: 0 };
    }
    const rate = money(lecturerHourRate);
    let entered = 0;
    let hours = 0;
    let base = 0;
    let asg = 0;
    let allowances = 0;
    let deductions = 0;
    for (const line of detail.lines) {
      const d = draft[line.id];
      const b = money(d?.base_amount ?? line.base_amount);
      const salary = isLecturerSheet ? b * rate : b;
      const a = Object.values(d?.assignments || {}).reduce((s, x) => s + money(x), 0);
      const all = money(d?.allowances_amount ?? line.allowances_amount);
      const ded = money(d?.deductions_amount ?? line.deductions_amount);
      hours += b;
      base += salary;
      asg += a;
      allowances += all;
      deductions += ded;
      if (b > 0 || a > 0 || all > 0 || ded > 0) entered += 1;
    }
    return {
      people: detail.lines.length,
      entered,
      hours,
      base,
      asg,
      allowances,
      deductions,
      grand: lineNet(base, asg, allowances, deductions),
    };
  }, [detail, draft, isLecturerSheet, lecturerHourRate]);

  // مقارنة حية مع الشهر السابق تعتمد قيم الإدخال الحالية قبل الحفظ
  const comparison = useMemo(() => {
    if (!detail?.previous_month) return null;
    const EPS = 0.0005;
    const prevByPerson = new Map(
      detail.previous_month.lines.map((p) => [p.payroll_person_id, p])
    );
    const seen = new Set<string>();
    const changes: ComparisonChange[] = [];
    let previousTotal = 0;
    let currentTotal = 0;
    const prevRate = money(
      detail.previous_month.lecturer_hour_rate ?? detail.sheet.lecturer_hour_rate ?? 0
    );
    const curRate = money(lecturerHourRate);

    const prevSalary = (hoursOrBase: number) =>
      isLecturerSheet ? hoursOrBase * prevRate : hoursOrBase;
    const curSalary = (hoursOrBase: number) =>
      isLecturerSheet ? hoursOrBase * curRate : hoursOrBase;

    for (const p of detail.previous_month.lines) {
      previousTotal += lineNet(
        prevSalary(money(p.base_amount)),
        money(p.assignments_total),
        money(p.allowances_amount),
        money(p.deductions_amount)
      );
    }

    for (const line of detail.lines) {
      const d = draft[line.id];
      const cur = lineNet(
        curSalary(money(d?.base_amount ?? line.base_amount)),
        Object.values(d?.assignments || {}).reduce((s, a) => s + money(a), 0),
        money(d?.allowances_amount ?? line.allowances_amount),
        money(d?.deductions_amount ?? line.deductions_amount)
      );
      currentTotal += cur;
      seen.add(line.payroll_person_id);
      const prev = prevByPerson.get(line.payroll_person_id);
      if (!prev) {
        if (cur > EPS) {
          changes.push({
            payroll_person_id: line.payroll_person_id,
            person_name: line.person_name_snapshot,
            reason: 'اسم جديد أُضيف هذا الشهر',
            previous_total: 0,
            current_total: cur,
            diff: cur,
          });
        }
        continue;
      }
      const prevTotal = lineNet(
        prevSalary(money(prev.base_amount)),
        money(prev.assignments_total),
        money(prev.allowances_amount),
        money(prev.deductions_amount)
      );
      const diff = cur - prevTotal;
      if (Math.abs(diff) <= EPS) continue;
      changes.push({
        payroll_person_id: line.payroll_person_id,
        person_name: line.person_name_snapshot,
        reason: diff > 0 ? 'زاد الإجمالي' : 'قل الإجمالي',
        previous_total: prevTotal,
        current_total: cur,
        diff,
      });
    }
    for (const p of detail.previous_month.lines) {
      if (seen.has(p.payroll_person_id)) continue;
      const prevTotal = lineNet(
        prevSalary(money(p.base_amount)),
        money(p.assignments_total),
        money(p.allowances_amount),
        money(p.deductions_amount)
      );
      if (prevTotal <= EPS) continue;
      changes.push({
        payroll_person_id: p.payroll_person_id,
        person_name: p.person_name,
        reason: 'غير موجود في كشف هذا الشهر',
        previous_total: prevTotal,
        current_total: 0,
        diff: -prevTotal,
      });
    }
    changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const diff = currentTotal - previousTotal;
    return {
      month_label: detail.previous_month.month_label,
      previous_total: previousTotal,
      current_total: currentTotal,
      diff,
      direction: Math.abs(diff) <= EPS ? 'equal' : diff > 0 ? 'higher' : 'lower',
      changes,
    };
  }, [detail, draft, isLecturerSheet, lecturerHourRate]);

  function patchDraft(lineId: string, patch: Partial<LineDraft>) {
    setDraft((prev) => ({
      ...prev,
      [lineId]: {
        base_amount: prev[lineId]?.base_amount || '0',
        allowances_amount: prev[lineId]?.allowances_amount || '0',
        deductions_amount: prev[lineId]?.deductions_amount || '0',
        assignments: prev[lineId]?.assignments || {},
        ...patch,
      },
    }));
  }

  function setBase(lineId: string, value: string) {
    patchDraft(lineId, { base_amount: value });
  }

  function setAllowances(lineId: string, value: string) {
    patchDraft(lineId, { allowances_amount: value });
  }

  function setDeductions(lineId: string, value: string) {
    patchDraft(lineId, { deductions_amount: value });
  }

  function setAssignmentAmount(lineId: string, asgId: string, value: string) {
    setDraft((prev) => ({
      ...prev,
      [lineId]: {
        base_amount: prev[lineId]?.base_amount || '0',
        allowances_amount: prev[lineId]?.allowances_amount || '0',
        deductions_amount: prev[lineId]?.deductions_amount || '0',
        assignments: {
          ...(prev[lineId]?.assignments || {}),
          [asgId]: value,
        },
      },
    }));
  }

  async function saveAll() {
    if (!detail || readOnly) return;
    setSaving(true);
    setError('');
    setMessage('');
    const lines = detail.lines.map((line) => ({
      id: line.id,
      base_amount: draft[line.id]?.base_amount ?? line.base_amount,
      allowances_amount: draft[line.id]?.allowances_amount ?? line.allowances_amount,
      deductions_amount: draft[line.id]?.deductions_amount ?? line.deductions_amount,
      assignments: line.assignments.map((a) => ({
        id: a.id,
        amount: draft[line.id]?.assignments?.[a.id] ?? a.amount,
      })),
    }));
    const r = await fetchJson(disbursementSheetUrl(detail.sheet.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: detail.sheet.version,
        lecturer_hour_rate: isLecturerSheet ? lecturerHourRate : undefined,
        lines,
      }),
    });
    setSaving(false);
    if (!r.__ok) {
      setError(errMsg(r));
      return;
    }
    setDetail(r.data);
    hydrateDraft(r.data.lines || []);
    setLecturerHourRate(r.data?.sheet?.lecturer_hour_rate ?? lecturerHourRate);
    setMessage('تم حفظ الكشف بنجاح');
  }

  async function runAction(
    url: string,
    body: Record<string, unknown> = {},
    successMsg: string
  ) {
    if (!detail) return;
    setSaving(true);
    setError('');
    setMessage('');
    const r = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: detail.sheet.version, ...body }),
    });
    setSaving(false);
    if (!r.__ok) {
      setError(errMsg(r));
      return;
    }
    setDetail(r.data);
    hydrateDraft(r.data.lines || []);
    setLecturerHourRate(r.data?.sheet?.lecturer_hour_rate ?? lecturerHourRate);
    setMessage(successMsg);
  }

  function handlePrintPdf() {
    if (!detail) return;
    const rows = detail.lines.map((line) => {
      const d = draft[line.id];
      const hoursOrBase = money(d?.base_amount ?? line.base_amount);
      const salary = lineSalary(hoursOrBase);
      const assignments = Object.values(d?.assignments || {}).reduce((s, a) => s + money(a), 0);
      const allowancesField = money(d?.allowances_amount ?? line.allowances_amount);
      const allowances = allowancesField + assignments;
      const deductions = money(d?.deductions_amount ?? line.deductions_amount);
      const subtotal = salary + allowances;
      const socialSecurity = salary * 0.05;
      const netPayable = subtotal - socialSecurity - deductions;
      return {
        name: line.person_name_snapshot,
        degree: line.degree || '',
        position: line.job_title || line.academic_title || '',
        salary,
        allowances,
        subtotal,
        social_security: socialSecurity,
        deductions,
        net_payable: netPayable,
      };
    });
    const totals = rows.reduce(
      (acc, row) => {
        acc.salary += row.salary;
        acc.allowances += row.allowances;
        acc.subtotal += row.subtotal;
        acc.social_security += row.social_security;
        acc.deductions += row.deductions;
        acc.net_payable += row.net_payable;
        return acc;
      },
      {
        salary: 0,
        allowances: 0,
        subtotal: 0,
        social_security: 0,
        deductions: 0,
        net_payable: 0,
      }
    );
    printDisbursementSheet({
      category_label: detail.sheet.category_label,
      month_label: detail.sheet.month_label,
      year_label: detail.sheet.year_label,
      status_label: STATUS_LABEL[detail.sheet.status] || detail.sheet.status,
      rows,
      people_count: rows.length,
      totals,
    });

    // ملحق الضمان يُطبع مباشرة بعد كشف الراتب
    window.setTimeout(() => {
      handlePrintSocialSecurityAnnex();
    }, 700);
  }

  function handlePrintSocialSecurityAnnex() {
    if (!detail) return;
    const rows = detail.lines.map((line) => {
      const d = draft[line.id];
      const hoursOrBase = money(d?.base_amount ?? line.base_amount);
      const salary = lineSalary(hoursOrBase);
      const pct5 = salary * 0.05;
      const pct12 = salary * 0.12;
      return {
        name: line.person_name_snapshot,
        degree: line.degree || '',
        position: line.job_title || line.academic_title || '',
        salary,
        pct5,
        pct12,
        pct17: pct5 + pct12,
      };
    });
    const totals = rows.reduce(
      (acc, row) => {
        acc.salary += row.salary;
        acc.pct5 += row.pct5;
        acc.pct12 += row.pct12;
        acc.pct17 += row.pct17;
        return acc;
      },
      { salary: 0, pct5: 0, pct12: 0, pct17: 0 }
    );
    printSocialSecurityAnnex({
      category_short:
        CATEGORY_SHORT[detail.sheet.person_category] || detail.sheet.category_label,
      month_label: detail.sheet.month_label,
      year_label: detail.sheet.year_label,
      rows,
      people_count: rows.length,
      totals,
    });
  }

  if (loading) {
    return (
      <main dir="rtl" className="p-4 w-full">
        <PayrollNav />
        <div className="py-16 text-center text-gray-500">جاري تحميل الكشف…</div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main dir="rtl" className="p-4 w-full">
        <PayrollNav />
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error || 'تعذر تحميل الكشف'}
        </div>
        <Link href="/accounts/payroll/disbursement" className="mt-3 inline-block text-sm text-red-900 underline">
          العودة لصرف الرواتب
        </Link>
      </main>
    );
  }

  return (
    <main dir="rtl" className="p-4 w-full pb-36">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{detail.sheet.category_label}</h1>
          <p className="text-sm text-gray-600">
            {detail.sheet.month_label} {detail.sheet.year_label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
            {STATUS_LABEL[detail.sheet.status] || detail.sheet.status}
          </span>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900"
          >
            طباعة PDF
          </button>
          <button
            type="button"
            onClick={handlePrintSocialSecurityAnnex}
            className="rounded-md border border-amber-800 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
          >
            طباعة ملحق الضمان
          </button>
          <Link
            href="/accounts/payroll/disbursement"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            رجوع
          </Link>
        </div>
      </div>
      <PayrollNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-gray-700">بحث</label>
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="الاسم أو الرمز…"
          />
        </div>
        <label className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(e) => setIncompleteOnly(e.target.checked)}
          />
          غير مكتمل فقط
        </label>
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
            >
              {saving ? 'جاري الحفظ…' : 'حفظ الكل'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (confirm('نسخ مبالغ الشهر السابق إلى هذا الكشف؟')) {
                  void runAction(
                    disbursementSheetCopyPreviousUrl(detail.sheet.id),
                    {},
                    'تم نسخ مبالغ الشهر السابق'
                  );
                }
              }}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              نسخ الشهر السابق
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void runAction(disbursementSheetLockUrl(detail.sheet.id), {}, 'تم قفل الكشف')
              }
              className="rounded-md border border-amber-700 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              قفل الكشف
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void runAction(
                  disbursementSheetDisburseUrl(detail.sheet.id),
                  {},
                  'تم تأكيد الصرف'
                )
              }
              className="rounded-md border border-emerald-700 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
            >
              تأكيد الصرف
            </button>
          </>
        )}
        {detail.sheet.status === 'LOCKED' && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setUnlockReason('');
              setUnlockOpen(true);
            }}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            فك القفل
          </button>
        )}
      </div>

      <div className="mb-3 h-2 overflow-hidden rounded bg-gray-100">
        <div
          className="h-full bg-red-900 transition-all"
          style={{
            width: `${liveSummary.people ? (liveSummary.entered / liveSummary.people) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="mb-3 text-xs text-gray-600">
        اكتمال الإدخال: {liveSummary.entered} من {liveSummary.people}
      </div>

      {!comparison ? (
        <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          لا توجد بيانات للشهر السابق للمقارنة
        </div>
      ) : (
        <div
          className={`mb-3 rounded-md border px-3 py-2.5 text-sm ${
            comparison.direction === 'higher'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : comparison.direction === 'lower'
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : 'border-gray-200 bg-gray-50 text-gray-700'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              {comparison.direction === 'equal' ? (
                <>إجمالي هذا الكشف مطابق لإجمالي شهر {comparison.month_label}</>
              ) : (
                <>
                  تنبيه: إجمالي هذا الكشف{' '}
                  {comparison.direction === 'higher' ? 'أعلى' : 'أقل'} من شهر{' '}
                  {comparison.month_label} بمبلغ{' '}
                  <span dir="ltr">{formatMoney(Math.abs(comparison.diff))}</span>
                </>
              )}
              <span className="mr-3 text-xs font-normal">
                (السابق: <span dir="ltr">{formatMoney(comparison.previous_total)}</span> — الحالي:{' '}
                <span dir="ltr">{formatMoney(comparison.current_total)}</span>)
              </span>
            </div>
            {comparison.changes.length > 0 && (
              <button
                type="button"
                onClick={() => setReasonsOpen((v) => !v)}
                className="rounded border border-black/20 bg-white/70 px-2 py-1 text-xs font-semibold hover:bg-white"
              >
                {reasonsOpen ? 'إخفاء الأسباب' : `عرض الأسباب (${comparison.changes.length})`}
              </button>
            )}
          </div>
          {reasonsOpen && comparison.changes.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-black/10 pt-2 text-xs">
              {comparison.changes.slice(0, 8).map((c) => (
                <li key={c.payroll_person_id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.person_name}</span>
                  <span>— {c.reason}</span>
                  <span dir="ltr" className="font-mono">
                    {formatMoney(c.previous_total)} ← {formatMoney(c.current_total)}
                  </span>
                  <span
                    dir="ltr"
                    className={`font-bold ${c.diff > 0 ? 'text-emerald-800' : 'text-red-800'}`}
                  >
                    {c.diff > 0 ? '+' : '−'}
                    {formatMoney(Math.abs(c.diff))}
                  </span>
                </li>
              ))}
              {comparison.changes.length > 8 && (
                <li className="text-[11px] text-gray-600">
                  و{comparison.changes.length - 8} تغييرات أخرى — التفاصيل الكاملة في تقرير الشهر
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm table-fixed">
          <thead>
            <tr className="border-b border-gray-200 bg-red-950 text-white">
              <th className="w-10 px-2 py-2.5 text-right font-semibold">#</th>
              <th className="px-2 py-2.5 text-right font-semibold">الاسم</th>
              <th className="w-[110px] px-2 py-2.5 text-right font-semibold">
                {isLecturerSheet ? 'عدد الساعات' : 'الراتب الأساسي'}
              </th>
              {isLecturerSheet && (
                <th className="w-[120px] px-2 py-2.5 text-right font-semibold">الراتب</th>
              )}
              <th className="w-[110px] px-2 py-2.5 text-right font-semibold">المخصصات</th>
              <th className="w-[110px] px-2 py-2.5 text-right font-semibold">الاستقطاعات</th>
              <th className="w-[100px] px-2 py-2.5 text-right font-semibold">التكليفات</th>
              <th className="w-[120px] px-2 py-2.5 text-right font-semibold">الإجمالي</th>
              <th className="w-[100px] px-2 py-2.5 text-center font-semibold">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {visibleLines.length === 0 ? (
              <tr>
                <td
                  colSpan={isLecturerSheet ? 9 : 8}
                  className="px-3 py-10 text-center text-gray-500"
                >
                  لا توجد أسطر مطابقة
                </td>
              </tr>
            ) : (
              visibleLines.map((line, idx) => {
                const d = draft[line.id];
                const hoursOrBase = money(d?.base_amount ?? line.base_amount);
                const salary = lineSalary(hoursOrBase);
                const asgTotal = Object.values(d?.assignments || {}).reduce(
                  (s, a) => s + money(a),
                  0
                );
                const allowances = money(d?.allowances_amount ?? line.allowances_amount);
                const deductions = money(d?.deductions_amount ?? line.deductions_amount);
                const open = !!expanded[line.id];
                return (
                  <Fragment key={line.id}>
                    <tr className="border-b border-gray-100 odd:bg-white even:bg-gray-50/70">
                      <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium text-gray-900 leading-snug">
                          {line.person_name_snapshot}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className={inputClass}
                          dir="ltr"
                          value={d?.base_amount ?? line.base_amount}
                          disabled={readOnly || saving}
                          onChange={(e) => setBase(line.id, e.target.value)}
                        />
                      </td>
                      {isLecturerSheet && (
                        <td
                          className="px-2 py-2 font-semibold whitespace-nowrap text-gray-800"
                          dir="ltr"
                        >
                          {formatMoney(salary)}
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <input
                          className={inputClass}
                          dir="ltr"
                          value={d?.allowances_amount ?? line.allowances_amount ?? '0'}
                          disabled={readOnly || saving}
                          onChange={(e) => setAllowances(line.id, e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className={inputClass}
                          dir="ltr"
                          value={d?.deductions_amount ?? line.deductions_amount ?? '0'}
                          disabled={readOnly || saving}
                          onChange={(e) => setDeductions(line.id, e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap" dir="ltr">
                        {formatMoney(asgTotal)}
                        {line.assignments.some((a) => a.is_partial) && (
                          <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
                            جزئي
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-semibold whitespace-nowrap" dir="ltr">
                        {formatMoney(lineNet(salary, asgTotal, allowances, deductions))}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-900 hover:underline whitespace-nowrap"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [line.id]: !prev[line.id] }))
                          }
                        >
                          {open ? 'إخفاء' : `تكليفات (${line.assignments.length})`}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-gray-100 bg-red-50/30">
                        <td colSpan={isLecturerSheet ? 9 : 8} className="px-4 py-3">
                          {line.assignments.length === 0 ? (
                            <div className="text-xs text-gray-500">
                              لا توجد تكليفات نشطة لهذا الشهر
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {line.assignments.map((a) => (
                                <div
                                  key={a.id}
                                  className="grid grid-cols-1 gap-2 rounded border border-gray-200 bg-white p-2 sm:grid-cols-4 sm:items-center"
                                >
                                  <div className="text-xs font-mono" dir="ltr">
                                    {a.assignment_code_snapshot}
                                  </div>
                                  <div className="text-sm sm:col-span-2">
                                    {a.assignment_title_snapshot}
                                    {a.is_partial && (
                                      <span className="mr-2 text-[10px] font-semibold text-amber-800">
                                        (جزئي خلال الشهر)
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    className={inputClass}
                                    dir="ltr"
                                    disabled={readOnly || saving}
                                    value={d?.assignments?.[a.id] ?? a.amount}
                                    onChange={(e) =>
                                      setAssignmentAmount(line.id, a.id, e.target.value)
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isLecturerSheet && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full sm:w-56">
              <label className="mb-1 block text-xs font-semibold text-amber-950">
                مبلغ ساعة المحاضر
              </label>
              <input
                className={inputClass}
                dir="ltr"
                value={lecturerHourRate}
                disabled={readOnly || saving}
                onChange={(e) => setLecturerHourRate(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="text-sm text-amber-950/80">
              <span className="font-semibold">احتساب الراتب:</span> عدد الساعات × مبلغ الساعة
              <span className="mx-2 text-amber-800/50">|</span>
              مجموع الساعات:{' '}
              <strong dir="ltr">{formatMoney(liveSummary.hours)}</strong>
              <span className="mx-2 text-amber-800/50">|</span>
              مجموع الرواتب:{' '}
              <strong dir="ltr">{formatMoney(liveSummary.base)}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap gap-4 text-gray-700">
            <span>
              الأسطر: <strong>{liveSummary.people}</strong>
            </span>
            {isLecturerSheet ? (
              <>
                <span>
                  الساعات:{' '}
                  <strong dir="ltr">{formatMoney(liveSummary.hours)}</strong>
                </span>
                <span>
                  الرواتب:{' '}
                  <strong dir="ltr">{formatMoney(liveSummary.base)}</strong>
                </span>
              </>
            ) : (
              <span>
                الأساسي:{' '}
                <strong dir="ltr">{formatMoney(liveSummary.base)}</strong>
              </span>
            )}
            <span>
              التكليفات:{' '}
              <strong dir="ltr">{formatMoney(liveSummary.asg)}</strong>
            </span>
            <span>
              المخصصات:{' '}
              <strong dir="ltr">{formatMoney(liveSummary.allowances)}</strong>
            </span>
            <span>
              الاستقطاعات:{' '}
              <strong dir="ltr">{formatMoney(liveSummary.deductions)}</strong>
            </span>
            <span>
              الإجمالي:{' '}
              <strong className="text-red-950" dir="ltr">
                {formatMoney(liveSummary.grand)}
              </strong>
            </span>
          </div>
          {!readOnly && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
            >
              حفظ الكشف
            </button>
          )}
        </div>
      </div>

      {unlockOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => !saving && setUnlockOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b bg-amber-800 px-4 py-3 text-white font-bold">فك قفل الكشف</div>
            <div className="space-y-3 p-4">
              <label className="mb-1 block text-xs font-semibold text-gray-700">
                سبب فك القفل <span className="text-red-700">*</span>
              </label>
              <textarea
                className={inputClass}
                rows={3}
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border px-4 py-2 text-sm"
                  onClick={() => setUnlockOpen(false)}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={saving || !unlockReason.trim()}
                  className="rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => {
                    setUnlockOpen(false);
                    void runAction(
                      disbursementSheetUnlockUrl(detail.sheet.id),
                      { reason: unlockReason.trim() },
                      'تم فك قفل الكشف'
                    );
                  }}
                >
                  تأكيد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
