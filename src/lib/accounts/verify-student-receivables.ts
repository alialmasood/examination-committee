/**
 * التحقق من تطابق Student Subledger مع عمليات الذمم على GL.
 *
 * مقارنة A↔B (5.A + 5.B):
 * - A = مجموع خطوط JE المرحّلة على حسابات الذمم من:
 *   • STUDENT_CHARGE / STUDENT_CHARGE_REVERSAL
 *   • قيود سندات قبض/عكس مرتبطة بتحصيلات الطلبة (cash/bank voucher)
 * - B = مجموع الدفتر الفرعي (باستثناء OPENING_REFERENCE)
 *   يشمل CHARGE / CHARGE_REVERSAL / COLLECTION / COLLECTION_REVERSAL
 *
 * unexplained = كامل GL على الذمم − A (يشمل Legacy مثل نشاط نقدي على 1111).
 * لا استثناء عام لأي كود حساب.
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
  ok: boolean;
  /** تطابق مجاميع A (عمليات الذمم) مع B (الدفتر الفرعي) */
  charge_subledger_match: boolean;
  unexplained_gl_activity: string;
  total_gl_balance: string;
  total_student_subledger: string;
  /** رصيد GL من عمليات الطلبة فقط (مطالبات + تحصيلات عبر السندات) */
  charge_sourced_gl_balance: string;
  /** Subledger − operations-sourced GL */
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
    collections_posted_count: number;
    allocations_sum_ok: boolean;
    gl_accounts: Array<{
      account_id: string;
      code: string | null;
      charge_sourced_balance: string;
      full_gl_balance: string;
    }>;
  };
};

function expectedChargeLedgerEntryType(jeSourceType: string): string {
  if (jeSourceType === 'STUDENT_CHARGE_REVERSAL') return 'CHARGE_REVERSAL';
  return 'CHARGE';
}

function sourceKey(entryType: string, sourceId: string): string {
  return `${entryType}::${sourceId}`;
}

/**
 * أثر تحصيلات الطلبة على GL الذمم: أسطر القيد على receivable_gl
 * الخاص بحساب الطالب فقط (لا تُخلط مع 1111 إن وُجد خطأً كذمم).
 */
