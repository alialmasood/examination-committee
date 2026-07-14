'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../../../cashbox/sessions/components/ConfirmDialog';
import {
  bankApi,
  BankReconciliationSummary,
  BankStatementDetail,
  BankStatementLine,
  BankStatementOptions,
  BookItem,
  CommitCsvResult,
  formatDateOnly,
  formatMoney,
  lineSide,
  MATCH_STATUS_LABEL,
  matchStatusClass,
  MatchSuggestion,
  ParsedCsvLine,
  PreviewCsvResult,
  STATEMENT_STATUS_LABEL,
  statementStatusClass,
} from '../components/types';

type CsvMappingForm = {
  transaction_date: string;
  value_date: string;
  description: string;
  reference: string;
  debit: string;
  credit: string;
  balance: string;
  external_id: string;
};

const DEFAULT_MAPPING: CsvMappingForm = {
  transaction_date: 'Date',
  value_date: '',
  description: 'Description',
  reference: 'Reference',
  debit: 'Debit',
  credit: 'Credit',
  balance: 'Balance',
  external_id: '',
};

export default function BankStatementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [statement, setStatement] = useState<BankStatementDetail | null>(null);
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [summary, setSummary] = useState<BankReconciliationSummary | null>(null);
  const [options, setOptions] = useState<BankStatementOptions | null>(null);
  const [bookItems, setBookItems] = useState<BookItem[]>([]);
  const [bookItemsTotal, setBookItemsTotal] = useState(0);
  const [bookItemsPage, setBookItemsPage] = useState(1);
  const [bookItemsQ, setBookItemsQ] = useState('');
  const [bookItemsUnmatchedOnly, setBookItemsUnmatchedOnly] = useState(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<
    'start' | 'reconcile' | 'close' | 'reopen' | null
  >(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const [addLineOpen, setAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState({
    transaction_date: '',
    value_date: '',
    description: '',
    bank_reference: '',
    side: 'DEBIT' as 'DEBIT' | 'CREDIT',
    amount: '',
    external_line_id: '',
  });

  const [excludeLineId, setExcludeLineId] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState('');

  const [adjustLineId, setAdjustLineId] = useState<string | null>(null);
  const [adjustCounterAccountId, setAdjustCounterAccountId] = useState('');
  const [adjustCostCenterId, setAdjustCostCenterId] = useState('');
  const [adjustDescription, setAdjustDescription] = useState('');

  const [matchLineId, setMatchLineId] = useState<string | null>(null);
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([]);
  const [matchJournalEntryId, setMatchJournalEntryId] = useState('');
  const [matchJournalEntryLineId, setMatchJournalEntryLineId] = useState('');
  const [matchAmount, setMatchAmount] = useState('');
  const [matchType, setMatchType] = useState<'MANUAL' | 'SYSTEM_SUGGESTED'>('MANUAL');
  const [matchNotes, setMatchNotes] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvMapping, setCsvMapping] = useState<CsvMappingForm>(DEFAULT_MAPPING);
  const [csvPreview, setCsvPreview] = useState<PreviewCsvResult | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<CommitCsvResult | null>(null);

  const loadStatement = useCallback(async () => {
    if (!id) return;
    const res = await bankApi<BankStatementDetail>(
      `/api/accounts/bank-statements/${id}`
    );
    if (!res.success || !res.data) {
      setError(res.message || 'تعذر تحميل كشف الحساب');
      setStatement(null);
      return;
    }
    setStatement(res.data);
    setError(null);
  }, [id]);

  const loadLines = useCallback(async () => {
    if (!id) return;
    const res = await bankApi<BankStatementLine[]>(
      `/api/accounts/bank-statements/${id}/lines?page_size=500`
    );
    if (res.success) setLines(res.data || []);
  }, [id]);

  const loadSummary = useCallback(async () => {
    if (!id) return;
    const res = await bankApi<BankReconciliationSummary>(
      `/api/accounts/bank-statements/${id}/summary`
    );
    if (res.success) setSummary(res.data || null);
  }, [id]);

  const loadOptions = useCallback(async () => {
    const res = await bankApi<BankStatementOptions>('/api/accounts/bank-statements/options');
    if (res.success) setOptions(res.data || null);
  }, []);

  const loadBookItems = useCallback(async () => {
    if (!id) return;
    const p = new URLSearchParams({
      page: String(bookItemsPage),
      page_size: '30',
      unmatched_only: bookItemsUnmatchedOnly ? 'true' : 'false',
    });
    if (bookItemsQ.trim()) p.set('q', bookItemsQ.trim());
    const res = await bankApi<BookItem[]>(
      `/api/accounts/bank-statements/${id}/book-items?${p.toString()}`
    );
    if (res.success) {
      setBookItems(res.data || []);
      const pag = res.pagination as { total?: number } | undefined;
      setBookItemsTotal(pag?.total || 0);
    }
  }, [id, bookItemsPage, bookItemsQ, bookItemsUnmatchedOnly]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStatement(), loadLines(), loadSummary(), loadBookItems()]);
    setLoading(false);
  }, [loadStatement, loadLines, loadSummary, loadBookItems]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch options on mount
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch book items when filters change
    void loadBookItems();
  }, [loadBookItems]);

  const refreshAfterMutation = async () => {
    await Promise.all([loadStatement(), loadLines(), loadSummary(), loadBookItems()]);
  };

  const runAction = async (action: 'start' | 'reconcile' | 'close' | 'reopen') => {
    if (!statement) return;
    setBusy(true);
    setActionError(null);
    const needsVersion = action === 'start';
    const res = await bankApi(`/api/accounts/bank-statements/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(
        needsVersion
          ? { version: statement.version, updated_at: statement.updated_at }
          : {}
      ),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر تنفيذ العملية');
      return;
    }
    setConfirmAction(null);
    const labels: Record<string, string> = {
      start: 'تم بدء التسوية',
      reconcile: 'تم إنهاء التسوية',
      close: 'تم إغلاق الكشف',
      reopen: 'تمت إعادة فتح الكشف',
    };
    setSuccess(labels[action] || 'تم تنفيذ العملية');
    await refreshAfterMutation();
  };

  const doCancel = async () => {
    if (!statement) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-statements/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        version: statement.version,
        updated_at: statement.updated_at,
        reason: cancelReason,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الإلغاء');
      return;
    }
    setConfirmCancel(false);
    setCancelReason('');
    setSuccess('تم إلغاء الكشف');
    await refreshAfterMutation();
  };

  const addLine = async () => {
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-statements/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({
        transaction_date: newLine.transaction_date,
        value_date: newLine.value_date || null,
        description: newLine.description,
        bank_reference: newLine.bank_reference || null,
        debit_amount: newLine.side === 'DEBIT' ? newLine.amount : '0',
        credit_amount: newLine.side === 'CREDIT' ? newLine.amount : '0',
        external_line_id: newLine.external_line_id || null,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر إضافة السطر');
      return;
    }
    setAddLineOpen(false);
    setNewLine({
      transaction_date: '',
      value_date: '',
      description: '',
      bank_reference: '',
      side: 'DEBIT',
      amount: '',
      external_line_id: '',
    });
    setSuccess('تمت إضافة السطر');
    await refreshAfterMutation();
  };

  const deleteLine = async (lineId: string) => {
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-statements/${id}/lines/${lineId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر حذف السطر');
      return;
    }
    setSuccess('تم حذف السطر');
    await refreshAfterMutation();
  };

  const openExclude = (lineId: string) => {
    setActionError(null);
    setExcludeReason('');
    setExcludeLineId(lineId);
  };

  const doExclude = async () => {
    if (!excludeLineId) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-statements/${id}/lines/${excludeLineId}/exclude`,
      { method: 'POST', body: JSON.stringify({ reason: excludeReason }) }
    );
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر الاستبعاد');
      return;
    }
    setExcludeLineId(null);
    setSuccess('تم استبعاد السطر');
    await refreshAfterMutation();
  };

  const unexcludeLine = async (lineId: string) => {
    setBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-statements/${id}/lines/${lineId}/exclude`,
      { method: 'DELETE' }
    );
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر التراجع عن الاستبعاد');
      return;
    }
    setSuccess('تم التراجع عن الاستبعاد');
    await refreshAfterMutation();
  };

  const openAdjustment = (lineId: string) => {
    setActionError(null);
    setAdjustCounterAccountId('');
    setAdjustCostCenterId('');
    setAdjustDescription('');
    setAdjustLineId(lineId);
  };

  const doAdjustment = async () => {
    if (!adjustLineId) return;
    setBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-statements/${id}/lines/${adjustLineId}/adjustment`,
      {
        method: 'POST',
        body: JSON.stringify({
          counter_account_id: adjustCounterAccountId,
          cost_center_id: adjustCostCenterId || null,
          description: adjustDescription || null,
        }),
      }
    );
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر إنشاء قيد التسوية');
      return;
    }
    setAdjustLineId(null);
    setSuccess('تم إنشاء وترحيل قيد التسوية');
    await refreshAfterMutation();
  };

  const openMatch = async (lineId: string) => {
    setMatchError(null);
    setMatchLineId(lineId);
    setMatchJournalEntryId('');
    setMatchJournalEntryLineId('');
    setMatchType('MANUAL');
    setMatchNotes('');
    const line = lines.find((l) => l.id === lineId);
    if (line) {
      const matchedSoFar = (line.matches || []).reduce(
        (sum, m) => sum + Number(m.matched_amount || 0),
        0
      );
      const { amount } = lineSide(line);
      const remaining = Math.max(0, Number(amount) - matchedSoFar);
      setMatchAmount(remaining ? remaining.toFixed(3) : '');
    }
    const res = await bankApi<MatchSuggestion[]>(
      `/api/accounts/bank-statements/${id}/suggestions?line_id=${lineId}`
    );
    if (res.success) setMatchSuggestions(res.data || []);
  };

  const applySuggestion = (s: MatchSuggestion) => {
    setMatchJournalEntryId(s.journal_entry_id);
    setMatchJournalEntryLineId(s.journal_entry_line_id || '');
    setMatchAmount(s.amount);
    setMatchType('SYSTEM_SUGGESTED');
  };

  const applyBookItem = (item: BookItem) => {
    setMatchJournalEntryId(item.journal_entry_id);
    setMatchJournalEntryLineId(item.journal_entry_line_id || '');
    setMatchType('MANUAL');
    const line = lines.find((l) => l.id === matchLineId);
    if (line) {
      const matchedSoFar = (line.matches || []).reduce(
        (sum, m) => sum + Number(m.matched_amount || 0),
        0
      );
      const { amount } = lineSide(line);
      const remainingOnLine = Math.max(0, Number(amount) - matchedSoFar);
      const remainingOnItem = Number(item.remaining_amount) || 0;
      setMatchAmount(Math.min(remainingOnLine, remainingOnItem).toFixed(3));
    }
  };

  const submitMatch = async () => {
    if (!matchLineId) return;
    setMatchBusy(true);
    setMatchError(null);
    const res = await bankApi(`/api/accounts/bank-statements/${id}/matches`, {
      method: 'POST',
      body: JSON.stringify({
        line_id: matchLineId,
        journal_entry_id: matchJournalEntryId,
        journal_entry_line_id: matchJournalEntryLineId || null,
        matched_amount: matchAmount,
        match_type: matchType,
        notes: matchNotes || null,
      }),
    });
    setMatchBusy(false);
    if (!res.success) {
      setMatchError(res.message || 'تعذر إنشاء المطابقة');
      return;
    }
    setMatchLineId(null);
    setSuccess('تمت المطابقة بنجاح');
    await refreshAfterMutation();
  };

  const removeMatch = async (matchId: string) => {
    setBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/bank-statements/${id}/matches/${matchId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر إزالة المطابقة');
      return;
    }
    setSuccess('تمت إزالة المطابقة');
    await refreshAfterMutation();
  };

  const previewCsv = async () => {
    setCsvBusy(true);
    setCsvError(null);
    setCsvResult(null);
    const mapping: Record<string, string> = {};
    (Object.keys(csvMapping) as Array<keyof CsvMappingForm>).forEach((k) => {
      if (csvMapping[k]) mapping[k] = csvMapping[k];
    });
    const res = await bankApi<PreviewCsvResult>(
      `/api/accounts/bank-statements/${id}/import/preview`,
      { method: 'POST', body: JSON.stringify({ csv_text: csvText, mapping }) }
    );
    setCsvBusy(false);
    if (!res.success || !res.data) {
      setCsvError(res.message || 'تعذر تحليل الملف');
      setCsvPreview(null);
      return;
    }
    setCsvPreview(res.data);
  };

  const commitCsv = async () => {
    if (!csvPreview) return;
    setCsvBusy(true);
    setCsvError(null);
    const validRows: ParsedCsvLine[] = csvPreview.rows.filter((r) => r.valid);
    const res = await bankApi<CommitCsvResult>(
      `/api/accounts/bank-statements/${id}/import/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ rows: validRows, file_name: csvFileName || null }),
      }
    );
    setCsvBusy(false);
    if (!res.success || !res.data) {
      setCsvError(res.message || 'تعذر تأكيد الاستيراد');
      return;
    }
    setCsvResult(res.data);
    setCsvPreview(null);
    setCsvText('');
    setSuccess(`تم استيراد ${res.data.imported} سطر (تخطي ${res.data.skipped_duplicate} مكرر)`);
    await refreshAfterMutation();
  };

  if (loading && !statement) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'كشف الحساب المصرفي غير موجود'}</p>
        <Link href="/accounts/banks/reconciliation" className="underline text-sm">
          العودة
        </Link>
      </div>
    );
  }

  const canEdit = statement.status === 'DRAFT' || statement.status === 'IN_PROGRESS';
  const canMatch = statement.status === 'IN_PROGRESS';
  const matchLine = lines.find((l) => l.id === matchLineId) || null;
  const adjustLine = lines.find((l) => l.id === adjustLineId) || null;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500 mb-1">
              <Link href="/accounts/banks/reconciliation" className="hover:text-red-900">
                التسوية المصرفية
              </Link>
              <span> / {statement.statement_number}</span>
            </div>
            <h1 className="text-xl font-semibold flex flex-wrap items-center gap-2">
              كشف حساب {statement.statement_number}
              <span
                className={`text-xs px-2 py-0.5 rounded ${statementStatusClass(statement.status)}`}
              >
                {STATEMENT_STATUS_LABEL[statement.status]}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 border rounded-md text-sm"
              onClick={() => router.push('/accounts/banks/reconciliation')}
            >
              العودة
            </button>
            <Link
              href={`/accounts/banks/reconciliation/${id}/print`}
              target="_blank"
              className="px-3 py-2 border rounded-md text-sm"
            >
              طباعة
            </Link>
            {statement.status === 'DRAFT' && (
              <button
                type="button"
                className="px-3 py-2 bg-blue-800 text-white rounded-md text-sm"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirmAction('start');
                }}
              >
                بدء التسوية
              </button>
            )}
            {statement.status === 'IN_PROGRESS' && (
              <button
                type="button"
                className="px-3 py-2 bg-green-800 text-white rounded-md text-sm"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirmAction('reconcile');
                }}
              >
                إنهاء التسوية
              </button>
            )}
            {statement.status === 'RECONCILED' && (
              <>
                <button
                  type="button"
                  className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setConfirmAction('close');
                  }}
                >
                  إغلاق الكشف
                </button>
                <button
                  type="button"
                  className="px-3 py-2 border border-amber-700 text-amber-950 rounded-md text-sm"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setConfirmAction('reopen');
                  }}
                >
                  إعادة فتح
                </button>
              </>
            )}
            {(statement.status === 'DRAFT' || statement.status === 'IN_PROGRESS') && (
              <button
                type="button"
                className="px-3 py-2 border border-red-700 text-red-900 rounded-md text-sm"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirmCancel(true);
                }}
              >
                إلغاء الكشف
              </button>
            )}
          </div>
        </div>

        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
            {success}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}
        {actionError && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {actionError}
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
          <Info
            label="الحساب المصرفي"
            value={`${statement.bank_account_code} — ${statement.bank_account_name_ar}`}
          />
          <Info
            label="المصرف"
            value={
              statement.bank_name_ar
                ? `${statement.bank_code} — ${statement.bank_name_ar}`
                : '—'
            }
          />
          <Info
            label="حساب GL"
            value={
              statement.gl_account_code
                ? `${statement.gl_account_code} — ${statement.gl_account_name_ar}`
                : '—'
            }
          />
          <Info label="العملة" value={statement.currency_code} />
          <Info
            label="الفترة"
            value={`${formatDateOnly(statement.date_from)} — ${formatDateOnly(statement.date_to)}`}
          />
          <Info
            label="الرصيد الافتتاحي"
            value={formatMoney(statement.opening_balance, statement.currency_code)}
          />
          <Info
            label="الرصيد الختامي"
            value={formatMoney(statement.closing_balance, statement.currency_code)}
          />
          <Info
            label="المرجع الخارجي"
            value={statement.external_statement_reference || '—'}
          />
          <Info label="المنشئ" value={statement.created_by_name || '—'} />
          {statement.cancellation_reason && (
            <Info label="سبب الإلغاء" value={statement.cancellation_reason} />
          )}
        </div>

        {summary && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">ملخص التسوية</h3>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  summary.within_tolerance
                    ? 'bg-green-100 text-green-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {summary.within_tolerance ? 'متوازن' : `فرق: ${formatMoney(summary.difference, statement.currency_code)}`}
              </span>
            </div>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
              <Info label="إجمالي دائن الكشف" value={formatMoney(summary.total_credits, statement.currency_code)} />
              <Info label="إجمالي مدين الكشف" value={formatMoney(summary.total_debits, statement.currency_code)} />
              <Info label="صافي حركة الكشف" value={formatMoney(summary.statement_movement, statement.currency_code)} />
              <Info
                label="الرصيد الختامي المتوقع"
                value={
                  <span className={summary.statement_balance_ok ? '' : 'text-red-800 font-semibold'}>
                    {formatMoney(summary.expected_closing, statement.currency_code)}
                  </span>
                }
              />
              <Info label="الرصيد الدفتري لتاريخ النهاية" value={formatMoney(summary.book_balance_at_date_to, statement.currency_code)} />
              <Info label="دائن كشف غير مطابق" value={formatMoney(summary.unmatched_bank_credits, statement.currency_code)} />
              <Info label="مدين كشف غير مطابق" value={formatMoney(summary.unmatched_bank_debits, statement.currency_code)} />
              <Info label="حركات دفترية معلّقة (مدين)" value={formatMoney(summary.outstanding_book_debits, statement.currency_code)} />
              <Info label="حركات دفترية معلّقة (دائن)" value={formatMoney(summary.outstanding_book_credits, statement.currency_code)} />
              <Info label="عدد التسويات الآلية" value={String(summary.adjustments_count)} />
              <Info label="صافي التسويات" value={formatMoney(summary.adjustments_net, statement.currency_code)} />
              <Info label="الرصيد البنكي المعدَّل" value={formatMoney(summary.bank_adjusted, statement.currency_code)} />
            </div>
          </div>
        )}

        {canEdit && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              استيراد سطور CSV
            </summary>
            <div className="mt-3 space-y-2">
              <textarea
                className="w-full border rounded-md px-3 py-2 text-xs font-mono"
                rows={4}
                placeholder="الصق محتوى CSV هنا (السطر الأول عناوين الأعمدة)"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                placeholder="اسم الملف (اختياري)"
                value={csvFileName}
                onChange={(e) => setCsvFileName(e.target.value)}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {(Object.keys(csvMapping) as Array<keyof CsvMappingForm>).map((key) => (
                  <label key={key} className="block">
                    {CSV_FIELD_LABEL[key]}
                    <input
                      className="mt-1 w-full border rounded-md px-2 py-1"
                      value={csvMapping[key]}
                      onChange={(e) =>
                        setCsvMapping((m) => ({ ...m, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              {csvError && (
                <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {csvError}
                </div>
              )}
              {csvResult && (
                <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
                  تم استيراد {csvResult.imported} من {csvResult.total_input} — تخطي{' '}
                  {csvResult.skipped_duplicate} مكرر، {csvResult.invalid} غير صالح
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 border rounded-md text-sm"
                  disabled={csvBusy || !csvText.trim()}
                  onClick={() => void previewCsv()}
                >
                  معاينة
                </button>
                {csvPreview && (
                  <button
                    type="button"
                    className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                    disabled={csvBusy || csvPreview.valid_count === 0}
                    onClick={() => void commitCsv()}
                  >
                    تأكيد استيراد {csvPreview.valid_count} سطر صالح
                  </button>
                )}
              </div>
              {csvPreview && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">
                    إجمالي الصفوف: {csvPreview.total_rows} — صالح: {csvPreview.valid_count} —
                    غير صالح: {csvPreview.invalid_count}
                    {csvPreview.truncated ? ' — تم اقتصار المعاينة' : ''}
                  </p>
                  {csvPreview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      {w}
                    </p>
                  ))}
                  <div className="overflow-x-auto border rounded max-h-64">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-right">#</th>
                          <th className="px-2 py-1 text-right">التاريخ</th>
                          <th className="px-2 py-1 text-right">الوصف</th>
                          <th className="px-2 py-1 text-right">مدين</th>
                          <th className="px-2 py-1 text-right">دائن</th>
                          <th className="px-2 py-1 text-right">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.slice(0, 200).map((r) => (
                          <tr key={r.row_number} className={r.valid ? '' : 'bg-red-50'}>
                            <td className="px-2 py-1">{r.row_number}</td>
                            <td className="px-2 py-1">{r.transaction_date || '—'}</td>
                            <td className="px-2 py-1">{r.description || '—'}</td>
                            <td className="px-2 py-1">{r.debit_amount}</td>
                            <td className="px-2 py-1">{r.credit_amount}</td>
                            <td className="px-2 py-1">
                              {r.valid ? 'صالح' : r.errors.join('، ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </details>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
              <h3 className="font-semibold text-sm">سطور كشف الحساب ({lines.length})</h3>
              {canEdit && (
                <button
                  type="button"
                  className="text-xs text-red-900 underline"
                  onClick={() => setAddLineOpen(true)}
                >
                  + إضافة سطر
                </button>
              )}
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-right">#</th>
                    <th className="px-2 py-2 text-right">التاريخ</th>
                    <th className="px-2 py-2 text-right">الوصف</th>
                    <th className="px-2 py-2 text-right">مدين</th>
                    <th className="px-2 py-2 text-right">دائن</th>
                    <th className="px-2 py-2 text-right">الحالة</th>
                    <th className="px-2 py-2 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                        لا توجد سطور
                      </td>
                    </tr>
                  ) : (
                    lines.map((l) => (
                      <tr key={l.id} className="border-t align-top">
                        <td className="px-2 py-2">{l.line_number}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {formatDateOnly(l.transaction_date)}
                        </td>
                        <td className="px-2 py-2">
                          {l.description}
                          {l.bank_reference && (
                            <span className="text-gray-500 block">
                              مرجع: {l.bank_reference}
                            </span>
                          )}
                          {(l.matches || []).length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {(l.matches || []).map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center justify-between gap-1 text-[11px] bg-gray-50 border rounded px-1.5 py-0.5"
                                >
                                  <span>
                                    {m.entry_number} — {formatMoney(m.matched_amount, statement.currency_code)}
                                  </span>
                                  {canMatch && m.match_type !== 'ADJUSTMENT' && (
                                    <button
                                      type="button"
                                      className="text-red-800"
                                      onClick={() => void removeMatch(m.id)}
                                    >
                                      إزالة
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {Number(l.debit_amount) > 0
                            ? formatMoney(l.debit_amount, statement.currency_code)
                            : '—'}
                        </td>
                        <td className="px-2 py-2">
                          {Number(l.credit_amount) > 0
                            ? formatMoney(l.credit_amount, statement.currency_code)
                            : '—'}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded ${matchStatusClass(l.match_status)}`}>
                            {MATCH_STATUS_LABEL[l.match_status]}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap space-y-1">
                          {canMatch && l.match_status !== 'EXCLUDED' && l.match_status !== 'MATCHED' && (
                            <button
                              type="button"
                              className="block text-blue-800 underline"
                              onClick={() => void openMatch(l.id)}
                            >
                              مطابقة
                            </button>
                          )}
                          {canEdit && l.match_status === 'EXCLUDED' && (
                            <button
                              type="button"
                              className="block text-gray-700 underline"
                              onClick={() => void unexcludeLine(l.id)}
                            >
                              تراجع
                            </button>
                          )}
                          {canEdit &&
                            l.match_status !== 'EXCLUDED' &&
                            l.match_status !== 'MATCHED' && (
                              <button
                                type="button"
                                className="block text-amber-800 underline"
                                onClick={() => openExclude(l.id)}
                              >
                                استبعاد
                              </button>
                            )}
                          {canMatch &&
                            !l.adjustment_journal_entry_id &&
                            l.match_status !== 'EXCLUDED' &&
                            l.match_status !== 'MATCHED' && (
                              <button
                                type="button"
                                className="block text-purple-800 underline"
                                onClick={() => openAdjustment(l.id)}
                              >
                                تسوية آلية
                              </button>
                            )}
                          {canEdit &&
                            (l.matches || []).length === 0 &&
                            !l.adjustment_journal_entry_id && (
                              <button
                                type="button"
                                className="block text-red-800 underline"
                                onClick={() => void deleteLine(l.id)}
                              >
                                حذف
                              </button>
                            )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b space-y-2">
              <h3 className="font-semibold text-sm">حركات الدفتر (حساب البنك GL)</h3>
              <div className="flex gap-2">
                <input
                  className="border rounded-md px-2 py-1 text-xs flex-1"
                  placeholder="بحث برقم القيد أو المرجع"
                  value={bookItemsQ}
                  onChange={(e) => setBookItemsQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setBookItemsPage(1);
                      void loadBookItems();
                    }
                  }}
                />
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={bookItemsUnmatchedOnly}
                    onChange={(e) => {
                      setBookItemsUnmatchedOnly(e.target.checked);
                      setBookItemsPage(1);
                    }}
                  />
                  غير المطابق فقط
                </label>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-right">القيد</th>
                    <th className="px-2 py-2 text-right">التاريخ</th>
                    <th className="px-2 py-2 text-right">الوصف</th>
                    <th className="px-2 py-2 text-right">الجانب</th>
                    <th className="px-2 py-2 text-right">المتبقي</th>
                  </tr>
                </thead>
                <tbody>
                  {bookItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                        لا توجد حركات
                      </td>
                    </tr>
                  ) : (
                    bookItems.map((b) => (
                      <tr key={`${b.journal_entry_id}-${b.journal_entry_line_id || ''}`} className="border-t">
                        <td className="px-2 py-2 font-mono">
                          <Link
                            href={`/accounts/entries?q=${encodeURIComponent(b.entry_number)}`}
                            className="text-red-900 underline"
                            target="_blank"
                          >
                            {b.entry_number}
                          </Link>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{formatDateOnly(b.entry_date)}</td>
                        <td className="px-2 py-2">
                          {b.description}
                          {b.bank_reference && (
                            <span className="text-gray-500 block">مرجع: {b.bank_reference}</span>
                          )}
                        </td>
                        <td className="px-2 py-2">{b.side === 'DEBIT' ? 'مدين' : 'دائن'}</td>
                        <td className="px-2 py-2">
                          {formatMoney(b.remaining_amount, statement.currency_code)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {bookItemsTotal > 30 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 border-t">
                <button
                  type="button"
                  className="px-2 py-1 border rounded disabled:opacity-40"
                  disabled={bookItemsPage <= 1}
                  onClick={() => setBookItemsPage((p) => p - 1)}
                >
                  السابق
                </button>
                <span>صفحة {bookItemsPage}</span>
                <button
                  type="button"
                  className="px-2 py-1 border rounded disabled:opacity-40"
                  disabled={bookItemsPage * 30 >= bookItemsTotal}
                  onClick={() => setBookItemsPage((p) => p + 1)}
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* إضافة سطر */}
      {addLineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5 space-y-3">
            <h3 className="text-lg font-semibold">إضافة سطر كشف</h3>
            <label className="block text-sm">
              تاريخ الحركة
              <input
                type="date"
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={newLine.transaction_date}
                onChange={(e) => setNewLine((f) => ({ ...f, transaction_date: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              الوصف
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={newLine.description}
                onChange={(e) => setNewLine((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              المرجع البنكي
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={newLine.bank_reference}
                onChange={(e) => setNewLine((f) => ({ ...f, bank_reference: e.target.value }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                الجانب
                <select
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={newLine.side}
                  onChange={(e) =>
                    setNewLine((f) => ({ ...f, side: e.target.value as 'DEBIT' | 'CREDIT' }))
                  }
                >
                  <option value="DEBIT">مدين (خروج)</option>
                  <option value="CREDIT">دائن (دخول)</option>
                </select>
              </label>
              <label className="block text-sm">
                المبلغ
                <input
                  className="mt-1 w-full border rounded-md px-3 py-2"
                  value={newLine.amount}
                  inputMode="decimal"
                  onChange={(e) => setNewLine((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-2 border rounded-md text-sm"
                disabled={busy}
                onClick={() => setAddLineOpen(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy || !newLine.transaction_date || !newLine.description || !newLine.amount}
                onClick={() => void addLine()}
              >
                إضافة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مطابقة */}
      {matchLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">
              مطابقة السطر #{matchLine.line_number} — {matchLine.description}
            </h3>
            {matchError && (
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                {matchError}
              </div>
            )}
            {matchSuggestions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-600">اقتراحات آلية</p>
                {matchSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-right text-xs border rounded px-2 py-1.5 hover:bg-gray-50 flex justify-between"
                    onClick={() => applySuggestion(s)}
                  >
                    <span>
                      {s.entry_number} — {formatDateOnly(s.entry_date)} — {s.reason}
                    </span>
                    <span className="font-semibold">
                      {formatMoney(s.amount, statement.currency_code)} ({s.confidence}%)
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-600">أو اختر يدوياً من حركات الدفتر</p>
              <div className="max-h-40 overflow-y-auto border rounded">
                {bookItems.map((b) => (
                  <button
                    key={`${b.journal_entry_id}-${b.journal_entry_line_id || ''}`}
                    type="button"
                    className={`w-full text-right text-xs px-2 py-1.5 border-b hover:bg-gray-50 flex justify-between ${
                      matchJournalEntryId === b.journal_entry_id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => applyBookItem(b)}
                  >
                    <span>
                      {b.entry_number} — {formatDateOnly(b.entry_date)} — {b.description}
                    </span>
                    <span className="font-semibold">
                      {formatMoney(b.remaining_amount, statement.currency_code)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm">
              مبلغ المطابقة
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={matchAmount}
                inputMode="decimal"
                onChange={(e) => setMatchAmount(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              ملاحظات
              <input
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={matchNotes}
                onChange={(e) => setMatchNotes(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-2 border rounded-md text-sm"
                disabled={matchBusy}
                onClick={() => setMatchLineId(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={matchBusy || !matchJournalEntryId || !matchAmount}
                onClick={() => void submitMatch()}
              >
                تأكيد المطابقة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* استبعاد */}
      <ConfirmDialog
        open={Boolean(excludeLineId)}
        title="استبعاد سطر من المطابقة"
        message={
          <textarea
            className="w-full border rounded-md px-3 py-2 text-sm"
            rows={2}
            placeholder="سبب الاستبعاد"
            value={excludeReason}
            onChange={(e) => setExcludeReason(e.target.value)}
          />
        }
        confirmLabel="استبعاد"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setExcludeLineId(null)}
        onConfirm={() => void doExclude()}
      />

      {/* تسوية آلية */}
      {adjustLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5 space-y-3">
            <h3 className="text-lg font-semibold">
              تسوية آلية للسطر #{adjustLine.line_number}
            </h3>
            <p className="text-xs text-gray-600">
              سيتم إنشاء وترحيل قيد محاسبي يقابل حساب البنك GL بحساب مقابل تختاره — للمبالغ التي
              لم تُسجَّل بعد في الدفاتر (رسوم أو فوائد بنكية مثلاً).
            </p>
            <label className="block text-sm">
              الحساب المقابل
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={adjustCounterAccountId}
                onChange={(e) => setAdjustCounterAccountId(e.target.value)}
              >
                <option value="">اختر الحساب</option>
                {(options?.adjustment_accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              مركز الكلفة
              <select
                className="mt-1 w-full border rounded-md px-3 py-2"
                value={adjustCostCenterId}
                onChange={(e) => setAdjustCostCenterId(e.target.value)}
              >
                <option value="">—</option>
                {(options?.cost_centers || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              البيان
              <textarea
                className="mt-1 w-full border rounded-md px-3 py-2"
                rows={2}
                value={adjustDescription}
                onChange={(e) => setAdjustDescription(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-2 border rounded-md text-sm"
                disabled={busy}
                onClick={() => setAdjustLineId(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
                disabled={busy || !adjustCounterAccountId}
                onClick={() => void doAdjustment()}
              >
                ترحيل التسوية
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction === 'start'}
        title="تأكيد بدء التسوية"
        message="سيتم نقل الكشف إلى حالة (قيد المعالجة) لبدء عمليات المطابقة. هل تريد المتابعة؟"
        confirmLabel="بدء التسوية"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runAction('start')}
      />
      <ConfirmDialog
        open={confirmAction === 'reconcile'}
        title="تأكيد إنهاء التسوية"
        message="يتطلب إنهاء التسوية أن تكون كل السطور مطابقة أو مستبعدة، وأن يتوازن الرصيد تماماً. هل تريد المتابعة؟"
        confirmLabel="إنهاء التسوية"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runAction('reconcile')}
      />
      <ConfirmDialog
        open={confirmAction === 'close'}
        title="تأكيد إغلاق الكشف"
        message="سيتم إغلاق الكشف نهائياً وحفظ لقطة التسوية. يتطلب صلاحية مدير الحسابات. هل تريد المتابعة؟"
        confirmLabel="إغلاق"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runAction('close')}
      />
      <ConfirmDialog
        open={confirmAction === 'reopen'}
        title="تأكيد إعادة فتح الكشف"
        message="سيعاد الكشف إلى حالة (قيد المعالجة). يتطلب صلاحية مدير الحسابات. هل تريد المتابعة؟"
        confirmLabel="إعادة فتح"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runAction('reopen')}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="تأكيد إلغاء الكشف"
        message={
          <div className="space-y-2">
            <p>لا يمكن التراجع عن الإلغاء. هل تريد المتابعة؟</p>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm"
              rows={2}
              placeholder="سبب الإلغاء"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="إلغاء الكشف"
        busy={busy}
        error={actionError}
        danger
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void doCancel()}
      />
    </div>
  );
}

const CSV_FIELD_LABEL: Record<keyof CsvMappingForm, string> = {
  transaction_date: 'عمود التاريخ',
  value_date: 'عمود تاريخ القيمة',
  description: 'عمود الوصف',
  reference: 'عمود المرجع',
  debit: 'عمود المدين',
  credit: 'عمود الدائن',
  balance: 'عمود الرصيد الجاري',
  external_id: 'عمود المعرّف الخارجي',
};

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-gray-900">{value}</div>
    </div>
  );
}
