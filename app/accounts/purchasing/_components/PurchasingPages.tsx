'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PurchasingNav from '../PurchasingNav';
import ConfirmDialog from '../../cashbox/sessions/components/ConfirmDialog';
import {
  API,
  KIND_LABEL,
  PO_STATUS,
  PRIORITY_LABEL,
  RECEIPT_STATUS,
  REQ_STATUS,
  emptyLine,
  emptyPoLine,
  errMsg,
  fetchJson,
  statusLabel,
} from '../_lib';

function Card({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="bg-white shadow rounded p-4 block hover:ring-2 hover:ring-blue-200">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </Link>
  );
}

export function PurchasingDashboard() {
  const [r, setR] = useState<any>();
  useEffect(() => {
    fetchJson(`${API.options}?dashboard=1`).then(setR);
  }, []);
  const d = r?.data?.dashboard;
  const req = d?.requisitions ?? {};
  const po = d?.purchase_orders ?? {};
  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">المشتريات — لوحة التحكم</h1>
        <Link className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" href="/accounts/purchasing/requisitions/new">
          طلب شراء جديد
        </Link>
      </div>
      <PurchasingNav />
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card label="طلبات مسودة" value={req.DRAFT ?? 0} href="/accounts/purchasing/requisitions?status=DRAFT" />
        <Card label="طلبات مقدّمة" value={req.SUBMITTED ?? 0} href="/accounts/purchasing/requisitions?status=SUBMITTED" />
        <Card label="طلبات معتمدة" value={req.APPROVED ?? 0} href="/accounts/purchasing/requisitions?status=APPROVED" />
        <Card label="أوامر معتمدة" value={po.APPROVED ?? 0} href="/accounts/purchasing/orders?status=APPROVED" />
        <Card label="استلام جزئي" value={po.PARTIALLY_RECEIVED ?? 0} href="/accounts/purchasing/orders?status=PARTIALLY_RECEIVED" />
        <Card label="محاضر مسودة" value={d?.draft_receipt_count ?? 0} href="/accounts/purchasing/receipts?status=DRAFT" />
        <Card label="بانتظار استلام" value={d?.pending_receipt_count ?? 0} href="/accounts/purchasing/receipts/new" />
        <Card label="مطابقة فواتير" value={po.PARTIALLY_INVOICED ?? 0} href="/accounts/purchasing/matching" />
      </section>
      <section className="bg-white shadow rounded p-4">
        <h2 className="font-semibold mb-2">أوامر شراء مفتوحة</h2>
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-gray-500">
              <th className="p-2">الرقم</th><th>المورد</th><th>التاريخ</th><th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {(d?.open_purchase_orders ?? []).map((x: any) => (
              <tr key={x.id} className="border-t">
                <td className="p-2">
                  <Link className="text-blue-600" href={`/accounts/purchasing/orders/${x.id}`}>{x.purchase_order_number}</Link>
                </td>
                <td>{x.supplier_name_ar}</td>
                <td>{x.order_date}</td>
                <td>{statusLabel(PO_STATUS, x.status)}</td>
              </tr>
            ))}
            {!d?.open_purchase_orders?.length && (
              <tr><td colSpan={4} className="p-3 text-gray-400">لا توجد أوامر مفتوحة</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export function RequisitionList() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const [r, setR] = useState<any>();
  useEffect(() => {
    const q = status ? `?status=${status}` : '';
    fetchJson(`${API.requisitions}${q}`).then(setR);
  }, [status]);
  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between">
        <h1 className="text-xl font-bold">طلبات الشراء</h1>
        <Link className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" href="/accounts/purchasing/requisitions/new">طلب جديد</Link>
      </div>
      <PurchasingNav />
      <div className="flex gap-2 mb-3 text-sm">
        {['', 'DRAFT', 'SUBMITTED', 'APPROVED'].map((s) => (
          <Link key={s || 'all'} href={s ? `?status=${s}` : '/accounts/purchasing/requisitions'} className={`px-2 py-1 rounded ${status === s ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}>
            {s ? statusLabel(REQ_STATUS, s) : 'الكل'}
          </Link>
        ))}
      </div>
      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead><tr><th className="p-2">الرقم</th><th>التاريخ</th><th>الأولوية</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
        <tbody>
          {r?.data?.map((x: any) => (
            <tr key={x.id} className="border-t">
              <td className="p-2"><Link className="text-blue-600" href={`/accounts/purchasing/requisitions/${x.id}`}>{x.requisition_number}</Link></td>
              <td>{x.requisition_date}</td>
              <td>{statusLabel(PRIORITY_LABEL, x.priority)}</td>
              <td>{x.total_estimated_amount} IQD</td>
              <td>{statusLabel(REQ_STATUS, x.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function RequisitionNew() {
  const [opts, setOpts] = useState<any>();
  const [userId, setUserId] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [f, setF] = useState<any>({
    requisition_date: new Date().toISOString().slice(0, 10),
    priority: 'NORMAL',
    justification: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchJson(API.options).then(setOpts);
    fetchJson('/api/auth/me').then((u) => { if (u.user?.id) setUserId(u.user.id); });
  }, []);
  const gl = opts?.data?.expense_gl_accounts ?? [];
  const kinds = opts?.data?.purchase_kinds ?? [];
  const depts = opts?.data?.departments ?? [];

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      const r = await fetchJson(API.requisitions, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, requested_by: userId, lines }),
      });
      if (!r.data) return setMsg(errMsg(r));
      location.href = `/accounts/purchasing/requisitions/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">طلب شراء جديد</h1>
      <PurchasingNav />
      <div className="bg-white shadow rounded p-4 grid gap-2 text-sm">
        <input className="border p-2" type="date" value={f.requisition_date} onChange={(e) => setF({ ...f, requisition_date: e.target.value })} />
        <select className="border p-2" value={f.requesting_department_id || ''} onChange={(e) => setF({ ...f, requesting_department_id: e.target.value || undefined })}>
          <option value="">— القسم الطالب —</option>
          {depts.map((d: any) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
        </select>
        <select className="border p-2" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          {(opts?.data?.requisition_priorities ?? ['NORMAL']).map((p: string) => (
            <option key={p} value={p}>{statusLabel(PRIORITY_LABEL, p)}</option>
          ))}
        </select>
        <input className="border p-2" type="date" placeholder="مطلوب قبل" onChange={(e) => setF({ ...f, needed_by_date: e.target.value || undefined })} />
        <textarea className="border p-2" placeholder="مبرر الطلب *" value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        <div className="border rounded p-2 space-y-2">
          <p className="font-semibold">السطور</p>
          {lines.map((ln, i) => (
            <div key={i} className="grid md:grid-cols-5 gap-2">
              <select className="border p-1" value={ln.purchase_kind} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, purchase_kind: e.target.value }; setLines(n); }}>
                {kinds.map((k: string) => <option key={k} value={k}>{statusLabel(KIND_LABEL, k)}</option>)}
              </select>
              <input className="border p-1 md:col-span-2" placeholder="الوصف" value={ln.description} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, description: e.target.value }; setLines(n); }} />
              <input className="border p-1" type="number" placeholder="الكمية" value={ln.requested_quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, requested_quantity: e.target.value }; setLines(n); }} />
              <input className="border p-1" type="number" placeholder="السعر" value={ln.estimated_unit_price} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, estimated_unit_price: e.target.value }; setLines(n); }} />
              <select className="border p-1 md:col-span-2" value={ln.expense_gl_account_id} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, expense_gl_account_id: e.target.value }; setLines(n); }}>
                <option value="">حساب المصروف</option>
                {gl.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
              </select>
              {lines.length > 1 && (
                <button type="button" className="text-red-600 text-xs" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</button>
              )}
            </div>
          ))}
          <button type="button" className="text-blue-600 text-sm" onClick={() => setLines([...lines, emptyLine()])}>+ سطر</button>
        </div>
        <button className="bg-blue-600 text-white rounded p-2" disabled={busy} onClick={() => void save()}>حفظ مسودة</button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    </main>
  );
}

