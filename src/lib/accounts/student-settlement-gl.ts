/**
 * ترحيل قيد يومية لوصل تسديد قسط الطالب:
 * مدين: حساب الصندوق (1111 — الصندوق / الصندوق الرئيسي) وليس صندوق الأقساط
 * دائن: إيرادات الطلبة (4100) وليس أقساط صباحي/مسائي
 */
import { AccountsHttpError } from './auth';
import {
  allocateJournalEntryNumber,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export const STUDENT_SETTLEMENT_SOURCE_TYPE = 'STUDENT_SETTLEMENT_RECEIPT';

/** حساب الصندوق للتحصيل — يُفضَّل 1111 ويتجنب صندوق الأقساط 1112 */
const CASH_ACCOUNT_CODES = ['1111', '1113', '1114'];

async function findPostingAccountByCodes(
  client: TxClient,
  codes: string[],
  label: string
): Promise<{ id: string; code: string; name_ar: string }> {
  const r = await txQuery<{ id: string; code: string; name_ar: string }>(
    client,
    `SELECT id, code, name_ar
     FROM accounts.chart_of_accounts
     WHERE code = ANY($1::text[])
       AND is_active = TRUE
       AND is_group = FALSE
       AND allow_posting = TRUE
     ORDER BY array_position($1::text[], code)
     LIMIT 1`,
    [codes]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      `${label} غير معرّف في دليل الحسابات (الأكواد: ${codes.join('، ')}). شغّل seed:accounts-chart:execute إن لزم.`,
      409
    );
  }
  return r.rows[0];
}

/** حساب الصندوق: يفضّل الاسم «الصندوق» أو «الصندوق الرئيسي» / الكود 1111 — وليس صندوق الأقساط */
async function resolveCashAccount(
  client: TxClient
): Promise<{ id: string; code: string; name_ar: string }> {
  const byName = await txQuery<{ id: string; code: string; name_ar: string }>(
    client,
    `SELECT id, code, name_ar
     FROM accounts.chart_of_accounts
     WHERE is_active = TRUE
       AND is_group = FALSE
       AND allow_posting = TRUE
       AND (
         name_ar = 'الصندوق'
         OR name_ar = 'حساب الصندوق'
         OR name_ar = 'الصندوق الرئيسي'
         OR code = '1111'
       )
       AND name_ar NOT ILIKE '%أقساط%'
     ORDER BY
       CASE
         WHEN name_ar = 'الصندوق' THEN 0
         WHEN name_ar = 'حساب الصندوق' THEN 1
         WHEN code = '1111' THEN 2
         ELSE 3
       END
     LIMIT 1`
  );
  if (byName.rows[0]) return byName.rows[0];

  const fromBox = await txQuery<{ id: string; code: string; name_ar: string }>(
    client,
    `SELECT a.id, a.code, a.name_ar
     FROM accounts.cash_boxes cb
     JOIN accounts.chart_of_accounts a ON a.id = cb.account_id
     WHERE cb.status = 'ACTIVE'
       AND a.is_active = TRUE
       AND a.is_group = FALSE
       AND a.allow_posting = TRUE
       AND a.code <> '1112'
       AND a.name_ar NOT ILIKE '%أقساط%'
     ORDER BY
       CASE WHEN a.code = '1111' THEN 0 ELSE 1 END,
       cb.code
     LIMIT 1`
  ).catch(() => ({ rows: [] as Array<{ id: string; code: string; name_ar: string }> }));

  if (fromBox.rows[0]) return fromBox.rows[0];
  return findPostingAccountByCodes(client, CASH_ACCOUNT_CODES, 'حساب الصندوق');
}

/**
 * إيرادات الطلبة (4100): حساب تجميعي بالبذرة؛ نجعله قابلاً للترحيل
 * لأن تسديد القسط يُرحَّل على «إيرادات الطلبة» وليس على أقساط صباحي/مسائي.
 */
