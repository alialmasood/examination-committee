'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CashBoxDetail,
  CashBoxOptions,
  cashApi,
} from './types';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  options: CashBoxOptions | null;
  initial?: CashBoxDetail | CashBoxDetail | null;
  onClose: () => void;
  onSaved: (id?: string) => void;
};

export default function CashBoxFormModal({
  open,
  mode,
  options,
  initial,
  onClose,
  onSaved,
}: Props) {
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [boxType, setBoxType] = useState('MAIN');
  const [accountId, setAccountId] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && initial) {
      setCode(initial.code || '');
      setNameAr(initial.name_ar || '');
      setNameEn(initial.name_en || '');
      setBoxType(initial.box_type_code || 'MAIN');
      setAccountId(initial.account_id || '');
      setCeiling(initial.ceiling_amount || '');
      setDescription(initial.description || '');
    } else {
      setCode('');
      setNameAr('');
      setNameEn('');
      setBoxType(options?.box_types[0]?.code || 'MAIN');
      setAccountId('');
      setCeiling('');
      setDescription('');
    }
  }, [open, mode, initial, options]);

  const accounts = useMemo(() => {
    const list = [...(options?.eligible_accounts || [])];
    if (
      initial?.account_id &&
      !list.some((a) => a.id === initial.account_id)
    ) {
      list.unshift({
        id: initial.account_id,
        code: initial.account_code || '',
        name_ar: initial.account_name_ar || 'الحساب الحالي',
        account_type_code: 'ASSET',
      });
    }
    return list;
  }, [options, initial]);

  if (!open) return null;

  const pettyRequiresCeiling = boxType === 'PETTY';

  const submit = async () => {
    setError(null);
    if (!code.trim() || !nameAr.trim() || !boxType) {
      setError('الرمز والاسم العربي والنوع مطلوبة');
      return;
    }
    if (pettyRequiresCeiling && !(Number(ceiling) > 0)) {
      setError('صندوق النثريات يتطلب سقفاً أكبر من صفر');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          code: code.trim(),
          name_ar: nameAr.trim(),
          name_en: nameEn.trim() || null,
          box_type_code: boxType,
          account_id: accountId || null,
          description: description.trim() || null,
        };
        if (ceiling !== '') body.ceiling_amount = ceiling;
        const res = await cashApi<{ id: string }>('/api/accounts/cash-boxes', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!res.success) {
          setError(res.message || 'تعذر إنشاء الصندوق');
          return;
        }
        onSaved((res.data as { id?: string })?.id);
        onClose();
      } else if (initial) {
        const body: Record<string, unknown> = {
          name_ar: nameAr.trim(),
          name_en: nameEn.trim() || null,
          box_type_code: boxType,
          account_id: accountId || null,
          description: description.trim() || null,
          ceiling_amount: ceiling === '' ? null : ceiling,
          version: initial.version,
          updated_at: initial.updated_at,
        };
        const res = await cashApi(`/api/accounts/cash-boxes/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        if (!res.success) {
          if (res.message?.includes('مستخدم آخر') || String(res.message).includes('updated_at')) {
            setError(
              'تم تعديل الصندوق من مستخدم آخر، يرجى إعادة تحميل البيانات.'
            );
          } else {
            setError(res.message || 'تعذر تعديل الصندوق');
          }
          return;
        }
        onSaved(initial.id);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {mode === 'create' ? 'إضافة صندوق' : 'تعديل صندوق'}
          </h2>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800"
            onClick={onClose}
            disabled={saving}
          >
            إغلاق
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {mode === 'edit' && initial && (
            <div className="text-sm text-gray-600">
              الحالة:{' '}
              <span className="font-medium">{initial.status}</span> (للعرض فقط)
            </div>
          )}

          <label className="block text-sm">
            <span className="text-gray-700">الكود</span>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm disabled:bg-gray-100"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={mode === 'edit' || saving}
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">الاسم العربي</span>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">الاسم الإنجليزي</span>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">نوع الصندوق</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={boxType}
              onChange={(e) => setBoxType(e.target.value)}
              disabled={saving}
            >
              {(options?.box_types || []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name_ar}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">الحساب المرتبط</span>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={saving || (mode === 'edit' && initial?.status !== 'DRAFT')}
            >
              <option value="">— بدون حساب —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name_ar}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500 mt-1 block">
              حسابات ASSET تفصيلية فعّالة قابلة للترحيل فقط.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">
              السقف النقدي{pettyRequiresCeiling ? ' *' : ''}
            </span>
            <input
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              disabled={saving}
              inputMode="decimal"
              placeholder="0.000"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">الوصف / ملاحظات</span>
            <textarea
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md border text-sm"
            onClick={onClose}
            disabled={saving}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-900 text-white text-sm hover:bg-red-800 disabled:opacity-60"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'جاري الحفظ…' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
