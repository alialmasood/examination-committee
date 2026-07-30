'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  BanknotesIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  ClipboardDocumentCheckIcon,
  TagIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import SupervisionShell, { SUPERVISION_BRAND } from '../components/SupervisionShell';
import type {
  DeptFinance,
  StudentsFinanceSummary,
} from '@/src/lib/accounts/students-finance-summary';

const num = (v: number) => Math.round(v || 0).toLocaleString('en-US');
const money = (v: number) => `${num(v)} د.ع`;
const percent = (v: number) => `${Number(v || 0).toFixed(1)}%`;

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof BanknotesIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5 px-0.5">
      <Icon className="w-4 h-4" style={{ color: SUPERVISION_BRAND }} />
      <h2 className="text-sm font-bold text-slate-800">{children}</h2>
    </div>
  );
}

function MoneyCard({
  label,
  value,
  tone = 'slate',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'emerald' | 'rose' | 'brand' | 'violet';
  hint?: string;
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    brand: '',
    violet: 'text-violet-700',
  };
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
      <p className="text-[11px] text-slate-500 mb-1">{label}</p>
      <p
        className={`text-lg font-bold tabular-nums leading-6 ${tones[tone]}`}
        style={tone === 'brand' ? { color: SUPERVISION_BRAND } : undefined}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-slate-400 mt-1.5">{hint}</p> : null}
    </div>
  );
}

