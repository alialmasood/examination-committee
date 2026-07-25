export type ExportStudentRow = {
  id: string;
  university_id: string;
  name: string;
  department: string;
  stage: string;
  study_type: string;
  annual_fee: number;
  discount_amount: number;
  discount_type: string;
  net_fee: number;
  paid_current_year: number;
  remaining_current_year: number;
  total_collected: number;
  receipts_count: number;
  current_year: number | null;
  status_label: string;
};

export type ExportDepartmentTotals = {
  department: string;
  students: number;
  annual_fee: number;
  discount_amount: number;
  net_fee: number;
  paid_current_year: number;
  remaining_current_year: number;
  total_collected: number;
  receipts_count: number;
};

export type StudentAccountsExportData = {
  generated_at: string;
  rows: ExportStudentRow[];
  departments: ExportDepartmentTotals[];
  totals: ExportDepartmentTotals;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function todayLabel(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${now.getFullYear()}`;
}

function buildHtml(data: StudentAccountsExportData, logoUrl: string): string {
  const sections = data.departments
    .map((dept) => {
      const deptRows = data.rows.filter((r) => r.department === dept.department);
      const body = deptRows
        .map(
          (row, index) => `<tr>
            <td>${index + 1}</td>
            <td class="name">${escapeHtml(row.name)}</td>
            <td dir="ltr">${escapeHtml(row.university_id)}</td>
            <td>${escapeHtml(row.stage)}</td>
            <td>${escapeHtml(row.study_type)}</td>
            <td dir="ltr">${money(row.annual_fee)}</td>
            <td dir="ltr">${money(row.discount_amount)}</td>
            <td>${escapeHtml(row.discount_type)}</td>
            <td dir="ltr">${money(row.net_fee)}</td>
            <td dir="ltr">${money(row.paid_current_year)}</td>
            <td dir="ltr">${money(row.remaining_current_year)}</td>
            <td dir="ltr">${money(row.total_collected)}</td>
            <td>${row.receipts_count}</td>
          </tr>`
        )
        .join('');

      return `
        <section class="dept">
          <h2 class="dept-title">
            <span>القسم: ${escapeHtml(dept.department)}</span>
            <span class="dept-count">${dept.students} طالب</span>
          </h2>
          <table class="grid">
            <thead>
              <tr>
                <th>ت</th>
                <th>اسم الطالب</th>
                <th>رقم الطالب</th>
                <th>المرحلة</th>
                <th>نوع الدراسة</th>
                <th>القسط الكلي</th>
                <th>التخفيض</th>
                <th>نوع التخفيض</th>
                <th>بعد التخفيض</th>
                <th>المسدد</th>
                <th>المتبقي</th>
                <th>الإجمالي المستحصل</th>
                <th>الوصولات</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot>
              <tr class="subtotal">
                <td colspan="5">إجمالي القسم</td>
                <td dir="ltr">${money(dept.annual_fee)}</td>
                <td dir="ltr">${money(dept.discount_amount)}</td>
                <td>—</td>
                <td dir="ltr">${money(dept.net_fee)}</td>
                <td dir="ltr">${money(dept.paid_current_year)}</td>
                <td dir="ltr">${money(dept.remaining_current_year)}</td>
                <td dir="ltr">${money(dept.total_collected)}</td>
                <td>${dept.receipts_count}</td>
              </tr>
            </tfoot>
          </table>
        </section>`;
    })
    .join('');

  const summaryRows = data.departments
    .map(
      (dept) => `<tr>
        <td class="name">${escapeHtml(dept.department)}</td>
        <td>${dept.students}</td>
        <td dir="ltr">${money(dept.annual_fee)}</td>
        <td dir="ltr">${money(dept.discount_amount)}</td>
        <td dir="ltr">${money(dept.net_fee)}</td>
        <td dir="ltr">${money(dept.paid_current_year)}</td>
        <td dir="ltr">${money(dept.remaining_current_year)}</td>
        <td dir="ltr">${money(dept.total_collected)}</td>
        <td>${dept.receipts_count}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>جدول حسابات الطلبة</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      color: #111827; background: #fff;
      font-family: "Tahoma", "Segoe UI", Arial, sans-serif;
      font-size: 9.5px;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      border-bottom: 2px solid #450a0a;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .header-side p { margin: 0; font-size: 10px; color: #374151; }
    .header-side .college { font-weight: 700; color: #450a0a; margin-top: 2px; }
    .header-center { text-align: center; }
    .header-center img { width: 46px; height: 46px; object-fit: contain; display: block; margin: 0 auto 3px; }
    .header-center .title { margin: 0; font-size: 14px; font-weight: 800; color: #450a0a; }
    .header-center .sub { margin: 2px 0 0; font-size: 9px; color: #6b7280; }
    .header-left { text-align: left; font-size: 9.5px; color: #374151; }
    .header-left b { color: #111827; }
    .dept { margin-bottom: 10px; page-break-inside: auto; }
    .dept-title {
      display: flex; justify-content: space-between; align-items: center;
      margin: 0 0 4px; padding: 4px 8px;
      background: #450a0a; color: #fff;
      font-size: 11px; font-weight: 700;
    }
    .dept-count { font-size: 9.5px; font-weight: 600; opacity: .9; }
    table.grid, table.summary { width: 100%; border-collapse: collapse; }
    table.grid th, table.grid td,
    table.summary th, table.summary td {
      border: 1px solid #d1d5db;
      padding: 3px 4px;
      text-align: center;
      vertical-align: middle;
    }
    table.grid th, table.summary th {
      background: #f3f4f6; color: #374151; font-weight: 700; font-size: 9px;
    }
    table.grid td.name, table.summary td.name { text-align: right; }
    table.grid tbody tr:nth-child(even) td { background: #f8fafc; }
    tr.subtotal td { background: #fde68a; font-weight: 700; color: #451a03; }
    .summary-title {
      margin: 14px 0 5px; padding: 5px 8px;
      background: #1f2937; color: #fff; font-size: 11px; font-weight: 700;
    }
    tr.grand td { background: #450a0a; color: #fff; font-weight: 800; }
    .footer {
      margin-top: 10px; padding-top: 5px;
      border-top: 1px solid #e5e7eb;
      text-align: center; font-size: 8.5px; color: #6b7280;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-side">
      <p>وزارة التعليم العالي والبحث العلمي</p>
      <p class="college">كلية الشرق للعلوم التقنية التخصصية</p>
    </div>
    <div class="header-center">
      <img src="${escapeHtml(logoUrl)}" alt="شعار الكلية" />
      <p class="title">جدول حسابات الطلبة</p>
      <p class="sub">تقرير مالي رسمي — شعبة الحسابات</p>
    </div>
    <div class="header-left">
      <div>تاريخ الطباعة: <b>${escapeHtml(todayLabel())}</b></div>
      <div>عدد الطلبة: <b>${data.totals.students}</b></div>
      <div>عدد الأقسام: <b>${data.departments.length}</b></div>
    </div>
  </div>

  ${sections}

  <h2 class="summary-title">ملخص الأقسام والإجمالي العام</h2>
  <table class="summary">
    <thead>
      <tr>
        <th>القسم</th>
        <th>عدد الطلبة</th>
        <th>القسط الكلي</th>
        <th>التخفيض</th>
        <th>بعد التخفيض</th>
        <th>المسدد</th>
        <th>المتبقي</th>
        <th>الإجمالي المستحصل</th>
        <th>الوصولات</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRows}
      <tr class="grand">
        <td class="name">الإجمالي العام</td>
        <td>${data.totals.students}</td>
        <td dir="ltr">${money(data.totals.annual_fee)}</td>
        <td dir="ltr">${money(data.totals.discount_amount)}</td>
        <td dir="ltr">${money(data.totals.net_fee)}</td>
        <td dir="ltr">${money(data.totals.paid_current_year)}</td>
        <td dir="ltr">${money(data.totals.remaining_current_year)}</td>
        <td dir="ltr">${money(data.totals.total_collected)}</td>
        <td>${data.totals.receipts_count}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    وثيقة رسمية صادرة من نظام حسابات الكلية · جميع المبالغ بالدينار العراقي (IQD)
  </div>
</body>
</html>`;
}

export function printStudentAccountsTable(
  data: StudentAccountsExportData
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const logoUrl = `${window.location.origin}/wasl.png`;
  const html = buildHtml(data, logoUrl);

  const existing = document.getElementById('student-accounts-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'student-accounts-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '0';
  iframe.style.top = '0';
  iframe.style.width = '297mm';
  iframe.style.height = '210mm';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '-1';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    iframe.remove();
    alert('تعذر تجهيز نافذة الطباعة.');
    return;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 2000);
  };

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      alert('تعذر فتح مربع الطباعة.');
    } finally {
      cleanup();
    }
  };

  const logo = frameDoc.querySelector('img');
  if (logo && !(logo as HTMLImageElement).complete) {
    logo.addEventListener('load', () => window.setTimeout(triggerPrint, 200));
    logo.addEventListener('error', () => window.setTimeout(triggerPrint, 200));
    window.setTimeout(triggerPrint, 1200);
  } else {
    window.setTimeout(triggerPrint, 500);
  }
}
