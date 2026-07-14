'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  ACCOUNT_STATUS_LABEL,
  accountStatusBadge,
  CHARGE_STATUS_LABEL,
  chargeStatusBadge,
  formatDateOnly,
  formatMoney,
  studentApi,
  type StudentAccountDetail,
  type StudentAccountSummary,
  type StudentChargeListItem,
  type StudentLedgerEntry,
} from '../../components/types';

export default function StudentAccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [account, setAccount] = useState<StudentAccountDetail | null>(null);
  const [summary, setSummary] = useState<StudentAccountSummary | null>(null);
  const [ledger, setLedger] = useState<StudentLedgerEntry[]>([]);
  const [charges, setCharges] = useState<StudentChargeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [accRes, sumRes, ledRes, chRes] = await Promise.all([
      studentApi<StudentAccountDetail>(`/api/accounts/student-accounts/${id}`),
      studentApi<StudentAccountSummary>(`/api/accounts/student-accounts/${id}/summary`),
      studentApi<{ entries?: StudentLedgerEntry[]; data?: StudentLedgerEntry[] } | StudentLedgerEntry[]>(
        `/api/accounts/student-accounts/${id}/ledger?page_size=100`
      ),
      studentApi<StudentChargeListItem[]>(
        `/api/accounts/student-charges?student_account_id=${id}&page_size=50`
      ),
    ]);

    if (!accRes.success || !accRes.data) {
      setError(accRes.message || 'الحساب غير موجود');
      setAccount(null);
      setLoading(false);
      return;
    }
    setAccount(accRes.data);
    setSummary(sumRes.data || null);

    const ledPayload = ledRes.data as
      | StudentLedgerEntry[]
      | { entries?: StudentLedgerEntry[]; data?: StudentLedgerEntry[]; rows?: StudentLedgerEntry[] }
      | undefined;
    if (Array.isArray(ledPayload)) setLedger(ledPayload);
    else if (ledPayload?.entries) setLedger(ledPayload.entries);
    else if (ledPayload?.rows) setLedger(ledPayload.rows);
    else if (ledPayload?.data) setLedger(ledPayload.data);
    else setLedger([]);

    setCharges(chRes.data || []);
    setError(null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/id change
    void load();
  }, [load]);

  const runAction = async (path: string, confirmMsg: string) => {
    if (!account) return;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    setActionError(null);
    const res = await studentApi(`/api/accounts/student-accounts/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify({
        version: account.version,
        updated_at: account.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setActionError(res.message || 'فشلت العملية');
      return;
    }
    void load();
  };

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'الحساب غير موجود'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline">
          رجوع
        </button>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/accounts/students/accounts" className="hover:underline">
              الحسابات
            </Link>
            <span>/</span>
            <span>{account.account_number}</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            {account.student?.full_name_ar || account.student_full_name_ar || 'حساب طالب'}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {account.student?.university_id || account.student_university_id || '—'} ·{' '}
            <span className={`inline-flex px-2 py-0.5 rounded text-xs ${accountStatusBadge(account.status)}`}>
              {ACCOUNT_STATUS_LABEL[account.status]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/students/accounts/${id}/print`}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            طباعة كشف الحساب
          </Link>
          {account.status === 'ACTIVE' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction('suspend', 'تعليق هذا الحساب؟')}
              className="px-3 py-2 text-sm border border-orange-300 text-orange-900 rounded-md"
            >
              تعليق
            </button>
          )}
          {account.status === 'SUSPENDED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction('activate', 'إعادة تفعيل الحساب؟')}
              className="px-3 py-2 text-sm bg-green-700 text-white rounded-md"
            >
              تفعيل
            </button>
          )}
          {account.status !== 'CLOSED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction('close', 'إغلاق نهائي؟ يتطلب رصيداً صفرياً ولا مسودات.')
              }
              className="px-3 py-2 text-sm bg-gray-800 text-white rounded-md"
            >
              إغلاق
            </button>
          )}
        </div>
      </div>

      <StudentsNav />

      {actionError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <InfoCard label="الرصيد" value={formatMoney(summary?.balance ?? '0')} />
        <InfoCard label="إجمالي المطالبات المرحّلة" value={formatMoney(summary?.charges_total ?? '0')} />
        <InfoCard label="حساب الذمم" value={`${account.receivable_gl_code || '—'} ${account.receivable_gl_name_ar || ''}`} />
        <InfoCard label="العملة / السنة" value={`${account.currency_code} · ${account.academic_year || '—'}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-gray-900 mb-3">المطالبات</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-1 text-right font-medium">الرقم</th>
                  <th className="py-1 text-right font-medium">المبلغ</th>
                  <th className="py-1 text-right font-medium">الحالة</th>
                  <th className="py-1 text-right font-medium">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-gray-500 text-center">
                      لا مطالبات
                    </td>
                  </tr>
                ) : (
                  charges.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="py-2">{c.charge_number}</td>
                      <td className="py-2">{formatMoney(c.original_amount)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${chargeStatusBadge(c.status)}`}>
                          {CHARGE_STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td className="py-2">{formatDateOnly(c.charge_date)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Link
            href={`/accounts/students/charges?student_account_id=${id}`}
            className="inline-block mt-3 text-sm text-red-900 hover:underline"
          >
            إدارة المطالبات
          </Link>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-gray-900 mb-3">دفتر الطالب الفرعي</h2>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500 sticky top-0 bg-white">
                <tr>
                  <th className="py-1 text-right font-medium">التاريخ</th>
                  <th className="py-1 text-right font-medium">البيان</th>
                  <th className="py-1 text-right font-medium">مدين</th>
                  <th className="py-1 text-right font-medium">دائن</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-gray-500 text-center">
                      لا حركات
                    </td>
                  </tr>
                ) : (
                  ledger.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="py-2 whitespace-nowrap">{formatDateOnly(e.entry_date)}</td>
                      <td className="py-2">{e.description}</td>
                      <td className="py-2">{formatMoney(e.debit_amount)}</td>
                      <td className="py-2">{formatMoney(e.credit_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 font-semibold text-gray-900 break-words">{value}</div>
    </div>
  );
}