async function resolveStudentRevenueAccount(
  client: TxClient
): Promise<{ id: string; code: string; name_ar: string }> {
  const existing = await txQuery<{
    id: string;
    code: string;
    name_ar: string;
    is_group: boolean;
    allow_posting: boolean;
    is_active: boolean;
  }>(
    client,
    `SELECT id, code, name_ar, is_group, allow_posting, is_active
     FROM accounts.chart_of_accounts
     WHERE code = '4100' OR name_ar = 'إيرادات الطلبة'
     ORDER BY CASE WHEN code = '4100' THEN 0 ELSE 1 END
     LIMIT 1`
  );

  if (!existing.rows[0]) {
    throw new AccountsHttpError(
      'حساب إيرادات الطلبة (4100) غير معرّف في دليل الحسابات',
      409
    );
  }

  const acc = existing.rows[0];
  if (!acc.is_active) {
    throw new AccountsHttpError('حساب إيرادات الطلبة غير فعّال', 409);
  }

  if (acc.is_group || !acc.allow_posting) {
    const updated = await txQuery<{ id: string; code: string; name_ar: string }>(
      client,
      `UPDATE accounts.chart_of_accounts
       SET is_group = FALSE,
           allow_posting = TRUE,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, code, name_ar`,
      [acc.id]
    );
    if (!updated.rows[0]) {
      throw new AccountsHttpError('تعذر تهيئة حساب إيرادات الطلبة للترحيل', 500);
    }
    return updated.rows[0];
  }

  return { id: acc.id, code: acc.code, name_ar: acc.name_ar };
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  entryDate: string
): Promise<{ fiscalYearId: string; fiscalPeriodId: string }> {
  const r = await txQuery<{ year_id: string; period_id: string }>(
    client,
    `SELECT y.id AS year_id, p.id AS period_id
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE'
       AND p.status = 'OPEN'
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`,
    [entryDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ التسديد — لن يُرحَّل القيد',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

export type SettlementJournalParams = {
  receiptId: string;
  receiptNumber: string;
  settlementDate: string;
  amount: number;
  studentName: string | null;
  universityId: string | null;
  studyType: string | null;
  userId: string;
};

export type SettlementJournalResult = {
  id: string;
  entry_number: string;
  debit_account: string;
  credit_account: string;
};

export async function postStudentSettlementJournalEntry(
  client: TxClient,
  params: SettlementJournalParams
): Promise<SettlementJournalResult> {
  const amount = Math.round(Math.max(0, params.amount) * 1000) / 1000;
  if (amount <= 0) {
    throw new AccountsHttpError('مبلغ القيد يجب أن يكون أكبر من صفر', 400);
  }

  const existing = await txQuery<{ id: string; entry_number: string }>(
    client,
    `SELECT id, entry_number FROM accounts.journal_entries
     WHERE source_type = $1 AND source_id = $2::uuid`,
    [STUDENT_SETTLEMENT_SOURCE_TYPE, params.receiptId]
  );
  if (existing.rows[0]) {
    return {
      ...existing.rows[0],
      debit_account: '',
      credit_account: '',
    };
  }

  const { fiscalYearId, fiscalPeriodId } = await resolveOpenFiscalForDate(
    client,
    params.settlementDate
  );

  const cashAccount = await resolveCashAccount(client);
  const revenueAccount = await resolveStudentRevenueAccount(client);

  const studentLabel = [
    params.studentName?.trim() || 'طالب',
    params.universityId?.trim() ? `(${params.universityId.trim()})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const description = `وصل تسديد قسط الطالب ${studentLabel} — ${params.receiptNumber}`;
  const amountStr = amount.toFixed(3);

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    [
      {
        account_id: cashAccount.id,
        debit_amount: amountStr,
        credit_amount: '0',
        description: `قبض نقدي — ${params.receiptNumber}`,
        reference_type: STUDENT_SETTLEMENT_SOURCE_TYPE,
        reference_id: params.receiptId,
      },
      {
        account_id: revenueAccount.id,
        debit_amount: '0',
        credit_amount: amountStr,
        description: `إيرادات الطلبة — ${studentLabel}`,
        reference_type: STUDENT_SETTLEMENT_SOURCE_TYPE,
        reference_id: params.receiptId,
      },
    ],
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(client, fiscalYearId);

  const ins = await txQuery<{ id: string; entry_number: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1,$2::uuid,$3::uuid,$4::date,'RECEIPT',
       $5,$6::uuid,$7,$8,
       $9::numeric,$10::numeric,'POSTED',
       1,$11::uuid,$11::uuid,$11::uuid,NOW())
     RETURNING id, entry_number`,
    [
      entryNumber,
      fiscalYearId,
      fiscalPeriodId,
      params.settlementDate,
      STUDENT_SETTLEMENT_SOURCE_TYPE,
      params.receiptId,
      params.receiptNumber,
      description,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );

  const journalId = ins.rows[0].id;
  await replaceJournalLines(client, journalId, lines);

  return {
    id: journalId,
    entry_number: ins.rows[0].entry_number,
    debit_account: `${cashAccount.code} — ${cashAccount.name_ar}`,
    credit_account: `${revenueAccount.code} — ${revenueAccount.name_ar}`,
  };
}
