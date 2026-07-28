import { query } from '@/src/lib/db';

export type AccountsSearchResultType =
  | 'student'
  | 'payroll_person'
  | 'supplier'
  | 'journal_entry'
  | 'cash_box'
  | 'cash_voucher'
  | 'bank'
  | 'bank_account'
  | 'fixed_asset'
  | 'chart_account';

export type AccountsSearchResult = {
  id: string;
  title: string;
  description: string;
  type: AccountsSearchResultType;
  url: string;
};

const PER_TYPE_LIMIT = 5;

const PAYROLL_PAGE: Record<string, string> = {
  TEACHING_STAFF: '/accounts/payroll/teaching-staff',
  EXTERNAL_LECTURER: '/accounts/payroll/lecturers',
  EMPLOYEE: '/accounts/payroll/admin-staff',
  DAILY_WORKER: '/accounts/payroll/daily-wages',
};

const PAYROLL_LABEL: Record<string, string> = {
  TEACHING_STAFF: 'كادر تدريسي',
  EXTERNAL_LECTURER: 'محاضر',
  EMPLOYEE: 'موظف',
  DAILY_WORKER: 'أجور يومية',
};

async function safeSearch(
  label: string,
  fn: () => Promise<AccountsSearchResult[]>
): Promise<AccountsSearchResult[]> {
  try {
    return await fn();
  } catch (error) {
    console.error(`خطأ في بحث الحسابات (${label}):`, error);
    return [];
  }
}

