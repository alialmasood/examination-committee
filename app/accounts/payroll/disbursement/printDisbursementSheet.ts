export type DisbursementPrintRow = {
  name: string;
  degree: string;
  position: string;
  salary: number;
  allowances: number;
  subtotal: number;
  social_security: number;
  deductions: number;
  net_payable: number;
};

export type DisbursementPrintData = {
  category_label: string;
  month_label: string;
  year_label: string;
  status_label: string;
  rows: DisbursementPrintRow[];
  people_count: number;
  totals: {
    salary: number;
    allowances: number;
    subtotal: number;
    social_security: number;
    deductions: number;
    net_payable: number;
  };
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
        <td>${escapeHtml(row.degree || '—')}</td>
        <td>${escapeHtml(row.position || '—')}</td>
        <td dir="ltr" class="money">${money(row.salary)}</td>
        <td dir="ltr" class="money">${money(row.allowances)}</td>
        <td dir="ltr" class="money">${money(row.subtotal)}</td>
        <td dir="ltr" class="money">${money(row.social_security)}</td>
        <td dir="ltr" class="money">${money(row.deductions)}</td>
        <td dir="ltr" class="money net">${money(row.net_payable)}</td>
      </tr>`
    )
    .join('');

  const t = data.totals;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>جدول رواتب ${escapeHtml(data.month_label)} ${escapeHtml(data.year_label)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm 8mm 48mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      color: #111827;
      background: #fff;
      font-family: "Tahoma", "Segoe UI", Arial, sans-serif;
      font-size: 10px;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      border-bottom: 2.5px solid #450a0a;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .header-side p { margin: 0; font-size: 11px; color: #374151; line-height: 1.55; }
    .header-side .college { font-weight: 800; color: #450a0a; margin-top: 2px; font-size: 12px; }
    .header-center { text-align: center; }
    .header-center img {
      width: 52px;
      height: 52px;
      object-fit: contain;
      display: block;
      margin: 0 auto 4px;
    }
    .header-center .title {
      margin: 0;
      font-size: 15px;
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
      margin: 0 0 10px;
      padding: 7px 10px;
      background: #fafafa;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      font-size: 10.5px;
    }
    .meta span b { color: #450a0a; }
    table.grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.grid th, table.grid td {
      border: 1px solid #9ca3af;
      padding: 4px 4px;
      text-align: center;
      vertical-align: middle;
      font-size: 9.5px;
    }
    table.grid th {
      background: #450a0a;
      color: #fff;
      font-weight: 700;
      font-size: 9px;
      line-height: 1.35;
    }
    table.grid col.c-num { width: 4%; }
    table.grid col.c-name { width: 18%; }
    table.grid col.c-degree { width: 9%; }
    table.grid col.c-pos { width: 9%; }
    table.grid col.c-sal { width: 9%; }
    table.grid col.c-all { width: 9%; }
    table.grid col.c-sub { width: 9%; }
    table.grid col.c-ss { width: 8%; }
    table.grid col.c-ded { width: 9%; }
    table.grid col.c-net { width: 10%; }
    table.grid td.name { text-align: right; font-weight: 600; }
    table.grid td.money { font-weight: 700; font-variant-numeric: tabular-nums; }
    table.grid td.net { color: #14532d; }
    table.grid tbody tr:nth-child(even) td { background: #f9fafb; }
    table.grid tfoot td {
      background: #fef3c7;
      font-weight: 800;
      color: #451a03;
      border-color: #92400e;
      font-size: 9.5px;
    }
    .page-bottom {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 4px 0 0;
      background: #fff;
    }
    .note {
      margin: 8px 0 4px;
      padding: 4px 0 0;
      border: none;
      border-top: 1px solid #d1d5db;
      font-size: 8.5px;
      color: #4b5563;
      line-height: 1.5;
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
      font-size: 10.5px;
      margin-bottom: 22px;
    }
    .sig .line {
      border-top: 1px solid #111827;
      margin: 0 auto;
      width: 78%;
      padding-top: 4px;
      font-size: 8.5px;
      color: #6b7280;
    }
    .sig.dean .role { color: #7f1d1d; }
    .footer {
      margin-top: 3px;
      padding-top: 0;
      border-top: none;
      text-align: center;
      font-size: 8px;
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
    <span>صافي المستحق الكلي: <b dir="ltr">${money(t.net_payable)}</b></span>
  </div>

  <table class="grid">
    <colgroup>
      <col class="c-num" />
      <col class="c-name" />
      <col class="c-degree" />
      <col class="c-pos" />
      <col class="c-sal" />
      <col class="c-all" />
      <col class="c-sub" />
      <col class="c-ss" />
      <col class="c-ded" />
      <col class="c-net" />
    </colgroup>
    <thead>
      <tr>
        <th>التسلسل</th>
        <th>الاسم</th>
        <th>الشهادة</th>
        <th>المنصب</th>
        <th>الراتب</th>
        <th>المخصصات</th>
        <th>المجموع</th>
        <th>الضمان 5%</th>
        <th>الاستقطاعات</th>
        <th>المستحق</th>
      </tr>
    </thead>
    <tbody>
      ${body || `<tr><td colspan="10">لا توجد بيانات</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4">المجموع الكلي</td>
        <td dir="ltr">${money(t.salary)}</td>
        <td dir="ltr">${money(t.allowances)}</td>
        <td dir="ltr">${money(t.subtotal)}</td>
        <td dir="ltr">${money(t.social_security)}</td>
        <td dir="ltr">${money(t.deductions)}</td>
        <td dir="ltr">${money(t.net_payable)}</td>
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
      الضمان يحسب بنسبة 5% من الراتب الأساسي، والمخصصات تشمل التكليفات إن وجدت، والمستحق = المجموع − الضمان − الاستقطاعات.
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
