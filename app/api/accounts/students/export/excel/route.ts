import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  getStudentExportData,
  type DepartmentTotals,
  type StudentExportRow,
} from '@/src/lib/accounts/student-export-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADER_FILL = 'FF450A0A';
const SUBTOTAL_FILL = 'FFFDE68A';
const TOTAL_FILL = 'FF450A0A';
const STRIPE_FILL = 'FFF8FAFC';

const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'ت', key: 'seq', width: 6 },
  { header: 'اسم الطالب', key: 'name', width: 30 },
  { header: 'رقم الطالب', key: 'university_id', width: 16 },
  { header: 'القسم', key: 'department', width: 30 },
  { header: 'المرحلة', key: 'stage', width: 12 },
  { header: 'نوع الدراسة', key: 'study_type', width: 12 },
  { header: 'القسط الكلي', key: 'annual_fee', width: 16 },
  { header: 'مبلغ التخفيض', key: 'discount_amount', width: 16 },
  { header: 'نوع التخفيض', key: 'discount_type', width: 24 },
  { header: 'القسط بعد التخفيض', key: 'net_fee', width: 18 },
  { header: 'المسدد (السنة الجارية)', key: 'paid_current_year', width: 20 },
  { header: 'المتبقي (السنة الجارية)', key: 'remaining_current_year', width: 20 },
  { header: 'الإجمالي المستحصل', key: 'total_collected', width: 20 },
  { header: 'عدد الوصولات', key: 'receipts_count', width: 14 },
  { header: 'السنة الجارية', key: 'current_year', width: 14 },
  { header: 'الحالة', key: 'status_label', width: 26 },
];

const MONEY_KEYS = new Set([
  'annual_fee',
  'discount_amount',
  'net_fee',
  'paid_current_year',
  'remaining_current_year',
  'total_collected',
]);

const MONEY_FORMAT = '#,##0';

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
      readingOrder: 'rtl',
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row, striped: boolean): void {
  row.eachCell((cell, colNumber) => {
    const key = COLUMNS[colNumber - 1]?.key;
    cell.font = { size: 10 };
    cell.alignment = {
      vertical: 'middle',
      horizontal: key === 'name' || key === 'department' ? 'right' : 'center',
      readingOrder: 'rtl',
    };
    cell.border = {
      top: { style: 'hair', color: { argb: 'FFD1D5DB' } },
      left: { style: 'hair', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } },
      right: { style: 'hair', color: { argb: 'FFD1D5DB' } },
    };
    if (striped) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: STRIPE_FILL },
      };
    }
    if (key && MONEY_KEYS.has(key)) {
      cell.numFmt = MONEY_FORMAT;
    }
  });
}

