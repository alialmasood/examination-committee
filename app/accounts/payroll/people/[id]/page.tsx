'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PayrollNav from '../../PayrollNav';
import {
  API,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_TYPE,
  COMPENSATION_BASIS,
  CONTRACT_STATUS,
  PAYMENT_METHOD,
  PERSON_STATUS,
  PERSON_TYPE,
  StatusBadge,
  errMsg,
  fetchJson,
  iqd,
  label,
} from '../../_lib';

export default function PersonDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [person, setPerson] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [comps, setComps] = useState<any[]>([]);
  const [componentIndex, setComponentIndex] = useState<Record<string, any>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [p, c, a, ca, opts] = await Promise.all([
        fetchJson(`${API.people}/${id}`),
        fetchJson(`${API.contracts}?payroll_person_id=${id}&page_size=200`),
        fetchJson(`${API.assignments}?payroll_person_id=${id}&page_size=200`),
        fetchJson(`${API.componentAssignments}?payroll_person_id=${id}&page_size=200`),
        fetchJson(API.options),
      ]);
      if (!p.success) {
        setError(errMsg(p));
        setLoading(false);
        return;
      }
      setPerson(p.data);
      setContracts(Array.isArray(c?.data) ? c.data : []);
      setAssignments(Array.isArray(a?.data) ? a.data : []);
      setComps(Array.isArray(ca?.data) ? ca.data : []);
      const idx: Record<string, any> = {};
      (opts?.data?.components ?? []).forEach((x: any) => (idx[x.id] = x));
      setComponentIndex(idx);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <main dir="rtl" className="p-4 max-w-6xl mx-auto"><PayrollNav /><p className="text-gray-400">جارٍ التحميل…</p></main>;
  if (error) return <main dir="rtl" className="p-4 max-w-6xl mx-auto"><PayrollNav /><p className="text-red-600">{error}</p></main>;
  if (!person) return null;

  const activeContract = contracts.find((c) => c.status === 'ACTIVE');
  const field = (lbl: string, val: any) => (
    <div className="flex justify-between border-b py-1.5">
      <span className="text-gray-500">{lbl}</span>
      <span className="font-medium">{val ?? '—'}</span>
    </div>
  );

  return (
    <main dir="rtl" className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold">{person.full_name_ar} <span className="font-mono text-sm text-gray-500">({person.person_code})</span></h1>
        <Link className="text-blue-600 text-sm" href="/accounts/payroll/people">← رجوع للقائمة</Link>
      </div>
      <PayrollNav />

      <section className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow p-4 text-sm">
          <h2 className="font-bold mb-2">البيانات الأساسية</h2>
          {field('النوع', label(PERSON_TYPE, person.person_type))}
          {field('الحالة', <StatusBadge status={person.status} map={PERSON_STATUS} />)}
          {field('العملة', person.default_currency_code)}
          {field('طريقة الدفع', label(PAYMENT_METHOD, person.payment_method))}
          {field('اسم صاحب الحساب', person.bank_account_name)}
          {field('المعرّف المصرفي (مقنّع)', person.bank_account_identifier_masked)}
          {field('بداية السريان', person.effective_from)}
          {field('نهاية السريان', person.effective_to)}
        </div>

        <div className="bg-white rounded-xl shadow p-4 text-sm">
          <h2 className="font-bold mb-2">العقد الأساسي الفعّال</h2>
          {activeContract ? (
            <>
              {field('رقم العقد', activeContract.contract_number)}
              {field('أساس التعويض', label(COMPENSATION_BASIS, activeContract.compensation_basis))}
              {field('المبلغ الأساسي', iqd(activeContract.base_amount))}
              {field('المعدّل', activeContract.rate_amount ? iqd(activeContract.rate_amount) : '—')}
              {field('الحالة', <StatusBadge status={activeContract.status} map={CONTRACT_STATUS} />)}
            </>
          ) : (
            <p className="text-gray-400">لا يوجد عقد فعّال</p>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow overflow-hidden mb-4">
        <div className="p-3 border-b font-bold text-sm">العقود ({contracts.length})</div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-2">الرقم</th><th>الأساس</th><th>المبلغ</th><th>الفترة</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2 font-mono">{c.contract_number}</td>
                <td>{label(COMPENSATION_BASIS, c.compensation_basis)}</td>
                <td>{iqd(c.base_amount)}</td>
                <td>{c.effective_from} → {c.effective_to ?? '—'}</td>
                <td><StatusBadge status={c.status} map={CONTRACT_STATUS} /></td>
              </tr>
            ))}
            {!contracts.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا عقود</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-xl shadow overflow-hidden mb-4">
        <div className="p-3 border-b font-bold text-sm">التكليفات ({assignments.length})</div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-2">الرمز</th><th>النوع</th><th>العنوان</th><th>الفترة</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2 font-mono">{a.assignment_code}</td>
                <td>{label(ASSIGNMENT_TYPE, a.assignment_type)}</td>
                <td>{a.title_ar}</td>
                <td>{a.effective_from} → {a.effective_to ?? '—'}</td>
                <td><StatusBadge status={a.status} map={ASSIGNMENT_STATUS} /></td>
              </tr>
            ))}
            {!assignments.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا تكليفات</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-xl shadow overflow-hidden mb-4">
        <div className="p-3 border-b font-bold text-sm">المكوّنات المُسندة ({comps.length})</div>
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-2">المكوّن</th><th>المبلغ</th><th>الأولوية</th><th>الفترة</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {comps.map((c) => {
              const comp = componentIndex[c.payroll_component_id];
              return (
                <tr key={c.id} className="border-t">
                  <td className="p-2">{comp ? `${comp.component_code} — ${comp.name_ar}` : c.payroll_component_id}</td>
                  <td>{c.amount ? iqd(c.amount) : c.percentage ? `${c.percentage}%` : c.rate ? iqd(c.rate) : '—'}</td>
                  <td>{c.priority}</td>
                  <td>{c.effective_from} → {c.effective_to ?? '—'}</td>
                  <td>
                    <span className={`text-xs font-semibold ${c.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                      {c.is_active ? 'فعّال' : 'موقوف'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!comps.length && <tr><td colSpan={5} className="p-3 text-gray-400">لا مكوّنات مُسندة</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
