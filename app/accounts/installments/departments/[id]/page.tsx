'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type StageStat = {
  stage: string;
  stage_label: string;
  total: number;
  males: number;
  females: number;
  unknown_gender: number;
  paid_count: number;
  unpaid_count: number;
  collected_amount: number;
  expected_amount: number;
  debt_amount: number;
  morning: number;
  evening: number;
};

type ReportData = {
  department: { id: string; name: string };
  generated_at: string;
  summary: {
    total_students: number;
    males: number;
    females: number;
    unknown_gender: number;
    paid_count: number;
    unpaid_count: number;
    collected_amount: number;
    expected_amount: number;
    debt_amount: number;
    morning: number;
    evening: number;
  };
  stages: StageStat[];
  unpaid_students: Array<{
    university_id: string;
    name: string;
    stage_label: string;
    study_type: string;
    expected: number;
    paid: number;
    debt: number;
    payment_status: string;
    status_label?: string;
  }>;
};

function money(n: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ar-IQ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintHtml(data: ReportData) {
  const { department, summary, stages, unpaid_students, generated_at } = data;

  const stageRows = stages
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.stage_label)}</td>
        <td>${s.total}</td>
        <td>${s.males}</td>
        <td>${s.females}</td>
        <td>${s.morning}</td>
        <td>${s.evening}</td>
        <td>${s.paid_count}</td>
        <td>${s.unpaid_count}</td>
        <td>${money(s.collected_amount)}</td>
        <td>${money(s.expected_amount)}</td>
        <td class="debt">${money(s.debt_amount)}</td>
      </tr>`
    )
    .join('');

  const stageCards = stages
    .map(
      (s) => `
      <div class="stage-card">
        <h4>${escapeHtml(s.stage_label)}</h4>
        <ul>
          <li>عدد الطلبة: ${s.total} (ذكور ${s.males} / إناث ${s.females})</li>
          <li>صباحي ${s.morning} — مسائي ${s.evening}</li>
          <li>مسدد بالكامل ${s.paid_count} — عليهم متبقي ${s.unpaid_count}</li>
          <li>المقبوضات: ${money(s.collected_amount)} IQD</li>
          <li>المتوقع: ${money(s.expected_amount)} IQD</li>
          <li class="debt"><strong>الديون: ${money(s.debt_amount)} IQD</strong></li>
        </ul>
      </div>`
    )
    .join('');

  const debtRows =
    unpaid_students.length === 0
      ? `<tr><td colspan="9" style="text-align:center">لا توجد ديون مسجّلة حالياً.</td></tr>`
      : unpaid_students
          .map(
            (s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(s.university_id)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.stage_label)}</td>
          <td>${escapeHtml(s.study_type)}</td>
          <td>${escapeHtml(s.status_label || 'غير مسدد')}</td>
          <td>${money(s.expected)}</td>
          <td>${money(s.paid)}</td>
          <td class="debt">${money(s.debt)}</td>
        </tr>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>تقرير أقساط — ${escapeHtml(department.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      color: #111;
      background: #fff;
      font-size: 12px;
      line-height: 1.5;
    }
    .report { width: 100%; }
    .letterhead {
      text-align: center;
      border-bottom: 2px solid #7f1d1d;
      padding: 8px 0 14px;
      margin-bottom: 16px;
    }
    .letterhead .muted { color: #4b5563; font-size: 12px; margin: 0; }
    .letterhead h1 {
      margin: 8px 0 0;
      color: #7f1d1d;
      font-size: 20px;
    }
    .letterhead h2 {
      margin: 10px 0 0;
      font-size: 15px;
      font-weight: 600;
    }
    .letterhead .dept {
      margin: 6px 0 0;
      font-size: 17px;
      font-weight: 700;
    }
    .letterhead .date { margin: 6px 0 0; color: #6b7280; font-size: 11px; }
    h3 {
      color: #7f1d1d;
      font-size: 13px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
      margin: 18px 0 10px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 8px;
    }
    .cards.cols-3 { grid-template-columns: repeat(3, 1fr); }
    .cards.cols-2 { grid-template-columns: repeat(2, 1fr); }
    .card {
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      border-radius: 4px;
      padding: 8px 10px;
    }
    .card.green { background: #ecfdf5; border-color: #a7f3d0; }
    .card.amber { background: #fffbeb; border-color: #fde68a; }
    .card.red { background: #fef2f2; border-color: #fecaca; }
    .card .label { color: #4b5563; font-size: 11px; }
    .card .value { font-weight: 700; font-size: 13px; margin-top: 2px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin-bottom: 8px;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 5px 6px;
      text-align: right;
    }
    th { background: #f3f4f6; font-weight: 700; }
    tr.total { background: #f9fafb; font-weight: 700; }
    .debt { color: #b91c1c; }
    .stage-card {
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 10px;
    }
    .stage-card h4 { margin: 0 0 6px; font-size: 13px; }
    .stage-card ul { margin: 0; padding-right: 16px; }
    .stage-card li { margin: 2px 0; }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      text-align: center;
      margin-top: 40px;
      font-size: 11px;
    }
    .signatures .line {
      border-top: 1px solid #9ca3af;
      padding-top: 8px;
      margin-top: 48px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .stage-card, .card, tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report">
    <div class="letterhead">
      <p class="muted">جمهورية العراق</p>
      <p class="muted">وزارة التعليم العالي والبحث العلمي</p>
      <h1>كلية الشرق للعلوم التقنية التخصصية</h1>
      <h2>تقرير إحصائي تفصيلي — أقساط الطلبة</h2>
      <p class="dept">${escapeHtml(department.name)}</p>
      <p class="date">تاريخ الإصدار: ${escapeHtml(formatDateTime(generated_at))}</p>
    </div>

    <h3>أولاً: الملخص العام للقسم</h3>
    <div class="cards">
      <div class="card"><div class="label">إجمالي الطلبة</div><div class="value">${summary.total_students}</div></div>
      <div class="card"><div class="label">الذكور</div><div class="value">${summary.males}</div></div>
      <div class="card"><div class="label">الإناث</div><div class="value">${summary.females}</div></div>
      <div class="card"><div class="label">غير محدد الجنس</div><div class="value">${summary.unknown_gender}</div></div>
      <div class="card green"><div class="label">مسدد بالكامل</div><div class="value">${summary.paid_count}</div></div>
      <div class="card amber"><div class="label">عليهم متبقي</div><div class="value">${summary.unpaid_count}</div></div>
      <div class="card"><div class="label">صباحي</div><div class="value">${summary.morning}</div></div>
      <div class="card"><div class="label">مسائي</div><div class="value">${summary.evening}</div></div>
    </div>
    <div class="cards cols-3">
      <div class="card green"><div class="label">إجمالي المقبوضات</div><div class="value">${money(summary.collected_amount)} IQD</div></div>
      <div class="card"><div class="label">إجمالي الأقساط المتوقعة</div><div class="value">${money(summary.expected_amount)} IQD</div></div>
      <div class="card red"><div class="label">إجمالي الديون</div><div class="value">${money(summary.debt_amount)} IQD</div></div>
    </div>

    <h3>ثانياً: التفصيل حسب المراحل الدراسية</h3>
    <table>
      <thead>
        <tr>
          <th>المرحلة</th><th>الطلبة</th><th>ذكور</th><th>إناث</th>
          <th>صباحي</th><th>مسائي</th><th>مسدد بالكامل</th><th>عليهم متبقي</th>
          <th>المقبوضات</th><th>المتوقع</th><th>الديون</th>
        </tr>
      </thead>
      <tbody>
        ${stageRows}
        <tr class="total">
          <td>الإجمالي</td>
          <td>${summary.total_students}</td>
          <td>${summary.males}</td>
          <td>${summary.females}</td>
          <td>${summary.morning}</td>
          <td>${summary.evening}</td>
          <td>${summary.paid_count}</td>
          <td>${summary.unpaid_count}</td>
          <td>${money(summary.collected_amount)}</td>
          <td>${money(summary.expected_amount)}</td>
          <td class="debt">${money(summary.debt_amount)}</td>
        </tr>
      </tbody>
    </table>

    <h3>ثالثاً: ملخص كل مرحلة</h3>
    <div class="cards cols-2">${stageCards}</div>

    <h3>رابعاً: كشف الديون (كل من عليه متبقي — غير مسدد أو مسدد جزئياً)</h3>
    <table>
      <thead>
        <tr>
          <th>#</th><th>الرقم الجامعي</th><th>الاسم</th><th>المرحلة</th>
          <th>الدراسة</th><th>الحالة</th><th>المطلوب</th><th>المدفوع</th><th>الدين</th>
        </tr>
      </thead>
      <tbody>${debtRows}</tbody>
    </table>

    <div class="signatures">
      <div><div class="line">منظم التقرير</div></div>
      <div><div class="line">المحاسب</div></div>
      <div><div class="line">مدير الحسابات</div></div>
    </div>
  </div>
</body>
</html>`;
}

