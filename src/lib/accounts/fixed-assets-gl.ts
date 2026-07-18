/**
 * مساعدات التحقق من حسابات GL المستخدمة في الأصول الثابتة (8.A).
 *
 * ملاحظة محاسبية: لا يوجد نوع CONTRA_ASSET في النظام. حساب مجمع الإهلاك يجب أن يكون
 * من نوع ASSET برصيد طبيعي دائن (CREDIT) — فيُعرض كحساب مقابل للأصل (contra-asset).
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type AssertedGlAccount = {
  id: string;
  code: string;
  account_type_code: string;
  normal_balance: 'DEBIT' | 'CREDIT';
  requires_cost_center: boolean;
};

async function loadPostingGl(
  client: TxClient,
  accountId: string,
  label: string
): Promise<AssertedGlAccount> {
  if (!accountId) throw new AccountsHttpError(`${label} مطلوب`, 400);
  const r = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    requires_cost_center: boolean;
    normal_balance: 'DEBIT' | 'CREDIT';
    account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.is_active, a.is_group, a.allow_posting,
            a.requires_cost_center, a.normal_balance, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1::uuid`,
    [accountId]
  );
  if (!r.rows[0]) throw new AccountsHttpError(`${label} غير موجود`, 404);
  const a = r.rows[0];
  if (!a.is_active || a.is_group || !a.allow_posting) {
    throw new AccountsHttpError(`${label} يجب أن يكون تفصيلياً وقابلاً للترحيل وفعّالاً`, 400);
  }
  return {
    id: a.id,
    code: a.code,
    account_type_code: a.account_type_code,
    normal_balance: a.normal_balance,
    requires_cost_center: a.requires_cost_center,
  };
}

/** حساب الأصل — يجب أن يكون ASSET */
export async function assertAssetGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب الأصل'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'ASSET') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع الأصول (ASSET)`, 400);
  }
  return gl;
}

/**
 * حساب مجمع الإهلاك — يجب أن يكون ASSET برصيد طبيعي دائن (contra-asset).
 */
export async function assertAccumulatedDepreciationGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب مجمع الإهلاك'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'ASSET') {
    throw new AccountsHttpError(
      `${label} يجب أن يكون من نوع الأصول (ASSET) — مجمع إهلاك مقابل`,
      400
    );
  }
  if (gl.normal_balance !== 'CREDIT') {
    throw new AccountsHttpError(
      `${label} يجب أن يكون برصيد طبيعي دائن (CREDIT) ليعمل كحساب مقابل للأصل`,
      400
    );
  }
  return gl;
}

/** حساب مصروف الإهلاك — يجب أن يكون EXPENSE */
export async function assertDepreciationExpenseGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب مصروف الإهلاك'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'EXPENSE') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع المصروفات (EXPENSE)`, 400);
  }
  return gl;
}

/** حساب أرباح بيع الأصول — REVENUE */
export async function assertGainGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب أرباح بيع الأصول'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'REVENUE') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع الإيرادات (REVENUE)`, 400);
  }
  return gl;
}

/** حساب خسائر بيع/استبعاد الأصول — EXPENSE */
export async function assertLossGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب خسائر استبعاد الأصول'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'EXPENSE') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع المصروفات (EXPENSE)`, 400);
  }
  return gl;
}

/** حساب إيراد التبرع (للأصول الموهوبة) — REVENUE */
export async function assertDonationRevenueGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب إيراد التبرع'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'REVENUE') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع الإيرادات (REVENUE)`, 400);
  }
  return gl;
}

/** حساب حقوق ملكية (للأرصدة الافتتاحية) — EQUITY */
export async function assertEquityGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب حقوق الملكية الافتتاحي'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'EQUITY') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع حقوق الملكية (EQUITY)`, 400);
  }
  return gl;
}

/** حساب نقدية/بنك (متحصلات البيع) — ASSET */
export async function assertProceedsGlAccount(
  client: TxClient,
  accountId: string,
  label = 'حساب متحصلات البيع'
): Promise<AssertedGlAccount> {
  const gl = await loadPostingGl(client, accountId, label);
  if (gl.account_type_code !== 'ASSET') {
    throw new AccountsHttpError(`${label} يجب أن يكون من نوع الأصول (ASSET) — نقدية/بنك`, 400);
  }
  return gl;
}

export { loadPostingGl };

/**
 * ينشئ قيد يومية مُرحَّلاً (POSTED) للأصول الثابتة مباشرة (مثل نمط فواتير الموردين).
 * السطور يجب أن تكون متوازنة (mode=strict). يعيد معرّف ورقم القيد.
 */
export async function postFixedAssetJournalEntry(
  client: TxClient,
  params: {
    fiscalYearId: string;
    fiscalPeriodId: string;
    entryDate: string;
    sourceType: string;
    sourceId: string;
    referenceNumber: string | null;
    description: string;
    userId: string;
    lines: Array<{
      account_id: string;
      cost_center_id?: string | null;
      debit_amount: string;
      credit_amount: string;
      description?: string | null;
    }>;
  }
): Promise<{ id: string; entry_number: string }> {
  const { normalizeAndValidateLines, allocateJournalEntryNumber, replaceJournalLines } =
    await import('./journal-entries');
  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    params.lines,
    'strict'
  );
  const entryNumber = await allocateJournalEntryNumber(client, params.fiscalYearId);
  const ins = await txQuery<{ id: string; entry_number: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1,$2::uuid,$3::uuid,$4::date,'ADJUSTMENT',
       $5,$6::uuid,$7,$8,
       $9::numeric,$10::numeric,'POSTED',
       1,$11::uuid,$11::uuid,$11::uuid,NOW())
     RETURNING id, entry_number`,
    [
      entryNumber,
      params.fiscalYearId,
      params.fiscalPeriodId,
      params.entryDate,
      params.sourceType,
      params.sourceId,
      params.referenceNumber,
      params.description,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = ins.rows[0].id;
  await replaceJournalLines(client, journalId, lines);
  return { id: journalId, entry_number: ins.rows[0].entry_number };
}
