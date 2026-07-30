import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { buildStudentsAggregateData } from '@/src/lib/accounts/students-aggregate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADER_FILL = 'FF450A0A';
const TOTAL_FILL = 'FFF3F4F6';
const MONEY_FORMAT = '#,##0';

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function addMoneyCell(row: ExcelJS.Row, col: number, value: number) {
  const cell = row.getCell(col);
  cell.value = Math.round(value || 0);
  cell.numFmt = MONEY_FORMAT;
  cell.alignment = { horizontal: 'left' };
}

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await buildStudentsAggregateData();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'نظام حسابات الكلية';
    wb.created = new Date();

    // ورقة المعادلة والأقسام
    const ws = wb.addWorksheet('حسب الأقسام', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 8 }],
    });
    ws.columns = [
      { width: 6 },
      { width: 36 },
      { width: 10 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 12 },
      { width: 18 },
    ];

    const title = ws.addRow(['حسابات إجمالية — مستحقات الطلبة']);
    ws.mergeCells(1, 1, 1, 11);
    title.getCell(1).font = { bold: true, size: 14 };
    title.getCell(1).alignment = { horizontal: 'center' };

    ws.addRow([]);
    ws.addRow([
      'أساس الرسوم',
      Math.round(data.equation.annual_base_total),
      'التخفيضات',
      Math.round(data.equation.total_discount_amount),
      'المطلوب',
      Math.round(data.equation.expected_annual_total),
    ]);
    ws.addRow([
      'المحصّل',
      Math.round(data.equation.collected_amount),
      'الدين',
      Math.round(data.equation.debt_amount),
      'نسبة التحصيل %',
      data.equation.collection_rate_percent,
    ]);
    ws.addRow([
      'متوقع 4 سنوات',
      Math.round(data.equation.expected_four_years_total),
      'عدد الوصولات',
      data.counts.receipts_count,
      'عدد الطلبة',
      data.counts.total_students,
    ]);
    ws.addRow([]);

    const header = ws.addRow([
      '#',
      'القسم',
      'طلبة',
      'أساس',
      'تخفيض',
      'مطلوب',
      'محصل',
      'دين',
      'وصولات',
      'تحصيل %',
      'متوقع 4 سنوات',
    ]);
    styleHeader(header);

    data.by_department.forEach((d, i) => {
      const row = ws.addRow([
        i + 1,
        d.name,
        d.students,
        null,
        null,
        null,
        null,
        null,
        d.receipts_count,
        d.collection_rate_percent,
        null,
      ]);
      addMoneyCell(row, 4, d.annual_base_total);
      addMoneyCell(row, 5, d.discount_amount);
      addMoneyCell(row, 6, d.expected_annual_total);
      addMoneyCell(row, 7, d.collected_amount);
      addMoneyCell(row, 8, d.debt_amount);
      addMoneyCell(row, 11, d.expected_four_years_total);
    });

    const totalRow = ws.addRow([
      '',
      'الإجمالي',
      data.totals.students,
      null,
      null,
      null,
      null,
      null,
      data.totals.receipts_count,
      data.equation.collection_rate_percent,
      null,
    ]);
    addMoneyCell(totalRow, 4, data.totals.annual_base_total);
    addMoneyCell(totalRow, 5, data.totals.discount_amount);
    addMoneyCell(totalRow, 6, data.totals.expected_annual_total);
    addMoneyCell(totalRow, 7, data.totals.collected_amount);
    addMoneyCell(totalRow, 8, data.totals.debt_amount);
    addMoneyCell(totalRow, 11, data.totals.expected_four_years_total);
    totalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTAL_FILL },
      };
    });

    // ورقة المراحل
    const wsStage = wb.addWorksheet('حسب المراحل', {
      views: [{ rightToLeft: true }],
    });
    wsStage.columns = [
      { width: 18 },
      { width: 10 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
    ];
    const sh = wsStage.addRow([
      'المرحلة',
      'طلبة',
      'أساس',
      'تخفيض',
      'مطلوب',
      'محصل',
      'دين',
      'وصولات',
    ]);
    styleHeader(sh);
    for (const s of data.by_stage) {
      const row = wsStage.addRow([
        s.label,
        s.students,
        null,
        null,
        null,
        null,
        null,
        s.receipts_count,
      ]);
      addMoneyCell(row, 3, s.annual_base_total);
      addMoneyCell(row, 4, s.discount_amount);
      addMoneyCell(row, 5, s.expected_annual_total);
      addMoneyCell(row, 6, s.collected_amount);
      addMoneyCell(row, 7, s.debt_amount);
    }

    // ورقة نوع الدراسة
    const wsStudy = wb.addWorksheet('حسب نوع الدراسة', {
      views: [{ rightToLeft: true }],
    });
    wsStudy.columns = [
      { width: 14 },
      { width: 10 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
    ];
    const sth = wsStudy.addRow([
      'النوع',
      'طلبة',
      'أساس',
      'تخفيض',
      'مطلوب',
      'محصل',
      'دين',
      'وصولات',
    ]);
    styleHeader(sth);
    for (const s of data.by_study_type) {
      const row = wsStudy.addRow([
        s.label,
        s.students,
        null,
        null,
        null,
        null,
        null,
        s.receipts_count,
      ]);
      addMoneyCell(row, 3, s.annual_base_total);
      addMoneyCell(row, 4, s.discount_amount);
      addMoneyCell(row, 5, s.expected_annual_total);
      addMoneyCell(row, 6, s.collected_amount);
      addMoneyCell(row, 7, s.debt_amount);
    }

    // ورقة سنة القسط
    const wsYear = wb.addWorksheet('حسب سنة القسط', {
      views: [{ rightToLeft: true }],
    });
    wsYear.columns = [
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 14 },
    ];
    const yh = wsYear.addRow([
      'السنة',
      'المستهدف',
      'المحصّل',
      'المتبقي',
      'وصولات',
      'طلبة بنشاط',
    ]);
    styleHeader(yh);
    for (const y of data.by_fee_year) {
      const row = wsYear.addRow([
        y.label,
        null,
        null,
        null,
        y.receipts_count,
        y.students_with_activity,
      ]);
      addMoneyCell(row, 2, y.target_amount);
      addMoneyCell(row, 3, y.collected_amount);
      addMoneyCell(row, 4, y.remaining_amount);
    }

    // ورقة التخفيضات
    const wsDisc = wb.addWorksheet('أنواع التخفيضات', {
      views: [{ rightToLeft: true }],
    });
    wsDisc.columns = [
      { width: 6 },
      { width: 32 },
      { width: 14 },
      { width: 12 },
      { width: 16 },
    ];
    const dh = wsDisc.addRow(['#', 'النوع', 'التصنيف', 'عدد الطلبة', 'المبلغ']);
    styleHeader(dh);
    data.discount_types.forEach((d, i) => {
      const row = wsDisc.addRow([
        i + 1,
        d.label,
        d.kind === 'channel' ? 'قناة قبول' : 'خصم تسديد',
        d.students_count,
        null,
      ]);
      addMoneyCell(row, 5, d.amount);
    });

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `حسابات-اجمالية-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
    console.error('aggregate excel error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تصدير الحسابات الإجمالية' },
      { status: 500 }
    );
  }
}
