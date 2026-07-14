'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StudentsNav from '../components/StudentsNav';
import {
  CHARGE_STATUS_LABEL,
  chargeStatusBadge,
  formatDateOnly,
  formatMoney,
  studentApi,
  type Pagination,
  type StudentChargeListItem,
  type StudentOptions,
} from '../components/types';

export default function StudentChargesPageInner() {
  const searchParams = useSearchParams();
  const initialAccountId = searchParams.get('student_account_id') || '';
  const initialStatus = searchParams.get('status') || '';

  const [rows, setRows] = useState<StudentChargeListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 20,
    total: 0,
    total_pages: 1,
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; account_number: string; student_full_name_ar?: string | null }>
  >([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    student_account_id: initialAccountId,
    fee_type_id: '',
    charge_date: '2026-01-15',
    original_amount: '',
    description: '',
  });

  const [actionCharge, setActionCharge] = useState<StudentChargeListItem | null>(null);
  const [actionKind, setActionKind] = useState<'post' | 'void' | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    const [opt, acc] = await Promise.all([
      studentApi<StudentOptions>('/api/accounts/student-options'),
      studentApi<
        Array<{ id: string; account_number: string; student_full_name_ar?: string | null }>
      >('/api/accounts/student-accounts?page_size=100&status=ACTIVE'),
    ]);
    if (opt.success && opt.data) setOptions(opt.data);
    if (acc.success) setAccounts(acc.data || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (accountId) params.set('student_account_id', accountId);
    const res = await studentApi<StudentChargeListItem[]>(
      `/api/accounts/student-charges?${params}`
    );
    if (!res.success) {
      setError(res.message || ' ⁄–—  Õ„Ì· «·„ÿ«·»« ');
      setRows([]);
    } else {
      setError(null);
      setRows(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    }
    setLoading(false);
  }, [page, q, status, accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const createDraft = async () => {
    setSaving(true);
    setSuccess(null);
    const body = {
      ...form,
      original_amount: form.original_amount || undefined,
    };
    const res = await studentApi('/api/accounts/student-charges', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.success) {
      setError(res.message || ' ⁄–— ≈‰‘«¡ «·„”Êœ…');
      return;
    }
    setCreateOpen(false);
    setSuccess(' „ ≈‰‘«¡ „ÿ«·»… „”Êœ…');
    void load();
  };

  const confirmAction = async () => {
    if (!actionCharge || !actionKind) return;
    setActionBusy(true);
    setError(null);
    const url =
      actionKind === 'post'
        ? `/api/accounts/student-charges/${actionCharge.id}/post`
        : `/api/accounts/student-charges/${actionCharge.id}/void`;
    const body: Record<string, unknown> = {
      version: actionCharge.version,
      updated_at: actionCharge.updated_at,
    };
    if (actionKind === 'void') body.reason = voidReason || '≈·€«¡ „‰ «·Ê«ÃÂ…';
    const res = await studentApi(url, { method: 'POST', body: JSON.stringify(body) });
    setActionBusy(false);
    if (!res.success) {
      setError(res.message || '›‘·  «·⁄„·Ì…');
      return;
    }
    setActionCharge(null);
    setActionKind(null);
    setVoidReason('');
    setSuccess(actionKind === 'post' ? ' „ «· —ÕÌ·' : ' „ «·≈·€«¡');
    void load();
  };

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">«·„ÿ«·»«  «·„«·Ì…</h1>
          <p className="text-sm text-gray-600 mt-1">„”Êœ… ?  —ÕÌ· („œÌ‰ –„„ / œ«∆‰ ≈Ì—«œ) ? ≈·€«¡ »⁄ﬂ”</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 bg-red-900 text-white text-sm rounded-md hover:bg-red-800"
        >
          „ÿ«·»… „”Êœ…
        </button>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="»ÕÀ »—ﬁ„ «·„ÿ«·»… / «·»Ì«‰"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">ﬂ· «·Õ«·« </option>
          <option value="DRAFT">„”Êœ…</option>
          <option value="POSTED">„—Õ¯·</option>
          <option value="VOID">„·€Ï</option>
        </select>
        <select
          value={accountId}
          onChange={(e) => {
            setPage(1);
            setAccountId(e.target.value);
          }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">ﬂ· «·Õ”«»« </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_number} ó {a.student_full_name_ar || ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm hover:bg-gray-50"
        >
           ÕœÌÀ
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-right font-medium">«·—ﬁ„</th>
              <th className="px-3 py-2 text-right font-medium">«·ÿ«·»</th>
              <th className="px-3 py-2 text-right font-medium">‰Ê⁄ «·—”„</th>
              <th className="px-3 py-2 text-right font-medium">«· «—ÌŒ</th>
              <th className="px-3 py-2 text-right font-medium">«·„»·€</th>
              <th className="px-3 py-2 text-right font-medium">«·Õ«·…</th>
              <th className="px-3 py-2 text-right font-medium">≈Ã—«¡« </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  Ã«—Ì «· Õ„Ì·...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  ·«  ÊÃœ „ÿ«·»« 
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{row.charge_number}</td>
                  <td className="px-3 py-2">
                    {row.student_full_name_ar || row.account_number || 'ó'}
                  </td>
                  <td className="px-3 py-2">
                    {row.fee_type_code
                      ? `${row.fee_type_code} ó ${row.fee_type_name_ar || ''}`
                      : 'ó'}
                  </td>
                  <td className="px-3 py-2">{formatDateOnly(row.charge_date)}</td>
                  <td className="px-3 py-2">{formatMoney(row.original_amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${chargeStatusBadge(row.status)}`}>
                      {CHARGE_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === 'DRAFT' && (
                        <>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 bg-green-700 text-white rounded"
                            onClick={() => {
                              setActionCharge(row);
                              setActionKind('post');
                            }}
                          >
                             —ÕÌ·
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 border rounded"
                            onClick={() => {
                              setActionCharge(row);
                              setActionKind('void');
                            }}
                          >
                            ≈·€«¡
                          </button>
                        </>
                      )}
                      {row.status === 'POSTED' && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 border border-red-300 text-red-800 rounded"
                          onClick={() => {
                            setActionCharge(row);
                            setActionKind('void');
                          }}
                        >
                          ⁄ﬂ”
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
        <span>
          ’›Õ… {pagination.page} „‰ {pagination.total_pages} ∑ {pagination.total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            «·”«»ﬁ
          </button>
          <button
            type="button"
            disabled={page >= pagination.total_pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            «· «·Ì
          </button>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-4">≈‰‘«¡ „ÿ«·»… „”Êœ…</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">«·Õ”«» «·„«·Ì</label>
                <select
                  value={form.student_account_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, student_account_id: e.target.value }))
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">«Œ —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} ó {a.student_full_name_ar || ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">‰Ê⁄ «·—”„</label>
                <select
                  value={form.fee_type_id}
                  onChange={(e) => {
                    const fee = options?.fee_types.find((f) => f.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      fee_type_id: e.target.value,
                      original_amount: fee?.default_amount
                        ? String(fee.default_amount)
                        : f.original_amount,
                    }));
                  }}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">«Œ —</option>
                  {(options?.fee_types || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} ó {f.name_ar}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                   «—ÌŒ «·„ÿ«·»… (› —… OPEN)
                </label>
                <input
                  type="date"
                  value={form.charge_date}
                  onChange={(e) => setForm((f) => ({ ...f, charge_date: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">«·„»·€</label>
                <input
                  value={form.original_amount}
                  onChange={(e) => setForm((f) => ({ ...f, original_amount: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">«·»Ì«‰</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-3 py-2 border rounded-md text-sm">
                ≈·€«¡
              </button>
              <button
                type="button"
                disabled={saving || !form.student_account_id || !form.fee_type_id}
                onClick={() => void createDraft()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {saving ? 'Ã«—Ì «·Õ›Ÿ...' : 'Õ›Ÿ „”Êœ…'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionCharge && actionKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-2">
              {actionKind === 'post' ? ' —ÕÌ· «·„ÿ«·»…' : '≈·€«¡ «·„ÿ«·»…'}
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              {actionCharge.charge_number} ∑ {formatMoney(actionCharge.original_amount)}
            </p>
            {actionKind === 'void' && actionCharge.status === 'POSTED' && (
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="”»» «·≈·€«¡ (≈·“«„Ì ··„—Õ¯·)"
                className="w-full border rounded-md px-3 py-2 text-sm mb-3"
                rows={2}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActionCharge(null);
                  setActionKind(null);
                }}
                className="px-3 py-2 border rounded-md text-sm"
              >
                 —«Ã⁄
              </button>
              <button
                type="button"
                disabled={
                  actionBusy ||
                  (actionKind === 'void' &&
                    actionCharge.status === 'POSTED' &&
                    !voidReason.trim())
                }
                onClick={() => void confirmAction()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {actionBusy ? '...' : ' √ﬂÌœ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