export function RequisitionDetail({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  const [dialog, setDialog] = useState<'submit' | 'approve' | 'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchJson(`${API.requisitions}/${id}`).then(setR);
  useEffect(() => {
    void fetchJson(`${API.requisitions}/${id}`).then(setR);
  }, [id]);
  const x = r?.data;

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchJson(`${API.requisitions}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.data) { setErr(errMsg(res)); return; }
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold">طلب شراء</h1>
      <PurchasingNav />
      {x && (
        <section className="bg-white shadow rounded p-4 space-y-2 text-sm">
          <p className="font-semibold">{x.requisition_number} · {statusLabel(REQ_STATUS, x.status)}</p>
          <p>{x.requisition_date} · {statusLabel(PRIORITY_LABEL, x.priority)} · {x.total_estimated_amount} IQD</p>
          <p>{x.justification}</p>
          <table className="w-full text-right border-t mt-2">
            <thead><tr><th className="p-1">#</th><th>النوع</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="p-1">{l.line_number}</td>
                  <td>{statusLabel(KIND_LABEL, l.purchase_kind)}</td>
                  <td>{l.description}</td>
                  <td>{l.requested_quantity}</td>
                  <td>{l.estimated_unit_price}</td>
                  <td>{l.estimated_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2 pt-2">
            {x.status === 'DRAFT' && <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={() => setDialog('submit')}>تقديم</button>}
            {x.status === 'SUBMITTED' && (
              <>
                <button className="bg-green-700 text-white px-3 py-1 rounded" onClick={() => setDialog('approve')}>اعتماد</button>
                <button className="bg-orange-600 text-white px-3 py-1 rounded" onClick={() => setDialog('reject')}>رفض</button>
              </>
            )}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(x.status) && (
              <button className="bg-red-700 text-white px-3 py-1 rounded" onClick={() => setDialog('cancel')}>إلغاء</button>
            )}
            {['APPROVED', 'PARTIALLY_ORDERED'].includes(x.status) && (
              <Link className="bg-indigo-600 text-white px-3 py-1 rounded" href={`/accounts/purchasing/orders/new?requisition_id=${id}`}>إنشاء أمر شراء</Link>
            )}
            <Link className="text-blue-600" href={`/accounts/purchasing/requisitions/${id}/print`}>طباعة</Link>
          </div>
        </section>
      )}
      <ConfirmDialog open={dialog === 'submit'} title="تقديم طلب الشراء" message="هل تريد تقديم الطلب للاعتماد؟" confirmLabel="تقديم" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('submit', { version: x.version, updated_at: x.updated_at })} />
      <ConfirmDialog open={dialog === 'approve'} title="اعتماد طلب الشراء" message="هل تريد اعتماد هذا الطلب؟" confirmLabel="اعتماد" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('approve', { version: x?.version, updated_at: x?.updated_at })} />
      <ConfirmDialog open={dialog === 'reject'} title="رفض طلب الشراء" message={<><p>سبب الرفض مطلوب:</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>} confirmLabel="رفض" danger busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('reject', { version: x?.version, updated_at: x?.updated_at, reason })} />
      <ConfirmDialog open={dialog === 'cancel'} title="إلغاء طلب الشراء" message="هل تريد إلغاء هذا الطلب؟" confirmLabel="إلغاء الطلب" danger busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('cancel', { version: x?.version, updated_at: x?.updated_at })} />
    </main>
  );
}

export function RequisitionPrint({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  useEffect(() => { fetchJson(`${API.requisitions}/${id}`).then(setR); }, [id]);
  const x = r?.data;
  return (
    <main dir="rtl" className="p-8 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => print()}>طباعة</button>
      {x && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold">كلية الشرق للعلوم التقنية التخصصية</h1>
            <h2 className="text-lg mt-1">طلب شراء — {x.requisition_number}</h2>
          </header>
          <section className="grid grid-cols-2 gap-2 text-sm">
            <p>التاريخ: {x.requisition_date}</p>
            <p>الأولوية: {statusLabel(PRIORITY_LABEL, x.priority)}</p>
            <p>الحالة: {statusLabel(REQ_STATUS, x.status)}</p>
            <p>الإجمالي: {x.total_estimated_amount} IQD</p>
          </section>
          <p className="text-sm">المبرر: {x.justification}</p>
          <table className="w-full text-sm border">
            <thead><tr className="border-b"><th className="p-2">#</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t"><td className="p-2">{l.line_number}</td><td>{l.description}</td><td>{l.requested_quantity}</td><td>{l.estimated_unit_price}</td><td>{l.estimated_total}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center print:pt-16">
            <div><div className="border-t pt-2">مقدّم الطلب</div></div>
            <div><div className="border-t pt-2">رئيس القسم</div></div>
            <div><div className="border-t pt-2">العميد / المعتمد</div></div>
          </div>
        </article>
      )}
    </main>
  );
}

export function OrderList() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const [r, setR] = useState<any>();
  useEffect(() => {
    const q = status ? `?status=${status}` : '';
    fetchJson(`${API.orders}${q}`).then(setR);
  }, [status]);
  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between">
        <h1 className="text-xl font-bold">أوامر الشراء</h1>
        <Link className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" href="/accounts/purchasing/orders/new">أمر جديد</Link>
      </div>
      <PurchasingNav />
      <div className="flex gap-2 mb-3 text-sm flex-wrap">
        {['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'].map((s) => (
          <Link key={s || 'all'} href={s ? `?status=${s}` : '/accounts/purchasing/orders'} className={`px-2 py-1 rounded ${status === s ? 'bg-blue-100 text-blue-800' : 'bg-gray-100'}`}>
            {s ? statusLabel(PO_STATUS, s) : 'الكل'}
          </Link>
        ))}
      </div>
      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead><tr><th className="p-2">الرقم</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
        <tbody>
          {r?.data?.map((x: any) => (
            <tr key={x.id} className="border-t">
              <td className="p-2"><Link className="text-blue-600" href={`/accounts/purchasing/orders/${x.id}`}>{x.purchase_order_number}</Link></td>
              <td>{x.order_date}</td>
              <td>{x.total_amount} IQD</td>
              <td>{statusLabel(PO_STATUS, x.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function OrderNew() {
  const sp = useSearchParams();
  const reqId = sp.get('requisition_id') ?? '';
  const [opts, setOpts] = useState<any>();
  const [req, setReq] = useState<any>();
  const [lines, setLines] = useState([emptyPoLine()]);
  const [f, setF] = useState<any>({
    order_date: new Date().toISOString().slice(0, 10),
    supplier_account_id: '',
    description: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchJson(API.options).then(setOpts);
    if (reqId) {
      fetchJson(`${API.requisitions}/${reqId}`).then((r) => {
        setReq(r.data);
        if (r.data?.lines?.length) {
          setLines(
            r.data.lines
              .filter((l: any) => Number(l.requested_quantity) > Number(l.ordered_quantity))
              .map((l: any) => ({
                requisition_line_id: l.id,
                purchase_kind: l.purchase_kind,
                description: l.description,
                ordered_quantity: String(Number(l.requested_quantity) - Number(l.ordered_quantity)),
                unit_price: l.estimated_unit_price,
                expense_gl_account_id: l.expense_gl_account_id,
              }))
          );
        }
      });
    }
  }, [reqId]);

  const suppliers = opts?.data?.supplier_accounts ?? [];
  const gl = opts?.data?.expense_gl_accounts ?? [];
  const kinds = opts?.data?.purchase_kinds ?? [];

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      const url = reqId ? API.ordersFromReq : API.orders;
      const body = reqId
        ? {
            requisition_id: reqId,
            supplier_account_id: f.supplier_account_id,
            order_date: f.order_date,
            description: f.description,
            lines: lines.map((l: any) => ({
              requisition_line_id: l.requisition_line_id,
              ordered_quantity: l.ordered_quantity,
              unit_price: l.unit_price,
            })),
          }
        : { ...f, lines };
      const r = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.data) return setMsg(errMsg(r));
      location.href = `/accounts/purchasing/orders/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">{reqId ? `أمر من طلب ${req?.requisition_number ?? ''}` : 'أمر شراء جديد'}</h1>
      <PurchasingNav />
      <div className="bg-white shadow rounded p-4 grid gap-2 text-sm">
        <select className="border p-2" value={f.supplier_account_id} onChange={(e) => setF({ ...f, supplier_account_id: e.target.value })}>
          <option value="">— حساب المورد —</option>
          {suppliers.map((s: any) => (
            <option key={s.supplier_account_id} value={s.supplier_account_id}>{s.supplier_number} — {s.name_ar}</option>
          ))}
        </select>
        <input className="border p-2" type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} />
        <textarea className="border p-2" placeholder="الوصف" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="border rounded p-2 space-y-2">
          <p className="font-semibold">السطور</p>
          {lines.map((ln: any, i: number) => (
            <div key={i} className="grid md:grid-cols-5 gap-2">
              {!reqId && (
                <select className="border p-1" value={ln.purchase_kind} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, purchase_kind: e.target.value }; setLines(n); }}>
                  {kinds.map((k: string) => <option key={k} value={k}>{statusLabel(KIND_LABEL, k)}</option>)}
                </select>
              )}
              <input className="border p-1 md:col-span-2" placeholder="الوصف" value={ln.description} readOnly={!!reqId} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, description: e.target.value }; setLines(n); }} />
              <input className="border p-1" type="number" placeholder="الكمية" value={ln.ordered_quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, ordered_quantity: e.target.value }; setLines(n); }} />
              <input className="border p-1" type="number" placeholder="السعر" value={ln.unit_price} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, unit_price: e.target.value }; setLines(n); }} />
              {!reqId && (
                <select className="border p-1 md:col-span-2" value={ln.expense_gl_account_id} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, expense_gl_account_id: e.target.value }; setLines(n); }}>
                  <option value="">حساب المصروف *</option>
                  {gl.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>)}
                </select>
              )}
              {!reqId && lines.length > 1 && (
                <button type="button" className="text-red-600 text-xs" onClick={() => setLines(lines.filter((_: any, j: number) => j !== i))}>حذف</button>
              )}
            </div>
          ))}
          {!reqId && <button type="button" className="text-blue-600 text-sm" onClick={() => setLines([...lines, emptyPoLine()])}>+ سطر</button>}
        </div>
        <button className="bg-blue-600 text-white rounded p-2" disabled={busy} onClick={() => void save()}>حفظ مسودة</button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    </main>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  const [dialog, setDialog] = useState<'submit' | 'approve' | 'reject' | 'cancel' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchJson(`${API.orders}/${id}`).then(setR);
  useEffect(() => {
    void fetchJson(`${API.orders}/${id}`).then(setR);
  }, [id]);
  const x = r?.data;

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchJson(`${API.orders}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.data) { setErr(errMsg(res)); return; }
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold">أمر شراء</h1>
      <PurchasingNav />
      {x && (
        <section className="bg-white shadow rounded p-4 space-y-2 text-sm">
          <p className="font-semibold">{x.purchase_order_number} · {statusLabel(PO_STATUS, x.status)}</p>
          <p>{x.order_date} · {x.total_amount} IQD</p>
          <p>{x.description}</p>
          <table className="w-full text-right border-t mt-2">
            <thead><tr><th className="p-1">#</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>مستلم</th><th>مفوتر</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="p-1">{l.line_number}</td>
                  <td>{l.description}</td>
                  <td>{l.ordered_quantity}</td>
                  <td>{l.unit_price}</td>
                  <td>{l.received_quantity}</td>
                  <td>{l.invoiced_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2 pt-2">
            {x.status === 'DRAFT' && <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={() => setDialog('submit')}>تقديم</button>}
            {x.status === 'SUBMITTED' && (
              <>
                <button className="bg-green-700 text-white px-3 py-1 rounded" onClick={() => setDialog('approve')}>اعتماد</button>
                <button className="bg-orange-600 text-white px-3 py-1 rounded" onClick={() => setDialog('reject')}>رفض</button>
              </>
            )}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(x.status) && (
              <button className="bg-red-700 text-white px-3 py-1 rounded" onClick={() => setDialog('cancel')}>إلغاء</button>
            )}
            {['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(x.status) && (
              <>
                <Link className="bg-teal-700 text-white px-3 py-1 rounded" href={`/accounts/purchasing/receipts/new?purchase_order_id=${id}`}>محضر استلام</Link>
                <Link className="bg-indigo-600 text-white px-3 py-1 rounded" href={`/accounts/purchasing/matching?purchase_order_id=${id}`}>مطابقة فاتورة</Link>
              </>
            )}
            {x.status === 'APPROVED' && (
              <button className="bg-gray-700 text-white px-3 py-1 rounded" onClick={() => setDialog('close')}>إغلاق</button>
            )}
            <Link className="text-blue-600" href={`/accounts/purchasing/orders/${id}/print`}>طباعة</Link>
          </div>
        </section>
      )}
      <ConfirmDialog open={dialog === 'submit'} title="تقديم أمر الشراء" message="هل تريد تقديم الأمر للاعتماد؟" confirmLabel="تقديم" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('submit', { version: x?.version, updated_at: x?.updated_at })} />
      <ConfirmDialog open={dialog === 'approve'} title="اعتماد أمر الشراء" message="هل تريد اعتماد هذا الأمر؟" confirmLabel="اعتماد" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('approve', { version: x?.version, updated_at: x?.updated_at })} />
      <ConfirmDialog open={dialog === 'reject'} title="رفض أمر الشراء" message={<><p>سبب الرفض:</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>} confirmLabel="رفض" danger busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('reject', { version: x?.version, updated_at: x?.updated_at, reason })} />
      <ConfirmDialog open={dialog === 'cancel'} title="إلغاء أمر الشراء" message="هل تريد إلغاء هذا الأمر؟" confirmLabel="إلغاء الأمر" danger busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('cancel', { version: x?.version, updated_at: x?.updated_at })} />
      <ConfirmDialog open={dialog === 'close'} title="إغلاق أمر الشراء" message="إغلاق يدوي للأمر دون استلام كامل." confirmLabel="إغلاق" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('close', { version: x?.version, updated_at: x?.updated_at })} />
    </main>
  );
}

export function OrderPrint({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  useEffect(() => { fetchJson(`${API.orders}/${id}`).then(setR); }, [id]);
  const x = r?.data;
  return (
    <main dir="rtl" className="p-8 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => print()}>طباعة</button>
      {x && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold">كلية الشرق للعلوم التقنية التخصصية</h1>
            <h2 className="text-lg mt-1">أمر شراء — {x.purchase_order_number}</h2>
          </header>
          <section className="grid grid-cols-2 gap-2 text-sm">
            <p>التاريخ: {x.order_date}</p>
            <p>الحالة: {statusLabel(PO_STATUS, x.status)}</p>
            <p>الإجمالي: {x.total_amount} IQD</p>
          </section>
          <table className="w-full text-sm border">
            <thead><tr className="border-b"><th className="p-2">#</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t"><td className="p-2">{l.line_number}</td><td>{l.description}</td><td>{l.ordered_quantity}</td><td>{l.unit_price}</td><td>{l.line_total}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center">
            <div><div className="border-t pt-2">المشتريات</div></div>
            <div><div className="border-t pt-2">المحاسبة</div></div>
            <div><div className="border-t pt-2">العميد / المعتمد</div></div>
          </div>
        </article>
      )}
    </main>
  );
}

export function ReceiptList() {
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const [r, setR] = useState<any>();
  useEffect(() => {
    const q = status ? `?status=${status}` : '';
    fetchJson(`${API.receipts}${q}`).then(setR);
  }, [status]);
  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between">
        <h1 className="text-xl font-bold">محاضر الاستلام</h1>
        <Link className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm" href="/accounts/purchasing/receipts/new">محضر جديد</Link>
      </div>
      <PurchasingNav />
      <table className="w-full bg-white shadow rounded text-sm text-right">
        <thead><tr><th className="p-2">الرقم</th><th>التاريخ</th><th>مرجع التسليم</th><th>الحالة</th></tr></thead>
        <tbody>
          {r?.data?.map((x: any) => (
            <tr key={x.id} className="border-t">
              <td className="p-2"><Link className="text-blue-600" href={`/accounts/purchasing/receipts/${x.id}`}>{x.receipt_number}</Link></td>
              <td>{x.receipt_date}</td>
              <td>{x.delivery_reference || '—'}</td>
              <td>{statusLabel(RECEIPT_STATUS, x.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function ReceiptNew() {
  const sp = useSearchParams();
  const poIdParam = sp.get('purchase_order_id') ?? '';
  const [opts, setOpts] = useState<any>();
  const [userId, setUserId] = useState('');
  const [po, setPo] = useState<any>();
  const [lines, setLines] = useState<any[]>([]);
  const [f, setF] = useState<any>({
    purchase_order_id: poIdParam,
    receipt_date: new Date().toISOString().slice(0, 10),
    delivery_reference: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchJson(`${API.options}?dashboard=1`).then(setOpts);
    fetchJson('/api/auth/me').then((u) => { if (u.user?.id) setUserId(u.user.id); });
  }, []);

  useEffect(() => {
    if (f.purchase_order_id) {
      fetchJson(`${API.orders}/${f.purchase_order_id}`).then((r) => {
        setPo(r.data);
        setLines(
          (r.data?.lines ?? [])
            .map((l: any) => {
              const open = Math.max(0, Number(l.ordered_quantity) - Number(l.received_quantity) - Number(l.cancelled_quantity || 0));
              return open > 0
                ? {
                    purchase_order_line_id: l.id,
                    description: l.description,
                    max: open,
                    received_quantity: String(open),
                    accepted_quantity: String(open),
                    rejected_quantity: '0',
                  }
                : null;
            })
            .filter(Boolean)
        );
      });
    }
  }, [f.purchase_order_id]);

  const openPos = opts?.data?.dashboard?.open_purchase_orders ?? [];

  async function save() {
    setMsg('');
    setBusy(true);
    try {
      const r = await fetchJson(API.receipts, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...f,
          received_by: userId,
          lines: lines.map((l) => ({
            purchase_order_line_id: l.purchase_order_line_id,
            received_quantity: l.received_quantity,
            accepted_quantity: l.accepted_quantity,
            rejected_quantity: l.rejected_quantity,
          })),
        }),
      });
      if (!r.data) return setMsg(errMsg(r));
      location.href = `/accounts/purchasing/receipts/${r.data.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">محضر استلام جديد</h1>
      <PurchasingNav />
      <div className="bg-white shadow rounded p-4 grid gap-2 text-sm">
        <select className="border p-2" value={f.purchase_order_id} onChange={(e) => setF({ ...f, purchase_order_id: e.target.value })}>
          <option value="">— أمر الشراء —</option>
          {openPos.map((p: any) => (
            <option key={p.id} value={p.id}>{p.purchase_order_number} — {p.supplier_name_ar}</option>
          ))}
        </select>
        {po && <p className="text-gray-600">أمر: {po.purchase_order_number} · {statusLabel(PO_STATUS, po.status)}</p>}
        <input className="border p-2" type="date" value={f.receipt_date} onChange={(e) => setF({ ...f, receipt_date: e.target.value })} />
        <input className="border p-2" placeholder="مرجع التسليم" value={f.delivery_reference} onChange={(e) => setF({ ...f, delivery_reference: e.target.value })} />
        {lines.map((ln, i) => (
          <div key={ln.purchase_order_line_id} className="border rounded p-2 grid md:grid-cols-4 gap-2">
            <span className="md:col-span-4 font-medium">{ln.description} (متبقي {ln.max})</span>
            <input className="border p-1" type="number" placeholder="مستلم" value={ln.received_quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, received_quantity: e.target.value }; setLines(n); }} />
            <input className="border p-1" type="number" placeholder="مقبول" value={ln.accepted_quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, accepted_quantity: e.target.value }; setLines(n); }} />
            <input className="border p-1" type="number" placeholder="مرفوض" value={ln.rejected_quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...ln, rejected_quantity: e.target.value }; setLines(n); }} />
          </div>
        ))}
        <button className="bg-blue-600 text-white rounded p-2" disabled={busy || !lines.length} onClick={() => void save()}>حفظ مسودة</button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    </main>
  );
}

