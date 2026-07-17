'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import SuppliersNav from '../SuppliersNav';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';

const api = '/api/accounts/supplier-payments';

export function PaymentList() {
  const [r, setR] = useState<any>();
  useEffect(() => {
    fetch(api).then((x) => x.json()).then(setR);
  }, []);
  return (
    <main dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">دفعات الموردين</h1>
        <Link className="bg-blue-600 text-white rounded px-4 py-2" href="payments/new">دفعة جديدة</Link>
      </div>
      <SuppliersNav />
      <table className="w-full bg-white shadow rounded text-right">
        <thead>
          <tr>
            <th className="p-3">الرقم</th><th>المورد</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {r?.data?.map((x: any) => (
            <tr key={x.id} className="border-t">
              <td className="p-3"><Link className="text-blue-600" href={`payments/${x.id}`}>{x.payment_number}</Link></td>
              <td>{x.supplier_name_ar}</td>
              <td>{x.payment_date}</td>
              <td>{x.amount}</td>
              <td>{x.payment_method}</td>
              <td>{x.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function PaymentNew() {
  const [o, setO] = useState<any>();
  const [f, setF] = useState<any>({
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'CASH',
    amount: '',
    allocations: [],
  });
  const [msg, setMsg] = useState('');
  const [confirmPost, setConfirmPost] = useState(false);
  const [pending, setPending] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${api}/options`).then((x) => x.json()).then(setO);
  }, []);
  const change = (k: string, v: any) => setF({ ...f, [k]: v });

  async function saveDraftThenAsk() {
    setMsg('');
    setBusy(true);
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(f),
      }).then((x) => x.json());
      if (!r.data) return setMsg(r.error || r.message || 'تعذر الحفظ');
      const pre = await fetch(`${api}/${r.data.id}/preview-allocation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: f.amount, mode: 'auto' }),
      }).then((x) => x.json());
      if (!pre.data) return setMsg(pre.error || pre.message || 'تعذر معاينة التخصيص');
      const up = await fetch(`${api}/${r.data.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: r.data.version,
          updated_at: r.data.updated_at,
          allocations: pre.data.allocations,
        }),
      }).then((x) => x.json());
      if (!up.data) return setMsg(up.error || up.message || 'تعذر حفظ التخصيص');
      setPending(up.data);
      setConfirmPost(true);
    } finally {
      setBusy(false);
    }
  }

  async function doPost() {
    if (!pending) return;
    setBusy(true);
    try {
      await fetch(`${api}/${pending.id}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: pending.version, updated_at: pending.updated_at }),
      });
      location.href = `/accounts/suppliers/payments/${pending.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">دفعة مورد جديدة</h1>
      <SuppliersNav />
      <div className="grid gap-3 bg-white shadow rounded p-5">
        <input className="border p-2" placeholder="معرّف حساب المورد" value={f.supplier_account_id || ''} onChange={(e) => change('supplier_account_id', e.target.value)} />
        <input className="border p-2" type="date" value={f.payment_date} onChange={(e) => change('payment_date', e.target.value)} />
        <input className="border p-2" type="number" placeholder="المبلغ" value={f.amount} onChange={(e) => change('amount', e.target.value)} />
        <select className="border p-2" value={f.payment_method} onChange={(e) => change('payment_method', e.target.value)}>
          <option value="CASH">نقدي</option>
          <option value="BANK">مصرفي</option>
        </select>
        {f.payment_method === 'CASH' ? (
          <select className="border p-2" onChange={(e) => {
            const s = o?.data?.open_sessions?.find((x: any) => x.id === e.target.value);
            setF({ ...f, cash_box_session_id: e.target.value, cash_box_id: s?.cash_box_id });
          }}>
            <option>اختر الجلسة المفتوحة</option>
            {o?.data?.open_sessions?.map((x: any) => (
              <option key={x.id} value={x.id}>{x.cash_box_name_ar} — {x.session_date}</option>
            ))}
          </select>
        ) : (
          <select className="border p-2" onChange={(e) => change('bank_account_id', e.target.value)}>
            <option>اختر الحساب المصرفي</option>
            {o?.data?.bank_accounts?.map((x: any) => (
              <option key={x.id} value={x.id}>{x.code} — {x.account_name_ar}</option>
            ))}
          </select>
        )}
        <textarea className="border p-2" placeholder="الوصف" onChange={(e) => change('description', e.target.value)} />
        <button className="bg-blue-600 text-white rounded p-2" disabled={busy} onClick={() => void saveDraftThenAsk()}>حفظ ومعاينة ثم ترحيل</button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
      <ConfirmDialog
        open={confirmPost}
        title="تأكيد ترحيل دفعة المورد"
        message="سيتم إنشاء سند الصرف وتخصيص الفواتير وترحيل الدفعة. هل تريد المتابعة؟"
        confirmLabel="ترحيل"
        busy={busy}
        onClose={() => {
          setConfirmPost(false);
          if (pending) location.href = `/accounts/suppliers/payments/${pending.id}`;
        }}
        onConfirm={() => void doPost()}
      />
    </main>
  );
}

export function PaymentDetail({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${api}/${id}`).then((x) => x.json()).then(setR);
  }, [id]);
  const p = r?.data;

  async function doPost() {
    if (!p) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${api}/${id}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: p.version, updated_at: p.updated_at }),
      }).then((x) => x.json());
      if (res.error || res.message && !res.success) {
        setActionError(res.error || res.message);
        return;
      }
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function doVoid() {
    if (!p) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${api}/${id}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: p.version,
          updated_at: p.updated_at,
          reason: voidReason || (p.status === 'DRAFT' ? 'إلغاء مسودة' : undefined),
        }),
      }).then((x) => x.json());
      if (res.error || (res.message && !res.success && !res.data)) {
        setActionError(res.error || res.message);
        return;
      }
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">تفاصيل الدفعة</h1>
      <SuppliersNav />
      {p && (
        <section className="bg-white shadow rounded p-5 space-y-2">
          <p>{p.payment_number} · {p.amount} IQD · {p.status}</p>
          <p>{p.supplier_name_ar}</p>
          <p>{p.description}</p>
          <h2 className="font-bold">التخصيصات</h2>
          {p.allocations?.map((x: any) => (
            <p key={x.id}>{x.invoice_number}: {x.allocated_amount}</p>
          ))}
          {p.status === 'DRAFT' && (
            <button className="bg-green-600 text-white p-2 rounded" onClick={() => setConfirmPost(true)}>ترحيل</button>
          )}
          {p.status !== 'VOID' && (
            <button className="bg-red-600 text-white p-2 rounded mr-2" onClick={() => setConfirmVoid(true)}>إلغاء</button>
          )}
          <Link className="text-blue-600" href={`/accounts/suppliers/payments/${id}/print`}>طباعة</Link>
        </section>
      )}
      <ConfirmDialog
        open={confirmPost}
        title="تأكيد ترحيل الدفعة"
        message="سيتم إنشاء سند الصرف وتحديث دفتر المورد والفواتير."
        confirmLabel="ترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmPost(false)}
        onConfirm={() => void doPost()}
      />
      <ConfirmDialog
        open={confirmVoid}
        title="تأكيد إلغاء الدفعة"
        danger
        message={
          <div className="space-y-2">
            <p>{p?.status === 'POSTED' ? 'سيُعكس السند والدفتر والتخصيصات.' : 'إلغاء المسودة دون قيد.'}</p>
            {p?.status === 'POSTED' && (
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm"
                rows={2}
                placeholder="سبب الإلغاء (إلزامي)"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            )}
          </div>
        }
        confirmLabel="إلغاء الدفعة"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmVoid(false)}
        onConfirm={() => void doVoid()}
      />
    </main>
  );
}
