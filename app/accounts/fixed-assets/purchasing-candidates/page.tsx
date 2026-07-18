'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import FixedAssetsNav from '../FixedAssetsNav';
import { API, CAP, can, errMsg, fetchJson, iqd } from '../_lib';

export default function PurchasingCandidatesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [caps, setCaps] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson(API.fromPurchasing);
    if (!r.success) return setError(r.__status === 401 || r.__status === 403
      ? 'ليس لديك صلاحية عرض مرشّحي الرسملة' : (r.message || 'تعذّر التحميل'));
    const list = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.candidates) ? r.data.candidates : [];
    setRows(list);
  };

  useEffect(() => {
    fetchJson(API.options).then((o) => setCaps(o?.data?.capabilities ?? []));
    void load();
  }, []);

  const capitalize = can(caps, CAP.ASSET_CAPITALIZE);
  const rowId = (c: any, i: number) =>
    c.purchase_order_line_id || c.invoice_line_id || c.id || `${c.supplier_invoice_id ?? ''}-${c.line_number ?? i}`;
  const remaining = (c: any) =>
    Number(c.remaining_quantity ?? c.remaining ?? (Number(c.quantity ?? 0) - Number(c.capitalized_quantity ?? c.already_capitalized ?? 0)));

  async function doCapitalize(c: any, id: string) {
    setMsg('');
    setError('');
    setBusyId(id);
    try {
      const units = Number(qty[id] || remaining(c) || 0);
      if (!(units > 0)) { setMsg('أدخل كمية صحيحة'); return; }
      const payload: any = { quantity: units, units };
      if (c.purchase_order_line_id) payload.purchase_order_line_id = c.purchase_order_line_id;
      if (c.invoice_line_id) payload.invoice_line_id = c.invoice_line_id;
      if (c.id) payload.candidate_id = c.id;
      if (c.category_id) payload.category_id = c.category_id;
      const r = await fetchJson(API.fromPurchasing, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.success) { setMsg(errMsg(r)); return; }
      const created = Array.isArray(r.data) ? r.data.length : (r.data?.created_count ?? 1);
      setMsg(`تم إنشاء ${created} أصل/أصول مسودة.`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold mb-2">مرشّحو الرسملة من المشتريات</h1>
      <FixedAssetsNav />

      {!capitalize && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          العرض فقط — تحتاج صلاحية الرسملة لإنشاء الأصول.
        </p>
      )}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}
      {msg && <p className="text-green-700 mb-3 text-sm">{msg}</p>}

      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-2">الفاتورة</th>
            <th>السطر</th>
            <th>الوصف</th>
            <th>التصنيف</th>
            <th>الكمية</th>
            <th>مُرسمل</th>
            <th>المتبقي</th>
            <th>كلفة الوحدة</th>
            {capitalize && <th>رسملة</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const id = rowId(c, i);
            const rem = remaining(c);
            return (
              <tr key={id} className="border-t">
                <td className="p-2">{c.supplier_invoice_number || c.invoice_number || '—'}</td>
                <td>{c.line_number ?? '—'}</td>
                <td>{c.description || '—'}</td>
                <td>{c.category_name_ar || c.category_name || '—'}</td>
                <td>{c.quantity ?? '—'}</td>
                <td>{c.capitalized_quantity ?? c.already_capitalized ?? 0}</td>
                <td className="font-semibold">{rem}</td>
                <td>{iqd(c.unit_cost ?? c.unit_price)}</td>
                {capitalize && (
                  <td className="whitespace-nowrap">
                    <input
                      className="border p-1 w-16"
                      type="number"
                      min={1}
                      max={rem}
                      value={qty[id] ?? String(rem || '')}
                      onChange={(e) => setQty((q) => ({ ...q, [id]: e.target.value }))}
                    />
                    <button
                      className="bg-red-800 text-white rounded px-2 py-1 mr-1 disabled:opacity-40"
                      disabled={busyId === id || rem <= 0}
                      onClick={() => void doCapitalize(c, id)}
                    >
                      {busyId === id ? '…' : 'رسملة'}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={capitalize ? 9 : 8} className="p-3 text-gray-400">لا مرشّحين للرسملة حالياً</td></tr>
          )}
        </tbody>
      </table>

      <p className="text-xs text-gray-400 mt-3">
        الأصول المُنشأة تظهر كمسودات في <Link className="text-blue-600" href="/accounts/fixed-assets/assets?status=DRAFT">سجل الأصول</Link>.
      </p>
    </main>
  );
}
