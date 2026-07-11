'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  JournalLineForm,
  accountsApi,
  moneyDiff,
  sumLines,
} from './types';

type AccountOpt = {
  id: string;
  code: string;
  name_ar: string;
  requires_cost_center: boolean;
};

type CostCenterOpt = { id: string; code: string; name_ar: string };
type YearOpt = { id: string; code: string; name_ar: string; status: string };
type PeriodOpt = {
  id: string;
  code: string;
  name_ar: string;
  status: string;
  start_date: string;
  end_date: string;
};
type TypeOpt = { code: string; name_ar: string };

type Props = {
  open: boolean;
  entryId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

function newLine(): JournalLineForm {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    account_id: '',
    cost_center_id: '',
    description: '',
    debit_amount: '',
    credit_amount: '',
  };
}

export default function EntryFormModal({ open, entryId, onClose, onSaved }: Props) {
  const [years, setYears] = useState<YearOpt[]>([]);
  const [periods, setPeriods] = useState<PeriodOpt[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterOpt[]>([]);
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [accountQ, setAccountQ] = useState('');
  const [version, setVersion] = useState(1);
  const [form, setForm] = useState({
    fiscal_year_id: '',
    fiscal_period_id: '',
    entry_date: '',
    entry_type: 'MANUAL',
    reference_number: '',
    description: '',
  });
  const [lines, setLines] = useState<JournalLineForm[]>([newLine(), newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const totalDebit = sumLines(lines, 'debit_amount');
  const totalCredit = sumLines(lines, 'credit_amount');
  const diff = moneyDiff(totalDebit, totalCredit);
  const balanced = diff === '0.000' && Number(totalDebit) > 0;

  const filteredAccounts = useMemo(() => {
    const q = accountQ.trim().toLowerCase();
    if (!q) return accounts.slice(0, 80);
    return accounts
      .filter(
        (a) =>
          a.code.toLowerCase().includes(q) || a.name_ar.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [accounts, accountQ]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const opt = await accountsApi<{
        fiscal_years: YearOpt[];
        default_fiscal_year: YearOpt | null;
        open_periods: PeriodOpt[];
        posting_accounts: AccountOpt[];
        cost_centers: CostCenterOpt[];
        entry_types: TypeOpt[];
      }>('/api/accounts/journal-entries/options');
      if (!opt.success || !opt.data) {
        setError(opt.message || 'تعذر تحميل خيارات القيد');
        return;
      }
      setYears(opt.data.fiscal_years || []);
      setAccounts(opt.data.posting_accounts || []);
      setCostCenters(opt.data.cost_centers || []);
      setTypes(opt.data.entry_types || []);
      const defYear = opt.data.default_fiscal_year;
      if (entryId) {
        const det = await accountsApi<Record<string, unknown>>(
          `/api/accounts/journal-entries/${entryId}`
        );
        if (!det.success || !det.data) {
          setError(det.message || 'تعذر تحميل القيد');
          return;
        }
        const d = det.data;
        setVersion(Number(d.version || 1));
        setForm({
          fiscal_year_id: String(d.fiscal_year_id),
          fiscal_period_id: String(d.fiscal_period_id),
          entry_date: String(d.entry_date),
          entry_type: String(d.entry_type || 'MANUAL'),
          reference_number: String(d.reference_number || ''),
          description: String(d.description || ''),
        });
        const loadedLines = (d.lines as Array<Record<string, unknown>>) || [];
        setLines(
          loadedLines.length
            ? loadedLines.map((l) => ({
                key: String(l.id || Math.random()),
                account_id: String(l.account_id),
                cost_center_id: String(l.cost_center_id || ''),
                description: String(l.description || ''),
                debit_amount:
                  Number(l.debit_amount) > 0 ? String(l.debit_amount) : '',
                credit_amount:
                  Number(l.credit_amount) > 0 ? String(l.credit_amount) : '',
              }))
            : [newLine(), newLine()]
        );
        const per = await accountsApi<PeriodOpt[]>(
          `/api/accounts/fiscal-periods?fiscal_year_id=${d.fiscal_year_id}`
        );
        if (per.success && per.data) {
          setPeriods((per.data as PeriodOpt[]).filter((p) => p.status === 'OPEN'));
        }
      } else {
        setVersion(1);
        setForm({
          fiscal_year_id: defYear?.id || '',
          fiscal_period_id: opt.data.open_periods?.[0]?.id || '',
          entry_date: new Date().toISOString().slice(0, 10),
          entry_type: 'MANUAL',
          reference_number: '',
          description: '',
        });
        setPeriods(opt.data.open_periods || []);
        setLines([newLine(), newLine()]);
      }
      setError(null);
      setWarnings([]);
    })();
  }, [open, entryId]);

  if (!open) return null;

  const onYearChange = async (yearId: string) => {
    setForm((f) => ({ ...f, fiscal_year_id: yearId, fiscal_period_id: '' }));
    const per = await accountsApi<PeriodOpt[]>(
      `/api/accounts/fiscal-periods?fiscal_year_id=${yearId}`
    );
    if (per.success && per.data) {
      const openOnly = (per.data as PeriodOpt[]).filter((p) => p.status === 'OPEN');
      setPeriods(openOnly);
      if (openOnly[0]) {
        setForm((f) => ({ ...f, fiscal_period_id: openOnly[0].id }));
      }
    }
  };

  const updateLine = (key: string, patch: Partial<JournalLineForm>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      reference_number: form.reference_number || null,
      version,
      lines: lines
        .filter((l) => l.account_id)
        .map((l) => ({
          account_id: l.account_id,
          cost_center_id: l.cost_center_id || null,
          description: l.description || null,
          debit_amount: l.debit_amount || '0',
          credit_amount: l.credit_amount || '0',
        })),
    };

    const res = entryId
      ? await accountsApi(`/api/accounts/journal-entries/${entryId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await accountsApi('/api/accounts/journal-entries', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    setSaving(false);
    if (!res.success) {
      setError(res.message || 'فشلت العملية');
      return;
    }
    if (Array.isArray(res.warnings)) setWarnings(res.warnings as string[]);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[94vh] overflow-y-auto p-5 text-right">
        <h2 className="text-lg font-semibold mb-4">
          {entryId ? 'تعديل مسودة قيد' : 'قيد محاسبي جديد'}
        </h2>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm text-gray-600">السنة المالية</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.fiscal_year_id}
                onChange={(e) => void onYearChange(e.target.value)}
                required
              >
                <option value="">اختر</option>
                {years
                  .filter((y) => y.status === 'ACTIVE')
                  .map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code} — {y.name_ar}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">الفترة</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.fiscal_period_id}
                onChange={(e) => setForm({ ...form, fiscal_period_id: e.target.value })}
                required
              >
                <option value="">اختر</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">تاريخ القيد</label>
              <input
                type="date"
                className="w-full border rounded-md px-3 py-2"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">نوع القيد</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={form.entry_type}
                onChange={(e) => setForm({ ...form, entry_type: e.target.value })}
              >
                {types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">الرقم المرجعي</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-sm text-gray-600">الوصف</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="border rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-medium">سطور القيد</h3>
              <div className="flex gap-2">
                <input
                  className="border rounded-md px-2 py-1 text-sm"
                  placeholder="بحث حساب..."
                  value={accountQ}
                  onChange={(e) => setAccountQ(e.target.value)}
                />
                <button
                  type="button"
                  className="px-3 py-1 rounded-md bg-gray-100 text-sm"
                  onClick={() => setLines((prev) => [...prev, newLine()])}
                >
                  إضافة سطر
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => {
                const acc = accounts.find((a) => a.id === line.account_id);
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start border-b pb-2"
                  >
                    <div className="md:col-span-1 text-xs text-gray-500 pt-2">{idx + 1}</div>
                    <div className="md:col-span-3">
                      <select
                        className="w-full border rounded-md px-2 py-2 text-sm"
                        value={line.account_id}
                        onChange={(e) =>
                          updateLine(line.key, {
                            account_id: e.target.value,
                            cost_center_id: '',
                          })
                        }
                      >
                        <option value="">الحساب</option>
                        {filteredAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name_ar}
                            {a.requires_cost_center ? ' ★' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <input
                        className="w-full border rounded-md px-2 py-2 text-sm"
                        placeholder="وصف السطر"
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <select
                        className="w-full border rounded-md px-2 py-2 text-sm"
                        value={line.cost_center_id}
                        onChange={(e) => updateLine(line.key, { cost_center_id: e.target.value })}
                        required={Boolean(acc?.requires_cost_center)}
                      >
                        <option value="">
                          {acc?.requires_cost_center ? 'مركز كلفة *' : 'مركز كلفة'}
                        </option>
                        {costCenters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <input
                        className="w-full border rounded-md px-2 py-2 text-sm"
                        placeholder="مدين"
                        inputMode="decimal"
                        value={line.debit_amount}
                        onChange={(e) =>
                          updateLine(line.key, {
                            debit_amount: e.target.value,
                            credit_amount: e.target.value ? '' : line.credit_amount,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-1">
                      <input
                        className="w-full border rounded-md px-2 py-2 text-sm"
                        placeholder="دائن"
                        inputMode="decimal"
                        value={line.credit_amount}
                        onChange={(e) =>
                          updateLine(line.key, {
                            credit_amount: e.target.value,
                            debit_amount: e.target.value ? '' : line.debit_amount,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2 flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-indigo-700"
                        onClick={() =>
                          setLines((prev) => [
                            ...prev,
                            { ...line, key: `${Date.now()}-${Math.random()}` },
                          ])
                        }
                      >
                        نسخ
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-700"
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span>
                مجموع المدين: <strong className="font-mono">{totalDebit}</strong>
              </span>
              <span>
                مجموع الدائن: <strong className="font-mono">{totalCredit}</strong>
              </span>
              <span className={balanced ? 'text-green-700' : 'text-amber-700'}>
                {balanced ? 'متوازن' : `القيد غير متوازن — الفرق: ${diff}`}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              يمكن حفظ المسودة غير المتوازنة. الإرسال للمراجعة يتطلب توازناً كاملاً وسطرين على الأقل.
            </p>
          </div>

          {warnings.length > 0 && (
            <ul className="text-sm text-amber-800 list-disc pr-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-gray-100">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md bg-red-900 text-white hover:bg-red-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ مسودة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
