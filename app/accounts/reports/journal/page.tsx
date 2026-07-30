'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  currentMonthRange,
  currentWeekRange,
  type CashboxRegisterData,
  type CashboxRegisterRow,
} from '@/src/lib/accounts/cashbox-daily-register-types';
import { printCashboxDailyRegister } from './printCashboxDailyRegister';

const money = (n: number) =>
  new Intl.NumberFormat('en-US').format(Math.round(n || 0));

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const raw = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(iso);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
};

type CustomReportState = {
  open: boolean;
  department: string;
  stage: string;
  docType: '' | 'receipt' | 'payment';
  dateFrom: string;
  dateTo: string;
  format: 'excel' | 'pdf';
};

export default function CashboxDailyRegisterPage() {
  const [data, setData] = useState<CashboxRegisterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [stage, setStage] = useState('');
  const [docType, setDocType] = useState<'' | 'receipt' | 'payment'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<CustomReportState>({
    open: false,
    department: '',
    stage: '',
    docType: '',
    dateFrom: '',
    dateTo: '',
    format: 'pdf',
  });

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (department) p.set('department', department);
    if (stage) p.set('stage', stage);
    if (docType) p.set('doc_type', docType);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  }, [search, department, stage, docType, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/reports/journal${queryString}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error || 'تعذر تحميل سجل يومية الصندوق');
        setData(null);
        return;
      }
      const next = body.data as CashboxRegisterData;
      setData(next);
      const draft: Record<string, string> = {};
      for (const row of next.rows) draft[row.id] = row.notes || '';
      setNotesDraft(draft);
    } catch {
      setError('تعذر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function saveNotes(row: CashboxRegisterRow) {
    const notes = notesDraft[row.id] ?? '';
    if (notes === (row.notes || '')) return;
    setSavingNotesId(row.id);
    try {
      const res = await fetch('/api/accounts/reports/journal/notes', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_id: row.id, notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        alert(body.error || 'تعذر حفظ الملاحظات');
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) =>
                r.id === row.id ? { ...r, notes } : r
              ),
            }
          : prev
      );
    } catch {
      alert('تعذر الاتصال بالخادم');
    } finally {
      setSavingNotesId(null);
    }
  }

  async function exportExcel(
    params: URLSearchParams,
    reportTitle: string
  ): Promise<void> {
    params.set('report_title', reportTitle);
    const res = await fetch(
      `/api/accounts/reports/journal/excel?${params.toString()}`,
      { credentials: 'include', cache: 'no-store' }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'تعذر تصدير Excel');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `يومية-الصندوق-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportPdf(
    params: URLSearchParams,
    reportTitle: string
  ): Promise<void> {
    const res = await fetch(
      `/api/accounts/reports/journal?${params.toString()}`,
      { credentials: 'include', cache: 'no-store' }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error(body.error || 'تعذر تجهيز التقرير');
    }
    printCashboxDailyRegister(body.data as CashboxRegisterData, reportTitle);
  }

  async function runReport(
    kind: 'week' | 'month' | 'custom' | 'current',
    format: 'excel' | 'pdf',
    customFilters?: Partial<CustomReportState>
  ) {
    const key = `${kind}-${format}`;
    setExporting(key);
    try {
      const params = new URLSearchParams();
      let title = 'سجل يومية الصندوق — كلية الشرق';

      if (kind === 'week') {
        const { from, to } = currentWeekRange();
        params.set('date_from', from);
        params.set('date_to', to);
        title = `تقرير أسبوعي — يومية الصندوق (${formatDate(from)} → ${formatDate(to)})`;
      } else if (kind === 'month') {
        const { from, to } = currentMonthRange();
        params.set('date_from', from);
        params.set('date_to', to);
        title = `تقرير شهري — يومية الصندوق (${formatDate(from)} → ${formatDate(to)})`;
      } else if (kind === 'custom' && customFilters) {
        if (customFilters.department) params.set('department', customFilters.department);
        if (customFilters.stage) params.set('stage', customFilters.stage);
        if (customFilters.docType) params.set('doc_type', customFilters.docType);
        if (customFilters.dateFrom) params.set('date_from', customFilters.dateFrom);
        if (customFilters.dateTo) params.set('date_to', customFilters.dateTo);
        title = 'تقرير مخصص — يومية الصندوق';
      } else {
        if (search.trim()) params.set('search', search.trim());
        if (department) params.set('department', department);
        if (stage) params.set('stage', stage);
        if (docType) params.set('doc_type', docType);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        title = 'سجل يومية الصندوق — كلية الشرق';
      }

      if (format === 'excel') await exportExcel(params, title);
      else await exportPdf(params, title);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'تعذر إنشاء التقرير');
    } finally {
      setExporting(null);
    }
  }

  function resetFilters() {
    setSearch('');
    setDepartment('');
    setStage('');
    setDocType('');
    setDateFrom('');
    setDateTo('');
  }

  const hasFilters =
    !!search.trim() || !!department || !!stage || !!docType || !!dateFrom || !!dateTo;

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto" dir="rtl">
      <div className="mb-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <Link href="/accounts/reports" className="text-sm text-red-900 hover:underline">
            ← العودة إلى التقارير
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 mt-2">
            سجل يومية الصندوق — كلية الشرق
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            المقبوضات من وصولات تسديد الطلبة · البيان من اسم الطالب على الوصل
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={() => void runReport('week', 'pdf')}
            disabled={!!exporting}
            className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {exporting === 'week-pdf' ? '…' : 'تقرير أسبوعي PDF'}
          </button>
          <button
            type="button"
            onClick={() => void runReport('week', 'excel')}
            disabled={!!exporting}
            className="rounded-md border border-amber-700 text-amber-900 px-3 py-1.5 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50"
          >
            أسبوعي Excel
          </button>
          <button
            type="button"
            onClick={() => void runReport('month', 'pdf')}
            disabled={!!exporting}
            className="rounded-md bg-indigo-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-900 disabled:opacity-50"
          >
            {exporting === 'month-pdf' ? '…' : 'تقرير شهري PDF'}
          </button>
          <button
            type="button"
            onClick={() => void runReport('month', 'excel')}
            disabled={!!exporting}
            className="rounded-md border border-indigo-800 text-indigo-900 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-50 disabled:opacity-50"
          >
            شهري Excel
          </button>
          <button
            type="button"
            onClick={() =>
              setCustom((c) => ({
                ...c,
                open: true,
                department,
                stage,
                docType,
                dateFrom,
                dateTo,
              }))
            }
            className="rounded-md bg-red-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900"
          >
            تقرير مخصص
          </button>
          <button
            type="button"
            onClick={() => void runReport('current', 'pdf')}
            disabled={!!exporting || !data}
            className="rounded-md border border-red-900 text-red-950 px-3 py-1.5 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
          >
            طباعة الحالي
          </button>
          <button
            type="button"
            onClick={() => void runReport('current', 'excel')}
            disabled={!!exporting || !data}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
          >
            Excel الحالي
          </button>
        </div>
      </div>

      {/* فلاتر */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-red-950 text-white px-4 py-2.5">
          <p className="text-sm font-semibold">بحث وفلترة</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">بحث</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم الطالب / رقم الوصل / رقم الطالب…"
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">القسم</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            >
              <option value="">الكل</option>
              {(data?.departments || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">المرحلة</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            >
              <option value="">الكل</option>
              <option value="first">الأولى</option>
              <option value="second">الثانية</option>
              <option value="third">الثالثة</option>
              <option value="fourth">الرابعة</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">نوع المستند</label>
            <select
              value={docType}
              onChange={(e) =>
                setDocType(e.target.value as '' | 'receipt' | 'payment')
              }
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            >
              <option value="">الكل</option>
              <option value="receipt">قبض</option>
              <option value="payment">دفع</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasFilters}
              className="h-10 w-full rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              إعادة تعيين
            </button>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center text-gray-500 text-sm">جارٍ التحميل…</div>
      ) : data ? (
        <>
          <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs text-amber-800">عدد السجلات</p>
              <p className="text-xl font-bold tabular-nums">{data.totals.count}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-xs text-emerald-800">إجمالي مقبوضات الصندوق</p>
              <p className="text-xl font-bold tabular-nums text-emerald-800">
                {money(data.totals.cash_received)} IQD
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600">إيداعات البنك</p>
              <p className="text-xl font-bold tabular-nums text-slate-500">
                {money(data.totals.bank_deposit)} IQD
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-red-950 text-white">
                  <tr>
                    <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap">التسلسل</th>
                    <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                      حسابات الصندوق
                      <br />
                      <span className="text-[10px] font-normal text-red-100">(مقبوضات منه)</span>
                    </th>
                    <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                      حسابات البنك
                      <br />
                      <span className="text-[10px] font-normal text-red-100">(ايداعات له)</span>
                    </th>
                    <th className="px-2 py-2.5 text-right font-medium">البيان</th>
                    <th className="px-2 py-2.5 text-center font-medium">نوع المستند</th>
                    <th className="px-2 py-2.5 text-center font-medium">تاريخ المستند</th>
                    <th className="px-2 py-2.5 text-center font-medium">رقم المستند</th>
                    <th className="px-2 py-2.5 text-center font-medium">تاريخ الشيك</th>
                    <th className="px-2 py-2.5 text-center font-medium">رقم الشيك</th>
                    <th className="px-2 py-2.5 text-right font-medium">القسم</th>
                    <th className="px-2 py-2.5 text-center font-medium">المرحلة</th>
                    <th className="px-2 py-2.5 text-right font-medium min-w-[160px]">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-12 text-center text-gray-500">
                        لا توجد سجلات مطابقة للفلاتر الحالية
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-amber-50/40">
                        <td className="px-2 py-2 text-center tabular-nums text-gray-600">
                          {row.seq}
                        </td>
                        <td className="px-2 py-2 text-center font-bold tabular-nums text-emerald-800">
                          {money(row.cash_received)}
                        </td>
                        <td className="px-2 py-2 text-center text-slate-400">—</td>
                        <td className="px-2 py-2 font-medium text-red-950">
                          {row.statement}
                          <div className="text-[10px] text-gray-400 font-normal" dir="ltr">
                            {row.university_id}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            {row.doc_type_label}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center tabular-nums">
                          {formatDate(row.doc_date)}
                        </td>
                        <td className="px-2 py-2 text-center font-mono text-[11px]" dir="ltr">
                          {row.doc_number}
                        </td>
                        <td className="px-2 py-2 text-center text-slate-400">—</td>
                        <td className="px-2 py-2 text-center text-slate-400">—</td>
                        <td className="px-2 py-2 text-gray-700 max-w-[180px]">
                          <span className="line-clamp-2">{row.department}</span>
                        </td>
                        <td className="px-2 py-2 text-center">{row.stage_label}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={notesDraft[row.id] ?? ''}
                              onChange={(e) =>
                                setNotesDraft((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.value,
                                }))
                              }
                              onBlur={() => void saveNotes(row)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              placeholder="أدخل ملاحظة…"
                              className="h-8 w-full min-w-[140px] rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-red-800"
                            />
                            {savingNotesId === row.id ? (
                              <span className="text-[10px] text-gray-400 shrink-0">…</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {data.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-amber-50 font-semibold">
                      <td className="px-2 py-2.5 text-center">الإجمالي</td>
                      <td className="px-2 py-2.5 text-center text-emerald-800 tabular-nums">
                        {money(data.totals.cash_received)}
                      </td>
                      <td className="px-2 py-2.5 text-center text-slate-500">
                        {money(data.totals.bank_deposit)}
                      </td>
                      <td className="px-2 py-2.5" colSpan={9}>
                        {data.totals.count} سجل
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* مودال تقرير مخصص */}
      {custom.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50"
            aria-label="إغلاق"
            onClick={() => setCustom((c) => ({ ...c, open: false }))}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-red-950 text-white px-5 py-3">
              <p className="font-semibold">تقرير مخصص — يومية الصندوق</p>
              <p className="text-xs text-red-100/80 mt-0.5">
                حدّد القسم أو المرحلة أو نوع المستند أو الفترة ثم صدّر
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">القسم</label>
                <select
                  value={custom.department}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, department: e.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                >
                  <option value="">الكل</option>
                  {(data?.departments || []).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">المرحلة</label>
                <select
                  value={custom.stage}
                  onChange={(e) => setCustom((c) => ({ ...c, stage: e.target.value }))}
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                >
                  <option value="">الكل</option>
                  <option value="first">الأولى</option>
                  <option value="second">الثانية</option>
                  <option value="third">الثالثة</option>
                  <option value="fourth">الرابعة</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">نوع المستند</label>
                <select
                  value={custom.docType}
                  onChange={(e) =>
                    setCustom((c) => ({
                      ...c,
                      docType: e.target.value as '' | 'receipt' | 'payment',
                    }))
                  }
                  className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                >
                  <option value="">الكل</option>
                  <option value="receipt">قبض</option>
                  <option value="payment">دفع</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
                  <input
                    type="date"
                    value={custom.dateFrom}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, dateFrom: e.target.value }))
                    }
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
                  <input
                    type="date"
                    value={custom.dateTo}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, dateTo: e.target.value }))
                    }
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">صيغة التصدير</label>
                <div className="flex rounded-md border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCustom((c) => ({ ...c, format: 'pdf' }))}
                    className={[
                      'flex-1 h-10 text-sm font-semibold',
                      custom.format === 'pdf'
                        ? 'bg-red-950 text-white'
                        : 'bg-white text-gray-700',
                    ].join(' ')}
                  >
                    PDF (A4)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustom((c) => ({ ...c, format: 'excel' }))}
                    className={[
                      'flex-1 h-10 text-sm font-semibold border-r border-gray-300',
                      custom.format === 'excel'
                        ? 'bg-red-950 text-white'
                        : 'bg-white text-gray-700',
                    ].join(' ')}
                  >
                    Excel
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustom((c) => ({ ...c, open: false }))}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={!!exporting}
                onClick={() => {
                  void runReport('custom', custom.format, custom).then(() =>
                    setCustom((c) => ({ ...c, open: false }))
                  );
                }}
                className="rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              >
                {exporting?.startsWith('custom') ? 'جارٍ التجهيز…' : 'تصدير التقرير'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
