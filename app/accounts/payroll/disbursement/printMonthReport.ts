export type MonthReportLine = {
  person_code: string;
  person_name: string;
  academic_title: string | null;
  degree: string | null;
  department_name: string | null;
  base_amount: string;
  assignments_total: string;
  grand_total: string;
};

export type MonthReportComparisonChange = {
  person_name: string;
  reason: string;
  previous_total: string;
  current_total: string;
  diff: string;
};

export type MonthReportCategoryComparison = {
  direction: 'higher' | 'lower' | 'equal';
  previous_total: string;
  current_total: string;
  diff: string;
  changes: MonthReportComparisonChange[];
};

export type MonthReportCategory = {
  person_category: string;
  category_label: string;
  status: string;
  status_label: string;
  people_count: number;
  entered_count: number;
  base_total: string;
  assignments_total: string;
  grand_total: string;
  lines: MonthReportLine[];
  comparison: MonthReportCategoryComparison | null;
};

export type MonthReportData = {
  month_label: string;
  year_label: string;
  fiscal_year_code: string;
  month_status_label: string;
  categories: MonthReportCategory[];
  totals: {
    people_count: number;
    entered_count: number;
    base_total: string;
    assignments_total: string;
    grand_total: string;
  };
  previous_comparison: {
    previous_month_label: string;
    previous_total: string;
    current_total: string;
    diff: string;
    direction: 'higher' | 'lower' | 'equal';
  } | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(v: string | number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(v || 0));
}

