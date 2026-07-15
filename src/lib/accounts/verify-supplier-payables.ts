/**
 * تحقق ذمم الموردين (6.A):
 * يقارن فواتير POSTED/VOID مع الدفتر الفرعي وقيود GL و outstanding.
 */
import {
  moneyEquals,
  moneyToMillisSigned,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierPayablesVerifyResult = {
  ok: boolean;
  invoice_ledger_match: boolean;
  void_reversal_ok: boolean;
  outstanding_ok: boolean;
  gl_subledger_match: boolean;
  unexplained_gl_activity: string;
  mismatches: Array<{
    kind: string;
    invoice_id?: string;
    detail: string;
  }>;
  summary: {
    posted_invoices: number;
    void_posted_invoices: number;
    ledger_invoice_entries: number;
    ledger_reversal_entries: number;
    payables_gl_net_from_ap_sources: string;
    supplier_ledger_net: string;
  };
};

function ms(v: string): bigint {
  return moneyToMillisSigned(v);
}

export function hasUnexplainedGlActivity(
  result: SupplierPayablesVerifyResult
): boolean {
  return !moneyEquals(result.unexplained_gl_activity, '0.000');
}

export async function verifySupplierPayables(
  client: TxClient
): Promise<SupplierPayablesVerifyResult> {
  const mismatches: SupplierPayablesVerifyResult['mismatches'] = [];

  const posted = await txQuery<{
    id: string;
    invoice_number: string;
    total_amount: string;
    outstanding_amount: string;
    status: string;
    journal_entry_id: string | null;
    reversal_journal_entry_id: string | null;
  }>(
    client,
    `SELECT id, invoice_number, total_amount::text, outstanding_amount::text,
            status, journal_entry_id, reversal_journal_entry_id
     FROM accounts.supplier_invoices
     WHERE status IN ('POSTED', 'VOID')`
  );

  let invoiceLedgerMatch = true;
  let voidReversalOk = true;
  let outstandingOk = true;

  for (const inv of posted.rows) {
    const led = await txQuery<{
      credits: string;
      debits: string;
      inv_cnt: number;
      rev_cnt: number;
    }>(
      client,
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'INVOICE' THEN credit_amount ELSE 0 END),0)::text AS credits,
         COALESCE(SUM(CASE WHEN entry_type = 'INVOICE_REVERSAL' THEN debit_amount ELSE 0 END),0)::text AS debits,
         COUNT(*) FILTER (WHERE entry_type = 'INVOICE')::int AS inv_cnt,
         COUNT(*) FILTER (WHERE entry_type = 'INVOICE_REVERSAL')::int AS rev_cnt
       FROM accounts.supplier_ledger_entries
       WHERE source_id = $1::uuid
         AND entry_type IN ('INVOICE', 'INVOICE_REVERSAL')`,
      [inv.id]
    );
    const row = led.rows[0];
    const total = normalizeMoneyInput(inv.total_amount);

    if (inv.status === 'POSTED') {
      if (row.inv_cnt !== 1 || !moneyEquals(row.credits, total)) {
        invoiceLedgerMatch = false;
        mismatches.push({
          kind: 'POSTED_LEDGER',
          invoice_id: inv.id,
          detail: `${inv.invoice_number}: ledger credit=${row.credits} expected=${total}`,
        });
      }
      if (row.rev_cnt !== 0) {
        invoiceLedgerMatch = false;
        mismatches.push({
          kind: 'POSTED_HAS_REVERSAL',
          invoice_id: inv.id,
          detail: inv.invoice_number,
        });
      }
      if (!moneyEquals(inv.outstanding_amount, total)) {
        outstandingOk = false;
        mismatches.push({
          kind: 'OUTSTANDING',
          invoice_id: inv.id,
          detail: `${inv.invoice_number}: outstanding=${inv.outstanding_amount}`,
        });
      }
      if (!inv.journal_entry_id) {
        mismatches.push({
          kind: 'MISSING_JE',
          invoice_id: inv.id,
          detail: inv.invoice_number,
        });
        invoiceLedgerMatch = false;
      }
    }

    if (inv.status === 'VOID' && inv.journal_entry_id) {
      if (row.inv_cnt !== 1 || row.rev_cnt !== 1) {
        voidReversalOk = false;
        mismatches.push({
          kind: 'VOID_LEDGER',
          invoice_id: inv.id,
          detail: `${inv.invoice_number}: inv=${row.inv_cnt} rev=${row.rev_cnt}`,
        });
      }
      if (!moneyEquals(row.credits, total) || !moneyEquals(row.debits, total)) {
        voidReversalOk = false;
        mismatches.push({
          kind: 'VOID_LEDGER_AMOUNT',
          invoice_id: inv.id,
          detail: inv.invoice_number,
        });
      }
      if (!moneyEquals(inv.outstanding_amount, '0.000')) {
        outstandingOk = false;
        mismatches.push({
          kind: 'VOID_OUTSTANDING',
          invoice_id: inv.id,
          detail: inv.invoice_number,
        });
      }
      if (!inv.reversal_journal_entry_id) {
        voidReversalOk = false;
        mismatches.push({
          kind: 'VOID_MISSING_REVERSAL_JE',
          invoice_id: inv.id,
          detail: inv.invoice_number,
        });
      }
    }
  }

  // صافي دفتر فرعي (بدون OPENING_REFERENCE)
  const subNet = await txQuery<{ net: string }>(
    client,
    `SELECT COALESCE(SUM(credit_amount - debit_amount), 0)::text AS net
     FROM accounts.supplier_ledger_entries
     WHERE entry_type <> 'OPENING_REFERENCE'`
  );

  // صافي Payables من مصادر فواتير الموردين فقط (بدون تضاعف JOIN)
  const apFromSources = await txQuery<{ net: string }>(
    client,
    `SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines jl
     JOIN accounts.journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status = 'POSTED'
       AND je.source_type IN ('SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_REVERSAL')
       AND jl.account_id IN (
         SELECT DISTINCT payable_gl_account_id FROM accounts.supplier_accounts
       )`
  );

  // إجمالي نشاط Payables GL المرتبط بحسابات موردين
  const apAllActivity = await txQuery<{ net: string }>(
    client,
    `SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines jl
     JOIN accounts.journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status = 'POSTED'
       AND jl.account_id IN (
         SELECT DISTINCT payable_gl_account_id FROM accounts.supplier_accounts
       )`
  );

  const unexplainedMillis =
    ms(apAllActivity.rows[0]?.net ?? '0') -
    ms(apFromSources.rows[0]?.net ?? '0');
  const unexplained =
    unexplainedMillis === BigInt(0)
      ? '0.000'
      : (() => {
          const neg = unexplainedMillis < BigInt(0);
          const abs = neg ? -unexplainedMillis : unexplainedMillis;
          const intPart = abs / BigInt(1000);
          const frac = (abs % BigInt(1000)).toString().padStart(3, '0');
          return `${neg ? '-' : ''}${intPart}.${frac}`;
        })();

  const glMatch = moneyEquals(
    subNet.rows[0]?.net ?? '0',
    apFromSources.rows[0]?.net ?? '0'
  );
  if (!glMatch) {
    mismatches.push({
      kind: 'GL_SUBLEDGER',
      detail: `subledger=${subNet.rows[0]?.net} gl_ap_sources=${apFromSources.rows[0]?.net}`,
    });
  }

  const ledgerCounts = await txQuery<{
    inv: number;
    rev: number;
  }>(
    client,
    `SELECT
       COUNT(*) FILTER (WHERE entry_type = 'INVOICE')::int AS inv,
       COUNT(*) FILTER (WHERE entry_type = 'INVOICE_REVERSAL')::int AS rev
     FROM accounts.supplier_ledger_entries`
  );

  const postedCount = posted.rows.filter((r) => r.status === 'POSTED').length;
  const voidPosted = posted.rows.filter(
    (r) => r.status === 'VOID' && r.journal_entry_id
  ).length;

  const ok =
    invoiceLedgerMatch &&
    voidReversalOk &&
    outstandingOk &&
    glMatch &&
    mismatches.length === 0;

  return {
    ok,
    invoice_ledger_match: invoiceLedgerMatch,
    void_reversal_ok: voidReversalOk,
    outstanding_ok: outstandingOk,
    gl_subledger_match: glMatch,
    unexplained_gl_activity: unexplained,
    mismatches,
    summary: {
      posted_invoices: postedCount,
      void_posted_invoices: voidPosted,
      ledger_invoice_entries: ledgerCounts.rows[0]?.inv ?? 0,
      ledger_reversal_entries: ledgerCounts.rows[0]?.rev ?? 0,
      payables_gl_net_from_ap_sources: normalizeSignedMoneyInput(
        apFromSources.rows[0]?.net ?? '0'
      ),
      supplier_ledger_net: normalizeSignedMoneyInput(
        subNet.rows[0]?.net ?? '0'
      ),
    },
  };
}
