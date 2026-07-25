import { feeYearLabel, type FeeYear, type YearLedger } from '../lib/settlementYearLedger';

export type FinancialReportReceipt = {
  id?: string;
  receipt_number: string;
  settlement_date: string;
  annual_fee?: number | string | null;
  discount_mode?: string | null;
  discount_amount?: number | string | null;
  after_discount?: number | string | null;
  pay_amount: number | string;
  remaining_amount?: number | string | null;
  periods?: number | string | null;
  per_period_amount?: number | string | null;
  fee_year?: number | string | null;
  created_at?: string | null;
};

export type StudentFinancialReportData = {
  name: string;
  universityId: string;
  college: string;
  department: string;
  studyType: string;
  stage: string;
  academicYear: string;
  duration: string;
  totalInstallment: number;
  paidAmount: number;
  remaining: number;
  paidInstallmentsCount: number;
  ledger: YearLedger;
  receipts: FinancialReportReceipt[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(value);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

function discountModeLabel(mode?: string | null): string {
  switch (mode) {
    case 'amount':
      return 'خصم بمبلغ';
    case 'percent':
      return 'خصم بنسبة مئوية';
    default:
      return 'بدون خصم';
  }
}

function yearStatusLabel(status: string): string {
  if (status === 'completed') return 'مكتملة';
  if (status === 'current') return 'جارية';
  return 'لم تبدأ';
}

function todayLabel(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
}

function buildReportHtml(data: StudentFinancialReportData, logoUrl: string): string {
  const receiptsByYear = ([1, 2, 3, 4] as FeeYear[]).map((year) => {
    const ledgerYear = data.ledger.years.find((entry) => entry.year === year);
    return {
      year,
      label: feeYearLabel(year),
      status: ledgerYear?.status || 'pending',
      target: ledgerYear?.target ?? data.totalInstallment,
      paid: ledgerYear?.paid ?? 0,
      remaining: ledgerYear?.remaining ?? data.totalInstallment,
      items: data.receipts.filter(
        (receipt) => Math.max(1, Math.min(4, toNumber(receipt.fee_year, 1))) === year
      ),
    };
  });

  const yearsSummaryRows = data.ledger.years
    .map(
      (y) => `<tr>
        <td>${escapeHtml(y.label)}</td>
        <td>${escapeHtml(yearStatusLabel(y.status))}</td>
        <td dir="ltr">${escapeHtml(money(y.target))} IQD</td>
        <td dir="ltr">${escapeHtml(money(y.paid))} IQD</td>
        <td dir="ltr">${escapeHtml(money(y.remaining))} IQD</td>
        <td>${escapeHtml(String(y.receiptsCount))}</td>
      </tr>`
    )
    .join('');

  const yearSections = receiptsByYear
    .map((group) => {
      const receiptRows =
        group.items.length > 0
          ? group.items
              .map((receipt, index) => {
                const periods = toNumber(receipt.periods, 1);
                const hasDiscount =
                  receipt.discount_mode !== 'none' &&
                  toNumber(receipt.discount_amount) > 0;
                return `<tr>
                  <td>${index + 1}</td>
                  <td dir="ltr">${escapeHtml(receipt.receipt_number)}</td>
                  <td>${escapeHtml(formatDate(receipt.settlement_date))}</td>
                  <td dir="ltr">${escapeHtml(money(toNumber(receipt.pay_amount)))} IQD</td>
                  <td dir="ltr">${escapeHtml(money(toNumber(receipt.remaining_amount)))} IQD</td>
                  <td>${
                    periods === 1 ? 'فترة واحدة' : `${periods} فترات`
                  }</td>
                  <td>${
                    hasDiscount
                      ? `${escapeHtml(discountModeLabel(receipt.discount_mode))} · ${escapeHtml(money(toNumber(receipt.discount_amount)))} IQD`
                      : 'بدون خصم'
                  }</td>
                </tr>`;
              })
              .join('')
          : `<tr><td colspan="7" class="empty">لا توجد وصولات ضمن ${escapeHtml(group.label)}</td></tr>`;

      return `
        <section class="year-block">
          <div class="year-head">
            <div>
              <h3>ملف ${escapeHtml(group.label)}</h3>
              <p>${escapeHtml(yearStatusLabel(group.status))} · ${group.items.length} وصل</p>
            </div>
            <div class="year-money">
              <span>مستحق: <b dir="ltr">${escapeHtml(money(group.target))} IQD</b></span>
              <span>مدفوع: <b dir="ltr">${escapeHtml(money(group.paid))} IQD</b></span>
              <span>متبقي: <b dir="ltr">${escapeHtml(money(group.remaining))} IQD</b></span>
            </div>
          </div>
          <table class="data">
            <thead>
              <tr>
                <th>#</th>
                <th>رقم الوصل</th>
                <th>التاريخ</th>
                <th>المدفوع</th>
                <th>المتبقي بعد الدفعة</th>
                <th>الفترات</th>
                <th>الخصم</th>
              </tr>
            </thead>
            <tbody>${receiptRows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>سيرة مالية — ${escapeHtml(data.name)}</title>
  <style>
    @page {
      size: A4;
      margin: 12mm;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 210mm;
      background: #fff;
      color: #111827;
      font-family: "Tahoma", "Segoe UI", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.45;
    }
    .sheet {
      width: 186mm;
      margin: 0 auto;
      padding: 0;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 10px;
      border-bottom: 2px solid #450a0a;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .header-side .line {
      margin: 0;
      font-size: 11px;
      color: #374151;
    }
    .header-side .college {
      font-weight: 700;
      color: #450a0a;
      margin-top: 2px;
    }
    .header-center {
      text-align: center;
    }
    .header-center img {
      width: 54px;
      height: 54px;
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
      margin: 2px 0 0;
      font-size: 10px;
      color: #6b7280;
    }
    .header-right {
      text-align: left;
      font-size: 10px;
      color: #374151;
    }
    .header-right .value {
      font-weight: 700;
      color: #111827;
    }
    .section-title {
      margin: 14px 0 6px;
      padding: 5px 8px;
      background: #450a0a;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }
    table.info, table.summary, table.data {
      width: 100%;
      border-collapse: collapse;
    }
    table.info th,
    table.info td {
      border: 1px solid #d1d5db;
      padding: 6px 8px;
      text-align: right;
      vertical-align: top;
    }
    table.info th {
      width: 28%;
      background: #f9fafb;
      color: #4b5563;
      font-weight: 600;
    }
    table.summary th,
    table.summary td,
    table.data th,
    table.data td {
      border: 1px solid #d1d5db;
      padding: 5px 6px;
      text-align: center;
      vertical-align: middle;
    }
    table.summary th,
    table.data th {
      background: #f3f4f6;
      color: #374151;
      font-weight: 700;
      font-size: 10px;
    }
    table.data td.empty {
      color: #6b7280;
      font-style: italic;
      padding: 10px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-top: 6px;
    }
    .card {
      border: 1px solid #d1d5db;
      border-radius: 4px;
      padding: 8px;
      background: #fff;
    }
    .card .label {
      font-size: 9px;
      color: #6b7280;
      margin-bottom: 3px;
    }
    .card .value {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
    }
    .card.success { background: #ecfdf5; border-color: #a7f3d0; }
    .card.warning { background: #fffbeb; border-color: #fde68a; }
    .year-block {
      margin-top: 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .year-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      padding: 7px 9px;
    }
    .year-head h3 {
      margin: 0;
      font-size: 12px;
      color: #450a0a;
    }
    .year-head p {
      margin: 2px 0 0;
      font-size: 9px;
      color: #6b7280;
    }
    .year-money {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 9px;
      color: #374151;
    }
    .note {
      margin-top: 12px;
      border: 1px dashed #9ca3af;
      padding: 8px;
      font-size: 9.5px;
      color: #4b5563;
      background: #f9fafb;
    }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 28px;
      text-align: center;
      font-size: 10px;
      color: #374151;
    }
    .signatures .line {
      border-top: 1px solid #6b7280;
      margin-top: 34px;
      padding-top: 4px;
      font-weight: 700;
    }
    .footer {
      margin-top: 14px;
      text-align: center;
      font-size: 9px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 6px;
    }
    @media print {
      html, body { width: 210mm; }
      .year-block { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="header-side">
        <p class="line">وزارة التعليم العالي والبحث العلمي</p>
        <p class="line college">${escapeHtml(data.college)}</p>
      </div>
      <div class="header-center">
        <img src="${escapeHtml(logoUrl)}" alt="شعار الكلية" />
        <p class="title">سيرة مالية للطالب</p>
        <p class="sub">تقرير حسابات رسمي</p>
      </div>
      <div class="header-right">
        <div>تاريخ الطباعة: <span class="value">${escapeHtml(todayLabel())}</span></div>
        <div>رقم الطالب: <span class="value" dir="ltr">${escapeHtml(data.universityId)}</span></div>
        <div>العام الدراسي: <span class="value">${escapeHtml(data.academicYear)}</span></div>
      </div>
    </div>

    <div class="section-title">البيانات الأساسية للطالب</div>
    <table class="info">
      <tr><th>اسم الطالب</th><td>${escapeHtml(data.name)}</td></tr>
      <tr><th>رقم الطالب</th><td dir="ltr">${escapeHtml(data.universityId)}</td></tr>
      <tr><th>الكلية</th><td>${escapeHtml(data.college)}</td></tr>
      <tr><th>القسم</th><td>${escapeHtml(data.department)}</td></tr>
      <tr><th>نوع الدراسة</th><td>${escapeHtml(data.studyType)}</td></tr>
      <tr><th>المرحلة</th><td>${escapeHtml(data.stage)}</td></tr>
      <tr><th>مدة القسط</th><td>${escapeHtml(data.duration)}</td></tr>
      <tr><th>عدد التسديدات المسجّلة</th><td>${escapeHtml(String(data.paidInstallmentsCount))}</td></tr>
    </table>

    <div class="section-title">الملخص المالي</div>
    <div class="cards">
      <div class="card">
        <div class="label">القسط السنوي</div>
        <div class="value" dir="ltr">${escapeHtml(money(data.totalInstallment))} IQD</div>
      </div>
      <div class="card success">
        <div class="label">إجمالي المدفوع (كل السنوات)</div>
        <div class="value" dir="ltr">${escapeHtml(money(data.paidAmount))} IQD</div>
      </div>
      <div class="card warning">
        <div class="label">متبقي السنة الجارية</div>
        <div class="value" dir="ltr">${escapeHtml(money(data.remaining))} IQD</div>
      </div>
      <div class="card">
        <div class="label">حالة السنوات</div>
        <div class="value" style="font-size:11px">
          ${
            data.ledger.currentYear
              ? escapeHtml(`الجارية: ${feeYearLabel(data.ledger.currentYear)}`)
              : 'اكتملت السنوات الأربع'
          }
        </div>
      </div>
    </div>

    <div class="section-title">تفصيل السنوات الأربع</div>
    <table class="summary">
      <thead>
        <tr>
          <th>السنة</th>
          <th>الحالة</th>
          <th>المستحق</th>
          <th>المدفوع</th>
          <th>المتبقي</th>
          <th>عدد الوصولات</th>
        </tr>
      </thead>
      <tbody>${yearsSummaryRows}</tbody>
    </table>

    <div class="section-title">تفصيل التسديدات والوصولات</div>
    ${yearSections}

    <div class="note">
      يُعد هذا المستند سيرة مالية رسمية لحساب الطالب لدى شعبة الحسابات، ويشمل البيانات الأساسية والملخص المالي وتفصيل السنوات والوصولات المسجّلة حتى تاريخ الطباعة.
      لا يُعتمد المستند بدون ختم شعبة الحسابات وتوقيع المحاسب المختص.
    </div>

    <div class="signatures">
      <div><div class="line">توقيع الطالب / ولي الأمر</div></div>
      <div><div class="line">المحاسب المسؤول</div></div>
      <div><div class="line">ختم شعبة الحسابات</div></div>
    </div>

    <div class="footer">
      وثيقة رسمية صادرة من نظام حسابات الكلية · سيرة مالية للطالب · ${escapeHtml(data.universityId)}
    </div>
  </div>
</body>
</html>`;
}

export function printStudentFinancialReport(data: StudentFinancialReportData): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const logoUrl = `${window.location.origin}/wasl.png`;
  const html = buildReportHtml(data, logoUrl);

  const existing = document.getElementById('student-financial-report-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'student-financial-report-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '0';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
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
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
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
    logo.addEventListener('load', () => window.setTimeout(triggerPrint, 150));
    logo.addEventListener('error', () => window.setTimeout(triggerPrint, 150));
    window.setTimeout(triggerPrint, 800);
  } else {
    window.setTimeout(triggerPrint, 400);
  }
}
