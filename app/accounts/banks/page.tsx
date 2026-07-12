'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ConfirmDialog from '../cashbox/sessions/components/ConfirmDialog';
import {
  ACCOUNT_TYPE_LABEL,
  BankAccountListItem,
  BankAccountStats,
  BankBranchListItem,
  BankListItem,
  BankOptions,
  BankStats,
  OPENING_BALANCE_NOTE,
  STATUS_LABEL,
  bankApi,
  statusBadgeClass,
} from './components/types';

type Tab = 'banks' | 'branches' | 'accounts';

export default function AccountsBanksPage() {
  const [tab, setTab] = useState<Tab>('accounts');
  const [options, setOptions] = useState<BankOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // banks
  const [banks, setBanks] = useState<BankListItem[]>([]);
  const [bankStats, setBankStats] = useState<BankStats | null>(null);
  const [bankQ, setBankQ] = useState('');
  const [bankActive, setBankActive] = useState('');
  const [banksLoading, setBanksLoading] = useState(false);
  const [bankModal, setBankModal] = useState(false);
  const [bankForm, setBankForm] = useState({
    code: '',
    name_ar: '',
    name_en: '',
    short_name: '',
    swift_code: '',
    country_code: 'IQ',
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [deactivateBank, setDeactivateBank] = useState<BankListItem | null>(null);

  // branches
  const [branches, setBranches] = useState<BankBranchListItem[]>([]);
  const [branchQ, setBranchQ] = useState('');
  const [branchBankId, setBranchBankId] = useState('');
  const [branchActive, setBranchActive] = useState('');
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchModal, setBranchModal] = useState(false);
  const [branchForm, setBranchForm] = useState({
    bank_id: '',
    code: '',
    name_ar: '',
    city: '',
    phone: '',
  });
  const [branchSaving, setBranchSaving] = useState(false);
  const [deactivateBranch, setDeactivateBranch] = useState<BankBranchListItem | null>(null);

  // accounts
  const [accounts, setAccounts] = useState<BankAccountListItem[]>([]);
  const [accountStats, setAccountStats] = useState<BankAccountStats | null>(null);
  const [accQ, setAccQ] = useState('');
  const [accBankId, setAccBankId] = useState('');
  const [accBranchId, setAccBranchId] = useState('');
  const [accStatus, setAccStatus] = useState('');
  const [accCurrency, setAccCurrency] = useState('');
  const [accType, setAccType] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [accountForm, setAccountForm] = useState({
    code: '',
    bank_id: '',
    bank_branch_id: '',
    account_name_ar: '',
    account_number: '',
    iban: '',
    currency_code: 'IQD',
    gl_account_id: '',
    account_type: 'CURRENT',
    opening_balance_reference: '',
    opening_balance_date: '',
    is_primary: false,
  });
  const [accountSaving, setAccountSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadOptions = useCallback(async (bankId?: string) => {
    const params = new URLSearchParams();
    if (bankId) params.set('bank_id', bankId);
    const res = await bankApi<BankOptions>(
      `/api/accounts/bank-accounts/options?${params.toString()}`
    );
    if (res.success && res.data) setOptions(res.data);
  }, []);

  const loadBanks = useCallback(async () => {
    setBanksLoading(true);
    const params = new URLSearchParams({ page_size: '50' });
    if (bankQ.trim()) params.set('q', bankQ.trim());
    if (bankActive) params.set('is_active', bankActive);
    const res = await bankApi<BankListItem[]>(`/api/accounts/banks?${params}`);
    if (!res.success) {
      setError(res.message || 'تعذر تحميل المصارف');
      setBanks([]);
    } else {
      setBanks((res.data as BankListItem[]) || []);
      setBankStats((res.stats as BankStats) || null);
      setError(null);
    }
    setBanksLoading(false);
  }, [bankQ, bankActive]);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    const params = new URLSearchParams({ page_size: '50' });
    if (branchQ.trim()) params.set('q', branchQ.trim());
    if (branchBankId) params.set('bank_id', branchBankId);
    if (branchActive) params.set('is_active', branchActive);
    const res = await bankApi<BankBranchListItem[]>(
      `/api/accounts/bank-branches?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الفروع');
      setBranches([]);
    } else {
      setBranches((res.data as BankBranchListItem[]) || []);
      setError(null);
    }
    setBranchesLoading(false);
  }, [branchQ, branchBankId, branchActive]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const params = new URLSearchParams({ page_size: '50' });
    if (accQ.trim()) params.set('q', accQ.trim());
    if (accBankId) params.set('bank_id', accBankId);
    if (accBranchId) params.set('branch_id', accBranchId);
    if (accStatus) params.set('status', accStatus);
    if (accCurrency) params.set('currency', accCurrency);
    if (accType) params.set('account_type', accType);
    const res = await bankApi<BankAccountListItem[]>(
      `/api/accounts/bank-accounts?${params}`
    );
    if (!res.success) {
      setError(res.message || 'تعذر تحميل الحسابات');
      setAccounts([]);
    } else {
      setAccounts((res.data as BankAccountListItem[]) || []);
      setAccountStats((res.stats as BankAccountStats) || null);
      setError(null);
    }
    setAccountsLoading(false);
  }, [accQ, accBankId, accBranchId, accStatus, accCurrency, accType]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/filters
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch by tab
    if (tab === 'banks') void loadBanks();
    if (tab === 'branches') void loadBranches();
    if (tab === 'accounts') void loadAccounts();
  }, [tab, loadBanks, loadBranches, loadAccounts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload branches for bank
    if (accountForm.bank_id) void loadOptions(accountForm.bank_id);
  }, [accountForm.bank_id, loadOptions]);

  const createBank = async () => {
    setFormError(null);
    if (!bankForm.code.trim() || !bankForm.name_ar.trim()) {
      setFormError('الرمز والاسم العربي مطلوبان');
      return;
    }
    setBankSaving(true);
    const res = await bankApi('/api/accounts/banks', {
      method: 'POST',
      body: JSON.stringify({
        ...bankForm,
        code: bankForm.code.trim(),
        name_ar: bankForm.name_ar.trim(),
        name_en: bankForm.name_en.trim() || null,
        short_name: bankForm.short_name.trim() || null,
        swift_code: bankForm.swift_code.trim() || null,
        country_code: bankForm.country_code.trim() || null,
      }),
    });
    setBankSaving(false);
    if (!res.success) {
      setFormError(res.message || 'تعذر الإنشاء');
      return;
    }
    setBankModal(false);
    setSuccess('تم إنشاء المصرف');
    void loadBanks();
    void loadOptions();
  };

  const createBranch = async () => {
    setFormError(null);
    if (!branchForm.bank_id || !branchForm.code.trim() || !branchForm.name_ar.trim()) {
      setFormError('المصرف والرمز والاسم مطلوبان');
      return;
    }
    setBranchSaving(true);
    const res = await bankApi('/api/accounts/bank-branches', {
      method: 'POST',
      body: JSON.stringify({
        ...branchForm,
        code: branchForm.code.trim(),
        name_ar: branchForm.name_ar.trim(),
        city: branchForm.city.trim() || null,
        phone: branchForm.phone.trim() || null,
      }),
    });
    setBranchSaving(false);
    if (!res.success) {
      setFormError(res.message || 'تعذر الإنشاء');
      return;
    }
    setBranchModal(false);
    setSuccess('تم إنشاء الفرع');
    void loadBranches();
    void loadOptions();
  };

  const createAccount = async () => {
    setFormError(null);
    if (
      !accountForm.code.trim() ||
      !accountForm.bank_id ||
      !accountForm.account_name_ar.trim() ||
      !accountForm.account_number.trim() ||
      !accountForm.gl_account_id
    ) {
      setFormError('الحقول الأساسية مطلوبة (رمز، مصرف، اسم، رقم حساب، حساب GL)');
      return;
    }
    setAccountSaving(true);
    const res = await bankApi('/api/accounts/bank-accounts', {
      method: 'POST',
      body: JSON.stringify({
        ...accountForm,
        code: accountForm.code.trim(),
        account_name_ar: accountForm.account_name_ar.trim(),
        account_number: accountForm.account_number.trim(),
        bank_branch_id: accountForm.bank_branch_id || null,
        iban: accountForm.iban.trim() || null,
        opening_balance_reference:
          accountForm.opening_balance_reference.trim() || null,
        opening_balance_date: accountForm.opening_balance_date || null,
      }),
    });
    setAccountSaving(false);
    if (!res.success) {
      setFormError(res.message || 'تعذر الإنشاء');
      return;
    }
    setAccountModal(false);
    setSuccess('تم إنشاء الحساب المصرفي');
    void loadAccounts();
  };

  const doDeactivateBank = async () => {
    if (!deactivateBank) return;
    setActionBusy(true);
    setActionError(null);
    const res = await bankApi(`/api/accounts/banks/${deactivateBank.id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({
        version: deactivateBank.version,
        updated_at: deactivateBank.updated_at,
      }),
    });
    setActionBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر التعطيل');
      return;
    }
    setDeactivateBank(null);
    setSuccess('تم تعطيل المصرف');
    void loadBanks();
  };

  const doDeactivateBranch = async () => {
    if (!deactivateBranch) return;
    setActionBusy(true);
    setActionError(null);
    const res = await bankApi(
      `/api/accounts/bank-branches/${deactivateBranch.id}/deactivate`,
      {
        method: 'POST',
        body: JSON.stringify({
          version: deactivateBranch.version,
          updated_at: deactivateBranch.updated_at,
        }),
      }
    );
    setActionBusy(false);
    if (!res.success) {
      setActionError(res.message || 'تعذر التعطيل');
      return;
    }
    setDeactivateBranch(null);
    setSuccess('تم تعطيل الفرع');
    void loadBranches();
  };

  const filteredBranchesForForm = (options?.branches || []).filter(
    (b) => !accountForm.bank_id || b.bank_id === accountForm.bank_id
  );

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'banks', label: 'المصارف' },
    { id: 'branches', label: 'الفروع' },
    { id: 'accounts', label: 'الحسابات' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">الحسابات المصرفية</h1>
            <p className="text-sm text-gray-600 mt-1">
              إدارة المصارف والفروع والحسابات البنكية وربطها بدليل الحسابات.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tab === 'banks' && (
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
                onClick={() => {
                  setFormError(null);
                  setBankForm({
                    code: '',
                    name_ar: '',
                    name_en: '',
                    short_name: '',
                    swift_code: '',
                    country_code: 'IQ',
                  });
                  setBankModal(true);
                }}
              >
                إضافة مصرف
              </button>
            )}
            {tab === 'branches' && (
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
                onClick={() => {
                  setFormError(null);
                  setBranchForm({
                    bank_id: options?.banks[0]?.id || '',
                    code: '',
                    name_ar: '',
                    city: '',
                    phone: '',
                  });
                  setBranchModal(true);
                }}
              >
                إضافة فرع
              </button>
            )}
            {tab === 'accounts' && (
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
                onClick={() => {
                  setFormError(null);
                  setAccountForm({
                    code: '',
                    bank_id: options?.banks[0]?.id || '',
                    bank_branch_id: '',
                    account_name_ar: '',
                    account_number: '',
                    iban: '',
                    currency_code: 'IQD',
                    gl_account_id: '',
                    account_type: 'CURRENT',
                    opening_balance_reference: '',
                    opening_balance_date: '',
                    is_primary: false,
                  });
                  setAccountModal(true);
                }}
              >
                إضافة حساب مصرفي
              </button>
            )}
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

        <div className="flex gap-1 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-red-900 text-red-900 font-medium'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'banks' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="الإجمالي" value={bankStats?.total} />
              <StatCard label="نشط" value={bankStats?.active} />
              <StatCard label="معطّل" value={bankStats?.inactive} />
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                className="border rounded-md px-3 py-2 text-sm flex-1 min-w-[180px]"
                placeholder="بحث…"
                value={bankQ}
                onChange={(e) => setBankQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadBanks()}
              />
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={bankActive}
                onChange={(e) => setBankActive(e.target.value)}
              >
                <option value="">الكل</option>
                <option value="true">نشط</option>
                <option value="false">معطّل</option>
              </select>
              <button
                type="button"
                className="px-3 py-2 rounded-md border text-sm"
                onClick={() => void loadBanks()}
              >
                تحديث
              </button>
            </div>
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">الرمز</th>
                    <th className="text-right px-3 py-2 font-medium">الاسم</th>
                    <th className="text-right px-3 py-2 font-medium">SWIFT</th>
                    <th className="text-right px-3 py-2 font-medium">فروع</th>
                    <th className="text-right px-3 py-2 font-medium">حسابات</th>
                    <th className="text-right px-3 py-2 font-medium">الحالة</th>
                    <th className="text-right px-3 py-2 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {banksLoading ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                        جاري التحميل…
                      </td>
                    </tr>
                  ) : banks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                        لا توجد مصارف
                      </td>
                    </tr>
                  ) : (
                    banks.map((b) => (
                      <tr key={b.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{b.code}</td>
                        <td className="px-3 py-2">{b.name_ar}</td>
                        <td className="px-3 py-2 font-mono text-xs">{b.swift_code || '—'}</td>
                        <td className="px-3 py-2">{b.branches_count ?? 0}</td>
                        <td className="px-3 py-2">{b.accounts_count ?? 0}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs ${
                              b.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            {b.is_active ? 'نشط' : 'معطّل'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {b.is_active && (
                            <button
                              type="button"
                              className="text-xs text-red-800 hover:underline"
                              onClick={() => setDeactivateBank(b)}
                            >
                              تعطيل
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'branches' && (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                className="border rounded-md px-3 py-2 text-sm flex-1 min-w-[160px]"
                placeholder="بحث…"
                value={branchQ}
                onChange={(e) => setBranchQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadBranches()}
              />
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={branchBankId}
                onChange={(e) => setBranchBankId(e.target.value)}
              >
                <option value="">كل المصارف</option>
                {(options?.banks || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name_ar}
                  </option>
                ))}
              </select>
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={branchActive}
                onChange={(e) => setBranchActive(e.target.value)}
              >
                <option value="">الكل</option>
                <option value="true">نشط</option>
                <option value="false">معطّل</option>
              </select>
              <button
                type="button"
                className="px-3 py-2 rounded-md border text-sm"
                onClick={() => void loadBranches()}
              >
                تحديث
              </button>
            </div>
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">المصرف</th>
                    <th className="text-right px-3 py-2 font-medium">الرمز</th>
                    <th className="text-right px-3 py-2 font-medium">الاسم</th>
                    <th className="text-right px-3 py-2 font-medium">المدينة</th>
                    <th className="text-right px-3 py-2 font-medium">الحالة</th>
                    <th className="text-right px-3 py-2 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {branchesLoading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                        جاري التحميل…
                      </td>
                    </tr>
                  ) : branches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                        لا توجد فروع
                      </td>
                    </tr>
                  ) : (
                    branches.map((br) => (
                      <tr key={br.id} className="border-t">
                        <td className="px-3 py-2">
                          {br.bank_code} — {br.bank_name_ar}
                        </td>
                        <td className="px-3 py-2 font-mono">{br.code}</td>
                        <td className="px-3 py-2">{br.name_ar}</td>
                        <td className="px-3 py-2">{br.city || '—'}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs ${
                              br.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            {br.is_active ? 'نشط' : 'معطّل'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {br.is_active && (
                            <button
                              type="button"
                              className="text-xs text-red-800 hover:underline"
                              onClick={() => setDeactivateBranch(br)}
                            >
                              تعطيل
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'accounts' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <StatCard label="الإجمالي" value={accountStats?.total} />
              <StatCard label="نشط" value={accountStats?.active} />
              <StatCard label="معلّق" value={accountStats?.suspended} />
              <StatCard label="مغلق" value={accountStats?.closed} />
              <StatCard label="أساسي" value={accountStats?.primary} />
              <StatCard label="دينار" value={accountStats?.iqd} />
              <StatCard label="عملات أخرى" value={accountStats?.other} />
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
              <input
                className="border rounded-md px-3 py-2 text-sm lg:col-span-2"
                placeholder="بحث بالرمز أو الاسم أو رقم الحساب…"
                value={accQ}
                onChange={(e) => setAccQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadAccounts()}
              />
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={accBankId}
                onChange={(e) => {
                  setAccBankId(e.target.value);
                  setAccBranchId('');
                  void loadOptions(e.target.value || undefined);
                }}
              >
                <option value="">كل المصارف</option>
                {(options?.banks || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name_ar}
                  </option>
                ))}
              </select>
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={accBranchId}
                onChange={(e) => setAccBranchId(e.target.value)}
              >
                <option value="">كل الفروع</option>
                {(options?.branches || [])
                  .filter((b) => !accBankId || b.bank_id === accBankId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name_ar}
                    </option>
                  ))}
              </select>
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={accStatus}
                onChange={(e) => setAccStatus(e.target.value)}
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
                value={accCurrency}
                onChange={(e) => setAccCurrency(e.target.value)}
              >
                <option value="">كل العملات</option>
                {(options?.currencies || ['IQD', 'USD']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={accType}
                onChange={(e) => setAccType(e.target.value)}
              >
                <option value="">كل الأنواع</option>
                {(options?.account_types || []).map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="px-3 py-2 rounded-md border text-sm"
                onClick={() => void loadAccounts()}
              >
                تحديث
              </button>
            </div>
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">الرمز</th>
                    <th className="text-right px-3 py-2 font-medium">الاسم</th>
                    <th className="text-right px-3 py-2 font-medium">المصرف</th>
                    <th className="text-right px-3 py-2 font-medium">رقم الحساب</th>
                    <th className="text-right px-3 py-2 font-medium">العملة</th>
                    <th className="text-right px-3 py-2 font-medium">النوع</th>
                    <th className="text-right px-3 py-2 font-medium">الحالة</th>
                    <th className="text-right px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {accountsLoading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                        جاري التحميل…
                      </td>
                    </tr>
                  ) : accounts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                        لا توجد حسابات
                      </td>
                    </tr>
                  ) : (
                    accounts.map((a) => (
                      <tr key={a.id} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono">
                          {a.code}
                          {a.is_primary && (
                            <span className="mr-1 text-[10px] text-red-900">أساسي</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{a.account_name_ar}</td>
                        <td className="px-3 py-2 text-xs">
                          {a.bank_name_ar || a.bank_code}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{a.account_number}</td>
                        <td className="px-3 py-2">{a.currency_code}</td>
                        <td className="px-3 py-2">
                          {ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClass(a.status)}`}
                          >
                            {STATUS_LABEL[a.status] || a.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/accounts/banks/${a.id}`}
                            className="text-xs text-red-900 hover:underline"
                          >
                            تفاصيل
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Bank create modal */}
      {bankModal && (
        <Modal title="إضافة مصرف" onClose={() => setBankModal(false)}>
          <Field label="الرمز">
            <input
              className="border rounded-md px-3 py-2 text-sm w-full font-mono"
              value={bankForm.code}
              onChange={(e) => setBankForm({ ...bankForm, code: e.target.value })}
            />
          </Field>
          <Field label="الاسم بالعربية">
            <input
              className="border rounded-md px-3 py-2 text-sm w-full"
              value={bankForm.name_ar}
              onChange={(e) => setBankForm({ ...bankForm, name_ar: e.target.value })}
            />
          </Field>
          <Field label="الاسم بالإنجليزية">
            <input
              className="border rounded-md px-3 py-2 text-sm w-full"
              value={bankForm.name_en}
              onChange={(e) => setBankForm({ ...bankForm, name_en: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الاسم المختصر">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={bankForm.short_name}
                onChange={(e) =>
                  setBankForm({ ...bankForm, short_name: e.target.value })
                }
              />
            </Field>
            <Field label="SWIFT">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full font-mono"
                value={bankForm.swift_code}
                onChange={(e) =>
                  setBankForm({ ...bankForm, swift_code: e.target.value })
                }
              />
            </Field>
          </div>
          {formError && <FormErr msg={formError} />}
          <ModalActions
            busy={bankSaving}
            onCancel={() => setBankModal(false)}
            onSave={() => void createBank()}
          />
        </Modal>
      )}

      {/* Branch create modal */}
      {branchModal && (
        <Modal title="إضافة فرع" onClose={() => setBranchModal(false)}>
          <Field label="المصرف">
            <select
              className="border rounded-md px-3 py-2 text-sm w-full"
              value={branchForm.bank_id}
              onChange={(e) =>
                setBranchForm({ ...branchForm, bank_id: e.target.value })
              }
            >
              <option value="">اختر…</option>
              {(options?.banks || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="رمز الفرع">
            <input
              className="border rounded-md px-3 py-2 text-sm w-full font-mono"
              value={branchForm.code}
              onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
            />
          </Field>
          <Field label="الاسم بالعربية">
            <input
              className="border rounded-md px-3 py-2 text-sm w-full"
              value={branchForm.name_ar}
              onChange={(e) =>
                setBranchForm({ ...branchForm, name_ar: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="المدينة">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={branchForm.city}
                onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })}
              />
            </Field>
            <Field label="الهاتف">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={branchForm.phone}
                onChange={(e) =>
                  setBranchForm({ ...branchForm, phone: e.target.value })
                }
              />
            </Field>
          </div>
          {formError && <FormErr msg={formError} />}
          <ModalActions
            busy={branchSaving}
            onCancel={() => setBranchModal(false)}
            onSave={() => void createBranch()}
          />
        </Modal>
      )}

      {/* Account create modal */}
      {accountModal && (
        <Modal title="إضافة حساب مصرفي" onClose={() => setAccountModal(false)} wide>
          <div className="grid md:grid-cols-2 gap-2">
            <Field label="الكود الداخلي">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full font-mono"
                value={accountForm.code}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, code: e.target.value })
                }
              />
            </Field>
            <Field label="اسم الحساب">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.account_name_ar}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, account_name_ar: e.target.value })
                }
              />
            </Field>
            <Field label="المصرف">
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.bank_id}
                onChange={(e) =>
                  setAccountForm({
                    ...accountForm,
                    bank_id: e.target.value,
                    bank_branch_id: '',
                  })
                }
              >
                <option value="">اختر…</option>
                {(options?.banks || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الفرع (اختياري)">
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.bank_branch_id}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, bank_branch_id: e.target.value })
                }
              >
                <option value="">—</option>
                {filteredBranchesForForm.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="رقم الحساب">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full font-mono"
                value={accountForm.account_number}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, account_number: e.target.value })
                }
              />
            </Field>
            <Field label="IBAN">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full font-mono"
                value={accountForm.iban}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, iban: e.target.value })
                }
              />
            </Field>
            <Field label="العملة">
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.currency_code}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, currency_code: e.target.value })
                }
              >
                {(options?.currencies || ['IQD', 'USD']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="نوع الحساب">
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.account_type}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, account_type: e.target.value })
                }
              >
                {(options?.account_types || []).map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="حساب GL">
              <select
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.gl_account_id}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, gl_account_id: e.target.value })
                }
              >
                <option value="">اختر…</option>
                {(options?.eligible_gl_accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="رصيد افتتاحي مرجعي">
              <input
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.opening_balance_reference}
                onChange={(e) =>
                  setAccountForm({
                    ...accountForm,
                    opening_balance_reference: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="تاريخ الرصيد المرجعي">
              <input
                type="date"
                className="border rounded-md px-3 py-2 text-sm w-full"
                value={accountForm.opening_balance_date}
                onChange={(e) =>
                  setAccountForm({
                    ...accountForm,
                    opening_balance_date: e.target.value,
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm mt-6">
              <input
                type="checkbox"
                checked={accountForm.is_primary}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, is_primary: e.target.checked })
                }
              />
              حساب أساسي لهذه العملة
            </label>
          </div>
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            {OPENING_BALANCE_NOTE}
          </p>
          {formError && <FormErr msg={formError} />}
          <ModalActions
            busy={accountSaving}
            onCancel={() => setAccountModal(false)}
            onSave={() => void createAccount()}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(deactivateBank)}
        title="تعطيل المصرف"
        message={`هل تريد تعطيل المصرف «${deactivateBank?.name_ar}»؟`}
        confirmLabel="تعطيل"
        danger
        busy={actionBusy}
        error={actionError}
        onConfirm={() => void doDeactivateBank()}
        onClose={() => setDeactivateBank(null)}
      />
      <ConfirmDialog
        open={Boolean(deactivateBranch)}
        title="تعطيل الفرع"
        message={`هل تريد تعطيل الفرع «${deactivateBranch?.name_ar}»؟`}
        confirmLabel="تعطيل"
        danger
        busy={actionBusy}
        error={actionError}
        onConfirm={() => void doDeactivateBranch()}
        onClose={() => setDeactivateBranch(null)}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">
        {value == null ? '—' : value}
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`bg-white rounded-lg shadow-lg w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-5 space-y-3 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" className="text-gray-400 hover:text-gray-700" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function FormErr({ msg }: { msg: string }) {
  return (
    <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
      {msg}
    </div>
  );
}

function ModalActions({
  busy,
  onCancel,
  onSave,
}: {
  busy?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        className="px-3 py-2 rounded-md border text-sm"
        disabled={busy}
        onClick={onCancel}
      >
        إلغاء
      </button>
      <button
        type="button"
        className="px-3 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-40"
        disabled={busy}
        onClick={onSave}
      >
        {busy ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
    </div>
  );
}
