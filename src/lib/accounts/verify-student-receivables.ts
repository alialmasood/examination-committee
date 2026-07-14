/**
 * التحقق من تطابق Student Subledger مع أثر قيود المطالبات على GL الذمم.
 *
 * مقارنة A↔B:
 * - A = مجموع خطوط JE المرحّلة على حسابات الذمم بمصادر
 *   STUDENT_CHARGE / STUDENT_CHARGE_REVERSAL
 * - B = مجموع الدفتر الفرعي (باستثناء OPENING_REFERENCE)
 *
 * يتتبع أيضاً الأيتام (قيد بلا دفتر / دفتر بلا قيد) وفروق المبالغ لكل مصدر،
 * ونشاط GL غير مفسَّر (قيود أخرى على نفس حسابات الذمم).
 *
 * لا يستثني أي كود حساب نقدي من التقرير — يُبلَّغ كله في unexplained.
 */
import {
  moneyEquals,
  moneyToMillisSigned,
  millisToMoney,
  normalizeSignedMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentReceivablesOrphanJournal = {
  journal_entry_id: string;
  source_type: string;
  source_id: string;
  expected_entry_type: string;
  gl_net: string;
};

export type StudentReceivablesOrphanLedger = {
  ledger_entry_id: string;
  entry_type: string;
  source_type: string;
  source_id: string;
  ledger_net: string;
};

export type StudentReceivablesAmountMismatch = {
  source_type: string;
  source_id: string;
  entry_type: string;
  gl_net: string;
  ledger_net: string;
  difference: string;
};

export type StudentReceivablesVerifyResult = {
  /** تطابق A↔B بدون أيتام أو فروق مبالغ */
  ok: boolean;
  /** تطابق مجاميع A (قيود المطالبات) مع B (الدفتر الفرعي) */
  charge_subledger_match: boolean;
  unexplained_gl_activity: string;
  /** كامل رصيد GL المرحّل على حسابات الذمم المستخدمة */
  total_gl_balance: string;
  total_student_subledger: string;
  charge_sourced_gl_balance: string;
  /** Subledger − charge-sourced GL */
  difference: string;
  orphans: {
    journal_without_ledger: StudentReceivablesOrphanJournal[];
    ledger_without_journal: StudentReceivablesOrphanLedger[];
    amount_mismatches: StudentReceivablesAmountMismatch[];
  };
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

function expectedLedgerEntryType(jeSourceType: string): string {
  if (jeSourceType === 'STUDENT_CHARGE_REVERSAL') return 'CHARGE_REVERSAL';
  return 'CHARGE';
}

function sourceKey(entryType: string, sourceId: string): string {
  return `${entryType}::${sourceId}`;
}

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
  const totalStudentSubledger = normalizeSignedMoneyInput(
    sub.rows[0]?.balance ?? '0'
  );

  let chargeGlMillis = BigInt(0);
  let fullGlMillis = BigInt(0);
  const glAccounts: StudentReceivablesVerifyResult['details']['gl_accounts'] =
    [];

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

  const chargeSourcedGlBalance = millisToMoney(chargeGlMillis);
  const totalGlBalance = millisToMoney(fullGlMillis);
  const difference = millisToMoney(
    moneyToMillisSigned(totalStudentSubledger) -
      moneyToMillisSigned(chargeSourcedGlBalance)
  );
  const unexplainedGlActivity = millisToMoney(
    moneyToMillisSigned(totalGlBalance) -
      moneyToMillisSigned(chargeSourcedGlBalance)
  );

  // —— Orphans & per-source amount match (charge-sourced JE ↔ subledger) ——
  type GlSrc = {
    journal_entry_id: string;
    source_type: string;
    source_id: string;
    gl_net: string;
  };
  type LedSrc = {
    ledger_entry_id: string;
    entry_type: string;
    source_type: string;
    source_id: string;
    ledger_net: string;
  };

  const glBySource = new Map<
    string,
    { journal_entry_id: string; source_type: string; source_id: string; netMillis: bigint }
  >();
  const ledBySource = new Map<
    string,
    { ledger_entry_id: string; entry_type: string; source_type: string; source_id: string; netMillis: bigint }
  >();

  if (glIds.length > 0) {
    const jeSources = await txQuery<GlSrc>(
      client,
      `SELECT e.id::text AS journal_entry_id,
              e.source_type,
              e.source_id::text AS source_id,
              COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS gl_net
       FROM accounts.journal_entries e
       JOIN accounts.journal_entry_lines l ON l.journal_entry_id = e.id
       WHERE e.status = 'POSTED'
         AND e.source_type IN ('STUDENT_CHARGE', 'STUDENT_CHARGE_REVERSAL')
         AND e.source_id IS NOT NULL
         AND l.account_id = ANY($1::uuid[])
       GROUP BY e.id, e.source_type, e.source_id`,
      [glIds]
    );

    for (const row of jeSources.rows) {
      const entryType = expectedLedgerEntryType(row.source_type);
      const key = sourceKey(entryType, row.source_id);
      const prev = glBySource.get(key);
      const add = moneyToMillisSigned(normalizeSignedMoneyInput(row.gl_net));
      if (prev) {
        prev.netMillis += add;
      } else {
        glBySource.set(key, {
          journal_entry_id: row.journal_entry_id,
          source_type: row.source_type,
          source_id: row.source_id,
          netMillis: add,
        });
      }
    }
  }

  const ledSources = await txQuery<LedSrc>(
    client,
    `SELECT le.id::text AS ledger_entry_id,
            le.entry_type,
            le.source_type,
            le.source_id::text AS source_id,
            (le.debit_amount - le.credit_amount)::text AS ledger_net
     FROM accounts.student_ledger_entries le
     WHERE le.entry_type IN ('CHARGE', 'CHARGE_REVERSAL')
       AND le.source_id IS NOT NULL`
  );

  for (const row of ledSources.rows) {
    const key = sourceKey(row.entry_type, row.source_id);
    const prev = ledBySource.get(key);
    const add = moneyToMillisSigned(normalizeSignedMoneyInput(row.ledger_net));
    if (prev) {
      prev.netMillis += add;
    } else {
      ledBySource.set(key, {
        ledger_entry_id: row.ledger_entry_id,
        entry_type: row.entry_type,
        source_type: row.source_type,
        source_id: row.source_id,
        netMillis: add,
      });
    }
  }

  const journalWithoutLedger: StudentReceivablesOrphanJournal[] = [];
  const ledgerWithoutJournal: StudentReceivablesOrphanLedger[] = [];
  const amountMismatches: StudentReceivablesAmountMismatch[] = [];

  for (const [key, gl] of glBySource) {
    const led = ledBySource.get(key);
    const entryType = expectedLedgerEntryType(gl.source_type);
    if (!led) {
      journalWithoutLedger.push({
        journal_entry_id: gl.journal_entry_id,
        source_type: gl.source_type,
        source_id: gl.source_id,
        expected_entry_type: entryType,
        gl_net: millisToMoney(gl.netMillis),
      });
      continue;
    }
    if (gl.netMillis !== led.netMillis) {
      amountMismatches.push({
        source_type: gl.source_type,
        source_id: gl.source_id,
        entry_type: entryType,
        gl_net: millisToMoney(gl.netMillis),
        ledger_net: millisToMoney(led.netMillis),
        difference: millisToMoney(led.netMillis - gl.netMillis),
      });
    }
  }

  for (const [key, led] of ledBySource) {
    if (!glBySource.has(key)) {
      ledgerWithoutJournal.push({
        ledger_entry_id: led.ledger_entry_id,
        entry_type: led.entry_type,
        source_type: led.source_type,
        source_id: led.source_id,
        ledger_net: millisToMoney(led.netMillis),
      });
    }
  }

  const chargeSubledgerMatch = moneyEquals(
    totalStudentSubledger,
    chargeSourcedGlBalance
  );
  const noOrphans =
    journalWithoutLedger.length === 0 &&
    ledgerWithoutJournal.length === 0 &&
    amountMismatches.length === 0;
  const ok = chargeSubledgerMatch && noOrphans;

  return {
    ok,
    charge_subledger_match: chargeSubledgerMatch,
    unexplained_gl_activity: unexplainedGlActivity,
    total_gl_balance: totalGlBalance,
    total_student_subledger: totalStudentSubledger,
    charge_sourced_gl_balance: chargeSourcedGlBalance,
    difference,
    orphans: {
      journal_without_ledger: journalWithoutLedger,
      ledger_without_journal: ledgerWithoutJournal,
      amount_mismatches: amountMismatches,
    },
    details: {
      receivable_gl_account_ids: glIds,
      student_accounts_count: accountsCount.rows[0]?.n ?? 0,
      ledger_entries_count: ledgerCount.rows[0]?.n ?? 0,
      gl_accounts: glAccounts,
    },
  };
}

/** هل unexplained_gl_activity صفري؟ */
export function hasUnexplainedGlActivity(
  result: StudentReceivablesVerifyResult
): boolean {
  return !moneyEquals(result.unexplained_gl_activity, '0');
}
