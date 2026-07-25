export type DisbursementPrintRow = {
  name: string;
  salary: number;
  degree: string;
  academic_title: string;
  department: string;
};

export type DisbursementPrintData = {
  category_label: string;
  month_label: string;
  year_label: string;
  status_label: string;
  rows: DisbursementPrintRow[];
  total_salary: number;
  people_count: number;
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
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(n || 0));
}

function todayLabel(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${now.getFullYear()}`;
}

function buildHtml(data: DisbursementPrintData, logoUrl: string): string {
  const body = data.rows
    .map(
      (row, index) => `<tr>
        <td>${index + 1}</td>
        <td class="name">${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.academic_title || '—')}</td>
        <td>${escapeHtml(row.degree || '—')}</td>
        <td class="name">${escapeHtml(row.department || '—')}</td>
        <td dir="ltr" class="money">${money(row.salary)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>جدول رواتب ${escapeHtml(data.month_label)} ${escapeHtml(data.year_label)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm 62mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      color: #111827;
      background: #fff;
      font-family: "Tahoma", "Segoe UI", Arial, sans-serif;
      font-size: 11px;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      border-bottom: 2.5px solid #450a0a;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .header-side p { margin: 0; font-size: 11px; color: #374151; line-height: 1.55; }
    .header-side .college { font-weight: 800; color: #450a0a; margin-top: 2px; font-size: 12px; }
    .header-center { text-align: center; }
    .header-center img {
      width: 58px;
      height: 58px;
      object-fit: contain;
      display: block;
      margin: 0 auto 4px;
    }
    .header-center .title {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      color: #450a0a;
    }
    .header-center .sub {
      margin: 3px 0 0;
      font-size: 11px;
      color: #4b5563;
      font-weight: 600;
    }
    .header-left {
      text-align: left;
      font-size: 10.5px;
      color: #374151;
      line-height: 1.6;
    }
    .header-left b { color: #111827; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      margin: 0 0 12px;
      padding: 8px 10px;
      background: #fafafa;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      font-size: 11px;
    }
    .meta span b { color: #450a0a; }
    table.grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.grid th, table.grid td {
      border: 1px solid #9ca3af;
      padding: 5px 6px;
      text-align: center;
      vertical-align: middle;
    }
    table.grid th {
      background: #450a0a;
      color: #fff;
      font-weight: 700;
      font-size: 10.5px;
    }
    table.grid col.c-num { width: 6%; }
    table.grid col.c-name { width: 28%; }
    table.grid col.c-title { width: 14%; }
    table.grid col.c-degree { width: 14%; }
    table.grid col.c-dept { width: 20%; }
    table.grid col.c-sal { width: 18%; }
    table.grid td.name { text-align: right; font-weight: 600; }
    table.grid td.money { font-weight: 700; font-variant-numeric: tabular-nums; }
    table.grid tbody tr:nth-child(even) td { background: #f9fafb; }
    table.grid tfoot td {
      background: #fef3c7;
      font-weight: 800;
      color: #451a03;
      border-color: #92400e;
    }
    /* تبقى التواقيع مثبتة في أسفل كل ورقة A4 */
    .page-bottom {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 6px 0 0;
      background: #fff;
    }
    .note {
      margin: 12px 0 6px;
      padding: 5px 0 0;
      border: none;
      border-top: 1px solid #d1d5db;
      font-size: 9px;
      color: #4b5563;
      line-height: 1.55;
      background: transparent;
      text-align: center;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }
    .sig {
      text-align: center;
      padding-top: 2px;
    }
    .sig .role {
      font-weight: 800;
      color: #450a0a;
      font-size: 11px;
      margin-bottom: 28px;
    }
    .sig .line {
      border-top: 1px solid #111827;
      margin: 0 auto;
      width: 78%;
      padding-top: 4px;
      font-size: 9px;
      color: #6b7280;
    }
    .sig.dean .role { color: #7f1d1d; }
    .footer {
      margin-top: 4px;
      padding-top: 0;
      border-top: none;
      text-align: center;
      font-size: 8.5px;
      color: #6b7280;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-bottom {
        position: fixed;
        bottom: 0;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-side">
      <p>وزارة التعليم العالي والبحث العلمي</p>
      <p class="college">كلية الشرق للعلوم التقنية التخصصية</p>
      <p>شعبة الحسابات</p>
    </div>
    <div class="header-center">
      <img src="${escapeHtml(logoUrl)}" alt="شعار الكلية" />
      <p class="title">جدول رواتب الشهر</p>
      <p class="sub">${escapeHtml(data.category_label)}</p>
    </div>
    <div class="header-left">
      <div>تاريخ الطباعة: <b>${escapeHtml(todayLabel())}</b></div>
      <div>الشهر: <b>${escapeHtml(data.month_label)}</b></div>
      <div>السنة المالية: <b>${escapeHtml(data.year_label)}</b></div>
    </div>
  </div>

  <div class="meta">
    <span>عدد الأسماء: <b>${data.people_count}</b></span>
    <span>حالة الكشف: <b>${escapeHtml(data.status_label)}</b></span>
    <span>إجمالي الرواتب: <b dir="ltr">${money(data.total_salary)}</b></span>
  </div>

  <table class="grid">
    <colgroup>
      <col class="c-num" />
      <col class="c-name" />
      <col class="c-title" />
      <col class="c-degree" />
      <col class="c-dept" />
      <col class="c-sal" />
    </colgroup>
    <thead>
      <tr>
        <th>ت</th>
        <th>الاسم</th>
        <th>اللقب العلمي</th>
        <th>الشهادة</th>
        <th>القسم</th>
        <th>الراتب</th>
      </tr>
    </thead>
    <tbody>
      ${body || `<tr><td colspan="6">لا توجد بيانات</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5">المجموع الكلي</td>
        <td dir="ltr">${money(data.total_salary)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="page-bottom">
    <div class="signatures">
      <div class="sig">
        <div class="role">المحاسب</div>
        <div class="line">التوقيع</div>
      </div>
      <div class="sig">
        <div class="role">مدير الحسابات</div>
        <div class="line">التوقيع</div>
      </div>
      <div class="sig dean">
        <div class="role">عميد الكلية</div>
        <div class="line">التوقيع والاعتماد</div>
      </div>
    </div>

    <div class="note">
      يُعد هذا الكشف مستنداً رسمياً لصرف رواتب
      <b>${escapeHtml(data.category_label)}</b>
      عن شهر <b>${escapeHtml(data.month_label)}</b> /
      <b>${escapeHtml(data.year_label)}</b>.
      بعد تدقيق المحاسب ومدير الحسابات يُرسل إلى السيد عميد الكلية لغرض التوقيع والاعتماد.
    </div>

    <div class="footer">
      نظام الحسابات — كلية الشرق للعلوم التقنية التخصصية —
    </div>
  </div>
</body>
</html>`;
}

export function printDisbursementSheet(data: DisbursementPrintData): void {
  if (typeof window === 'undefined') return;

  const logoUrl = `${window.location.origin}/wasl.png`;
  const html = buildHtml(data, logoUrl);

  const existing = document.getElementById('disbursement-sheet-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'disbursement-sheet-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
  const frameWindow = iframe.contentWindow;
  if (!frameDoc || !frameWindow) {
    alert('تعذر تجهيز نافذة الطباعة.');
    return;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      alert('تعذر فتح مربع الطباعة.');
    }
  };

  const logo = frameDoc.querySelector('img');
  if (logo && !(logo as HTMLImageElement).complete) {
    logo.addEventListener('load', () => window.setTimeout(triggerPrint, 200));
    logo.addEventListener('error', () => window.setTimeout(triggerPrint, 200));
  } else {
    window.setTimeout(triggerPrint, 200);
  }
}
