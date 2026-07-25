export type SettlementPrintReceipt = {
  receipt_number: string;
  university_id?: string | null;
  student_name?: string | null;
  department?: string | null;
  study_type?: string | null;
  admission_type?: string | null;
  settlement_date: string;
  annual_fee: number | string;
  four_years_total?: number | string;
  discount_mode?: string | null;
  discount_years?: number | string;
  discount_base?: number | string;
  discount_amount?: number | string;
  after_discount?: number | string;
  pay_amount: number | string;
  remaining_amount?: number | string;
  periods?: number | string;
  per_period_amount?: number | string;
  fee_year?: number | string | null;
};

export type ReceiptPaperSize = 'A4' | 'A5';

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

function formatStage(admissionType?: string | null): string {
  switch (admissionType) {
    case 'first':
      return 'الأولى';
    case 'second':
      return 'الثانية';
    case 'third':
      return 'الثالثة';
    case 'fourth':
      return 'الرابعة';
    default:
      return 'غير محدد';
  }
}

function formatStudyType(studyType?: string | null): string {
  switch (String(studyType || '').toLowerCase()) {
    case 'morning':
    case 'صباحي':
      return 'صباحي';
    case 'evening':
    case 'مسائي':
      return 'مسائي';
    default:
      return studyType?.trim() || 'غير محدد';
  }
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

function discountYearsLabel(years: number): string {
  if (years <= 1) return 'من القسط السنوي (سنة واحدة)';
  if (years === 2) return 'من قسط سنتين';
  if (years === 3) return 'من قسط 3 سنوات';
  return 'من قسط 4 سنوات';
}

const ONES = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const TENS = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];
const HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

function belowThousand(n: number): string {
  if (n <= 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    if (!o) return TENS[t];
    return `${ONES[o]} و${TENS[t]}`;
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!rest) return HUNDREDS[h];
  return `${HUNDREDS[h]} و${belowThousand(rest)}`;
}

/** تفقيط مبسّط للمبالغ الصحيحة بالدينار العراقي */
export function amountInArabicWords(amount: number): string {
  const n = Math.round(Math.abs(amount || 0));
  if (n === 0) return 'صفر دينار عراقي فقط لا غير';

  const parts: string[] = [];
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  if (billions) {
    if (billions === 1) parts.push('مليار');
    else if (billions === 2) parts.push('ملياران');
    else if (billions >= 3 && billions <= 10)
      parts.push(`${belowThousand(billions)} مليارات`);
    else parts.push(`${belowThousand(billions)} مليار`);
  }
  if (millions) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else if (millions >= 3 && millions <= 10)
      parts.push(`${belowThousand(millions)} ملايين`);
    else parts.push(`${belowThousand(millions)} مليون`);
  }
  if (thousands) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands >= 3 && thousands <= 10)
      parts.push(`${belowThousand(thousands)} آلاف`);
    else parts.push(`${belowThousand(thousands)} ألف`);
  }
  if (rest) parts.push(belowThousand(rest));

  return `${parts.join(' و')} دينار عراقي فقط لا غير`;
}

