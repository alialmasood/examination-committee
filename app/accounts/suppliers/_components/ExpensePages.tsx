'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import SuppliersNav from '../SuppliersNav';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';

const api = '/api/accounts/direct-expenses';

export function ExpenseList() {
  const [r, setR] = useState<any>();
  useEffect(() => {
    fetch(api).then((x) => x.json()).then(setR);
  }, []);
  return (
    <main dir="rtl" className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">المصروفات المباشرة</h1>
        <Link className="bg-blue-600 text-white rounded px-4 py-2" href="expenses/new">مصروف جديد</Link>
      </div>
      <SuppliersNav />
      <table className="w-full bg-white shadow rounded">
        <thead>
          <tr><th>الرقم</th><th>التاريخ</th><th>المستفيد</th><th>المبلغ</th><th>الحالة</th></tr>
        </thead>
        <tbody>
          {r?.data?.map((x: any) => (
            <tr className="border-t" key={x.id}>
              <td><Link className="text-blue-600" href={`expenses/${x.id}`}>{x.expense_number}</Link></td>
              <td>{x.expense_date}</td>
              <td>{x.beneficiary_name}</td>
              <td>{x.amount}</td>
              <td>{x.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function ExpenseNew() {
  const [f, setF] = useState<any>({
    expense_date: new Date().toISOString().slice(0, 10),
    payment_method: 'CASH',
    amount: '',
  });
  const [m, setM] = useState('');
  const [confirmPost, setConfirmPost] = useState(false);
  const [pending, setPending] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const c = (k: string, v: any) => setF({ ...f, [k]: v });

  async function saveDraftThenAsk() {
    setM('');
    setBusy(true);
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(f),
      }).then((x) => x.json());
      if (!r.data) return setM(r.error || r.message || 'تعذر الحفظ');
      setPending(r.data);
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
      location.href = `/accounts/suppliers/expenses/${pending.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">مصروف مباشر جديد</h1>
      <SuppliersNav />
      <div className="grid gap-3 bg-white shadow rounded p-5">
        {[
          ['expense_gl_account_id', 'معرّف حساب المصروف'],
          ['beneficiary_name', 'اسم المستفيد'],
          ['amount', 'المبلغ'],
          ['cash_box_id', 'معرّف الصندوق'],
          ['cash_box_session_id', 'معرّف الجلسة'],
          ['bank_account_id', 'معرّف الحساب البنكي (إن BANK)'],
        ].map(([k, l]) => (
          <input key={k} className="border p-2" placeholder={l} value={f[k] || ''} onChange={(e) => c(k, e.target.value)} />
        ))}
        <input className="border p-2" type="date" value={f.expense_date} onChange={(e) => c('expense_date', e.target.value)} />
        <select className="border p-2" value={f.payment_method} onChange={(e) => c('payment_method', e.target.value)}>
          <option value="CASH">نقدي</option>
          <option value="BANK">مصرفي</option>
        </select>
        <textarea className="border p-2" placeholder="الوصف" onChange={(e) => c('description', e.target.value)} />
        <button onClick={() => void saveDraftThenAsk()} disabled={busy} className="bg-blue-600 text-white p-2 rounded">حفظ ثم ترحيل</button>
        {m && <p className="text-red-600">{m}</p>}
      </div>
      <ConfirmDialog
        open={confirmPost}
        title="تأكيد ترحيل المصروف المباشر"
        message="سيتم إنشاء سند الصرف وترحيل المصروف دون تأثير على دفتر المورد."
        confirmLabel="ترحيل"
        busy={busy}
        onClose={() => {
          setConfirmPost(false);
          if (pending) location.href = `/accounts/suppliers/expenses/${pending.id}`;
        }}
        onConfirm={() => void doPost()}
      />
    </main>
  );
}

export function ExpenseDetail({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${api}/${id}`).then((x) => x.json()).then(setR);
  }, [id]);
  const x = r?.data;

  async function doPost() {
    if (!x) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${api}/${id}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: x.version, updated_at: x.updated_at }),
      }).then((y) => y.json());
      if (res.error || (res.message && !res.success && !res.data)) {
        setActionError(res.error || res.message);
        return;
      }
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function doVoid() {
    if (!x) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${api}/${id}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: x.version,
          updated_at: x.updated_at,
          reason: voidReason || (x.status === 'DRAFT' ? 'إلغاء مسودة' : undefined),
        }),
      }).then((y) => y.json());
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
      <h1 className="text-2xl font-bold">تفاصيل المصروف</h1>
      <SuppliersNav />
      {x && (
        <section className="bg-white shadow rounded p-5 space-y-2">
          <p>{x.expense_number} · {x.amount} · {x.status}</p>
          <p>{x.beneficiary_name} — {x.description}</p>
          {x.status === 'DRAFT' && (
            <button className="bg-green-600 text-white p-2 rounded" onClick={() => setConfirmPost(true)}>ترحيل</button>
          )}
          {x.status !== 'VOID' && (
            <button className="bg-red-600 text-white p-2 rounded mr-2" onClick={() => setConfirmVoid(true)}>إلغاء</button>
          )}
          <Link className="text-blue-600 mr-3" href={`/accounts/suppliers/expenses/${id}/print`}>طباعة</Link>
        </section>
      )}
      <ConfirmDialog
        open={confirmPost}
        title="تأكيد ترحيل المصروف"
        message="سيتم إنشاء سند الصرف وترحيل المصروف."
        confirmLabel="ترحيل"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmPost(false)}
        onConfirm={() => void doPost()}
      />
      <ConfirmDialog
        open={confirmVoid}
        title="تأكيد إلغاء المصروف"
        danger
        message={
          <div className="space-y-2">
            <p>{x?.status === 'POSTED' ? 'سيُعكس سند الصرف فقط دون دفتر مورد.' : 'إلغاء المسودة.'}</p>
            {x?.status === 'POSTED' && (
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
        confirmLabel="إلغاء المصروف"
        busy={busy}
        error={actionError}
        onClose={() => setConfirmVoid(false)}
        onConfirm={() => void doVoid()}
      />
    </main>
  );
}