function styleSummaryRow(
  row: ExcelJS.Row,
  fill: string,
  fontColor: string
): void {
  row.height = 22;
  row.eachCell((cell, colNumber) => {
    const key = COLUMNS[colNumber - 1]?.key;
    cell.font = { bold: true, size: 10.5, color: { argb: fontColor } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: colNumber <= 2 ? 'right' : 'center',
      readingOrder: 'rtl',
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
    if (key && MONEY_KEYS.has(key)) {
      cell.numFmt = MONEY_FORMAT;
    }
  });
}

function totalsRowValues(
  label: string,
  totals: DepartmentTotals
): Record<string, string | number> {
  return {
    seq: '',
    name: label,
    university_id: `${totals.students} طالب`,
    department: '',
    stage: '',
    study_type: '',
    annual_fee: totals.annual_fee,
    discount_amount: totals.discount_amount,
    discount_type: '',
    net_fee: totals.net_fee,
    paid_current_year: totals.paid_current_year,
    remaining_current_year: totals.remaining_current_year,
    total_collected: totals.total_collected,
    receipts_count: totals.receipts_count,
    current_year: '',
    status_label: '',
  };
}

function rowValues(
  row: StudentExportRow,
  seq: number
): Record<string, string | number> {
  return {
    seq,
    name: row.name,
    university_id: row.university_id,
    department: row.department,
    stage: row.stage,
    study_type: row.study_type,
    annual_fee: row.annual_fee,
    discount_amount: row.discount_amount,
    discount_type: row.discount_type,
    net_fee: row.net_fee,
    paid_current_year: row.paid_current_year,
    remaining_current_year: row.remaining_current_year,
    total_collected: row.total_collected,
    receipts_count: row.receipts_count,
    current_year: row.current_year ? `السنة ${row.current_year}` : 'مكتملة',
    status_label: row.status_label,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const data = await getStudentExportData({
      search: searchParams.get('search') || undefined,
      department: searchParams.get('department') || undefined,
      stage: searchParams.get('stage') || undefined,
      studyType: searchParams.get('study_type') || undefined,
      paymentStatus: (searchParams.get('payment_status') || '') as
        | 'settled'
        | 'partial'
        | 'unpaid'
        | '',
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'نظام حسابات الكلية';
    wb.created = new Date();

    const ws = wb.addWorksheet('حسابات الطلبة', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    });

    ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

    const titleRow = ws.addRow([
      'كلية الشرق للعلوم التقنية التخصصية — جدول حسابات الطلبة',
    ]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, COLUMNS.length);
    titleRow.height = 30;
    const titleCell = titleRow.getCell(1);
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const metaRow = ws.addRow([
      `تاريخ التصدير: ${new Date(data.generated_at).toLocaleString('ar-IQ')} · عدد الطلبة: ${data.totals.students}${
        searchParams.toString() ? ' · وفق الفلاتر المحددة' : ''
      }`,
    ]);
    ws.mergeCells(metaRow.number, 1, metaRow.number, COLUMNS.length);
    metaRow.height = 20;
    const metaCell = metaRow.getCell(1);
    metaCell.font = { size: 10, color: { argb: 'FF4B5563' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.addRow([]);

    const headerRow = ws.addRow(
      COLUMNS.reduce<Record<string, string>>((acc, col) => {
        acc[col.key] = col.header;
        return acc;
      }, {})
    );
    styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: COLUMNS.length },
    };

    let seq = 0;
    for (const dept of data.departments) {
      const deptRows = data.rows.filter((r) => r.department === dept.department);

      const deptHeader = ws.addRow(
        totalsRowValues(`قسم: ${dept.department}`, dept)
      );
      styleSummaryRow(deptHeader, 'FFE5E7EB', 'FF111827');

      let striped = false;
      for (const row of deptRows) {
        seq += 1;
        const dataRow = ws.addRow(rowValues(row, seq));
        styleDataRow(dataRow, striped);
        striped = !striped;
      }

      const subtotal = ws.addRow(
        totalsRowValues(`إجمالي قسم ${dept.department}`, dept)
      );
      styleSummaryRow(subtotal, SUBTOTAL_FILL, 'FF451A03');
      ws.addRow([]);
    }

    const grandTotal = ws.addRow(
      totalsRowValues('الإجمالي العام لكل الأقسام', data.totals)
    );
    styleSummaryRow(grandTotal, TOTAL_FILL, 'FFFFFFFF');

    const summary = wb.addWorksheet('ملخص الأقسام', {
      views: [{ rightToLeft: true }],
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });
    summary.columns = [
      { header: 'القسم', key: 'department', width: 34 },
      { header: 'عدد الطلبة', key: 'students', width: 14 },
      { header: 'القسط الكلي', key: 'annual_fee', width: 18 },
      { header: 'مبلغ التخفيض', key: 'discount_amount', width: 18 },
      { header: 'بعد التخفيض', key: 'net_fee', width: 18 },
      { header: 'المسدد', key: 'paid_current_year', width: 18 },
      { header: 'المتبقي', key: 'remaining_current_year', width: 18 },
      { header: 'الإجمالي المستحصل', key: 'total_collected', width: 20 },
      { header: 'عدد الوصولات', key: 'receipts_count', width: 16 },
    ];
    const summaryHeader = summary.getRow(1);
    summaryHeader.height = 24;
    summaryHeader.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: HEADER_FILL },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    for (const [index, dept] of data.departments.entries()) {
      const row = summary.addRow({
        department: dept.department,
        students: dept.students,
        annual_fee: dept.annual_fee,
        discount_amount: dept.discount_amount,
        net_fee: dept.net_fee,
        paid_current_year: dept.paid_current_year,
        remaining_current_year: dept.remaining_current_year,
        total_collected: dept.total_collected,
        receipts_count: dept.receipts_count,
      });
      row.eachCell((cell, colNumber) => {
        cell.alignment = {
          horizontal: colNumber === 1 ? 'right' : 'center',
          vertical: 'middle',
        };
        if (colNumber >= 3 && colNumber <= 8) cell.numFmt = MONEY_FORMAT;
        if (index % 2 === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: STRIPE_FILL },
          };
        }
      });
    }

    const summaryTotal = summary.addRow({
      department: 'الإجمالي العام',
      students: data.totals.students,
      annual_fee: data.totals.annual_fee,
      discount_amount: data.totals.discount_amount,
      net_fee: data.totals.net_fee,
      paid_current_year: data.totals.paid_current_year,
      remaining_current_year: data.totals.remaining_current_year,
      total_collected: data.totals.total_collected,
      receipts_count: data.totals.receipts_count,
    });
    summaryTotal.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTAL_FILL },
      };
      cell.alignment = {
        horizontal: colNumber === 1 ? 'right' : 'center',
        vertical: 'middle',
      };
      if (colNumber >= 3 && colNumber <= 8) cell.numFmt = MONEY_FORMAT;
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const fileName = `student-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('student accounts excel export error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تصدير ملف الإكسل' },
      { status: 500 }
    );
  }
}
