'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import OpenSessionModal from './components/OpenSessionModal';
import SessionSummaryCards from './components/SessionSummaryCards';
import SessionsTable from './components/SessionsTable';
import {
  cashApi,
  CashSessionListItem,
  SessionOptions,
  SessionStats,
} from './components/session-types';

export default function CashBoxSessionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CashSessionListItem[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [options, setOptions] = useState<SessionOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cashBoxId, setCashBoxId] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [openModal, setOpenModal] = useState(false);

  const loadOptions = useCallback(async () => {
    const res = await cashApi<SessionOptions>('/api/accounts/cash-box-sessions/options');
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (cashBoxId) params.set('cash_box_id', cashBoxId);

    const res = await cashApi<CashSessionListItem[]>(
      `/api/accounts/cash-box-sessions?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الجلسات');
      setRows([]);
    } else {
      setRows((res.data as CashSessionListItem[]) || []);
      setStats((res.stats as SessionStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [page, q, status, cashBoxId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- بحث يدوي عبر الزر
  }, [page, status, cashBoxId]);

  const applySearch = () => {
    setPage(1);
    void load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/accounts/cashbox" className="hover:text-red-900">
                الصناديق
              </Link>
              <span>/</span>
              <span className="text-gray-700">الجلسات اليومية</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">جلسات الصناديق</h1>
            <p className="text-sm text-gray-600 mt-1">
              فتح اليوم التشغيلي، الجرد المبسط، والإغلاق بفرق صفر.
            </p>
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
            onClick={() => setOpenModal(true)}
          >
            فتح جلسة
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
            {success}
          </div>
        )}

        <SessionSummaryCards stats={stats} loading={loading} />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm lg:col-span-2"
            placeholder="بحث برمز الصندوق أو الاسم أو رقم الجلسة…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySearch();
            }}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">كل الحالات</option>
            <option value="OPEN">مفتوحة</option>
            <option value="CLOSING">قيد الإغلاق</option>
            <option value="CLOSED">مغلقة</option>
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={cashBoxId}
            onChange={(e) => {
              setPage(1);
              setCashBoxId(e.target.value);
            }}
          >
            <option value="">كل الصناديق</option>
            {(options?.cash_boxes || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name_ar}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50"
            onClick={applySearch}
          >
            بحث / تحديث
          </button>
        </div>

        <SessionsTable rows={rows} loading={loading} />

        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            صفحة {page} من {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 border rounded disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              السابق
            </button>
            <button
              type="button"
              className="px-3 py-1 border rounded disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              التالي
            </button>
          </div>
        </div>
      </div>

      <OpenSessionModal
        open={openModal}
        options={options}
        onClose={() => setOpenModal(false)}
        onOpened={(id) => {
          setOpenModal(false);
          setSuccess('تم فتح الجلسة بنجاح');
          void loadOptions();
          void load();
          router.push(`/accounts/cashbox/sessions/${id}`);
        }}
      />
    </div>
  );
}
