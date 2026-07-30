import type { StudentsAggregateData } from '@/src/lib/accounts/students-aggregate';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function percent(n: number): string {
  return `${Number(n || 0).toFixed(1)}%`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-IQ');
  } catch {
    return iso;
  }
}

export function printAggregateAccounts(data: StudentsAggregateData): void {
  const eq = data.equation;
  const totals = data.totals;

  const deptRows = data.by_department
    .map(
      (d, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(d.name)}</td>
        <td>${d.students}</td>
        <td dir="ltr">${money(d.annual_base_total)}</td>
        <td dir="ltr">${money(d.discount_amount)}</td>
        <td dir="ltr">${money(d.expected_annual_total)}</td>
        <td dir="ltr">${money(d.collected_amount)}</td>
        <td dir="ltr" class="debt">${money(d.debt_amount)}</td>
        <td>${d.receipts_count}</td>
        <td>${percent(d.collection_rate_percent)}</td>
        <td dir="ltr">${money(d.expected_four_years_total)}</td>
      </tr>`
    )
    .join('');

  const stageRows = data.by_stage
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.label)}</td>
        <td>${s.students}</td>
        <td dir="ltr">${money(s.annual_base_total)}</td>
        <td dir="ltr">${money(s.discount_amount)}</td>
        <td dir="ltr">${money(s.expected_annual_total)}</td>
        <td dir="ltr">${money(s.collected_amount)}</td>
        <td dir="ltr" class="debt">${money(s.debt_amount)}</td>
        <td>${s.receipts_count}</td>
      </tr>`
    )
    .join('');

  const studyRows = data.by_study_type
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.label)}</td>
        <td>${s.students}</td>
        <td dir="ltr">${money(s.annual_base_total)}</td>
        <td dir="ltr">${money(s.discount_amount)}</td>
        <td dir="ltr">${money(s.expected_annual_total)}</td>
        <td dir="ltr">${money(s.collected_amount)}</td>
        <td dir="ltr" class="debt">${money(s.debt_amount)}</td>
        <td>${s.receipts_count}</td>
      </tr>`
    )
    .join('');

  const feeYearRows = data.by_fee_year
    .map(
      (y) => `<tr>
        <td>${escapeHtml(y.label)}</td>
        <td dir="ltr">${money(y.target_amount)}</td>
        <td dir="ltr">${money(y.collected_amount)}</td>
        <td dir="ltr" class="debt">${money(y.remaining_amount)}</td>
        <td>${y.receipts_count}</td>
        <td>${y.students_with_activity}</td>
      </tr>`
    )
    .join('');

  const discountRows =
    data.discount_types.length === 0
      ? `<tr><td colspan="4" style="text-align:center">لا توجد تخفيضات</td></tr>`
      : data.discount_types
          .map(
            (d, i) => `<tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(d.label)}</td>
              <td>${d.kind === 'channel' ? 'قناة قبول' : 'خصم تسديد'}</td>
              <td>${d.students_count}</td>
              <td dir="ltr">${money(d.amount)}</td>
            </tr>`
          )
          .join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>حسابات إجمالية — مستحقات الطلبة</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 22px 0 8px; color: #7f1d1d; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .muted { color: #6b7280; font-size: 12px; }
    .eq { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 8px; }
    .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
    .card .label { font-size: 11px; color: #6b7280; }
    .card .value { font-size: 15px; font-weight: 700; margin-top: 4px; }
    .debt { color: #b91c1c; }
    .green { color: #047857; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: right; }
    th { background: #450a0a; color: #fff; }
    tr.total { background: #f3f4f6; font-weight: 700; }
    .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 48px; text-align: center; font-size: 12px; }
    .sigs .line { border-top: 1px solid #9ca3af; margin-top: 40px; padding-top: 6px; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <p class="muted">جمهورية العراق — وزارة التعليم العالي والبحث العلمي</p>
  <h1>كلية الشرق للعلوم التقنية التخصصية</h1>
  <h1>تقرير الحسابات الإجمالية — مستحقات الطلبة</h1>
  <p class="muted">تاريخ الإصدار: ${escapeHtml(formatDateTime(data.generated_at))}</p>

  <h2>معادلة الحساب الإجمالي</h2>
  <div class="eq">
    <div class="card"><div class="label">أساس الرسوم</div><div class="value">${money(eq.annual_base_total)} IQD</div></div>
    <div class="card"><div class="label">− التخفيضات</div><div class="value">${money(eq.total_discount_amount)} IQD</div></div>
    <div class="card"><div class="label">= المطلوب</div><div class="value">${money(eq.expected_annual_total)} IQD</div></div>
    <div class="card"><div class="label">المحصّل</div><div class="value green">${money(eq.collected_amount)} IQD</div></div>
    <div class="card"><div class="label">الدين</div><div class="value debt">${money(eq.debt_amount)} IQD</div></div>
    <div class="card"><div class="label">نسبة التحصيل</div><div class="value">${percent(eq.collection_rate_percent)}</div></div>
    <div class="card"><div class="label">متوقع 4 سنوات</div><div class="value">${money(eq.expected_four_years_total)} IQD</div></div>
    <div class="card"><div class="label">عدد الوصولات</div><div class="value">${data.counts.receipts_count}</div></div>
  </div>

  <h2>حسب الأقسام</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>القسم</th><th>طلبة</th><th>أساس</th><th>تخفيض</th>
        <th>مطلوب</th><th>محصل</th><th>دين</th><th>وصولات</th><th>تحصيل</th><th>4 سنوات</th>
      </tr>
    </thead>
    <tbody>
      ${deptRows}
      <tr class="total">
        <td colspan="2">الإجمالي</td>
        <td>${totals.students}</td>
        <td dir="ltr">${money(totals.annual_base_total)}</td>
        <td dir="ltr">${money(totals.discount_amount)}</td>
        <td dir="ltr">${money(totals.expected_annual_total)}</td>
        <td dir="ltr">${money(totals.collected_amount)}</td>
        <td dir="ltr" class="debt">${money(totals.debt_amount)}</td>
        <td>${totals.receipts_count}</td>
        <td>${percent(eq.collection_rate_percent)}</td>
        <td dir="ltr">${money(totals.expected_four_years_total)}</td>
      </tr>
    </tbody>
  </table>

  <h2>حسب المراحل</h2>
  <table>
    <thead>
      <tr><th>المرحلة</th><th>طلبة</th><th>أساس</th><th>تخفيض</th><th>مطلوب</th><th>محصل</th><th>دين</th><th>وصولات</th></tr>
    </thead>
    <tbody>${stageRows}</tbody>
  </table>

  <h2>حسب نوع الدراسة</h2>
  <table>
    <thead>
      <tr><th>النوع</th><th>طلبة</th><th>أساس</th><th>تخفيض</th><th>مطلوب</th><th>محصل</th><th>دين</th><th>وصولات</th></tr>
    </thead>
    <tbody>${studyRows}</tbody>
  </table>

  <h2>حسب سنة القسط</h2>
  <table>
    <thead>
      <tr><th>السنة</th><th>المستهدف</th><th>المحصّل</th><th>المتبقي</th><th>وصولات</th><th>طلبة بنشاط</th></tr>
    </thead>
    <tbody>${feeYearRows}</tbody>
  </table>

  <h2>أنواع التخفيضات</h2>
  <table>
    <thead>
      <tr><th>#</th><th>النوع</th><th>التصنيف</th><th>عدد الطلبة</th><th>المبلغ</th></tr>
    </thead>
    <tbody>${discountRows}</tbody>
  </table>

  <div class="sigs">
    <div><div class="line">منظم التقرير</div></div>
    <div><div class="line">المحاسب</div></div>
    <div><div class="line">مدير الحسابات</div></div>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
  if (!w) {
    alert('تعذر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 350);
}
