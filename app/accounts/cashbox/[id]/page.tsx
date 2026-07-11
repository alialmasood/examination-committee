'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ActivationChecklist from '../components/ActivationChecklist';
import CashBoxFormModal from '../components/CashBoxFormModal';
import CashBoxStatusBadge from '../components/CashBoxStatusBadge';
import CustodiansPanel from '../components/CustodiansPanel';
import {
  CashBoxDetail,
  CashBoxOptions,
  canActivateChecklist,
  cashApi,
  formatIqd,
} from '../components/types';

export default function CashBoxDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [box, setBox] = useState<CashBoxDetail | null>(null);
  const [options, setOptions] = useState<CashBoxOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (!id) return;
    if (showSpinner) setLoading(true);
    const [detail, opt] = await Promise.all([
      cashApi<CashBoxDetail>(`/api/accounts/cash-boxes/${id}`),
      cashApi<CashBoxOptions>('/api/accounts/cash-boxes/options'),
    ]);
    if (opt.success && opt.data) setOptions(opt.data);
    if (!detail.success || !detail.data) {
      setError(detail.message || 'تعذر تحميل الصندوق');
      setBox(null);
    } else {
      setBox(detail.data);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // تحميل أولي من API — نفس نمط صفحات الحسابات الأخرى
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load(false);
  }, [load]);

  const checklist = box
    ? canActivateChecklist({
        ...box,
        primary_custodian_user_id:
          box.primary_custodian?.user_id || box.primary_custodian_user_id,
      })
    : { ok: false, items: [] };

  const warnings: string[] = [];
  if (box) {
    if (!box.account_id) warnings.push('لا يوجد حساب مرتبط بالصندوق.');
    if (!box.primary_custodian && !box.primary_custodian_user_id) {
      warnings.push('لا يوجد أمين أساسي ساري.');
    }
    if (
      box.box_type_code === 'PETTY' &&
      !(box.ceiling_amount != null && Number(box.ceiling_amount) > 0)
    ) {
      warnings.push('صندوق النثريات بلا سقف صالح.');
    }
    if (box.status === 'DRAFT' && !checklist.ok) {
      warnings.push('تعذر التفعيل حتى تكتمل الشروط.');
    }
  }

  const doActivate = async () => {
    if (!box || !checklist.ok) return;
    setActivating(true);
    setActivateError(null);
    const res = await cashApi(`/api/accounts/cash-boxes/${box.id}/activate`, {
      method: 'POST',
      body: JSON.stringify({
        version: box.version,
        updated_at: box.updated_at,
      }),
    });
    setActivating(false);
    if (!res.success) {
      setActivateError(res.message || 'تعذر التفعيل');
      return;
    }
    setActivateOpen(false);
    setSuccess('تم تفعيل الصندوق بنجاح');
    void load(true);
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500">جاري تحميل تفاصيل الصندوق…</div>
    );
  }

  if (!box) {
    return (
      <div className="p-6">
        <div className="text-red-800 bg-red-50 border border-red-200 rounded px-4 py-3 text-sm">
          {error || 'الصندوق غير موجود'}
        </div>
        <Link href="/accounts/cashbox" className="text-sm text-red-900 mt-3 inline-block">
          العودة للقائمة
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/accounts/cashbox" className="text-xs text-gray-500 hover:underline">
              ← قائمة الصناديق
            </Link>
            <h1 className="text-xl font-semibold text-gray-900 mt-1">
              {box.name_ar}{' '}
              <span className="text-sm font-mono text-gray-500">({box.code})</span>
            </h1>
            <div className="mt-2">
              <CashBoxStatusBadge status={box.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/accounts/cashbox/sessions"
              className="px-3 py-2 rounded-md border border-red-900 text-red-900 text-sm hover:bg-red-50"
            >
              الجلسات اليومية
            </Link>
            {box.status !== 'CLOSED' && (
              <button
                type="button"
                className="px-3 py-2 rounded-md border text-sm"
                onClick={() => setFormOpen(true)}
              >
                تعديل
              </button>
            )}
            {box.status === 'DRAFT' && (
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-red-900 text-white text-sm disabled:opacity-50"
                onClick={() => {
                  setActivateError(null);
                  setActivateOpen(true);
                }}
              >
                تفعيل
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

        {warnings.length > 0 && (
          <div className="text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
            {warnings.map((w) => (
              <div key={w}>• {w}</div>
            ))}
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <Info label="النوع" value={box.box_type_name_ar || box.box_type_code} />
          <Info
            label="الحساب المرتبط"
            value={
              box.account_id ? (
                <Link
                  href="/accounts/chart-of-accounts"
                  className="text-red-900 hover:underline"
                >
                  {box.account_code} — {box.account_name_ar}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <Info label="السقف" value={formatIqd(box.ceiling_amount)} />
          <Info label="الرصيد الدفتري" value={formatIqd(box.book_balance)} />
          <Info
            label="الأمين الأساسي"
            value={
              box.primary_custodian?.username ||
              box.primary_custodian_username ||
              '—'
            }
          />
          <Info
            label="تاريخ الإنشاء"
            value={
              box.created_at
                ? new Date(box.created_at).toLocaleString('ar-IQ')
                : '—'
            }
          />
          <Info
            label="آخر تحديث"
            value={
              box.updated_at
                ? new Date(box.updated_at).toLocaleString('ar-IQ')
                : '—'
            }
          />
          <Info label="العملة" value={box.currency_code || 'IQD'} />
          <Info label="الوصف" value={box.description || '—'} />
        </div>
      </div>

      <CustodiansPanel box={box} options={options} onChanged={() => void load(true)} />

      <CashBoxFormModal
        open={formOpen}
        mode="edit"
        options={options}
        initial={box}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setSuccess('تم تحديث الصندوق');
          void load(true);
        }}
      />

      <ActivationChecklist
        open={activateOpen}
        items={checklist.items}
        canSubmit={checklist.ok}
        busy={activating}
        error={activateError}
        onClose={() => setActivateOpen(false)}
        onConfirm={() => void doActivate()}
      />
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="font-medium text-gray-900 break-words">{value}</div>
    </div>
  );
}