export function ReceiptDetail({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  const [dialog, setDialog] = useState<'post' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchJson(`${API.receipts}/${id}`).then(setR);
  useEffect(() => {
    void fetchJson(`${API.receipts}/${id}`).then(setR);
  }, [id]);
  const x = r?.data;

  async function act(action: string, body: any = {}) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchJson(`${API.receipts}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.data) { setErr(errMsg(res)); return; }
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold">محضر استلام</h1>
      <PurchasingNav />
      {x && (
        <section className="bg-white shadow rounded p-4 space-y-2 text-sm">
          <p className="font-semibold">{x.receipt_number} · {statusLabel(RECEIPT_STATUS, x.status)}</p>
          <p>{x.receipt_date} · {x.delivery_reference || '—'}</p>
          <table className="w-full text-right border-t mt-2">
            <thead><tr><th className="p-1">مستلم</th><th>مقبول</th><th>مرفوض</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t">
                  <td className="p-1">{l.received_quantity}</td>
                  <td>{l.accepted_quantity}</td>
                  <td>{l.rejected_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 pt-2">
            {x.status === 'DRAFT' && <button className="bg-green-700 text-white px-3 py-1 rounded" onClick={() => setDialog('post')}>ترحيل</button>}
            {x.status !== 'VOID' && <button className="bg-red-700 text-white px-3 py-1 rounded" onClick={() => setDialog('void')}>إبطال</button>}
            <Link className="text-blue-600" href={`/accounts/purchasing/receipts/${id}/print`}>طباعة</Link>
          </div>
        </section>
      )}
      <ConfirmDialog open={dialog === 'post'} title="ترحيل محضر الاستلام" message="سيتم تحديث كميات أمر الشراء. هل تريد الترحيل؟" confirmLabel="ترحيل" busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('post', { version: x?.version, updated_at: x?.updated_at })} />
      <ConfirmDialog open={dialog === 'void'} title="إبطال محضر الاستلام" message={<><p>سبب الإبطال (مطلوب للمرحّل):</p><textarea className="border w-full mt-2 p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></>} confirmLabel="إبطال" danger busy={busy} error={err} onClose={() => setDialog(null)} onConfirm={() => void act('void', { version: x?.version, updated_at: x?.updated_at, reason: reason || undefined })} />
    </main>
  );
}

export function ReceiptPrint({ id }: { id: string }) {
  const [r, setR] = useState<any>();
  useEffect(() => { fetchJson(`${API.receipts}/${id}`).then(setR); }, [id]);
  const x = r?.data;
  return (
    <main dir="rtl" className="p-8 max-w-3xl mx-auto text-gray-900">
      <button className="print:hidden border px-3 py-1 rounded mb-4" onClick={() => print()}>طباعة</button>
      {x && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-bold">كلية الشرق للعلوم التقنية التخصصية</h1>
            <h2 className="text-lg mt-1">محضر استلام — {x.receipt_number}</h2>
          </header>
          <section className="grid grid-cols-2 gap-2 text-sm">
            <p>التاريخ: {x.receipt_date}</p>
            <p>الحالة: {statusLabel(RECEIPT_STATUS, x.status)}</p>
            <p>مرجع التسليم: {x.delivery_reference || '—'}</p>
          </section>
          <table className="w-full text-sm border">
            <thead><tr className="border-b"><th className="p-2">مستلم</th><th>مقبول</th><th>مرفوض</th></tr></thead>
            <tbody>
              {x.lines?.map((l: any) => (
                <tr key={l.id} className="border-t"><td className="p-2">{l.received_quantity}</td><td>{l.accepted_quantity}</td><td>{l.rejected_quantity}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-8 pt-12 text-sm text-center">
            <div><div className="border-t pt-2">المستلم</div></div>
            <div><div className="border-t pt-2">المفتش</div></div>
            <div><div className="border-t pt-2">المعتمد</div></div>
          </div>
        </article>
      )}
    </main>
  );
}

export function MatchingPage() {
  const sp = useSearchParams();
  const poIdParam = sp.get('purchase_order_id') ?? '';
  const [opts, setOpts] = useState<any>();
  const [poId, setPoId] = useState(poIdParam);
  const [matchable, setMatchable] = useState<any[]>([]);
  const [tolerance, setTolerance] = useState(0);
  const [overrideTolerance, setOverrideTolerance] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [f, setF] = useState<any>({
    supplier_invoice_number: '',
    invoice_date: new Date().toISOString().slice(0, 10),
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const canOverride = Boolean(opts?.data?.can_override_price_tolerance);

  useEffect(() => {
    fetchJson(`${API.options}?dashboard=1`).then(setOpts);
  }, []);

  useEffect(() => {
    setPoId(poIdParam);
  }, [poIdParam]);

  useEffect(() => {
    if (poId) {
      fetchJson(`${API.orders}/${poId}/matchable-lines`).then((r) => {
        setTolerance(r.data?.price_tolerance_percent ?? opts?.data?.price_tolerance_percent ?? 0);
        setMatchable(
          (r.data?.lines ?? []).map((l: any) => ({
            ...l,
            quantity: l.available_to_invoice ?? l.available_quantity ?? '0',
            unit_price: l.unit_price ?? l.po_unit_price ?? '0',
            po_unit_price: l.unit_price ?? l.po_unit_price ?? '0',
          }))
        );
      });
    } else {
      setMatchable([]);
    }
  }, [poId, opts?.data?.price_tolerance_percent]);

  const openPos = opts?.data?.dashboard?.open_purchase_orders ?? [];

  function priceOutsideTolerance(): boolean {
    if (tolerance <= 0) {
      return matchable.some(
        (l) => Number(l.quantity) > 0 && Number(l.unit_price) !== Number(l.po_unit_price ?? l.unit_price)
      );
    }
    return matchable.some((l) => {
      if (!(Number(l.quantity) > 0)) return false;
      const po = Number(l.po_unit_price ?? l.unit_price);
      const inv = Number(l.unit_price);
      if (!po) return inv !== po;
      const diff = Math.abs(inv - po);
      return diff > (po * tolerance) / 100;
    });
  }

  async function doCreate(withOverride: boolean) {
    setMsg('');
    setBusy(true);
    try {
      const lines = matchable
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          purchase_order_line_id: l.purchase_order_line_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        }));
      if (!lines.length) return setMsg('أدخل كمية واحدة على الأقل');
      const body: any = { purchase_order_id: poId, ...f, lines };
      if (withOverride) {
        body.override_tolerance = true;
        if (overrideReason.trim()) body.override_reason = overrideReason.trim();
      }
      const r = await fetchJson(API.invoiceFromPo, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.data) return setMsg(errMsg(r));
      location.href = `/accounts/suppliers/invoices/${r.data.id}`;
    } finally {
      setBusy(false);
      setConfirmOverride(false);
    }
  }

  async function createInvoice() {
    if (overrideTolerance && canOverride && priceOutsideTolerance()) {
      setConfirmOverride(true);
      return;
    }
    await doCreate(overrideTolerance && canOverride);
  }

  return (
    <main dir="rtl" className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">مطابقة فاتورة مورد</h1>
      <PurchasingNav />
      <div className="bg-white shadow rounded p-4 grid gap-2 text-sm">
        <select className="border p-2" value={poId} onChange={(e) => setPoId(e.target.value)}>
          <option value="">— أمر الشراء —</option>
          {openPos.map((p: any) => (
            <option key={p.id} value={p.id}>{p.purchase_order_number} — {p.supplier_name_ar}</option>
          ))}
        </select>
        <p className="text-gray-500 text-xs">تسامح السعر: {tolerance}% (متماثل زيادة/نقصان)</p>
        <input className="border p-2" placeholder="رقم فاتورة المورد *" value={f.supplier_invoice_number} onChange={(e) => setF({ ...f, supplier_invoice_number: e.target.value })} />
        <input className="border p-2" type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} />
        {matchable.map((ln, i) => (
          <div key={ln.purchase_order_line_id} className="border rounded p-2 grid md:grid-cols-4 gap-2">
            <span className="md:col-span-4">{ln.line_number}. {ln.description}</span>
            <span className="text-gray-500">متاح: {ln.available_to_invoice ?? ln.available_quantity} · سعر الأمر: {ln.po_unit_price}</span>
            <input className="border p-1" type="number" placeholder="الكمية" value={ln.quantity} onChange={(e) => { const n = [...matchable]; n[i] = { ...ln, quantity: e.target.value }; setMatchable(n); }} />
            <input className="border p-1" type="number" placeholder="السعر" value={ln.unit_price} onChange={(e) => { const n = [...matchable]; n[i] = { ...ln, unit_price: e.target.value }; setMatchable(n); }} />
          </div>
        ))}
        {!matchable.length && poId && <p className="text-gray-400">لا توجد سطور قابلة للمطابقة</p>}
        {canOverride && (
          <label className="flex items-start gap-2 border rounded p-2 bg-amber-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={overrideTolerance}
              onChange={(e) => setOverrideTolerance(e.target.checked)}
            />
            <span>
              <strong>تجاوز فرق السعر المسموح</strong>
              <span className="block text-xs text-amber-800 mt-1">
                سيُسجَّل التجاوز في سجل التدقيق المالي مع أسعار الأمر والفاتورة والمستخدم.
              </span>
              {overrideTolerance && (
                <textarea
                  className="border w-full mt-2 p-2 text-sm"
                  placeholder="سبب التجاوز (اختياري)"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              )}
            </span>
          </label>
        )}
        <button className="bg-blue-600 text-white rounded p-2" disabled={busy || !poId} onClick={() => void createInvoice()}>إنشاء فاتورة</button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
      <ConfirmDialog
        open={confirmOverride}
        title="تأكيد تجاوز تسامح السعر"
        message="السعر خارج نطاق التسامح المعتمد. سيتم تسجيل التجاوز في التدقيق. هل تريد المتابعة؟"
        confirmLabel="تجاوز وإنشاء"
        danger
        busy={busy}
        error={msg || null}
        onClose={() => setConfirmOverride(false)}
        onConfirm={() => void doCreate(true)}
      />
    </main>
  );
}
