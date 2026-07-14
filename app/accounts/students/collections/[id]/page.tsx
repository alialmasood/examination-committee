'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import StudentsNav from '../../components/StudentsNav';
import {
  COLLECTIONS_API,
  COLLECTION_STATUS_LABEL,
  collectionStatusBadge,
  formatDateOnly,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  studentApi,
  type StudentCollectionDetail,
} from '../../components/types';

export default function StudentCollectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [collection, setCollection] = useState<StudentCollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [showPost, setShowPost] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await studentApi<StudentCollectionDetail>(`${COLLECTIONS_API}/${id}`);
    if (!res.success || !res.data) {
      setError(res.message || 'التحصيل غير موجود');
      setCollection(null);
    } else {
      setCollection(res.data);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const postCollection = async () => {
    if (!collection) return;
    setBusy(true);
    const res = await studentApi(`${COLLECTIONS_API}/${id}/post`, {
      method: 'POST',
      body: JSON.stringify({
        version: collection.version,
        updated_at: collection.updated_at,
      }),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشل الترحيل');
      return;
    }
    setShowPost(false);
    setSuccess('تم ترحيل التحصيل وإنشاء سند القبض');
    void load();
  };

  const voidCollection = async () => {
    if (!collection) return;
    setBusy(true);
    const res = await studentApi(`${COLLECTIONS_API}/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({
        version: collection.version,
        updated_at: collection.updated_at,
        reason: voidReason || 'إلغاء من الواجهة',
      }),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'فشل الإلغاء');
      return;
    }
    setShowVoid(false);
    setVoidReason('');
    setSuccess('تم إلغاء التحصيل');
    void load();
  };

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        <div className="h-40 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-red-800">{error || 'التحصيل غير موجود'}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 text-sm underline">
          رجوع
        </button>
      </div>
    );
  }

  const allocations = collection.allocations || [];
  const allocatedTotal = allocations.reduce(
    (s, a) => s + Number(a.allocated_amount || 0),
    0
  );
  const remainingAfter =
    Number(collection.amount || 0) - allocatedTotal;

  return (
    <div className="p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            تحصيل {collection.collection_number}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {collection.student_full_name_ar || collection.account_number} ·{' '}
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs ${collectionStatusBadge(collection.status)}`}
            >
              {COLLECTION_STATUS_LABEL[collection.status]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/accounts/students/collections/${id}/print`}
            className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            طباعة الإيصال
          </Link>
          {collection.status === 'DRAFT' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPost(true)}
                className="px-3 py-2 text-sm bg-green-700 text-white rounded-md disabled:opacity-40"
              >
                ترحيل
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowVoid(true)}
                className="px-3 py-2 text-sm border border-red-300 text-red-800 rounded-md"
              >
                إلغاء
              </button>
            </>
          )}
          {collection.status === 'POSTED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowVoid(true)}
              className="px-3 py-2 text-sm border border-red-300 text-red-800 rounded-md"
            >
              عكس التحصيل
            </button>
          )}
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm space-y-2">
          <div>
            <span className="text-gray-500">الحساب: </span>
            <Link
              href={`/accounts/students/accounts/${collection.student_account_id}`}
              className="text-red-900 hover:underline"
            >
              {collection.account_number}
            </Link>
          </div>
          <div>
            <span className="text-gray-500">التاريخ: </span>
            {formatDateOnly(collection.collection_date)}
          </div>
          <div>
            <span className="text-gray-500">المبلغ: </span>
            {formatMoney(collection.amount)}
          </div>
          <div>
            <span className="text-gray-500">الطريقة: </span>
            {PAYMENT_METHOD_LABEL[collection.payment_method]}
          </div>
          {collection.payer_name && (
            <div>
              <span className="text-gray-500">الدافع: </span>
              {collection.payer_name}
            </div>
          )}
          {collection.cash_voucher_number && (
            <div>
              <span className="text-gray-500">سند نقدي: </span>
              {collection.cash_voucher_number}
            </div>
          )}
          {collection.bank_voucher_number && (
            <div>
              <span className="text-gray-500">سند مصرفي: </span>
              {collection.bank_voucher_number}
            </div>
          )}
          {collection.posted_at && (
            <div>
              <span className="text-gray-500">تاريخ الترحيل: </span>
              {formatDateOnly(collection.posted_at)}
            </div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
          <div className="text-gray-500 mb-1">البيان</div>
          <p className="text-gray-800">{collection.description}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 font-medium text-sm">
          تخصيصات المطالبات
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-right font-medium">المطالبة</th>
              <th className="px-3 py-2 text-right font-medium">القسط</th>
              <th className="px-3 py-2 text-right font-medium">استحقاق القسط</th>
              <th className="px-3 py-2 text-right font-medium">المخصص</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                  لا توجد تخصيصات
                </td>
              </tr>
            ) : (
              allocations.map((a) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{a.charge_number || '—'}</td>
                  <td className="px-3 py-2">{a.installment_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    {formatDateOnly(a.installment_due_date)}
                  </td>
                  <td className="px-3 py-2">{formatMoney(a.allocated_amount)}</td>
                </tr>
              ))
            )}
          </tbody>
          {allocations.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-medium">
                <td colSpan={3} className="px-3 py-2 text-left">
                  إجمالي المخصص / غير مخصص
                </td>
                <td className="px-3 py-2">
                  {formatMoney(allocatedTotal)} / {formatMoney(remainingAfter)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-2">ترحيل التحصيل</h2>
            <p className="text-sm text-gray-600 mb-3">
              {collection.collection_number} · {formatMoney(collection.amount)} · سيتم إنشاء
              سند قبض {PAYMENT_METHOD_LABEL[collection.payment_method]}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPost(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void postCollection()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {busy ? '...' : 'تأكيد الترحيل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5" dir="rtl">
            <h2 className="text-lg font-semibold mb-2">
              {collection.status === 'POSTED' ? 'عكس التحصيل' : 'إلغاء التحصيل'}
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              {collection.collection_number} · {formatMoney(collection.amount)}
            </p>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="سبب الإلغاء"
              className="w-full border rounded-md px-3 py-2 text-sm mb-3"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowVoid(false)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void voidCollection()}
                className="px-3 py-2 bg-red-900 text-white rounded-md text-sm disabled:opacity-40"
              >
                {busy ? '...' : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
