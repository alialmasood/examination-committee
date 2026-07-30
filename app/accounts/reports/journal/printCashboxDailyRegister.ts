import type { CashboxRegisterData } from '@/src/lib/accounts/cashbox-daily-register-types';

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

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const raw = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return String(iso);
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

export function printCashboxDailyRegister(
  data: CashboxRegisterData,
  reportTitle?: string
): void {
  const title = reportTitle || data.title;
  const period =
    data.filters.dateFrom || data.filters.dateTo
      ? `${formatDate(data.filters.dateFrom)} — ${formatDate(data.filters.dateTo)}`
      : 'جميع الفترات';

  const filterBits = [
    data.filters.department ? `القسم: ${data.filters.department}` : '',
    data.filters.stage
      ? `المرحلة: ${
          { first: 'الأولى', second: 'الثانية', third: 'الثالثة', fourth: 'الرابعة' }[
            data.filters.stage
          ] || data.filters.stage
        }`
      : '',
    data.filters.docType === 'receipt'
      ? 'نوع المستند: قبض'
      : data.filters.docType === 'payment'
        ? 'نوع المستند: دفع'
        : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const body = data.rows
    .map(
      (r) => `<tr>
        <td>${r.seq}</td>
        <td class="cash" dir="ltr">${money(r.cash_received)}</td>
        <td dir="ltr">${r.bank_deposit == null ? '—' : money(r.bank_deposit)}</td>
        <td class="name">${escapeHtml(r.statement)}</td>
        <td><span class="badge">${escapeHtml(r.doc_type_label)}</span></td>
        <td>${escapeHtml(formatDate(r.doc_date))}</td>
        <td class="mono" dir="ltr">${escapeHtml(r.doc_number)}</td>
        <td>${r.check_date ? escapeHtml(formatDate(r.check_date)) : '—'}</td>
        <td>${r.check_number ? escapeHtml(r.check_number) : '—'}</td>
        <td>${escapeHtml(r.department)}</td>
        <td>${escapeHtml(r.stage_label)}</td>
        <td>${escapeHtml(r.notes || '—')}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      color: #111827;
      background: #fff;
    }
    .sheet {
      min-height: calc(210mm - 20mm);
      display: flex;
      flex-direction: column;
      padding: 8px 4px 0;
    }
    .main {
      flex: 1 1 auto;
      padding-bottom: 8px;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #7f1d1d;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .header .gov { font-size: 11px; color: #6b7280; margin: 0; }
    .header h1 {
      margin: 4px 0 2px;
      font-size: 18px;
      color: #7f1d1d;
    }
    .header h2 {
      margin: 0;
      font-size: 14px;
      color: #111827;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
      color: #4b5563;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .card {
      border: 1px solid #fecaca;
      background: linear-gradient(180deg, #fff7ed 0%, #fff 100%);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .card .label { font-size: 10px; color: #7f1d1d; }
    .card .value { font-size: 15px; font-weight: 700; margin-top: 2px; }
    .card.green { border-color: #a7f3d0; background: linear-gradient(180deg, #ecfdf5 0%, #fff 100%); }
    .card.green .label { color: #047857; }
    .card.green .value { color: #047857; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
    }
    thead th {
      background: #7f1d1d;
      color: #fff;
      padding: 7px 5px;
      border: 1px solid #991b1b;
      text-align: center;
      font-weight: 700;
    }
    tbody td {
      border: 1px solid #e5e7eb;
      padding: 5px 4px;
      text-align: center;
      vertical-align: middle;
    }
    tbody tr:nth-child(even) { background: #fff7ed; }
    tbody tr:nth-child(odd) { background: #fff; }
    td.name { text-align: right; font-weight: 600; color: #7f1d1d; }
    td.cash { color: #047857; font-weight: 700; }
    td.mono { font-family: ui-monospace, monospace; font-size: 9px; }
    .badge {
      display: inline-block;
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 9px;
      font-weight: 700;
    }
    tfoot td {
      background: #fef3c7;
      font-weight: 700;
      border: 1px solid #f59e0b;
      padding: 7px 5px;
      text-align: center;
    }
    .page-footer {
      margin-top: auto;
      flex-shrink: 0;
      padding-top: 12px;
      padding-bottom: 4px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sigs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      text-align: center;
      font-size: 11px;
      color: #374151;
    }
    .sigs .line {
      border-top: 1px solid #9ca3af;
      margin-top: 36px;
      padding-top: 6px;
    }
    .footer-note {
      margin: 10px 0 0;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet {
        min-height: calc(210mm - 20mm);
      }
      /* تثبيت التذييل أسفل كل ورقة مطبوعة */
      .page-footer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        margin-top: 0;
        padding: 8px 4px 0;
        background: #fff;
      }
      .main {
        padding-bottom: 72px; /* مساحة كافية حتى لا يتداخل الجدول مع التذييل */
      }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="main">
      <div class="header">
        <p class="gov">جمهورية العراق — وزارة التعليم العالي والبحث العلمي</p>
        <h1>كلية الشرق للعلوم التقنية التخصصية</h1>
        <h2>${escapeHtml(title)}</h2>
      </div>

      <div class="meta">
        <span>الفترة: ${escapeHtml(period)}</span>
        <span>${escapeHtml(filterBits || 'بدون فلاتر إضافية')}</span>
        <span>تاريخ الإصدار: ${escapeHtml(new Date(data.generated_at).toLocaleString('ar-IQ'))}</span>
      </div>

      <div class="summary">
        <div class="card"><div class="label">عدد السجلات</div><div class="value">${data.totals.count}</div></div>
        <div class="card green"><div class="label">إجمالي مقبوضات الصندوق</div><div class="value" dir="ltr">${money(data.totals.cash_received)} IQD</div></div>
        <div class="card"><div class="label">إجمالي إيداعات البنك</div><div class="value" dir="ltr">${money(data.totals.bank_deposit)} IQD</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>التسلسل</th>
            <th>حسابات الصندوق<br/>(مقبوضات منه)</th>
            <th>حسابات البنك<br/>(ايداعات له)</th>
            <th>البيان</th>
            <th>نوع المستند</th>
            <th>تاريخ المستند</th>
            <th>رقم المستند</th>
            <th>تاريخ الشيك</th>
            <th>رقم الشيك</th>
            <th>القسم</th>
            <th>المرحلة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          ${
            body ||
            `<tr><td colspan="12" style="padding:18px;color:#6b7280">لا توجد سجلات مطابقة</td></tr>`
          }
        </tbody>
        <tfoot>
          <tr>
            <td>الإجمالي</td>
            <td class="cash" dir="ltr">${money(data.totals.cash_received)}</td>
            <td dir="ltr">${money(data.totals.bank_deposit)}</td>
            <td colspan="9">${data.totals.count} سجل</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <footer class="page-footer">
      <div class="sigs">
        <div><div class="line">أمين الصندوق</div></div>
        <div><div class="line">المحاسب</div></div>
        <div><div class="line">مدير الحسابات</div></div>
      </div>
      <p class="footer-note">وثيقة رسمية — سجل يومية الصندوق · شعبة الحسابات · كلية الشرق</p>
    </footer>
  </div>
</body>
</html>`;

  // iframe بدل window.open — يتجنب حظر النوافذ المنبثقة بعد fetch غير متزامن
  const existing = document.getElementById('cashbox-daily-register-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'cashbox-daily-register-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
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

  window.setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      alert('تعذر فتح مربع الطباعة.');
    } finally {
      cleanup();
    }
  }, 400);
}
