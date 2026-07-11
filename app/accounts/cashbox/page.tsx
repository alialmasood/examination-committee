'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ActivationChecklist from './components/ActivationChecklist';
import CashBoxFormModal from './components/CashBoxFormModal';
import CashBoxSummaryCards from './components/CashBoxSummaryCards';
import CashBoxesTable from './components/CashBoxesTable';
import {
  CashBoxListItem,
  CashBoxOptions,
  CashBoxStats,
  canActivateChecklist,
  cashApi,
} from './components/types';

export default function AccountsCashboxPage() {
  const [rows, setRows] = useState<CashBoxListItem[]>([]);
  const [stats, setStats] = useState<CashBoxStats | null>(null);
  const [options, setOptions] = useState<CashBoxOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [boxType, setBoxType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [custodianId, setCustodianId] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<CashBoxListItem | null>(null);
  const [activateRow, setActivateRow] = useState<CashBoxListItem | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const loadOptions = useCallback(async () => {
    const res = await cashApi<CashBoxOptions>('/api/accounts/cash-boxes/options');
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
    if (boxType) params.set('box_type_code', boxType);
    if (accountId) params.set('account_id', accountId);
    if (custodianId) params.set('primary_custodian_user_id', custodianId);

    const res = await cashApi<CashBoxListItem[]>(
      `/api/accounts/cash-boxes?${params.toString()}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الصناديق');
      setRows([]);
    } else {
      setRows((res.data as CashBoxListItem[]) || []);
      setStats((res.stats as CashBoxStats) || null);
      const pag = res.pagination as { total_pages?: number } | undefined;
      setTotalPages(pag?.total_pages || 1);
      setError(null);
    }
    setLoading(false);
  }, [page, q, status, boxType, accountId, custodianId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
    // البحث يُطبَّق عند تغيير الفلاتر/الصفحة أو زر التحديث — ليس مع كل حرف
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, boxType, accountId, custodianId]);

  const applySearch = () => {
    setPage(1);
    void load();
  };

  const pageBalancesSum = useMemo(() => {
    if (!rows.length) return null;
    let total = 0;
    for (const r of rows) {
      const n = Number(r.book_balance);
      if (Number.isFinite(n)) total += n;
    }
    return total.toFixed(3);
  }, [rows]);

  const activateChecklist = activateRow
    ? canActivateChecklist(activateRow)
    : { ok: false, items: [] };

  const doActivate = async () => {
    if (!activateRow || !activateChecklist.ok) return;
    setActivating(true);
    setActivateError(null);
    const res = await cashApi(`/api/accounts/cash-boxes/${activateRow.id}/activate`, {
      method: 'POST',
      body: JSON.stringify({
        version: activateRow.version,
        updated_at: activateRow.updated_at,
      }),
    });
    setActivating(false);
    if (!res.success) {
      setActivateError(res.message || 'تعذر التفعيل');
      return;
    }
    setActivateRow(null);
    setSuccess('تم تفعيل الصندوق بنجاح');
    void load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">إدارة الصناديق</h1>
            <p className="text-sm text-gray-600 mt-1">
              تعريف الصناديق النقدية وربطها بالدليل وتعيين الأمناء وتفعيل التشغيل.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/accounts/cashbox/sessions"
              className="px-4 py-2 rounded-md border border-red-900 text-red-900 text-sm hover:bg-red-50"
            >
              الجلسات اليومية
            </Link>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
              onClick={() => {
                setEditRow(null);
                setFormOpen(true);
              }}
            >
              إضافة صندوق
            </button>
          </div>
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

        <CashBoxSummaryCards
          stats={stats}
          pageBalancesSum={pageBalancesSum}
          loading={loading}
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-2">
          <input
            className="border rounded-md px-3 py-2 text-sm lg:col-span-2"
            placeholder="بحث بالرمز أو الاسم…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySearch();
            }}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={boxType}
            onChange={(e) => {
              setPage(1);
              setBoxType(e.target.value);
            }}
          >
            <option value="">كل الأنواع</option>
            {(options?.box_types || []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">كل الحالات</option>
            {(options?.statuses || []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={accountId}
            onChange={(e) => {
              setPage(1);
              setAccountId(e.target.value);
            }}
          >
            <option value="">كل الحسابات</option>
            {(options?.eligible_accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm lg:col-span-2"
            value={custodianId}
            onChange={(e) => {
              setPage(1);
              setCustodianId(e.target.value);
            }}
          >
            <option value="">كل الأمناء</option>
            {(options?.users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
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

        <CashBoxesTable
          rows={rows}
          loading={loading}
          onEdit={(row) => {
            setEditRow(row);
            setFormOpen(true);
          }}
          onActivate={(row) => {
            setActivateError(null);
            setActivateRow(row);
          }}
        />

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

      <CashBoxFormModal
        open={formOpen}
        mode={editRow ? 'edit' : 'create'}
        options={options}
        initial={editRow as never}
        onClose={() => {
          setFormOpen(false);
          setEditRow(null);
        }}
        onSaved={() => {
          setSuccess(editRow ? 'تم تحديث الصندوق' : 'تم إنشاء الصندوق');
          void load();
          void loadOptions();
        }}
      />

      <ActivationChecklist
        open={Boolean(activateRow)}
        items={activateChecklist.items}
        canSubmit={activateChecklist.ok}
        busy={activating}
        error={activateError}
        onClose={() => setActivateRow(null)}
        onConfirm={() => void doActivate()}
      />
    </div>
  );
}