export function buildSettlementReceiptPrintHtml(
  receipt: SettlementPrintReceipt,
  paperSize: ReceiptPaperSize,
  logoUrl = '/wasl.png'
): string {
  const pay = toNumber(receipt.pay_amount);
  const remaining = toNumber(receipt.remaining_amount);
  const periods = toNumber(receipt.periods, 1);
  const discountYears = toNumber(receipt.discount_years, 1);
  const hasDiscount =
    receipt.discount_mode !== 'none' && toNumber(receipt.discount_amount) > 0;
  const isA5 = paperSize === 'A5';
  const pageW = isA5 ? '148mm' : '210mm';
  const pageH = isA5 ? '210mm' : '297mm';
  const pageMargin = isA5 ? '5mm' : '8mm';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>وصل تسديد ${escapeHtml(receipt.receipt_number)}</title>
  <style>
    @page {
      size: ${pageW} ${pageH};
      margin: 0;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${pageW};
      height: ${pageH};
      overflow: hidden;
      background: #fff;
      font-family: "Traditional Arabic", "Segoe UI", Tahoma, Arial, sans-serif;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; }
    .sheet {
      width: ${pageW};
      height: ${pageH};
      margin: 0;
      padding: ${pageMargin};
      display: flex;
      flex-direction: column;
    }
    .inner {
      flex: 1;
      min-height: 0;
      border: 2px solid #7f1d1d;
      padding: 2px;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .frame {
      flex: 1;
      min-height: 0;
      border: 1px solid #b91c1c;
      padding: ${isA5 ? '5mm 4mm' : '7mm 6mm'};
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0.055;
      font-size: ${isA5 ? '36px' : '56px'};
      font-weight: 700;
      color: #7f1d1d;
      transform: rotate(-18deg);
      z-index: 0;
    }
    .content {
      position: relative;
      z-index: 1;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .header {
      direction: ltr;
      display: grid;
      grid-template-columns: 1.15fr auto 1.15fr;
      gap: ${isA5 ? '6px' : '10px'};
      align-items: center;
      flex-shrink: 0;
      margin-bottom: ${isA5 ? '6px' : '8px'};
      padding-bottom: ${isA5 ? '5px' : '7px'};
      border-bottom: 1.5px solid #7f1d1d;
    }
    .header-left {
      text-align: left;
      direction: rtl;
    }
    .header-left .line {
      margin: 0;
      font-size: ${isA5 ? '10px' : '12px'};
      color: #374151;
      line-height: 1.45;
      font-weight: 600;
    }
    .header-left .college {
      margin-top: 2px;
      font-size: ${isA5 ? '11px' : '13px'};
      color: #7f1d1d;
      font-weight: 800;
    }
    .header-center {
      text-align: center;
      min-width: ${isA5 ? '58px' : '72px'};
    }
    .header-center img {
      display: block;
      margin: 0 auto;
      width: ${isA5 ? '42px' : '56px'};
      height: ${isA5 ? '42px' : '56px'};
      object-fit: contain;
    }
    .header-center .receipt-title {
      margin: 4px 0 0;
      font-size: ${isA5 ? '13px' : '16px'};
      font-weight: 800;
      color: #7f1d1d;
    }
    .header-right {
      text-align: right;
      direction: rtl;
      font-size: ${isA5 ? '10.5px' : '12px'};
    }
    .header-right .row {
      margin: 0 0 4px;
      line-height: 1.4;
    }
    .header-right .label { color: #6b7280; }
    .header-right .value { font-weight: 700; color: #111; }
    table.info {
      width: 100%;
      border-collapse: collapse;
      font-size: ${isA5 ? '10.5px' : '12px'};
      margin-bottom: ${isA5 ? '5px' : '7px'};
      flex-shrink: 0;
    }
    table.info th, table.info td {
      border: 1px solid #d1d5db;
      padding: ${isA5 ? '3.5px 5px' : '5px 7px'};
      text-align: right;
      vertical-align: top;
    }
    table.info th {
      background: #fef2f2;
      width: 30%;
      font-weight: 700;
      color: #7f1d1d;
    }
    .amount-box {
      border: 2px dashed #7f1d1d;
      background: #fff7ed;
      padding: ${isA5 ? '5px' : '8px 10px'};
      margin: ${isA5 ? '3px 0' : '5px 0'};
      text-align: center;
      flex-shrink: 0;
    }
    .amount-box .title {
      font-size: ${isA5 ? '10px' : '12px'};
      color: #7f1d1d;
      font-weight: 700;
      margin-bottom: 3px;
    }
    .amount-box .num {
      font-size: ${isA5 ? '16px' : '21px'};
      font-weight: 800;
      direction: ltr;
      unicode-bidi: plaintext;
    }
    .amount-box .words {
      margin-top: 3px;
      font-size: ${isA5 ? '10px' : '12px'};
      line-height: 1.4;
      font-weight: 600;
    }
    .note {
      font-size: ${isA5 ? '9px' : '10.5px'};
      color: #374151;
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      padding: ${isA5 ? '4px' : '6px'};
      flex-shrink: 0;
    }
    .spacer { flex: 1 1 auto; min-height: 4px; }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      text-align: center;
      font-size: ${isA5 ? '9.5px' : '11px'};
      flex-shrink: 0;
    }
    .signatures .line {
      border-top: 1px solid #6b7280;
      margin-top: ${isA5 ? '18px' : '28px'};
      padding-top: 4px;
      font-weight: 700;
    }
    .footer {
      margin-top: ${isA5 ? '5px' : '7px'};
      text-align: center;
      font-size: ${isA5 ? '8px' : '9.5px'};
      color: #6b7280;
      flex-shrink: 0;
    }
    @media print {
      html, body, .sheet {
        width: ${pageW} !important;
        height: ${pageH} !important;
      }
      .sheet {
        page-break-after: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="inner">
      <div class="frame">
        <div class="watermark">وصل رسمي</div>
        <div class="content">
          <div class="header">
            <div class="header-left">
              <p class="line">وزارة التعليم العالي والبحث العلمي</p>
              <p class="line college">كلية الشرق للعلوم التقنية التخصصية</p>
            </div>
            <div class="header-center">
              <img src="${escapeHtml(logoUrl)}" alt="شعار الكلية" />
              <p class="receipt-title">وصل قبض</p>
            </div>
            <div class="header-right">
              <p class="row">
                <span class="label">تاريخ التسديد: </span>
                <span class="value">${escapeHtml(formatDate(receipt.settlement_date))}</span>
              </p>
              <p class="row">
                <span class="label">رقم الوصل: </span>
                <span class="value" dir="ltr">${escapeHtml(receipt.receipt_number)}</span>
              </p>
              <p class="row">
                <span class="label">سنة القسط: </span>
                <span class="value">${escapeHtml(
                  (() => {
                    const y = Number(receipt.fee_year) || 1;
                    if (y === 1) return 'الأولى';
                    if (y === 2) return 'الثانية';
                    if (y === 3) return 'الثالثة';
                    if (y === 4) return 'الرابعة';
                    return String(y);
                  })()
                )}</span>
              </p>
            </div>
          </div>

          <table class="info">
            <tr>
              <th>استلمنا من السيد/ة</th>
              <td>${escapeHtml(receipt.student_name?.trim() || '—')}</td>
            </tr>
            <tr>
              <th>رقم الطالب</th>
              <td dir="ltr">${escapeHtml(receipt.university_id?.trim() || '—')}</td>
            </tr>
            <tr>
              <th>القسم / نوع الدراسة</th>
              <td>${escapeHtml(receipt.department?.trim() || '—')} — ${escapeHtml(formatStudyType(receipt.study_type))}</td>
            </tr>
            <tr>
              <th>المرحلة</th>
              <td>${escapeHtml(formatStage(receipt.admission_type))}</td>
            </tr>
            <tr>
              <th>وذلك عن</th>
              <td>تسديد قسط دراسي / دفعة حساب طالب</td>
            </tr>
            <tr>
              <th>القسط السنوي</th>
              <td dir="ltr">${escapeHtml(money(toNumber(receipt.annual_fee)))} IQD</td>
            </tr>
            <tr>
              <th>بعد الخصم</th>
              <td dir="ltr">${escapeHtml(money(toNumber(receipt.after_discount)))} IQD</td>
            </tr>
            <tr>
              <th>المتبقي بعد هذه الدفعة</th>
              <td dir="ltr">${escapeHtml(money(remaining))} IQD</td>
            </tr>
            <tr>
              <th>مدة التسديد</th>
              <td>${
                periods === 1
                  ? 'فترة واحدة (دفع المبلغ كله)'
                  : `${periods} فترات × ${escapeHtml(money(toNumber(receipt.per_period_amount)))} IQD`
              }</td>
            </tr>
            ${
              hasDiscount
                ? `<tr>
              <th>تفاصيل الخصم</th>
              <td>
                ${escapeHtml(discountModeLabel(receipt.discount_mode))} ·
                ${escapeHtml(discountYearsLabel(discountYears))} ·
                قيمة الخصم:
                <span dir="ltr">${escapeHtml(money(toNumber(receipt.discount_amount)))} IQD</span>
              </td>
            </tr>`
                : ''
            }
          </table>

          <div class="amount-box">
            <div class="title">المبلغ المستلم نقداً / بموجب هذا الوصل</div>
            <div class="num">${escapeHtml(money(pay))} IQD</div>
            <div class="words">${escapeHtml(amountInArabicWords(pay))}</div>
          </div>

          <div class="note">
            يُعد هذا المستند وصلاً رسمياً بإثبات قبض المبلغ المذكور أعلاه لحساب الكلية، ويُعتمد للأغراض المحاسبية والمصرفية.
            لا يُعتبر الوصل نافذاً بدون ختم الحسابات وتوقيع المحاسب المختص.
          </div>

          <div class="spacer"></div>

          <div class="signatures">
            <div><div class="line">توقيع الطالب / ولي الأمر</div></div>
            <div><div class="line">المحاسب المسؤول</div></div>
            <div><div class="line">ختم شعبة الحسابات</div></div>
          </div>

          <div class="footer">
            وثيقة رسمية صادرة من نظام حسابات الكلية · ${escapeHtml(receipt.receipt_number)}
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function printSettlementReceipt(
  receipt: SettlementPrintReceipt,
  paperSize: ReceiptPaperSize
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const logoUrl = `${window.location.origin}/wasl.png`;
  const html = buildSettlementReceiptPrintHtml(receipt, paperSize, logoUrl);
  const isA5 = paperSize === 'A5';
  const pageW = isA5 ? '148mm' : '210mm';
  const pageH = isA5 ? '210mm' : '297mm';

  const existing = document.getElementById('settlement-receipt-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'settlement-receipt-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '0';
  iframe.style.top = '0';
  iframe.style.width = pageW;
  iframe.style.height = pageH;
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

  // انتظار تحميل الشعار قبل الطباعة
  const logo = frameDoc.querySelector('img');
  if (logo && !(logo as HTMLImageElement).complete) {
    logo.addEventListener('load', () => window.setTimeout(triggerPrint, 150));
    logo.addEventListener('error', () => window.setTimeout(triggerPrint, 150));
    window.setTimeout(triggerPrint, 800);
  } else {
    window.setTimeout(triggerPrint, 400);
  }
}
