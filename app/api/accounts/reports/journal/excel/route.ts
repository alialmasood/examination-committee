import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  buildCashboxDailyRegister,
  type CashboxDocType,
} from '@/src/lib/accounts/cashbox-daily-register';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADER_FILL = 'FF7F1D1D';
const TOTAL_FILL = 'FFFEF3C7';
const MONEY_FORMAT = '#,##0';

function parseDocType(raw: string | null): CashboxDocType {
  if (raw === 'receipt' || raw === 'payment') return raw;
  if (raw === 'قبض') return 'receipt';
  if (raw === 'دفع') return 'payment';
  return '';
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
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

/**
 * GET /api/accounts/reports/journal/excel
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const reportTitle =
      searchParams.get('report_title') || 'سجل يومية الصندوق — كلية الشرق';
    const data = await buildCashboxDailyRegister({
      search: searchParams.get('search') || undefined,
      department: searchParams.get('department') || undefined,
      stage: searchParams.get('stage') || undefined,
      docType: parseDocType(searchParams.get('doc_type')),
      dateFrom: searchParams.get('date_from') || undefined,
      dateTo: searchParams.get('date_to') || undefined,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'نظام حسابات الكلية';
    wb.created = new Date();

    const ws = wb.addWorksheet('يومية الصندوق', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 5 }],
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
      },
    });

    ws.columns = [
      { width: 6 },
      { width: 16 },
      { width: 14 },
      { width: 28 },
      { width: 10 },
      { width: 12 },
      { width: 16 },
      { width: 12 },
      { width: 12 },
      { width: 26 },
      { width: 12 },
      { width: 22 },
    ];

    const t1 = ws.addRow(['كلية الشرق للعلوم التقنية التخصصية']);
    ws.mergeCells(1, 1, 1, 12);
    t1.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF7F1D1D' } };
    t1.getCell(1).alignment = { horizontal: 'center' };

    const t2 = ws.addRow([reportTitle]);
    ws.mergeCells(2, 1, 2, 12);
    t2.getCell(1).font = { bold: true, size: 12 };
    t2.getCell(1).alignment = { horizontal: 'center' };

    const period =
      data.filters.dateFrom || data.filters.dateTo
        ? `الفترة: ${data.filters.dateFrom || '—'} ← ${data.filters.dateTo || '—'}`
        : 'الفترة: الكل';
    const t3 = ws.addRow([period]);
    ws.mergeCells(3, 1, 3, 12);
    t3.getCell(1).font = { size: 10, color: { argb: 'FF4B5563' } };
    t3.getCell(1).alignment = { horizontal: 'center' };

    ws.addRow([]);

    const header = ws.addRow([
      'التسلسل',
      'حسابات الصندوق\n(مقبوضات منه)',
      'حسابات البنك\n(ايداعات له)',
      'البيان',
      'نوع المستند',
      'تاريخ المستند',
      'رقم المستند',
      'تاريخ الشيك',
      'رقم الشيك',
      'القسم',
      'المرحلة',
      'ملاحظات',
    ]);
    styleHeader(header);

    for (const row of data.rows) {
      const r = ws.addRow([
        row.seq,
        Math.round(row.cash_received),
        row.bank_deposit == null ? '' : Math.round(row.bank_deposit),
        row.statement,
        row.doc_type_label,
        row.doc_date,
        row.doc_number,
        row.check_date || '',
        row.check_number || '',
        row.department,
        row.stage_label,
        row.notes || '',
      ]);
      r.getCell(2).numFmt = MONEY_FORMAT;
      if (row.bank_deposit != null) r.getCell(3).numFmt = MONEY_FORMAT;
      r.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      r.getCell(2).font = { color: { argb: 'FF047857' }, bold: true };
    }

    const total = ws.addRow([
      'الإجمالي',
      Math.round(data.totals.cash_received),
      Math.round(data.totals.bank_deposit),
      `${data.totals.count} سجل`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    total.getCell(2).numFmt = MONEY_FORMAT;
    total.getCell(3).numFmt = MONEY_FORMAT;
    total.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTAL_FILL },
      };
    });

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `يومية-الصندوق-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('cashbox excel error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تصدير سجل يومية الصندوق' },
      { status: 500 }
    );
  }
}
