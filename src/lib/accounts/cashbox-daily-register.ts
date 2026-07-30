/**
 * سجل يومية الصندوق — كلية الشرق
 * المصدر الحالي: وصولات تسديد الطلبة (قبض).
 * Server-only — لا تستورد من Client Components.
 */
import { query } from '@/src/lib/db';
import type {
  CashboxRegisterData,
  CashboxRegisterFilters,
  CashboxRegisterRow,
} from '@/src/lib/accounts/cashbox-daily-register-types';

export type {
  CashboxDocType,
  CashboxRegisterData,
  CashboxRegisterFilters,
  CashboxRegisterRow,
} from '@/src/lib/accounts/cashbox-daily-register-types';

export {
  currentMonthRange,
  currentWeekRange,
} from '@/src/lib/accounts/cashbox-daily-register-types';

const STAGE_LABELS: Record<string, string> = {
  first: 'الأولى',
  second: 'الثانية',
  third: 'الثالثة',
  fourth: 'الرابعة',
};

function stageLabel(raw?: string | null): string {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return STAGE_LABELS[key] || (raw?.trim() ? String(raw) : '—');
}

function studyLabel(raw?: string | null): string {
  const st = String(raw || '').toLowerCase();
  if (st === 'evening' || st === 'مسائي') return 'مسائي';
  if (st === 'morning' || st === 'صباحي' || !st) return 'صباحي';
  return String(raw);
}

export async function ensureCashboxRegisterNotesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS accounts.cashbox_daily_register_notes (
      settlement_receipt_id UUID PRIMARY KEY
        REFERENCES accounts.student_settlement_receipts(id) ON DELETE CASCADE,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by UUID NULL
    )
  `).catch(() => undefined);
}

export async function buildCashboxDailyRegister(
  filters: CashboxRegisterFilters = {}
): Promise<CashboxRegisterData> {
  await ensureCashboxRegisterNotesTable();

  // الدفع غير مفعّل بعد — إن طُلب دفع نُرجع فارغاً
  if (filters.docType === 'payment') {
    const deptsRes = await query(
      `SELECT DISTINCT TRIM(department) AS department
       FROM accounts.student_settlement_receipts
       WHERE department IS NOT NULL AND TRIM(department) <> ''
       ORDER BY 1`
    ).catch(() => ({ rows: [] as Array<{ department: string }> }));

    return {
      generated_at: new Date().toISOString(),
      title: 'سجل يومية الصندوق — كلية الشرق',
      filters,
      rows: [],
      totals: { count: 0, cash_received: 0, bank_deposit: 0 },
      departments: deptsRes.rows.map((r) => String(r.department)),
    };
  }

  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.dateFrom) {
    where.push(`r.settlement_date >= $${i++}::date`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push(`r.settlement_date <= $${i++}::date`);
    params.push(filters.dateTo);
  }
  if (filters.department) {
    where.push(`TRIM(COALESCE(r.department, '')) = $${i++}`);
    params.push(filters.department);
  }
  if (filters.stage) {
    where.push(`TRIM(COALESCE(r.admission_type, '')) = $${i++}`);
    params.push(filters.stage);
  }
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    where.push(
      `(r.student_name ILIKE $${i} OR r.receipt_number ILIKE $${i} OR COALESCE(r.university_id,'') ILIKE $${i} OR COALESCE(r.department,'') ILIKE $${i})`
    );
    params.push(q);
    i += 1;
  }

  const result = await query(
    `SELECT
       r.id,
       r.receipt_number,
       r.student_id::text AS student_id,
       COALESCE(r.university_id, '') AS university_id,
       COALESCE(NULLIF(TRIM(r.student_name), ''), '—') AS student_name,
       COALESCE(NULLIF(TRIM(r.department), ''), '—') AS department,
       r.study_type,
       r.admission_type,
       r.settlement_date::text AS settlement_date,
       COALESCE(r.pay_amount, 0)::float8 AS pay_amount,
       r.fee_year,
       r.created_at,
       COALESCE(n.notes, '') AS notes
     FROM accounts.student_settlement_receipts r
     LEFT JOIN accounts.cashbox_daily_register_notes n
       ON n.settlement_receipt_id = r.id
     WHERE ${where.join(' AND ')}
     ORDER BY r.settlement_date ASC, r.created_at ASC, r.receipt_number ASC
     LIMIT 10000`,
    params
  );

  const rows: CashboxRegisterRow[] = result.rows.map(
    (row: Record<string, unknown>, index: number) => ({
      id: String(row.id),
      seq: index + 1,
      cash_received: Number(row.pay_amount || 0),
      bank_deposit: null,
      statement: String(row.student_name || '—'),
      doc_type: 'receipt' as const,
      doc_type_label: 'قبض',
      doc_date: String(row.settlement_date || '').slice(0, 10),
      doc_number: String(row.receipt_number || '—'),
      check_date: null,
      check_number: null,
      department: String(row.department || '—'),
      stage: String(row.admission_type || ''),
      stage_label: stageLabel(String(row.admission_type || '')),
      study_type: String(row.study_type || ''),
      study_type_label: studyLabel(String(row.study_type || '')),
      university_id: String(row.university_id || '—'),
      student_id: String(row.student_id || ''),
      notes: String(row.notes || ''),
      pay_amount: Number(row.pay_amount || 0),
      fee_year: row.fee_year != null ? Number(row.fee_year) : null,
      created_at: row.created_at ? String(row.created_at) : null,
    })
  );

  const cashTotal = rows.reduce((s, r) => s + r.cash_received, 0);

  const deptsRes = await query(
    `SELECT DISTINCT TRIM(department) AS department
     FROM accounts.student_settlement_receipts
     WHERE department IS NOT NULL AND TRIM(department) <> ''
     ORDER BY 1`
  ).catch(() => ({ rows: [] as Array<{ department: string }> }));

  return {
    generated_at: new Date().toISOString(),
    title: 'سجل يومية الصندوق — كلية الشرق',
    filters,
    rows,
    totals: {
      count: rows.length,
      cash_received: cashTotal,
      bank_deposit: 0,
    },
    departments: deptsRes.rows.map((r) => String(r.department)),
  };
}

export async function upsertCashboxRegisterNote(
  receiptId: string,
  notes: string,
  userId?: string | null
): Promise<void> {
  await ensureCashboxRegisterNotesTable();
  const createdBy =
    userId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId
    )
      ? userId
      : null;

  await query(
    `INSERT INTO accounts.cashbox_daily_register_notes
       (settlement_receipt_id, notes, updated_at, updated_by)
     VALUES ($1::uuid, $2, NOW(), $3::uuid)
     ON CONFLICT (settlement_receipt_id) DO UPDATE
       SET notes = EXCLUDED.notes,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
    [receiptId, notes ?? '', createdBy]
  );
}