function todayLabel(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${now.getFullYear()}`;
}

function buildCategorySection(cat: MonthReportCategory): string {
  if (cat.lines.length === 0) {
    return `<section class="cat">
      <h2 class="cat-title">
        <span>${escapeHtml(cat.category_label)}</span>
        <span class="cat-meta">لا توجد بيانات</span>
      </h2>
    </section>`;
  }

  const rows = cat.lines
    .map(
      (line, index) => `<tr>
        <td>${index + 1}</td>
        <td class="name">${escapeHtml(line.person_name)}</td>
        <td>${escapeHtml(line.academic_title || '—')}</td>
        <td>${escapeHtml(line.degree || '—')}</td>
        <td class="name">${escapeHtml(line.department_name || '—')}</td>
        <td dir="ltr" class="money">${money(line.base_amount)}</td>
        <td dir="ltr" class="money">${money(line.assignments_total)}</td>
        <td dir="ltr" class="money strong">${money(line.grand_total)}</td>
      </tr>`
    )
    .join('');

  return `<section class="cat">
    <h2 class="cat-title">
      <span>${escapeHtml(cat.category_label)}</span>
      <span class="cat-meta">
        ${cat.people_count} اسم — حالة الكشف: ${escapeHtml(cat.status_label)}
      </span>
    </h2>
    <table class="grid">
      <colgroup>
        <col class="c-num" /><col class="c-name" /><col class="c-title" />
        <col class="c-degree" /><col class="c-dept" /><col class="c-money" />
        <col class="c-money" /><col class="c-money" />
      </colgroup>
      <thead>
        <tr>
          <th>ت</th>
          <th>الاسم</th>
          <th>اللقب العلمي</th>
          <th>الشهادة</th>
          <th>القسم</th>
          <th>الراتب الأساسي</th>
          <th>التكليفات</th>
          <th>الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="subtotal">
          <td colspan="5">مجموع ${escapeHtml(cat.category_label)}</td>
          <td dir="ltr">${money(cat.base_total)}</td>
          <td dir="ltr">${money(cat.assignments_total)}</td>
          <td dir="ltr">${money(cat.grand_total)}</td>
        </tr>
      </tfoot>
    </table>
  </section>`;
}

function buildComparisonSection(data: MonthReportData): string {
  const cmp = data.previous_comparison;
  if (!cmp) return '';

  const directionText =
    cmp.direction === 'equal'
      ? `إجمالي هذا الشهر مطابق لإجمالي شهر ${escapeHtml(cmp.previous_month_label)}`
      : `إجمالي رواتب هذا الشهر ${cmp.direction === 'higher' ? 'أعلى' : 'أقل'} من شهر ${escapeHtml(
          cmp.previous_month_label
        )} بمبلغ ${money(Math.abs(Number(cmp.diff)))}`;

  const rows = data.categories
    .filter((c) => c.comparison)
    .map((c) => {
      const cc = c.comparison!;
      const d = Number(cc.diff);
      const sign = d > 0 ? '+' : d < 0 ? '−' : '';
      return `<tr>
        <td class="name">${escapeHtml(c.category_label)}</td>
        <td dir="ltr">${money(cc.previous_total)}</td>
        <td dir="ltr">${money(cc.current_total)}</td>
        <td dir="ltr" class="strong ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${sign}${money(
          Math.abs(d)
        )}</td>
      </tr>`;
    })
    .join('');

  const reasonBlocks = data.categories
    .filter((c) => c.comparison && c.comparison.changes.length > 0)
    .map((c) => {
      const items = c
        .comparison!.changes.slice(0, 6)
        .map((ch) => {
          const d = Number(ch.diff);
          const sign = d > 0 ? '+' : '−';
          return `<li>
            <b>${escapeHtml(ch.person_name)}</b> — ${escapeHtml(ch.reason)}
            <span dir="ltr">(${sign}${money(Math.abs(d))})</span>
          </li>`;
        })
        .join('');
      const more =
        c.comparison!.changes.length > 6
          ? `<li class="more">و${c.comparison!.changes.length - 6} تغييرات أخرى</li>`
          : '';
      return `<div class="cmp-reasons">
        <div class="cmp-reasons-title">أسباب التغير — ${escapeHtml(c.category_label)}</div>
        <ul>${items}${more}</ul>
      </div>`;
    })
    .join('');

  return `
  <h2 class="summary-title">مقارنة مع شهر ${escapeHtml(cmp.previous_month_label)}</h2>
  <p class="cmp-lead">${directionText}.</p>
  <table class="summary">
    <thead>
      <tr>
        <th>الفئة</th>
        <th>إجمالي شهر ${escapeHtml(cmp.previous_month_label)}</th>
        <th>إجمالي هذا الشهر</th>
        <th>الفرق</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="grand">
        <td>المجموع الكلي</td>
        <td dir="ltr">${money(cmp.previous_total)}</td>
        <td dir="ltr">${money(cmp.current_total)}</td>
        <td dir="ltr">${Number(cmp.diff) > 0 ? '+' : Number(cmp.diff) < 0 ? '−' : ''}${money(
          Math.abs(Number(cmp.diff))
        )}</td>
      </tr>
    </tfoot>
  </table>
  ${reasonBlocks}`;
}

function buildHtml(data: MonthReportData, logoUrl: string): string {
  const sections = data.categories.map(buildCategorySection).join('');

  const summaryRows = data.categories
    .map(
      (cat) => `<tr>
        <td class="name">${escapeHtml(cat.category_label)}</td>
        <td>${cat.people_count}</td>
        <td dir="ltr">${money(cat.base_total)}</td>
        <td dir="ltr">${money(cat.assignments_total)}</td>
        <td dir="ltr" class="strong">${money(cat.grand_total)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>تقرير رواتب ${escapeHtml(data.month_label)} ${escapeHtml(data.year_label)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm 58mm; }
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
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .header-side p { margin: 0; font-size: 10.5px; color: #374151; line-height: 1.55; }
    .header-side .college { font-weight: 800; color: #450a0a; margin-top: 2px; font-size: 11.5px; }
    .header-center { text-align: center; }
    .header-center img {
      width: 56px; height: 56px; object-fit: contain;
      display: block; margin: 0 auto 4px;
    }
    .header-center .title { margin: 0; font-size: 15px; font-weight: 800; color: #450a0a; }
    .header-center .sub { margin: 3px 0 0; font-size: 10.5px; color: #4b5563; font-weight: 600; }
    .header-left { text-align: left; font-size: 10px; color: #374151; line-height: 1.6; }
    .header-left b { color: #111827; }
    .meta {
      display: flex; flex-wrap: wrap; gap: 6px 16px;
      margin: 0 0 10px; padding: 7px 9px;
      background: #fafafa; border: 1px solid #e5e7eb; border-radius: 4px;
      font-size: 10px;
    }
    .meta b { color: #450a0a; }
    .cat { margin-bottom: 12px; }
    .cat-title {
      display: flex; justify-content: space-between; align-items: center;
      margin: 0 0 4px; padding: 5px 8px;
      background: #450a0a; color: #fff;
      font-size: 11px; font-weight: 800;
    }
    .cat-meta { font-size: 9.5px; font-weight: 600; opacity: .92; }
    table.grid, table.summary { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.grid th, table.grid td,
    table.summary th, table.summary td {
      border: 1px solid #9ca3af;
      padding: 4px 5px;
      text-align: center;
      vertical-align: middle;
    }
    table.grid th, table.summary th {
      background: #f3f4f6; color: #1f2937; font-weight: 700; font-size: 9.5px;
    }
    table.grid col.c-num { width: 5%; }
    table.grid col.c-name { width: 21%; }
    table.grid col.c-title { width: 11%; }
    table.grid col.c-degree { width: 11%; }
    table.grid col.c-dept { width: 16%; }
    table.grid col.c-money { width: 12%; }
    td.name { text-align: right; font-weight: 600; }
    td.money { font-variant-numeric: tabular-nums; }
    td.strong { font-weight: 800; }
    table.grid tbody tr:nth-child(even) td { background: #f9fafb; }
    tr.subtotal td {
      background: #fef3c7; font-weight: 800; color: #451a03; border-color: #92400e;
    }
    .summary-title {
      margin: 14px 0 5px; padding: 5px 8px;
      background: #1f2937; color: #fff; font-size: 11px; font-weight: 800;
    }
    tr.grand td { background: #450a0a; color: #fff; font-weight: 800; }
    td.pos { color: #065f46; }
    td.neg { color: #991b1b; }
    .cmp-lead { margin: 0 0 6px; font-size: 10px; color: #374151; font-weight: 600; }
    .cmp-reasons { margin-top: 7px; }
    .cmp-reasons-title {
      font-size: 9.5px; font-weight: 800; color: #450a0a; margin-bottom: 2px;
    }
    .cmp-reasons ul { margin: 0; padding-right: 14px; }
    .cmp-reasons li { font-size: 9px; color: #374151; line-height: 1.6; }
    .cmp-reasons li.more { color: #6b7280; list-style: none; }
    .page-bottom {
      position: fixed; left: 0; right: 0; bottom: 0;
      padding: 6px 0 0; background: #fff;
    }
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .sig { text-align: center; padding-top: 2px; }
    .sig .role { font-weight: 800; color: #450a0a; font-size: 11px; margin-bottom: 26px; }
    .sig .line {
      border-top: 1px solid #111827; margin: 0 auto; width: 78%;
      padding-top: 4px; font-size: 9px; color: #6b7280;
    }
    .sig.dean .role { color: #7f1d1d; }
    .note {
      margin: 10px 0 4px; padding: 5px 0 0;
      border-top: 1px solid #d1d5db;
      font-size: 9px; color: #4b5563; line-height: 1.55; text-align: center;
    }
    .footer { margin-top: 3px; text-align: center; font-size: 8.5px; color: #6b7280; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    section.cat { page-break-inside: auto; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
      <p class="title">تقرير رواتب شهر ${escapeHtml(data.month_label)}</p>
      <p class="sub">تقرير مفصّل لجميع فئات الصرف</p>
    </div>
    <div class="header-left">
      <div>تاريخ الطباعة: <b>${escapeHtml(todayLabel())}</b></div>
      <div>الشهر: <b>${escapeHtml(data.month_label)} ${escapeHtml(data.year_label)}</b></div>
      <div>السنة المالية: <b>${escapeHtml(data.fiscal_year_code)}</b></div>
    </div>
  </div>

  <div class="meta">
    <span>حالة الشهر: <b>${escapeHtml(data.month_status_label)}</b></span>
    <span>إجمالي الأسماء: <b>${data.totals.people_count}</b></span>
    <span>الرواتب الأساسية: <b dir="ltr">${money(data.totals.base_total)}</b></span>
    <span>التكليفات: <b dir="ltr">${money(data.totals.assignments_total)}</b></span>
    <span>الإجمالي الكلي: <b dir="ltr">${money(data.totals.grand_total)}</b></span>
  </div>

  ${sections}

  <h2 class="summary-title">ملخص أوجه الصرف للشهر</h2>
  <table class="summary">
    <thead>
      <tr>
        <th>الفئة</th>
        <th>عدد الأسماء</th>
        <th>الرواتب الأساسية</th>
        <th>التكليفات</th>
        <th>الإجمالي</th>
      </tr>
    </thead>
    <tbody>${summaryRows}</tbody>
    <tfoot>
      <tr class="grand">
        <td>المجموع الكلي</td>
        <td>${data.totals.people_count}</td>
        <td dir="ltr">${money(data.totals.base_total)}</td>
        <td dir="ltr">${money(data.totals.assignments_total)}</td>
        <td dir="ltr">${money(data.totals.grand_total)}</td>
      </tr>
    </tfoot>
  </table>

  ${buildComparisonSection(data)}

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
      يُعد هذا التقرير مستنداً رسمياً يوضح تفاصيل صرف رواتب شهر
      <b>${escapeHtml(data.month_label)}</b> / <b>${escapeHtml(data.year_label)}</b>
      لجميع الفئات. بعد تدقيق المحاسب ومدير الحسابات يُرسل إلى السيد عميد الكلية لغرض التوقيع والاعتماد.
    </div>
    <div class="footer">
      نظام الحسابات — كلية الشرق للعلوم التقنية التخصصية —
    </div>
  </div>
</body>
</html>`;
}

export function printMonthReport(data: MonthReportData): void {
  if (typeof window === 'undefined') return;

  const logoUrl = `${window.location.origin}/wasl.png`;
  const html = buildHtml(data, logoUrl);

  const existing = document.getElementById('payroll-month-report-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'payroll-month-report-print-frame';
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
    logo.addEventListener('load', () => window.setTimeout(triggerPrint, 250));
    logo.addEventListener('error', () => window.setTimeout(triggerPrint, 250));
  } else {
    window.setTimeout(triggerPrint, 250);
  }
}
