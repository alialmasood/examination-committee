'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  bankApi,
  BankReconciliationSummary,
  BankStatementDetail,
  BankStatementLine,
  BookItem,
  formatDateOnly,
  formatMoney,
  MATCH_STATUS_LABEL,
  sanitizeDisplayCell,
  STATEMENT_STATUS_LABEL,
} from '../../components/types';

export default function BankStatementPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [statement, setStatement] = useState<BankStatementDetail | null>(null);
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [summary, setSummary] = useState<BankReconciliationSummary | null>(null);
  const [outstandingBookItems, setOutstandingBookItems] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [statementRes, linesRes, summaryRes, bookItemsRes] = await Promise.all([
      bankApi<BankStatementDetail>(`/api/accounts/bank-statements/${id}`),
      bankApi<BankStatementLine[]>(`/api/accounts/bank-statements/${id}/lines?page_size=500`),
      bankApi<BankReconciliationSummary>(`/api/accounts/bank-statements/${id}/summary`),
      bankApi<BookItem[]>(
        `/api/accounts/bank-statements/${id}/book-items?unmatched_only=true&page_size=200`
      ),
    ]);
    if (!statementRes.success || !statementRes.data) {
      setError(statementRes.message || 'تعذر تحميل كشف الحساب');
      setLoading(false);
      return;
    }
    setStatement(statementRes.data);
    setLines(linesRes.data || []);
    setSummary(summaryRes.data || null);
    setOutstandingBookItems(bookItemsRes.data || []);
    setError(null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  if (loading) {
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
      </div>
    );
  }

  const unresolvedLines = lines.filter(
    (l) => l.match_status === 'UNMATCHED' || l.match_status === 'PARTIALLY_MATCHED'
  );
  const excludedLines = lines.filter((l) => l.match_status === 'EXCLUDED');
  const adjustmentLines = lines.filter((l) => l.adjustment_journal_entry_id);
  const currency = statement.currency_code;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4 print:p-0" dir="rtl">
      <div className="flex justify-between gap-2 print:hidden">
        <button
          type="button"
          className="px-3 py-2 border rounded-md text-sm"
          onClick={() => router.back()}
        >
          رجوع
        </button>
        <button
          type="button"
          className="px-3 py-2 bg-red-900 text-white rounded-md text-sm"
          onClick={() => window.print()}
        >
          طباعة
        </button>
      </div>

      <div className="text-center space-y-1 border-b pb-4">
        <div className="text-lg font-bold">كلية الشرق الجامعة</div>
        <div className="text-sm text-gray-600">قسم الحسابات — التسوية المصرفية</div>
        <div className="text-base font-semibold mt-2">
          تقرير تسوية كشف الحساب المصرفي — {statement.statement_number}
        </div>
        <div className="text-sm">
          الحالة: {STATEMENT_STATUS_LABEL[statement.status]}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
        <PrintField label="الحساب المصرفي" value={`${statement.bank_account_code} — ${statement.bank_account_name_ar}`} />
        <PrintField label="المصرف" value={statement.bank_name_ar ? `${statement.bank_code} — ${statement.bank_name_ar}` : '—'} />
        <PrintField label="حساب GL" value={statement.gl_account_code ? `${statement.gl_account_code} — ${statement.gl_account_name_ar}` : '—'} />
        <PrintField label="العملة" value={currency} />
        <PrintField label="الفترة" value={`${formatDateOnly(statement.date_from)} — ${formatDateOnly(statement.date_to)}`} />
        <PrintField label="المرجع الخارجي" value={statement.external_statement_reference || '—'} />
        <PrintField label="الرصيد الافتتاحي" value={formatMoney(statement.opening_balance, currency)} />
        <PrintField label="الرصيد الختامي (بحسب المصرف)" value={formatMoney(statement.closing_balance, currency)} />
        <PrintField label="أُعدّ بواسطة" value={statement.created_by_name || '—'} />
      </section>

      {summary && (
        <section className="space-y-2">
          <h3 className="font-semibold text-sm border-b pb-1">ملخص التسوية</h3>
          <table className="min-w-full text-xs border">
            <tbody>
              <SummaryRow label="الرصيد الختامي بحسب كشف المصرف" value={formatMoney(summary.closing_balance, currency)} />
              <SummaryRow label="زائد: حركات دفترية معلّقة (مدين) لم تظهر في المصرف بعد" value={formatMoney(summary.outstanding_book_debits, currency)} />
              <SummaryRow label="ناقص: حركات دفترية معلّقة (دائن) لم تظهر في المصرف بعد" value={formatMoney(summary.outstanding_book_credits, currency)} />
              <SummaryRow label="الرصيد البنكي المعدَّل" value={formatMoney(summary.bank_adjusted, currency)} bold />
              <SummaryRow label="الرصيد الدفتري (حسب سجلات الكلية) لتاريخ النهاية" value={formatMoney(summary.book_balance_at_date_to, currency)} bold />
              <SummaryRow
                label="الفرق"
                value={formatMoney(summary.difference, currency)}
                bold
                highlight={!summary.within_tolerance}
              />
            </tbody>
          </table>
          {!summary.statement_balance_ok && (
            <p className="text-xs text-red-800">
              تنبيه: الرصيد الافتتاحي + صافي حركات الكشف لا يساوي الرصيد الختامي المُدخل للكشف.
            </p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold text-sm border-b pb-1">
          سطور كشف المصرف غير المطابقة ({unresolvedLines.length})
        </h3>
        <PrintLinesTable lines={unresolvedLines} currency={currency} emptyLabel="لا توجد سطور غير مطابقة" />
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-sm border-b pb-1">
          الحركات الدفترية المعلّقة (لم تظهر في المصرف بعد) ({outstandingBookItems.length})
        </h3>
        <table className="min-w-full text-xs border">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1 text-right">رقم القيد</th>
              <th className="border px-2 py-1 text-right">التاريخ</th>
              <th className="border px-2 py-1 text-right">الوصف</th>
              <th className="border px-2 py-1 text-right">الجانب</th>
              <th className="border px-2 py-1 text-right">المبلغ المعلّق</th>
            </tr>
          </thead>
          <tbody>
            {outstandingBookItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="border px-2 py-3 text-center text-gray-500">
                  لا توجد حركات معلّقة
                </td>
              </tr>
            ) : (
              outstandingBookItems.map((b) => (
                <tr key={`${b.journal_entry_id}-${b.journal_entry_line_id || ''}`}>
                  <td className="border px-2 py-1 font-mono">{b.entry_number}</td>
                  <td className="border px-2 py-1">{formatDateOnly(b.entry_date)}</td>
                  <td className="border px-2 py-1">{sanitizeDisplayCell(b.description)}</td>
                  <td className="border px-2 py-1">{b.side === 'DEBIT' ? 'مدين' : 'دائن'}</td>
                  <td className="border px-2 py-1">{formatMoney(b.remaining_amount, currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {adjustmentLines.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-sm border-b pb-1">
            التسويات الآلية المرحّلة ({adjustmentLines.length})
          </h3>
          <PrintLinesTable lines={adjustmentLines} currency={currency} emptyLabel="لا توجد تسويات" />
        </section>
      )}

      {excludedLines.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-sm border-b pb-1">
            السطور المستبعدة من المطابقة ({excludedLines.length})
          </h3>
          <PrintLinesTable lines={excludedLines} currency={currency} emptyLabel="لا توجد سطور مستبعدة" showReason />
        </section>
      )}

      <section className="grid grid-cols-4 gap-4 pt-12 text-sm text-center">
        <div>
          <div className="border-t border-gray-800 pt-2">المحاسب</div>
        </div>
        <div>
          <div className="border-t border-gray-800 pt-2">مسؤول المصرف</div>
        </div>
        <div>
          <div className="border-t border-gray-800 pt-2">المدير المالي</div>
        </div>
        <div>
          <div className="border-t border-gray-800 pt-2">التدقيق</div>
        </div>
      </section>
    </div>
  );
}

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded px-2 py-1.5">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="font-medium">{sanitizeDisplayCell(value)}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? 'bg-red-50' : ''}>
      <td className={`border px-2 py-1 ${bold ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`border px-2 py-1 text-left ${bold ? 'font-semibold' : ''}`}>{value}</td>
    </tr>
  );
}

function PrintLinesTable({
  lines,
  currency,
  emptyLabel,
  showReason,
}: {
  lines: BankStatementLine[];
  currency: string;
  emptyLabel: string;
  showReason?: boolean;
}) {
  return (
    <table className="min-w-full text-xs border">
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1 text-right">#</th>
          <th className="border px-2 py-1 text-right">التاريخ</th>
          <th className="border px-2 py-1 text-right">الوصف</th>
          <th className="border px-2 py-1 text-right">مدين</th>
          <th className="border px-2 py-1 text-right">دائن</th>
          <th className="border px-2 py-1 text-right">
            {showReason ? 'سبب الاستبعاد' : 'الحالة'}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td colSpan={6} className="border px-2 py-3 text-center text-gray-500">
              {emptyLabel}
            </td>
          </tr>
        ) : (
          lines.map((l) => (
            <tr key={l.id}>
              <td className="border px-2 py-1">{l.line_number}</td>
              <td className="border px-2 py-1 whitespace-nowrap">
                {formatDateOnly(l.transaction_date)}
              </td>
              <td className="border px-2 py-1">
                {sanitizeDisplayCell(l.description)}
                {l.bank_reference && (
                  <span className="text-gray-500">
                    {' '}
                    (مرجع: {sanitizeDisplayCell(l.bank_reference)})
                  </span>
                )}
              </td>
              <td className="border px-2 py-1">
                {Number(l.debit_amount) > 0 ? formatMoney(l.debit_amount, currency) : '—'}
              </td>
              <td className="border px-2 py-1">
                {Number(l.credit_amount) > 0 ? formatMoney(l.credit_amount, currency) : '—'}
              </td>
              <td className="border px-2 py-1">
                {showReason
                  ? sanitizeDisplayCell(l.exclusion_reason || '—')
                  : MATCH_STATUS_LABEL[l.match_status]}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