function DeptRankList({
  title,
  items,
  valueKey,
  showRate = false,
}: {
  title: string;
  items: DeptFinance[];
  valueKey: keyof Pick<
    DeptFinance,
    'collected_amount' | 'debt_amount' | 'expected_annual_total' | 'total_discount_amount'
  >;
  showRate?: boolean;
}) {
  return (
    <section className="sup-enter">
      <SectionTitle icon={ChartBarIcon}>{title}</SectionTitle>
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden divide-y divide-slate-100">
        {items.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-6">لا توجد بيانات</p>
        ) : (
          items.map((dept, index) => (
            <div key={dept.id} className="px-3.5 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className="w-6 h-6 rounded-lg text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: `${SUPERVISION_BRAND}18`, color: SUPERVISION_BRAND }}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 leading-5">{dept.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {num(dept.students)} طالب
                    {showRate ? ` · تحصيل ${percent(dept.collection_rate_percent)}` : ''}
                  </p>
                </div>
              </div>
              <p className="text-xs font-bold text-slate-800 tabular-nums shrink-0 text-left leading-5">
                {money(Number(dept[valueKey] || 0))}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function SupervisionAccountsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<StudentsFinanceSummary | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/general-supervision/accounts', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'تعذر تحميل إحصائيات الحسابات');
      }
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات الحسابات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <SupervisionShell title="الحسابات">
      <div className="space-y-4 pb-2">
        {/* تحديث */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            {data
              ? `آخر تحديث: ${new Date(data.generated_at).toLocaleString('ar-IQ')}`
              : 'ملخص مالي لطلبة الكلية'}
          </p>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={loadData} className="underline shrink-0">
              إعادة
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20 text-slate-500 gap-3 text-sm">
            <span
              className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{
                borderColor: `${SUPERVISION_BRAND} transparent ${SUPERVISION_BRAND} ${SUPERVISION_BRAND}`,
              }}
            />
            جاري تحميل الإحصائيات المالية...
          </div>
        ) : data ? (
          <>
            {/* نظرة عامة */}
            <section className="sup-enter-scale sup-d1">
              <SectionTitle icon={UserGroupIcon}>نظرة عامة</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                <MoneyCard
                  label="عدد الطلبة"
                  value={num(data.total_students)}
                  tone="brand"
                  hint={`صباحي ${num(data.morning)} · مسائي ${num(data.evening)}`}
                />
                <MoneyCard
                  label="أقسام نشطة"
                  value={num(data.departments_with_students)}
                  hint={`من أصل ${num(data.departments_count)}`}
                />
              </div>
            </section>

            {/* الملخص المالي */}
            <section className="sup-enter sup-d2">
              <SectionTitle icon={BanknotesIcon}>الملخص المالي</SectionTitle>
              <div className="space-y-2.5">
                <MoneyCard
                  label="المبلغ المدفوع"
                  value={money(data.collected_amount)}
                  tone="emerald"
                />
                <MoneyCard
                  label="الديون المتبقية"
                  value={money(data.debt_amount)}
                  tone="rose"
                />
                <MoneyCard
                  label="المتوقع السنوي"
                  value={money(data.expected_annual_total)}
                  tone="brand"
                />
                <MoneyCard
                  label="المتوقع خلال 4 سنوات"
                  value={money(data.expected_four_years_total)}
                  hint={`أساس 4 سنوات: ${money(data.expected_four_years_base_total)}`}
                />
              </div>
            </section>

            {/* نسب التسديد */}
            <section className="sup-enter sup-d3">
              <SectionTitle icon={ChartBarIcon}>نسب التسديدات</SectionTitle>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-700">نسبة التحصيل</p>
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      data.collection_rate_percent >= 70
                        ? 'text-emerald-700'
                        : data.collection_rate_percent >= 40
                          ? 'text-amber-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {percent(data.collection_rate_percent)}
                  </p>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, data.collection_rate_percent)}%`,
                      background: `linear-gradient(90deg, ${SUPERVISION_BRAND}, #0f766e)`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3.5 text-center">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-2.5">
                    <p className="text-base font-bold text-emerald-700 tabular-nums">
                      {num(data.fully_paid_count)}
                    </p>
                    <p className="text-[10px] text-emerald-600 mt-0.5">مسدد بالكامل</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 py-2.5">
                    <p className="text-base font-bold text-amber-700 tabular-nums">
                      {num(data.partial_paid_count)}
                    </p>
                    <p className="text-[10px] text-amber-600 mt-0.5">تسديد جزئي</p>
                  </div>
                  <div className="rounded-xl bg-rose-50 border border-rose-100 py-2.5">
                    <p className="text-base font-bold text-rose-700 tabular-nums">
                      {num(data.unpaid_count)}
                    </p>
                    <p className="text-[10px] text-rose-600 mt-0.5">غير مسدد</p>
                  </div>
                </div>
              </div>
            </section>

            {/* الوصولات */}
            <section className="sup-enter sup-d4">
              <SectionTitle icon={ClipboardDocumentCheckIcon}>الوصولات والمستندات</SectionTitle>
              <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden divide-y divide-slate-100">
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">عدد الوصولات المقطوعة</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {num(data.receipts_count)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">مدفوعات التسوية عبر الوصولات</p>
                  <p className="text-sm font-bold text-emerald-700 tabular-nums">
                    {money(data.settlements_paid_amount)}
                  </p>
                </div>
              </div>
            </section>

            {/* التخفيضات */}
            <section className="sup-enter sup-d5">
              <SectionTitle icon={TagIcon}>التخفيضات وتفصيلاتها</SectionTitle>
              <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden divide-y divide-slate-100">
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckBadgeIcon className="w-4 h-4 text-slate-400 shrink-0" />
                    <p className="text-sm text-slate-700">طلبة لديهم تخفيض</p>
                  </div>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {num(data.discounts_count)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">خصم قنوات القبول</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: SUPERVISION_BRAND }}>
                    {money(data.channel_discount_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">خصم التسوية / الوصولات</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: SUPERVISION_BRAND }}>
                    {money(data.settlement_discount_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-700">إجمالي التخفيضات</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      أثر التخفيض من الأساس {percent(data.discount_impact_percent)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-violet-700 tabular-nums">
                    {money(data.total_discount_amount)}
                  </p>
                </div>
                <div className="px-3.5 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">أساس الرسوم السنوي</p>
                  <p className="text-sm font-bold text-slate-800 tabular-nums">
                    {money(data.annual_base_total)}
                  </p>
                </div>
              </div>
            </section>

            {/* حسب المرحلة */}
            <section className="sup-enter sup-d6">
              <SectionTitle icon={AcademicCapIcon}>حسب المرحلة الدراسية</SectionTitle>
              <div className="space-y-2.5">
                {data.by_stage.map((stage) => (
                  <article
                    key={stage.stage}
                    className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                      <h3 className="text-sm font-semibold text-slate-800">{stage.label}</h3>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {num(stage.students)} طالب
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-2">
                        <p className="text-[10px] text-emerald-600 mb-0.5">محصل</p>
                        <p className="text-[11px] font-bold text-emerald-700 tabular-nums leading-4">
                          {money(stage.collected_amount)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-rose-50 border border-rose-100 py-2">
                        <p className="text-[10px] text-rose-600 mb-0.5">دين</p>
                        <p className="text-[11px] font-bold text-rose-700 tabular-nums leading-4">
                          {money(stage.debt_amount)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 py-2">
                        <p className="text-[10px] text-slate-500 mb-0.5">متوقع</p>
                        <p className="text-[11px] font-bold text-slate-800 tabular-nums leading-4">
                          {money(stage.expected_annual_total)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <DeptRankList
              title="الأقسام الأفضل تحصيلاً"
              items={data.best_paying_departments}
              valueKey="collected_amount"
              showRate
            />

            <DeptRankList
              title="أعلى الأقسام مديونية"
              items={data.top_debt_departments}
              valueKey="debt_amount"
            />

            <DeptRankList
              title="أعلى الأقسام تخفيضاً"
              items={data.top_discount_departments}
              valueKey="total_discount_amount"
            />

            {/* كل الأقسام */}
            <section className="sup-enter">
              <SectionTitle icon={BanknotesIcon}>تسديدات كل قسم</SectionTitle>
              <div className="space-y-2.5">
                {data.departments.map((dept) => (
                  <article
                    key={dept.id}
                    className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden"
                  >
                    <div className="px-3.5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-2.5">
                        <span
                          className="w-1.5 h-8 rounded-full shrink-0 mt-0.5"
                          style={{ backgroundColor: SUPERVISION_BRAND }}
                        />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-800 leading-5">
                            {dept.name}
                          </h3>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {num(dept.students)} طالب · صباحي {num(dept.morning)} · مسائي{' '}
                            {num(dept.evening)}
                          </p>
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <p
                          className="text-sm font-bold tabular-nums"
                          style={{ color: SUPERVISION_BRAND }}
                        >
                          {percent(dept.collection_rate_percent)}
                        </p>
                        <p className="text-[10px] text-slate-400">تحصيل</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-100">
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">محصل</p>
                        <p className="text-[11px] font-bold text-emerald-700 tabular-nums leading-4">
                          {money(dept.collected_amount)}
                        </p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">دين</p>
                        <p className="text-[11px] font-bold text-rose-700 tabular-nums leading-4">
                          {money(dept.debt_amount)}
                        </p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">متوقع</p>
                        <p className="text-[11px] font-bold text-slate-800 tabular-nums leading-4">
                          {money(dept.expected_annual_total)}
                        </p>
                      </div>
                    </div>
                    {(dept.total_discount_amount > 0 || dept.discounts_count > 0) && (
                      <div className="px-3.5 py-2.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">
                          تخفيضات: {num(dept.discounts_count)} طالب
                        </span>
                        <span className="font-semibold text-violet-700 tabular-nums">
                          {money(dept.total_discount_amount)}
                        </span>
                      </div>
                    )}
                  </article>
                ))}
                {data.departments.length === 0 && (
                  <p className="text-center text-slate-400 text-sm py-8">لا توجد بيانات أقسام</p>
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </SupervisionShell>
  );
}
