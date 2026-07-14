/**
 * التحقق من تطابق Student Subledger مع أثر قيود المطالبات على GL الذمم.
 *
 * SoT العام = journal_entries POSTED.
 * المقارنة الأساسية: Subledger ↔ قيود مصدرها STUDENT_CHARGE / STUDENT_CHARGE_REVERSAL
 * على حسابات receivable المستخدمة في student_accounts.
 *
 * أي نشاط GL آخر على نفس الحسابات يُبلَّغ كـ unexplained_gl (لا يفشل المقارنة الأساسية
 * إن تطابقت المطالبات مع الدفتر الفرعي — سياسة كشف فرق القيود اليدوية منفصلة في التقرير).
 */
import {
  moneyEquals,
  moneyToMillisSigned,
  millisToMoney,
  normalizeSignedMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentReceivablesVerifyResult = {
  ok: boolean;
  glBalance: string;
  subledgerBalance: string;
  difference: string;
  unexplainedGlBalance: string;
  details: {
    receivable_gl_account_ids: string[];
    student_accounts_count: number;
    ledger_entries_count: number;
    gl_accounts: Array<{
      account_id: string;
      code: string | null;
      charge_sourced_balance: string;
      full_gl_balance: string;
    }>;
  };
};

export async function verifyStudentReceivables(
  client: TxClient
): Promise<StudentReceivablesVerifyResult> {
  const accounts = await txQuery<{
    receivable_gl_account_id: string;
    code: string | null;
  }>(
    client,
    `SELECT DISTINCT sa.receivable_gl_account_id,
            a.code
     FROM accounts.student_accounts sa
     LEFT JOIN accounts.chart_of_accounts a ON a.id = sa.receivable_gl_account_id`
  );

  const glIds = accounts.rows.map((r) => r.receivable_gl_account_id);
  const accountsCount = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.student_accounts`
  );
  const ledgerCount = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.student_ledger_entries
     WHERE entry_type <> 'OPENING_REFERENCE'`
  );

  const sub = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text AS balance
     FROM accounts.student_ledger_entries
     WHERE entry_type <> 'OPENING_REFERENCE'`
  );
  const subledgerBalance = normalizeSignedMoneyInput(sub.rows[0]?.balance ?? '0');

  let chargeGlMillis = BigInt(0);
  let fullGlMillis = BigInt(0);
  const glAccounts: StudentReceivablesVerifyResult['details']['gl_accounts'] = [];

  if (glIds.length > 0) {
    const gl = await txQuery<{
      account_id: string;
      code: string | null;
      charge_net: string;
      full_net: string;
    }>(
      client,
      `SELECT a.id::text AS account_id,
              a.code,
              COALESCE((
                SELECT SUM(l.debit_amount - l.credit_amount)
                FROM accounts.journal_entry_lines l
                INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
                WHERE l.account_id = a.id
                  AND e.status = 'POSTED'
                  AND e.source_type IN ('STUDENT_CHARGE', 'STUDENT_CHARGE_REVERSAL')
              ), 0)::text AS charge_net,
              COALESCE((
                SELECT SUM(l.debit_amount - l.credit_amount)
                FROM accounts.journal_entry_lines l
                INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
                WHERE l.account_id = a.id
                  AND e.status = 'POSTED'
              ), 0)::text AS full_net
       FROM unnest($1::uuid[]) AS u(id)
       JOIN accounts.chart_of_accounts a ON a.id = u.id`,
      [glIds]
    );

    for (const row of gl.rows) {
      const chargeBal = normalizeSignedMoneyInput(row.charge_net);
      const fullBal = normalizeSignedMoneyInput(row.full_net);
      chargeGlMillis += moneyToMillisSigned(chargeBal);
      fullGlMillis += moneyToMillisSigned(fullBal);
      glAccounts.push({
        account_id: row.account_id,
        code: row.code,
        charge_sourced_balance: chargeBal,
        full_gl_balance: fullBal,
      });
    }

    for (const id of glIds) {
      if (!glAccounts.some((g) => g.account_id === id)) {
        glAccounts.push({
          account_id: id,
          code: null,
          charge_sourced_balance: '0.000',
          full_gl_balance: '0.000',
        });
      }
    }
  }

  const glBalance = millisToMoney(chargeGlMillis);
  const fullGl = millisToMoney(fullGlMillis);
  const difference = millisToMoney(
    moneyToMillisSigned(subledgerBalance) - moneyToMillisSigned(glBalance)
  );
  const unexplainedGlBalance = millisToMoney(
    moneyToMillisSigned(fullGl) - moneyToMillisSigned(glBalance)
  );
  const ok = moneyEquals(subledgerBalance, glBalance);

  return {
    ok,
    glBalance,
    subledgerBalance,
    difference,
    unexplainedGlBalance,
    details: {
      receivable_gl_account_ids: glIds,
      student_accounts_count: accountsCount.rows[0]?.n ?? 0,
      ledger_entries_count: ledgerCount.rows[0]?.n ?? 0,
      gl_accounts: glAccounts,
    },
  };
}
