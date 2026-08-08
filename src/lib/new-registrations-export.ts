import type { ApplicationSnapshot } from '@/src/lib/student-application-print';

export type ExportRegistrationRow = {
  code: string;
  full_name: string;
  national_id: string;
  phone: string;
  preference_1: string;
  preference_2: string;
  preference_3: string;
  study_type: string;
  academic_year: string;
  status: string;
  confirmed_department?: string | null;
  university_id?: string | null;
  created_at: string;
  payload?: ApplicationSnapshot & {
    archiveFolder?: string;
  };
};

function studyLabel(v: string) {
  if (v === 'morning') return 'صباحي';
  if (v === 'evening') return 'مسائي';
  return v || '—';
}

function statusLabel(v: string) {
  if (v === 'confirmed') return 'مثبت';
  return 'قيد الانتظار';
}

function dateLabel(v: string) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('ar-IQ');
  } catch {
    return v;
  }
}

export async function exportNewRegistrationsExcel(rows: ExportRegistrationRow[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SHAU Student Affairs';
  wb.created = new Date();

  const ws = wb.addWorksheet('التسجيل الجديد', {
    views: [{ rightToLeft: true }],
    properties: { defaultRowHeight: 22 },
  });

  const widths = [6, 16, 28, 16, 14, 26, 26, 26, 10, 12, 12, 24, 14, 12];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.mergeCells('A1:N1');
  const title = ws.getCell('A1');
  title.value = 'كلية الشرق التقنية التخصصية — تقرير طلبات التسجيل الجديد';
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0E3D6E' },
  };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:N2');
  const sub = ws.getCell('A2');
  sub.value = `تاريخ التصدير: ${new Date().toLocaleString('ar-IQ')} · عدد السجلات: ${rows.length}`;
  sub.font = { size: 11, color: { argb: 'FF0E3D6E' } };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  sub.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF8' },
  };
  ws.getRow(2).height = 22;

  const headers = [
    '#',
    'الرمز',
    'الاسم الرباعي',
    'الهوية',
    'الهاتف',
    'الرغبة 1',
    'الرغبة 2',
    'الرغبة 3',
    'الدراسة',
    'السنة',
    'الحالة',
    'القسم المثبت',
    'الرقم الجامعي',
    'التاريخ',
  ];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E3D6E' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF3A6FA0' } },
      left: { style: 'thin', color: { argb: 'FF3A6FA0' } },
      bottom: { style: 'thin', color: { argb: 'FF3A6FA0' } },
      right: { style: 'thin', color: { argb: 'FF3A6FA0' } },
    };
  });
  headerRow.height = 26;

  rows.forEach((row, index) => {
    const excelRow = ws.getRow(5 + index);
    const values = [
      index + 1,
      row.code,
      row.full_name,
      row.national_id || '—',
      row.phone || '—',
      row.preference_1 || '—',
      row.preference_2 || '—',
      row.preference_3 || '—',
      studyLabel(row.study_type),
      row.academic_year || '—',
      statusLabel(row.status),
      row.confirmed_department || '—',
      row.university_id || '—',
      dateLabel(row.created_at),
    ];
    const bg = index % 2 === 0 ? 'FFFFFFFF' : 'FFF7F9FC';
    values.forEach((value, colIdx) => {
      const col = colIdx + 1;
      const cell = excelRow.getCell(col);
      cell.value = value;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bg },
      };
      cell.alignment = {
        horizontal: col <= 2 || col === 9 || col === 11 || col === 14 ? 'center' : 'right',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D7E5' } },
        left: { style: 'thin', color: { argb: 'FFD0D7E5' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D7E5' } },
        right: { style: 'thin', color: { argb: 'FFD0D7E5' } },
      };
      cell.font = { size: 10, color: { argb: 'FF0F172A' } };
      if (col === 11) {
        const confirmed = row.status === 'confirmed';
        cell.font = {
          bold: true,
          size: 10,
          color: { argb: confirmed ? 'FF065F46' : 'FF92400E' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: confirmed ? 'FFD1FAE5' : 'FFFEF3C7' },
        };
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `التسجيل-الجديد-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportNewRegistrationsPdfLandscape(rows: ExportRegistrationRow[]) {
  const tableRows = rows
    .map(
      (row, index) => `
      <tr class="${index % 2 === 0 ? 'even' : 'odd'}">
        <td>${index + 1}</td>
        <td class="mono">${row.code || '—'}</td>
        <td class="name">${row.full_name || '—'}</td>
        <td class="mono">${row.national_id || '—'}</td>
        <td class="mono">${row.phone || '—'}</td>
        <td>${row.preference_1 || '—'}</td>
        <td>${row.preference_2 || '—'}</td>
        <td>${row.preference_3 || '—'}</td>
        <td>${studyLabel(row.study_type)}</td>
        <td>${row.academic_year || '—'}</td>
        <td><span class="badge ${row.status === 'confirmed' ? 'ok' : 'wait'}">${statusLabel(row.status)}</span></td>
        <td>${dateLabel(row.created_at)}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>تقرير التسجيل الجديد</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .hdr {
      border: 1px solid #0E3D6E;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .hdr-top {
      background: linear-gradient(90deg, #0E3D6E 0%, #3A6FA0 100%);
      color: #fff;
      padding: 10px 14px;
      text-align: center;
    }
    .hdr-top h1 { margin: 0; font-size: 18px; }
    .hdr-top p { margin: 4px 0 0; font-size: 11px; opacity: 0.95; }
    .hdr-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 12px;
      background: #eef2f9;
      font-size: 11px;
      color: #0E3D6E;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
    }
    thead th {
      background: #0E3D6E;
      color: #fff;
      padding: 6px 5px;
      border: 1px solid #0A2748;
      text-align: center;
      font-weight: 800;
    }
    tbody td {
      padding: 5px 4px;
      border: 1px solid #d0d7e5;
      text-align: center;
      vertical-align: middle;
    }
    tbody td.name { text-align: right; font-weight: 700; }
    tbody tr.even td { background: #fff; }
    tbody tr.odd td { background: #f7f9fc; }
    .mono { font-family: Consolas, "Courier New", monospace; direction: ltr; }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 800;
    }
    .badge.ok { background: #d1fae5; color: #065f46; }
    .badge.wait { background: #fef3c7; color: #92400e; }
    .ftr {
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #475569;
      border-top: 2px solid #0E3D6E;
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="hdr-top">
      <h1>كلية الشرق التقنية التخصصية</h1>
      <p>شؤون الطلبة والتسجيل · تقرير طلبات التسجيل الجديد</p>
    </div>
    <div class="hdr-meta">
      <span>عدد السجلات: ${rows.length}</span>
      <span>تاريخ التصدير: ${new Date().toLocaleString('ar-IQ')}</span>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الرمز</th>
        <th>الاسم الرباعي</th>
        <th>الهوية</th>
        <th>الهاتف</th>
        <th>الرغبة 1</th>
        <th>الرغبة 2</th>
        <th>الرغبة 3</th>
        <th>الدراسة</th>
        <th>السنة</th>
        <th>الحالة</th>
        <th>التاريخ</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || `<tr><td colspan="12">لا توجد بيانات</td></tr>`}
    </tbody>
  </table>
  <div class="ftr">
    <span>نظام شؤون الطلبة · SHAU</span>
    <span>احفظ كـ PDF من نافذة الطباعة (A4 أفقي)</span>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 350);
    };
  </script>
</body>
</html>`;

  const w = window.open('about:blank', '_blank');
  if (!w) {
    alert('تعذر فتح نافذة التصدير. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
