'use client';
import { useEffect, useState } from 'react';
import PayrollNav from './PayrollNav';
import { API, StatCard, fetchJson } from './_lib';

export default function PayrollDashboard() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const o = await fetchJson(API.options);
      if (o.__status === 401 || o.__status === 403) {
        setError(o.message || 'ليس لديك صلاحية الوصول إلى الرواتب');
        return;
      }
      const [people, contracts, assignments, components, calendars, mappings] = await Promise.all([
        fetchJson(`${API.people}?status=ACTIVE&page_size=1`),
        fetchJson(`${API.contracts}?status=ACTIVE&page_size=1`),
        fetchJson(`${API.assignments}?status=ACTIVE&page_size=1`),
        fetchJson(`${API.components}?active_only=true&page_size=1`),
        fetchJson(`${API.calendars}?active_only=true&page_size=1`),
        fetchJson(`${API.accountMappings}?active_only=true&page_size=1`),
      ]);
      setCounts({
        people: people?.pagination?.total ?? 0,
        contracts: contracts?.pagination?.total ?? 0,
        assignments: assignments?.pagination?.total ?? 0,
        components: components?.pagination?.total ?? 0,
        calendars: calendars?.pagination?.total ?? 0,
        mappings: mappings?.pagination?.total ?? 0,
      });
    })();
  }, []);

  return (
    <main dir="rtl" className="p-4 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-xl font-bold text-gray-800">الرواتب — لوحة التحكم</h1>
      </div>
      <PayrollNav />

      {error && (
        <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="الأشخاص الفعّالون" value={counts.people ?? '—'} href="/accounts/payroll/people?status=ACTIVE" tone="text-green-700" />
        <StatCard label="العقود الفعّالة" value={counts.contracts ?? '—'} href="/accounts/payroll/contracts?status=ACTIVE" tone="text-green-700" />
        <StatCard label="التكليفات الفعّالة" value={counts.assignments ?? '—'} href="/accounts/payroll/assignments?status=ACTIVE" tone="text-blue-700" />
        <StatCard label="المكوّنات الفعّالة" value={counts.components ?? '—'} href="/accounts/payroll/components" tone="text-indigo-700" />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="التقويمات الفعّالة" value={counts.calendars ?? '—'} href="/accounts/payroll/calendars" />
        <StatCard label="خرائط الحسابات الفعّالة" value={counts.mappings ?? '—'} href="/accounts/payroll/account-mappings" />
      </section>
    </main>
  );
}
