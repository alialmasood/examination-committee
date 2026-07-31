'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import StudentsNav from '../../../../../components/StudentsNav';

type DiscountType = {
  key: string;
  label: string;
  kind: 'channel' | 'settlement';
  students_count: number;
  amount: number;
};

type StudentRow = {
  id: string;
  university_id: string;
  name: string;
  gender: string;
  admission_channel: string;
  admission_channel_label: string;
  annual_fee: number;
  expected_fee: number;
  discount_amount: number;
  channel_discount: number;
  settlement_discount: number;
  paid_amount: number;
  debt_amount: number;
  receipts_count: number;
  payment_category: 'settled' | 'partial' | 'unpaid';
  status_label: string;
  expected_four_years: number;
};

type StageDetail = {
  generated_at: string;
  department: { id: string; name: string };
  study_type: string;
  study_type_label: string;
  stage: string;
  stage_label: string;
  summary: {
    total_students: number;
    males: number;
    females: number;
    unknown_gender: number;
    fully_paid_count: number;
    partial_paid_count: number;
    unpaid_count: number;
    receipts_count: number;
    collected_amount: number;
    debt_amount: number;
    annual_base_total: number;
    expected_annual_total: number;
    expected_four_years_total: number;
    channel_discount_amount: number;
    settlement_discount_amount: number;
    total_discount_amount: number;
    students_with_discount: number;
    discount_impact_percent: number;
    collection_rate_percent: number;
  };
  discount_types: DiscountType[];
  students: StudentRow[];
};

const DEPT_FALLBACK: Record<string, string> = {
  anesthesia: 'تقنيات التخدير',
  radiology: 'تقنيات الاشعة',
  dental: 'تقنيات صناعة الاسنان',
  construction: 'هندسة تقنيات البناء والانشاءات',
  'oil-gas': 'تقنيات هندسة النفط والغاز',
  'health-physics': 'تقنيات الفيزياء الصحية',
  optics: 'تقنيات البصريات',
  'community-health': 'تقنيات صحة المجتمع',
  'emergency-medicine': 'تقنيات طب الطوارئ',
  'physical-therapy': 'تقنيات العلاج الطبيعي',
  cybersecurity: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
  law: 'القانون',
};

const money = (n: number) =>
  new Intl.NumberFormat('en-US').format(Math.round(n || 0));

const percent = (n: number) => `${Number(n || 0).toFixed(1)}%`;

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'indigo';
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50/60'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50/60'
        : tone === 'red'
          ? 'border-rose-200 bg-rose-50/60'
          : tone === 'indigo'
            ? 'border-indigo-200 bg-indigo-50/60'
            : 'border-gray-200 bg-white';
  const valueClass =
    tone === 'green'
      ? 'text-emerald-800'
      : tone === 'amber'
        ? 'text-amber-800'
        : tone === 'red'
          ? 'text-rose-800'
          : tone === 'indigo'
            ? 'text-indigo-800'
            : 'text-gray-900';

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {hint ? <p className="text-[11px] text-gray-500 mt-1">{hint}</p> : null}
    </div>
  );
}

function statusBadgeClass(category: StudentRow['payment_category']) {
  if (category === 'settled') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (category === 'partial') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-rose-50 text-rose-800 border-rose-200';
}