export async function searchAccountsSystem(rawQ: string): Promise<{
  results: AccountsSearchResult[];
  total: number;
}> {
  const q = rawQ.trim();
  if (q.length < 2) {
    return { results: [], total: 0 };
  }

  const like = `%${q}%`;

  const groups = await Promise.all([
    safeSearch('students', async () => {
      const res = await query(
        `SELECT
           s.id,
           s.university_id,
           COALESCE(
             NULLIF(TRIM(s.full_name_ar), ''),
             NULLIF(TRIM(s.full_name), ''),
             TRIM(CONCAT_WS(' ', s.first_name, s.middle_name, s.last_name))
           ) AS name,
           COALESCE(s.major, '') AS department,
           s.study_type,
           s.admission_type
         FROM student_affairs.students s
         WHERE COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') = 'paid'
           AND (
             COALESCE(s.full_name_ar, '') ILIKE $1
             OR COALESCE(s.full_name, '') ILIKE $1
             OR COALESCE(s.university_id::text, '') ILIKE $1
             OR COALESCE(s.student_number, '') ILIKE $1
             OR COALESCE(s.national_id, '') ILIKE $1
             OR COALESCE(s.major, '') ILIKE $1
             OR COALESCE(s.nickname, '') ILIKE $1
           )
         ORDER BY name ASC NULLS LAST
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `student-${row.id}`,
        title: String(row.name || 'طالب'),
        description: [
          row.university_id ? `رقم الطالب: ${row.university_id}` : null,
          row.department || null,
          row.study_type || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'student' as const,
        url: `/accounts/students/accounts/student/${row.id}`,
      }));
    }),

    safeSearch('payroll', async () => {
      const res = await query(
        `SELECT
           p.id,
           p.person_code,
           p.full_name_ar,
           p.person_type,
           p.university_id,
           p.phone,
           p.job_title,
           p.academic_title
         FROM accounts.payroll_people p
         WHERE p.person_code ILIKE $1
            OR p.full_name_ar ILIKE $1
            OR COALESCE(p.university_id, '') ILIKE $1
            OR COALESCE(p.phone, '') ILIKE $1
            OR COALESCE(p.job_title, '') ILIKE $1
         ORDER BY p.full_name_ar ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => {
        const personType = String(row.person_type || '');
        const page =
          PAYROLL_PAGE[personType] || '/accounts/payroll/teaching-staff';
        const qParam = encodeURIComponent(
          String(row.person_code || row.full_name_ar || q)
        );
        return {
          id: `payroll-${row.id}`,
          title: String(row.full_name_ar || row.person_code || 'كادر'),
          description: [
            PAYROLL_LABEL[personType] || personType,
            row.person_code ? `الرمز: ${row.person_code}` : null,
            row.job_title || row.academic_title || null,
          ]
            .filter(Boolean)
            .join(' · '),
          type: 'payroll_person' as const,
          url: `${page}?q=${qParam}`,
        };
      });
    }),

    safeSearch('suppliers', async () => {
      const res = await query(
        `SELECT id, supplier_number, code, name_ar, phone, status
         FROM accounts.suppliers
         WHERE supplier_number ILIKE $1
            OR COALESCE(code, '') ILIKE $1
            OR name_ar ILIKE $1
            OR COALESCE(name_en, '') ILIKE $1
            OR COALESCE(phone, '') ILIKE $1
         ORDER BY name_ar ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `supplier-${row.id}`,
        title: String(row.name_ar || 'مورد'),
        description: [
          row.supplier_number ? `رقم: ${row.supplier_number}` : null,
          row.code ? `رمز: ${row.code}` : null,
          row.phone || null,
          row.status || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'supplier' as const,
        url: `/accounts/suppliers/${row.id}`,
      }));
    }),

    safeSearch('journal', async () => {
      const res = await query(
        `SELECT id, entry_number, reference_number, description, status, entry_date
         FROM accounts.journal_entries
         WHERE entry_number ILIKE $1
            OR COALESCE(reference_number, '') ILIKE $1
            OR COALESCE(description, '') ILIKE $1
         ORDER BY entry_date DESC NULLS LAST, created_at DESC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `journal-${row.id}`,
        title: `قيد ${row.entry_number || ''}`,
        description: [
          row.reference_number ? `مرجع: ${row.reference_number}` : null,
          row.description || null,
          row.status || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'journal_entry' as const,
        url: `/accounts/entries?q=${encodeURIComponent(String(row.entry_number || q))}`,
      }));
    }),

    safeSearch('cash_boxes', async () => {
      const res = await query(
        `SELECT id, code, name_ar, status
         FROM accounts.cash_boxes
         WHERE code ILIKE $1
            OR name_ar ILIKE $1
            OR COALESCE(name_en, '') ILIKE $1
         ORDER BY code ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `cashbox-${row.id}`,
        title: String(row.name_ar || row.code || 'صندوق'),
        description: [`رمز: ${row.code}`, row.status || null]
          .filter(Boolean)
          .join(' · '),
        type: 'cash_box' as const,
        url: `/accounts/cashbox/${row.id}`,
      }));
    }),

    safeSearch('cash_vouchers', async () => {
      const res = await query(
        `SELECT id, voucher_number, party_name, description, status, voucher_date
         FROM accounts.cash_vouchers
         WHERE voucher_number ILIKE $1
            OR COALESCE(party_name, '') ILIKE $1
            OR COALESCE(description, '') ILIKE $1
         ORDER BY voucher_date DESC NULLS LAST, created_at DESC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `cashvoucher-${row.id}`,
        title: `سند صندوق ${row.voucher_number || ''}`,
        description: [
          row.party_name || null,
          row.description || null,
          row.status || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'cash_voucher' as const,
        url: `/accounts/cashbox/vouchers/${row.id}`,
      }));
    }),

    safeSearch('banks', async () => {
      const res = await query(
        `SELECT id, code, name_ar, short_name, status
         FROM accounts.banks
         WHERE code ILIKE $1
            OR name_ar ILIKE $1
            OR COALESCE(name_en, '') ILIKE $1
            OR COALESCE(short_name, '') ILIKE $1
         ORDER BY code ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `bank-${row.id}`,
        title: String(row.name_ar || row.code || 'مصرف'),
        description: [
          `رمز: ${row.code}`,
          row.short_name || null,
          row.status || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'bank' as const,
        url: `/accounts/banks/${row.id}`,
      }));
    }),

    safeSearch('bank_accounts', async () => {
      const res = await query(
        `SELECT ba.id, ba.code, ba.account_name_ar, ba.account_number, ba.iban, b.name_ar AS bank_name
         FROM accounts.bank_accounts ba
         LEFT JOIN accounts.banks b ON b.id = ba.bank_id
         WHERE ba.code ILIKE $1
            OR ba.account_name_ar ILIKE $1
            OR COALESCE(ba.account_name_en, '') ILIKE $1
            OR COALESCE(ba.account_number, '') ILIKE $1
            OR COALESCE(ba.iban, '') ILIKE $1
         ORDER BY ba.code ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `bankacc-${row.id}`,
        title: String(row.account_name_ar || row.code || 'حساب مصرفي'),
        description: [
          row.bank_name || null,
          row.account_number ? `رقم: ${row.account_number}` : null,
          row.code ? `رمز: ${row.code}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'bank_account' as const,
        url: `/accounts/banks?q=${encodeURIComponent(String(row.code || q))}`,
      }));
    }),

    safeSearch('fixed_assets', async () => {
      const res = await query(
        `SELECT id, asset_number, name_ar, barcode_value, serial_number, status
         FROM accounts.fixed_assets
         WHERE asset_number ILIKE $1
            OR name_ar ILIKE $1
            OR COALESCE(barcode_value, '') ILIKE $1
            OR COALESCE(serial_number, '') ILIKE $1
         ORDER BY asset_number ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `asset-${row.id}`,
        title: String(row.name_ar || row.asset_number || 'أصل ثابت'),
        description: [
          row.asset_number ? `رقم: ${row.asset_number}` : null,
          row.serial_number ? `تسلسلي: ${row.serial_number}` : null,
          row.status || null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'fixed_asset' as const,
        url: `/accounts/fixed-assets/assets/${row.id}`,
      }));
    }),

    safeSearch('chart', async () => {
      const res = await query(
        `SELECT id, code, name_ar, is_group, is_active
         FROM accounts.chart_of_accounts
         WHERE code ILIKE $1
            OR name_ar ILIKE $1
            OR COALESCE(name_en, '') ILIKE $1
         ORDER BY code ASC
         LIMIT ${PER_TYPE_LIMIT}`,
        [like]
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        id: `coa-${row.id}`,
        title: `${row.code} — ${row.name_ar || ''}`,
        description: [
          row.is_group ? 'حساب تجميعي' : 'حساب تفصيلي',
          row.is_active === false ? 'غير نشط' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        type: 'chart_account' as const,
        url: `/accounts/chart-of-accounts?q=${encodeURIComponent(String(row.code || q))}`,
      }));
    }),
  ]);

  const typeOrder: AccountsSearchResultType[] = [
    'student',
    'payroll_person',
    'supplier',
    'journal_entry',
    'cash_voucher',
    'cash_box',
    'bank_account',
    'bank',
    'fixed_asset',
    'chart_account',
  ];

  const results = groups.flat().sort((a, b) => {
    return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
  });

  return {
    results: results.slice(0, 30),
    total: results.length,
  };
}