export default function DepartmentInstallmentsReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/installments/departments/${encodeURIComponent(id)}`,
        { credentials: 'include', cache: 'no-store' }
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'تعذر تحميل التقرير');
        setData(null);
      } else {
        setData(json.data);
        setError(null);
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const printReport = useCallback(() => {
    if (!data) return;

    const html = buildPrintHtml(data);
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1200');
    if (!printWindow) {
      alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    const triggerPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        /* ignore */
      }
    };

    // بعد التحميل أو بعد مهلة قصيرة
    if (printWindow.document.readyState === 'complete') {
      window.setTimeout(triggerPrint, 250);
    } else {
      printWindow.onload = () => window.setTimeout(triggerPrint, 250);
      window.setTimeout(triggerPrint, 600);
    }
  }, [data]);

  if (loading) {
    return (
      <div className="p-6" dir="rtl">
        جاري تحميل تقرير القسم...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-3" dir="rtl">
        <p className="text-red-700">{error || 'لا توجد بيانات'}</p>
        <Link href="/accounts/installments" className="text-red-900 underline text-sm">
          العودة إلى أقساط الطلبة
        </Link>
      </div>
    );
  }

  const { department, summary, stages, unpaid_students, generated_at } = data;

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/accounts/installments"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← العودة
          </Link>
          <h1 className="text-base font-semibold text-gray-900">
            تقرير قسم: {department.name}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={printReport}
            className="px-4 py-1.5 text-sm bg-red-900 text-white rounded-md hover:bg-red-800"
          >
            تصدير PDF / طباعة A4
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6">
        <article className="mx-auto bg-white shadow-sm border border-gray-200">
          <div className="border-b-2 border-red-900 px-8 pt-8 pb-5 text-center">
            <p className="text-sm text-gray-600">جمهورية العراق</p>
            <p className="text-sm text-gray-600">وزارة التعليم العالي والبحث العلمي</p>
            <h2 className="text-xl font-bold text-red-900 mt-2">
              كلية الشرق للعلوم التقنية التخصصية
            </h2>
            <p className="text-base font-semibold text-gray-800 mt-3">
              تقرير إحصائي تفصيلي — أقساط الطلبة
            </p>
            <p className="text-lg font-bold text-gray-900 mt-1">{department.name}</p>
            <p className="text-xs text-gray-500 mt-2">
              تاريخ الإصدار: {formatDateTime(generated_at)}
            </p>
          </div>

          <div className="px-8 py-6 space-y-6 text-sm">
            <section>
              <h3 className="text-sm font-bold text-red-900 border-b border-gray-200 pb-1 mb-3">
                أولاً: الملخص العام للقسم
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="إجمالي الطلبة" value={String(summary.total_students)} />
                <StatCard label="الذكور" value={String(summary.males)} />
                <StatCard label="الإناث" value={String(summary.females)} />
                <StatCard
                  label="غير محدد الجنس"
                  value={String(summary.unknown_gender)}
                />
                <StatCard label="مسدد بالكامل" value={String(summary.paid_count)} tone="green" />
                <StatCard label="عليهم متبقي" value={String(summary.unpaid_count)} tone="amber" />
                <StatCard label="صباحي" value={String(summary.morning)} />
                <StatCard label="مسائي" value={String(summary.evening)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <StatCard
                  label="إجمالي المقبوضات"
                  value={`${money(summary.collected_amount)} IQD`}
                  tone="green"
                />
                <StatCard
                  label="إجمالي الأقساط المتوقعة"
                  value={`${money(summary.expected_amount)} IQD`}
                />
                <StatCard
                  label="إجمالي الديون"
                  value={`${money(summary.debt_amount)} IQD`}
                  tone="red"
                />
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-red-900 border-b border-gray-200 pb-1 mb-3">
                ثانياً: التفصيل حسب المراحل الدراسية
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border p-2 text-right">المرحلة</th>
                      <th className="border p-2 text-right">الطلبة</th>
                      <th className="border p-2 text-right">ذكور</th>
                      <th className="border p-2 text-right">إناث</th>
                      <th className="border p-2 text-right">صباحي</th>
                      <th className="border p-2 text-right">مسائي</th>
                      <th className="border p-2 text-right">مسدد بالكامل</th>
                      <th className="border p-2 text-right">عليهم متبقي</th>
                      <th className="border p-2 text-right">المقبوضات</th>
                      <th className="border p-2 text-right">المتوقع</th>
                      <th className="border p-2 text-right">الديون</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((s) => (
                      <tr key={s.stage}>
                        <td className="border p-2 font-medium">{s.stage_label}</td>
                        <td className="border p-2">{s.total}</td>
                        <td className="border p-2">{s.males}</td>
                        <td className="border p-2">{s.females}</td>
                        <td className="border p-2">{s.morning}</td>
                        <td className="border p-2">{s.evening}</td>
                        <td className="border p-2 text-emerald-700">{s.paid_count}</td>
                        <td className="border p-2 text-amber-700">{s.unpaid_count}</td>
                        <td className="border p-2">{money(s.collected_amount)}</td>
                        <td className="border p-2">{money(s.expected_amount)}</td>
                        <td className="border p-2 text-red-700">{money(s.debt_amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="border p-2">الإجمالي</td>
                      <td className="border p-2">{summary.total_students}</td>
                      <td className="border p-2">{summary.males}</td>
                      <td className="border p-2">{summary.females}</td>
                      <td className="border p-2">{summary.morning}</td>
                      <td className="border p-2">{summary.evening}</td>
                      <td className="border p-2">{summary.paid_count}</td>
                      <td className="border p-2">{summary.unpaid_count}</td>
                      <td className="border p-2">{money(summary.collected_amount)}</td>
                      <td className="border p-2">{money(summary.expected_amount)}</td>
                      <td className="border p-2">{money(summary.debt_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-red-900 border-b border-gray-200 pb-1 mb-3">
                ثالثاً: ملخص كل مرحلة
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stages.map((s) => (
                  <div key={`card-${s.stage}`} className="border border-gray-200 rounded p-3">
                    <h4 className="font-bold text-gray-900 mb-2">{s.stage_label}</h4>
                    <ul className="space-y-1 text-xs text-gray-700">
                      <li>عدد الطلبة: {s.total} (ذكور {s.males} / إناث {s.females})</li>
                      <li>صباحي {s.morning} — مسائي {s.evening}</li>
                      <li>
                        مسدد بالكامل {s.paid_count} — عليهم متبقي {s.unpaid_count}
                      </li>
                      <li>المقبوضات: {money(s.collected_amount)} IQD</li>
                      <li>المتوقع: {money(s.expected_amount)} IQD</li>
                      <li className="text-red-800 font-medium">
                        الديون: {money(s.debt_amount)} IQD
                      </li>
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-red-900 border-b border-gray-200 pb-1 mb-3">
                رابعاً: كشف الديون (كل من عليه متبقي — غير مسدد أو مسدد جزئياً)
              </h3>
              {unpaid_students.length === 0 ? (
                <p className="text-sm text-gray-600">لا توجد ديون مسجّلة حالياً.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border p-2 text-right">#</th>
                        <th className="border p-2 text-right">الرقم الجامعي</th>
                        <th className="border p-2 text-right">الاسم</th>
                        <th className="border p-2 text-right">المرحلة</th>
                        <th className="border p-2 text-right">الدراسة</th>
                        <th className="border p-2 text-right">الحالة</th>
                        <th className="border p-2 text-right">المطلوب</th>
                        <th className="border p-2 text-right">المدفوع</th>
                        <th className="border p-2 text-right">الدين</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unpaid_students.map((s, i) => (
                        <tr key={`${s.university_id}-${i}`}>
                          <td className="border p-2">{i + 1}</td>
                          <td className="border p-2 font-mono">{s.university_id}</td>
                          <td className="border p-2">{s.name}</td>
                          <td className="border p-2">{s.stage_label}</td>
                          <td className="border p-2">{s.study_type}</td>
                          <td className="border p-2">{s.status_label || 'غير مسدد'}</td>
                          <td className="border p-2">{money(s.expected)}</td>
                          <td className="border p-2">{money(s.paid)}</td>
                          <td className="border p-2 text-red-700 font-medium">
                            {money(s.debt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {unpaid_students.length >= 500 && (
                    <p className="text-xs text-gray-500 mt-2">
                      يُعرض أول 500 سجل دين فقط في التقرير.
                    </p>
                  )}
                </div>
              )}
            </section>

            <div className="pt-10 grid grid-cols-3 gap-6 text-center text-xs text-gray-700">
              <div>
                <div className="border-t border-gray-400 pt-2 mt-10">منظم التقرير</div>
              </div>
              <div>
                <div className="border-t border-gray-400 pt-2 mt-10">المحاسب</div>
              </div>
              <div>
                <div className="border-t border-gray-400 pt-2 mt-10">مدير الحسابات</div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'amber' | 'red';
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : tone === 'red'
          ? 'border-red-200 bg-red-50'
          : 'border-gray-200 bg-gray-50';
  return (
    <div className={`rounded border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] text-gray-600">{label}</div>
      <div className="text-sm font-bold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}