export default function StudentAccountsDepartmentStagePage() {
  const params = useParams();
  const departmentId = String(params?.id || '');
  const studyType = String(params?.studyType || '');
  const stage = String(params?.stage || '');

  const [data, setData] = useState<StageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    '' | 'settled' | 'partial' | 'unpaid'
  >('');
  const [searchQuery, setSearchQuery] = useState('');

  const backHref = useMemo(
    () => `/accounts/students/accounts/departments/${departmentId}`,
    [departmentId]
  );

  const load = useCallback(async () => {
    if (!departmentId || !studyType || !stage) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/accounts/students/departments/${encodeURIComponent(departmentId)}/${encodeURIComponent(studyType)}/${encodeURIComponent(stage)}`,
        { credentials: 'include', cache: 'no-store' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error || 'تعذر تحميل تفصيل المرحلة');
        setData(null);
        return;
      }
      setData(body.data as StageDetail);
    } catch {
      setError('تعذر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [departmentId, studyType, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.students.filter((s) => {
      if (statusFilter && s.payment_category !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.university_id.toLowerCase().includes(q) ||
        s.admission_channel_label.toLowerCase().includes(q)
      );
    });
  }, [data, statusFilter, searchQuery]);

  const titleDept =
    data?.department.name || DEPT_FALLBACK[departmentId] || departmentId;
  const titleStudy = data?.study_type_label || studyType;
  const titleStage = data?.stage_label || stage;

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4">
        <Link href={backHref} className="text-sm text-red-900 hover:underline">
          ← العودة إلى {titleDept}
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">
          {titleDept} — {titleStudy} — {titleStage}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          تفصيل مالي كامل لطلبة هذه المرحلة (التسديدات · التخفيضات · الديون)
        </p>
      </div>

      <StudentsNav />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="underline shrink-0">
            إعادة المحاولة
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center text-gray-500 text-sm">جارٍ تحميل تفصيل المرحلة…</div>
      ) : data ? (
        <div className="space-y-6">
          {/* نظرة عامة */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              أولاً: نظرة عامة
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="إجمالي الطلبة"
                value={String(data.summary.total_students)}
                hint={`ذكور ${data.summary.males} · إناث ${data.summary.females}`}
              />
              <StatCard
                label="مسدد بالكامل"
                value={String(data.summary.fully_paid_count)}
                tone="green"
              />
              <StatCard
                label="تسديد جزئي"
                value={String(data.summary.partial_paid_count)}
                tone="amber"
              />
              <StatCard
                label="غير مسدد"
                value={String(data.summary.unpaid_count)}
                tone="red"
              />
            </div>
          </section>

          {/* المبالغ */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              ثانياً: المبالغ والأقساط
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <StatCard
                label="المقبوضات (وصولات التسديد)"
                value={`${money(data.summary.collected_amount)} IQD`}
                tone="green"
                hint={`عدد الوصولات: ${data.summary.receipts_count}`}
              />
              <StatCard
                label="الديون المتبقية"
                value={`${money(data.summary.debt_amount)} IQD`}
                tone="red"
              />
              <StatCard
                label="نسبة التحصيل"
                value={percent(data.summary.collection_rate_percent)}
                hint="من المتوقع السنوي بعد التخفيض"
              />
              <StatCard
                label="أساس الرسوم السنوي"
                value={`${money(data.summary.annual_base_total)} IQD`}
              />
              <StatCard
                label="المتوقع لسنة واحدةة"
                value={`${money(data.summary.expected_annual_total)} IQD`}
                hint="بعد طرح التخفيضات"
              />
              <StatCard
                label="المتوقع لـ 4 سنوات"
                value={`${money(data.summary.expected_four_years_total)} IQD`}
                hint="×4 من المتوقع السنوي"
              />
            </div>
          </section>

          {/* التخفيضات */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              ثالثاً: التخفيضات وأثرها
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <StatCard
                label="إجمالي التخفيضات"
                value={`${money(data.summary.total_discount_amount)} IQD`}
                tone="indigo"
              />
              <StatCard
                label="طلبة لديهم تخفيض"
                value={String(data.summary.students_with_discount)}
                tone="indigo"
              />
              <StatCard
                label="خصم القنوات"
                value={`${money(data.summary.channel_discount_amount)} IQD`}
              />
              <StatCard
                label="أثر التخفيض على الأساس"
                value={percent(data.summary.discount_impact_percent)}
                hint={`خصم التسديد: ${money(data.summary.settlement_discount_amount)} IQD`}
              />
            </div>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-red-950 text-white">
                <p className="text-sm font-semibold">أنواع التخفيضات في هذه المرحلة</p>
                <p className="text-xs text-red-100/80 mt-0.5">
                  حسب قناة القبول أو خصم التسديد · عدد المستفيدين · إجمالي المبلغ
                </p>
              </div>
              {data.discount_types.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">
                  لا توجد تخفيضات مسجّلة لهذه المرحلة
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-2.5 text-right font-medium">#</th>
                        <th className="px-4 py-2.5 text-right font-medium">نوع التخفيض</th>
                        <th className="px-4 py-2.5 text-right font-medium">التصنيف</th>
                        <th className="px-4 py-2.5 text-right font-medium">عدد الطلبة</th>
                        <th className="px-4 py-2.5 text-right font-medium">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.discount_types.map((d, i) => (
                        <tr key={d.key} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-900">{d.label}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={[
                                'inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                                d.kind === 'channel'
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                                  : 'bg-violet-50 border-violet-200 text-violet-800',
                              ].join(' ')}
                            >
                              {d.kind === 'channel' ? 'قناة قبول' : 'خصم تسديد'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">{d.students_count}</td>
                          <td className="px-4 py-2.5 font-semibold text-indigo-800 tabular-nums">
                            {money(d.amount)} IQD
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* جدول الطلبة */}
          <section>
            <h2 className="text-sm font-bold text-red-950 mb-3 border-b border-gray-200 pb-1">
              رابعاً: كشف الطلبة التفصيلي
            </h2>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">قائمة الطلبة</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    النتائج: {filteredStudents.length} من {data.students.length}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="بحث بالاسم أو الرقم…"
                    className="h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                  />
                  <div className="flex rounded-md border border-gray-300 overflow-hidden">
                    {(
                      [
                        { value: '' as const, label: 'الكل' },
                        { value: 'settled' as const, label: 'مسدد' },
                        { value: 'partial' as const, label: 'جزئي' },
                        { value: 'unpaid' as const, label: 'غير مسدد' },
                      ] as const
                    ).map((opt, idx) => (
                      <button
                        key={opt.value || 'all'}
                        type="button"
                        onClick={() => setStatusFilter(opt.value)}
                        className={[
                          'h-9 px-2.5 text-xs font-semibold',
                          idx > 0 ? 'border-r border-gray-300' : '',
                          statusFilter === opt.value
                            ? 'bg-red-950 text-white'
                            : 'bg-white text-gray-700 hover:bg-gray-50',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-red-950 text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-medium">#</th>
                      <th className="px-3 py-2.5 text-right font-medium">اسم الطالب</th>
                      <th className="px-3 py-2.5 text-right font-medium">رقم الطالب</th>
                      <th className="px-3 py-2.5 text-right font-medium">الجنس</th>
                      <th className="px-3 py-2.5 text-right font-medium">القناة</th>
                      <th className="px-3 py-2.5 text-right font-medium">القسط</th>
                      <th className="px-3 py-2.5 text-right font-medium">التخفيض</th>
                      <th className="px-3 py-2.5 text-right font-medium">المطلوب</th>
                      <th className="px-3 py-2.5 text-right font-medium">المدفوع</th>
                      <th className="px-3 py-2.5 text-right font-medium">الدين</th>
                      <th className="px-3 py-2.5 text-right font-medium">الوصولات</th>
                      <th className="px-3 py-2.5 text-right font-medium">الحالة</th>
                      <th className="px-3 py-2.5 text-right font-medium">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-10 text-center text-gray-500"
                        >
                          لا توجد نتائج مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((s, i) => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-gray-500">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/accounts/students/accounts/student/${s.id}`}
                              className="font-medium text-red-900 hover:underline"
                            >
                              {s.name}
                            </Link>
                          </td>
                          <td
                            className="px-3 py-2.5 font-mono text-xs text-gray-800"
                            dir="ltr"
                          >
                            {s.university_id}
                          </td>
                          <td className="px-3 py-2.5 text-gray-700">{s.gender}</td>
                          <td className="px-3 py-2.5 text-gray-700 text-xs">
                            {s.admission_channel_label}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-gray-700">
                            {money(s.annual_fee)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-indigo-800 font-medium">
                            {money(s.discount_amount)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-gray-800">
                            {money(s.expected_fee)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-emerald-800 font-medium">
                            {money(s.paid_amount)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-rose-800 font-medium">
                            {money(s.debt_amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={[
                                'inline-flex min-w-[2rem] justify-center rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums',
                                s.receipts_count > 0
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : 'bg-slate-50 border-slate-200 text-slate-500',
                              ].join(' ')}
                            >
                              {s.receipts_count}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(s.payment_category)}`}
                            >
                              {s.status_label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/accounts/students/accounts?search=${encodeURIComponent(s.university_id)}`}
                              className="inline-flex rounded-md bg-red-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800"
                            >
                              تسديد
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <p className="text-center text-xs text-gray-400 pb-2">
            آخر تحديث: {new Date(data.generated_at).toLocaleString('ar-IQ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