const COLLECTION_RECV_NET_SQL = `
  SELECT COALESCE(SUM(x.net), 0)
  FROM (
    SELECT SUM(l.debit_amount - l.credit_amount) AS net
    FROM accounts.student_collections sc
    JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
    JOIN accounts.cash_vouchers cv ON cv.id = sc.cash_voucher_id
    JOIN accounts.journal_entries e ON e.id = cv.journal_entry_id AND e.status = 'POSTED'
    JOIN accounts.journal_entry_lines l
      ON l.journal_entry_id = e.id
     AND l.account_id = sa.receivable_gl_account_id
    WHERE sa.receivable_gl_account_id = a.id
    UNION ALL
    SELECT SUM(l.debit_amount - l.credit_amount)
    FROM accounts.student_collections sc
    JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
    JOIN accounts.cash_vouchers cv ON cv.id = sc.cash_voucher_id
    JOIN accounts.journal_entries e ON e.id = cv.reversal_journal_entry_id AND e.status = 'POSTED'
    JOIN accounts.journal_entry_lines l
      ON l.journal_entry_id = e.id
     AND l.account_id = sa.receivable_gl_account_id
    WHERE sa.receivable_gl_account_id = a.id
    UNION ALL
    SELECT SUM(l.debit_amount - l.credit_amount)
    FROM accounts.student_collections sc
    JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
    JOIN accounts.bank_vouchers bv ON bv.id = sc.bank_voucher_id
    JOIN accounts.journal_entries e ON e.id = bv.journal_entry_id AND e.status = 'POSTED'
    JOIN accounts.journal_entry_lines l
      ON l.journal_entry_id = e.id
     AND l.account_id = sa.receivable_gl_account_id
    WHERE sa.receivable_gl_account_id = a.id
    UNION ALL
    SELECT SUM(l.debit_amount - l.credit_amount)
    FROM accounts.student_collections sc
    JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
    JOIN accounts.bank_vouchers bv ON bv.id = sc.bank_voucher_id
    JOIN accounts.journal_entries e ON e.id = bv.reversal_journal_entry_id AND e.status = 'POSTED'
    JOIN accounts.journal_entry_lines l
      ON l.journal_entry_id = e.id
     AND l.account_id = sa.receivable_gl_account_id
    WHERE sa.receivable_gl_account_id = a.id
  ) x
`;

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
  const collCount = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.student_collections WHERE status = 'POSTED'`
  );

  const allocCheck = await txQuery<{ bad: number }>(
    client,
    `SELECT COUNT(*)::int AS bad
     FROM accounts.student_collections sc
     WHERE sc.status IN ('DRAFT', 'POSTED')
       AND ABS(
         sc.amount - COALESCE((
           SELECT SUM(a.allocated_amount)
           FROM accounts.student_collection_allocations a
           WHERE a.collection_id = sc.id
         ), 0)
       ) > 0.0005`
  );
  const allocationsSumOk = (allocCheck.rows[0]?.bad ?? 0) === 0;

  const sub = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text AS balance
     FROM accounts.student_ledger_entries
     WHERE entry_type <> 'OPENING_REFERENCE'`
  );
  const totalStudentSubledger = normalizeSignedMoneyInput(
    sub.rows[0]?.balance ?? '0'
  );

  let opsGlMillis = BigInt(0);
  let fullGlMillis = BigInt(0);
  const glAccounts: StudentReceivablesVerifyResult['details']['gl_accounts'] =
    [];

  if (glIds.length > 0) {
    const gl = await txQuery<{
      account_id: string;
      code: string | null;
      ops_net: string;
      full_net: string;
    }>(
      client,
      `SELECT a.id::text AS account_id,
              a.code,
              (
                COALESCE((
                  SELECT SUM(l.debit_amount - l.credit_amount)
                  FROM accounts.journal_entry_lines l
                  INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
                  WHERE l.account_id = a.id
                    AND e.status = 'POSTED'
                    AND e.source_type IN ('STUDENT_CHARGE', 'STUDENT_CHARGE_REVERSAL')
                ), 0)
                + COALESCE((${COLLECTION_RECV_NET_SQL}), 0)
              )::text AS ops_net,
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
      const opsBal = normalizeSignedMoneyInput(row.ops_net);
      const fullBal = normalizeSignedMoneyInput(row.full_net);
      opsGlMillis += moneyToMillisSigned(opsBal);
      fullGlMillis += moneyToMillisSigned(fullBal);
      glAccounts.push({
        account_id: row.account_id,
        code: row.code,
        charge_sourced_balance: opsBal,
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

  const opsSourcedGlBalance = millisToMoney(opsGlMillis);
  const totalGlBalance = millisToMoney(fullGlMillis);
  const difference = millisToMoney(
    moneyToMillisSigned(totalStudentSubledger) -
      moneyToMillisSigned(opsSourcedGlBalance)
  );
  const unexplainedGlActivity = millisToMoney(
    moneyToMillisSigned(totalGlBalance) -
      moneyToMillisSigned(opsSourcedGlBalance)
  );

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
    journal_entry_id: string | null;
  };

  const glBySource = new Map<
    string,
    { journal_entry_id: string; source_type: string; source_id: string; netMillis: bigint }
  >();
  const ledBySource = new Map<
    string,
    {
      ledger_entry_id: string;
      entry_type: string;
      source_type: string;
      source_id: string;
      netMillis: bigint;
    }
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
      const entryType = expectedChargeLedgerEntryType(row.source_type);
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
            (le.debit_amount - le.credit_amount)::text AS ledger_net,
            le.journal_entry_id::text AS journal_entry_id
     FROM accounts.student_ledger_entries le
     WHERE le.entry_type IN (
       'CHARGE', 'CHARGE_REVERSAL', 'COLLECTION', 'COLLECTION_REVERSAL'
     )
       AND le.source_id IS NOT NULL`
  );

  for (const row of ledSources.rows) {
    if (
      row.entry_type === 'CHARGE' ||
      row.entry_type === 'CHARGE_REVERSAL'
    ) {
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
  }

  const journalWithoutLedger: StudentReceivablesOrphanJournal[] = [];
  const ledgerWithoutJournal: StudentReceivablesOrphanLedger[] = [];
  const amountMismatches: StudentReceivablesAmountMismatch[] = [];

  for (const [key, gl] of glBySource) {
    const led = ledBySource.get(key);
    const entryType = expectedChargeLedgerEntryType(gl.source_type);
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

  // تطابق تحصيلات: دفتر COLLECTION* ↔ أسطر القيد على receivable_gl لحساب الطالب فقط
  const collLed = await txQuery<{
    ledger_entry_id: string;
    entry_type: string;
    source_type: string;
    source_id: string;
    ledger_net: string;
    journal_entry_id: string | null;
    receivable_gl_account_id: string | null;
  }>(
    client,
    `SELECT le.id::text AS ledger_entry_id,
            le.entry_type,
            le.source_type,
            le.source_id::text AS source_id,
            (le.debit_amount - le.credit_amount)::text AS ledger_net,
            le.journal_entry_id::text AS journal_entry_id,
            sa.receivable_gl_account_id::text AS receivable_gl_account_id
     FROM accounts.student_ledger_entries le
     JOIN accounts.student_collections sc ON sc.id = le.source_id
     JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
     WHERE le.entry_type IN ('COLLECTION', 'COLLECTION_REVERSAL')`
  );

  for (const row of collLed.rows) {
    if (!row.journal_entry_id || !row.receivable_gl_account_id) {
      ledgerWithoutJournal.push({
        ledger_entry_id: row.ledger_entry_id,
        entry_type: row.entry_type,
        source_type: row.source_type,
        source_id: row.source_id,
        ledger_net: normalizeSignedMoneyInput(row.ledger_net),
      });
      continue;
    }

    const glNet = await txQuery<{ gl_net: string }>(
      client,
      `SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS gl_net
       FROM accounts.journal_entry_lines l
       JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
       WHERE e.id = $1::uuid
         AND e.status = 'POSTED'
         AND l.account_id = $2::uuid`,
      [row.journal_entry_id, row.receivable_gl_account_id]
    );
    const g = moneyToMillisSigned(
      normalizeSignedMoneyInput(glNet.rows[0]?.gl_net ?? '0')
    );
    const lNet = moneyToMillisSigned(normalizeSignedMoneyInput(row.ledger_net));
    if (g === BigInt(0) && lNet !== BigInt(0)) {
      ledgerWithoutJournal.push({
        ledger_entry_id: row.ledger_entry_id,
        entry_type: row.entry_type,
        source_type: row.source_type,
        source_id: row.source_id,
        ledger_net: millisToMoney(lNet),
      });
    } else if (g !== lNet) {
      amountMismatches.push({
        source_type: row.source_type,
        source_id: row.source_id,
        entry_type: row.entry_type,
        gl_net: millisToMoney(g),
        ledger_net: millisToMoney(lNet),
        difference: millisToMoney(lNet - g),
      });
    }
  }

  const chargeSubledgerMatch = moneyEquals(
    totalStudentSubledger,
    opsSourcedGlBalance
  );
  const noOrphans =
    journalWithoutLedger.length === 0 &&
    ledgerWithoutJournal.length === 0 &&
    amountMismatches.length === 0;
  const ok = chargeSubledgerMatch && noOrphans && allocationsSumOk;

  return {
    ok,
    charge_subledger_match: chargeSubledgerMatch,
    unexplained_gl_activity: unexplainedGlActivity,
    total_gl_balance: totalGlBalance,
    total_student_subledger: totalStudentSubledger,
    charge_sourced_gl_balance: opsSourcedGlBalance,
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
      collections_posted_count: collCount.rows[0]?.n ?? 0,
      allocations_sum_ok: allocationsSumOk,
      gl_accounts: glAccounts,
    },
  };
}

export function hasUnexplainedGlActivity(
  result: StudentReceivablesVerifyResult
): boolean {
  return !moneyEquals(result.unexplained_gl_activity, '0');
}
