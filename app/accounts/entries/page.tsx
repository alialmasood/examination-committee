'use client';

import { useEffect, useState } from 'react';
import EntriesTable from './components/EntriesTable';
import EntryDetailsPanel from './components/EntryDetailsPanel';
import EntryFormModal from './components/EntryFormModal';
import {
  JournalEntryListItem,
  STATUS_LABEL,
  TYPE_LABEL,
  accountsApi,
} from './components/types';

type Stats = {
  total: number;
  drafts: number;
  pending_review: number;
  approved: number;
  posted: number;
  reversed: number;
};

export default function AccountsEntriesPage() {
  const [rows, setRows] = useState<JournalEntryListItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [entryType, setEntryType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [years, setYears] = useState<Array<{ id: string; code: string }>>([]);
  const [fiscalYearId, setFiscalYearId] = useState('');

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (entryType) params.set('entry_type', entryType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (fiscalYearId) params.set('fiscal_year_id', fiscalYearId);

    const res = await accountsApi<JournalEntryListItem[]>(
      `/api/accounts/journal-entries?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل القيود');
      setRows([]);
    } else {
      setRows((res.data as JournalEntryListItem[]) || []);
      setStats((res.stats as Stats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void (async () => {
      const opt = await accountsApi<{
        fiscal_years: Array<{ id: string; code: string }>;
        default_fiscal_year: { id: string } | null;
      }>('/api/accounts/journal-entries/options');
      if (opt.success && opt.data) {
        setYears(opt.data.fiscal_years || []);
        if (opt.data.default_fiscal_year?.id) {
          setFiscalYearId(opt.data.default_fiscal_year.id);
        }
      }
    })();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, entryType, fiscalYearId]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">القيود المحاسبية</h1>
            <p className="text-sm text-gray-600 mt-1">
              إنشاء ومراجعة واعتماد وترحيل القيود المزدوجة — دفتر اليومية من التقارير.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/accounts/reports/journal"
              className="px-3 py-2 rounded-md border text-sm text-gray-700 hover:bg-gray-50"
            >
              دفتر اليومية
            </a>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              قيد جديد
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
            {[
              ['الإجمالي', stats.total],
              ['مسودات', stats.drafts],
              ['بانتظار المراجعة', stats.pending_review],
              ['معتمدة', stats.approved],
              ['مرحلة', stats.posted],
              ['معكوسة', stats.reversed],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-gray-50 px-3 py-2">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-lg font-semibold text-red-950">{value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
          <input
            className="border rounded-md px-3 py-2 md:col-span-2"
            placeholder="بحث: رقم / مرجع / وصف"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                void load();
              }
            }}
          />
          <select
            className="border rounded-md px-3 py-2"
            value={fiscalYearId}
            onChange={(e) => {
              setFiscalYearId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل السنوات</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2"
            value={entryType}
            onChange={(e) => {
              setEntryType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الأنواع</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-gray-100"
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            بحث
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="border rounded-md px-3 py-2"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

        <EntriesTable
          rows={rows}
          loading={loading}
          onOpen={(id) => setDetailId(id)}
          onEdit={(id) => {
            setEditId(id);
            setFormOpen(true);
          }}
        />

        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            className="px-3 py-1 rounded border disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            السابق
          </button>
          <span>
            صفحة {page} من {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border disabled:opacity-40"
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      </div>

      <EntryFormModal
        open={formOpen}
        entryId={editId}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSaved={() => void load()}
      />

      <EntryDetailsPanel
        entryId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => void load()}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
