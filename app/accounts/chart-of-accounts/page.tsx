'use client';

import { useEffect, useMemo, useState } from 'react';
import AccountFormModal from './components/AccountFormModal';
import ChartTreeView from './components/ChartTreeView';
import {
  AccountType,
  ChartAccount,
  accountsApi,
  balanceLabel,
} from './components/types';

function collectIds(nodes: ChartAccount[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id);
    if (n.children?.length) collectIds(n.children, out);
  }
  return out;
}

function filterTree(
  nodes: ChartAccount[],
  pred: (a: ChartAccount) => boolean
): ChartAccount[] {
  const result: ChartAccount[] = [];
  for (const n of nodes) {
    const kids = filterTree(n.children || [], pred);
    if (pred(n) || kids.length > 0) {
      result.push({ ...n, children: kids });
    }
  }
  return result;
}

export default function ChartOfAccountsPage() {
  const [types, setTypes] = useState<AccountType[]>([]);
  const [tree, setTree] = useState<ChartAccount[]>([]);
  const [flat, setFlat] = useState<ChartAccount[]>([]);
  const [totals, setTotals] = useState({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'child';
    initial?: ChartAccount | null;
    parentHint?: ChartAccount | null;
  }>({ open: false, mode: 'create' });
  const [details, setDetails] = useState<ChartAccount | null>(null);

  const load = async () => {
    setLoading(true);
    const [typesRes, treeRes] = await Promise.all([
      accountsApi<AccountType[]>('/api/accounts/account-types'),
      accountsApi<ChartAccount[]>('/api/accounts/chart-of-accounts/tree'),
    ]);
    if (typesRes.success && typesRes.data) setTypes(typesRes.data);
    if (treeRes.success) {
      setTree((treeRes.data as ChartAccount[]) || []);
      setFlat((treeRes.flat as ChartAccount[]) || []);
      if (treeRes.totals) setTotals(treeRes.totals as typeof totals);
      const ids = collectIds((treeRes.data as ChartAccount[]) || []);
      setExpanded(new Set(ids));
    } else {
      setError(treeRes.message || 'تعذر تحميل دليل الحسابات');
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- تحميل مرة واحدة عند الفتح
  }, []);

  const visible = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return filterTree(tree, (a) => {
      if (typeFilter && a.account_type_id !== typeFilter) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (kindFilter === 'group' && !a.is_group) return false;
      if (kindFilter === 'detail' && a.is_group) return false;
      if (!qq) return true;
      return (
        a.code.toLowerCase().includes(qq) ||
        a.name_ar.toLowerCase().includes(qq) ||
        (a.name_en || '').toLowerCase().includes(qq)
      );
    });
  }, [tree, q, typeFilter, statusFilter, kindFilter]);

  const notify = (ok: boolean, text?: string) => {
    setError(ok ? null : text || 'فشلت العملية');
    setMessage(ok ? text || 'تمت العملية بنجاح' : null);
  };

  const expandAll = () => setExpanded(new Set(collectIds(tree)));
  const collapseAll = () => setExpanded(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">دليل الحسابات</h1>
            <p className="text-sm text-gray-600 mt-1">
              شجرة الحسابات المحاسبية لكلية الشرق التقنية التخصصية
            </p>
            <p className="text-xs text-gray-500 mt-2">
              الإجمالي: {totals.total} · فعّال: {totals.active} · معطّل: {totals.inactive}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-gray-100 text-sm"
              onClick={expandAll}
            >
              توسيع الكل
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-gray-100 text-sm"
              onClick={collapseAll}
            >
              طي الكل
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800"
              onClick={() => setModal({ open: true, mode: 'create' })}
            >
              إضافة حساب
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
          <input
            className="border rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="بحث بالكود أو الاسم..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">كل الأنواع</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name_ar}
              </option>
            ))}
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">كل الحالات</option>
            <option value="active">فعّال</option>
            <option value="inactive">معطّل</option>
          </select>
          <select
            className="border rounded-md px-3 py-2 text-sm md:col-span-1"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          >
            <option value="">تجميعي / تفصيلي</option>
            <option value="group">تجميعي</option>
            <option value="detail">تفصيلي</option>
          </select>
        </div>

        {message && <p className="text-sm text-green-700 mb-2">{message}</p>}
        {error && <p className="text-sm text-red-700 mb-2">{error}</p>}

        {loading ? (
          <div className="py-16 text-center text-gray-500">جاري تحميل دليل الحسابات...</div>
        ) : (
          <ChartTreeView
            nodes={visible}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onDetails={(a) => setDetails(a)}
            onEdit={(a) => setModal({ open: true, mode: 'edit', initial: a })}
            onAddChild={(a) => setModal({ open: true, mode: 'child', parentHint: a })}
            onMove={async (a) => {
              const parentCode = prompt('أدخل كود الحساب الأب الجديد (فارغ للجذر):', '') ?? null;
              if (parentCode === null) return;
              let parentId: string | null = null;
              if (parentCode.trim()) {
                const found = flat.find((x) => x.code.toLowerCase() === parentCode.trim().toLowerCase());
                if (!found) {
                  notify(false, 'لم يُعثر على الحساب الأب بالكود المدخل');
                  return;
                }
                parentId = found.id;
              }
              const res = await accountsApi(`/api/accounts/chart-of-accounts/${a.id}/move`, {
                method: 'POST',
                body: JSON.stringify({ parent_id: parentId }),
              });
              notify(Boolean(res.success), res.message);
              if (res.success) await load();
            }}
            onToggleStatus={async (a) => {
              const force =
                a.is_active && a.is_group
                  ? confirm(
                      'قد توجد حسابات فرعية فعالة. هل تريد التعطيل مع تعطيل الفروع الفعالة؟'
                    )
                  : false;
              if (a.is_active && a.is_group && !force) {
                // try without force first; if 409 user already cancelled force
              }
              const res = await accountsApi(`/api/accounts/chart-of-accounts/${a.id}/toggle-status`, {
                method: 'POST',
                body: JSON.stringify({ force_with_active_children: force }),
              });
              notify(Boolean(res.success), res.message);
              if (res.success) await load();
            }}
            onDelete={async (a) => {
              if (!confirm(`حذف الحساب ${a.code} — ${a.name_ar}؟`)) return;
              const res = await accountsApi(`/api/accounts/chart-of-accounts/${a.id}`, {
                method: 'DELETE',
              });
              notify(Boolean(res.success), res.message);
              if (res.success) await load();
            }}
          />
        )}
      </div>

      <AccountFormModal
        open={modal.open}
        mode={modal.mode}
        accountTypes={types}
        flatAccounts={flat}
        initial={modal.initial}
        parentHint={modal.parentHint}
        onClose={() => setModal({ open: false, mode: 'create' })}
        onSaved={async () => {
          notify(true, 'تم حفظ الحساب');
          await load();
        }}
      />

      {details && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-lg text-right space-y-2">
            <h3 className="font-semibold text-lg">تفاصيل الحساب</h3>
            <p>
              <span className="text-gray-500">الكود:</span> {details.code}
            </p>
            <p>
              <span className="text-gray-500">الاسم:</span> {details.name_ar}
            </p>
            <p>
              <span className="text-gray-500">النوع:</span> {details.account_type_name_ar}
            </p>
            <p>
              <span className="text-gray-500">الرصيد الطبيعي:</span>{' '}
              {balanceLabel(details.normal_balance)}
            </p>
            <p>
              <span className="text-gray-500">المستوى:</span> {details.level}
            </p>
            <p>
              <span className="text-gray-500">التصنيف:</span>{' '}
              {details.is_group ? 'تجميعي' : 'تفصيلي'} / ترحيل:{' '}
              {details.allow_posting ? 'نعم' : 'لا'}
            </p>
            <p>
              <span className="text-gray-500">مركز كلفة:</span>{' '}
              {details.requires_cost_center ? 'مطلوب' : 'غير مطلوب'}
            </p>
            <p>
              <span className="text-gray-500">المصدر:</span>{' '}
              {details.source === 'SYSTEM' ? 'نظام (SYSTEM)' : 'مستخدم (USER)'}
            </p>
            <p>
              <span className="text-gray-500">ترتيب العرض:</span> {details.sort_order ?? '—'}
            </p>
            <button
              type="button"
              className="mt-3 px-4 py-2 rounded-md bg-gray-100"
              onClick={() => setDetails(null)}
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
