/**
 * تحقق ذمم الموردين (6.A):
 * يقارن الفواتير والدفعات مع الدفتر الفرعي وقيود GL و outstanding.
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
     WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID')`
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

    if (inv.status === 'POSTED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
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
      const paid = await txQuery<{ total: string }>(
        client,
        `SELECT COALESCE(SUM(a.allocated_amount),0)::text AS total
         FROM accounts.supplier_payment_allocations a
         JOIN accounts.supplier_payments p ON p.id = a.supplier_payment_id
         WHERE a.supplier_invoice_id = $1::uuid AND p.status = 'POSTED'`,
        [inv.id]
      );
      const expectedOutstandingMillis = ms(total) - ms(paid.rows[0]?.total ?? '0');
      const expectedOutstanding = (() => {
        const integer = expectedOutstandingMillis / BigInt(1000);
        const fraction = (expectedOutstandingMillis % BigInt(1000))
          .toString()
          .padStart(3, '0');
        return `${integer}.${fraction}`;
      })();
      const expectedStatus =
        expectedOutstandingMillis === BigInt(0)
          ? 'PAID'
          : moneyEquals(expectedOutstanding, total)
            ? 'POSTED'
            : 'PARTIALLY_PAID';
      if (
        expectedOutstandingMillis < BigInt(0) ||
        !moneyEquals(inv.outstanding_amount, expectedOutstanding) ||
        inv.status !== expectedStatus
      ) {
        outstandingOk = false;
        mismatches.push({
          kind: 'OUTSTANDING',
          invoice_id: inv.id,
          detail: `${inv.invoice_number}: outstanding=${inv.outstanding_amount} expected=${expectedOutstanding} status=${inv.status} expected_status=${expectedStatus}`,
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

  const payments = await txQuery<{
    id: string;
    payment_number: string;
    amount: string;
    status: string;
    supplier_account_id: string;
    cash_voucher_id: string | null;
    bank_voucher_id: string | null;
  }>(
    client,
    `SELECT id,payment_number,amount::text,status,supplier_account_id,cash_voucher_id,bank_voucher_id
     FROM accounts.supplier_payments WHERE status IN ('POSTED','VOID')`
  );
  for (const payment of payments.rows) {
    const ledger = await txQuery<{ debit:string; credit:string; pay_cnt:number; rev_cnt:number }>(
      client,
      `SELECT
        COALESCE(SUM(CASE WHEN entry_type='PAYMENT' THEN debit_amount ELSE 0 END),0)::text debit,
        COALESCE(SUM(CASE WHEN entry_type='PAYMENT_REVERSAL' THEN credit_amount ELSE 0 END),0)::text credit,
        COUNT(*) FILTER (WHERE entry_type='PAYMENT')::int pay_cnt,
        COUNT(*) FILTER (WHERE entry_type='PAYMENT_REVERSAL')::int rev_cnt
       FROM accounts.supplier_ledger_entries
       WHERE source_id=$1::uuid AND entry_type IN ('PAYMENT','PAYMENT_REVERSAL')`,
      [payment.id]
    );
    const allocated = await txQuery<{ total:string }>(
      client,
      `SELECT COALESCE(SUM(allocated_amount),0)::text total
       FROM accounts.supplier_payment_allocations WHERE supplier_payment_id=$1::uuid`,
      [payment.id]
    );
    const voucherId = payment.cash_voucher_id ?? payment.bank_voucher_id;
    const voucherTable = payment.cash_voucher_id ? 'cash_vouchers' : 'bank_vouchers';
    const voucher = voucherId
      ? await txQuery<{ status:string; counter_account_id:string; journal_entry_id:string|null }>(
          client,
          `SELECT status,counter_account_id,journal_entry_id FROM accounts.${voucherTable} WHERE id=$1::uuid`,
          [voucherId]
        )
      : { rows: [] as Array<{status:string;counter_account_id:string;journal_entry_id:string|null}> };
    const payable = await txQuery<{ payable_gl_account_id:string }>(
      client,
      `SELECT payable_gl_account_id FROM accounts.supplier_accounts WHERE id=$1::uuid`,
      [payment.supplier_account_id]
    );
    const l = ledger.rows[0];
    if (payment.status === 'POSTED') {
      if (l.pay_cnt !== 1 || !moneyEquals(l.debit, payment.amount) ||
          !moneyEquals(allocated.rows[0]?.total ?? '0', payment.amount) ||
          voucher.rows[0]?.status !== 'POSTED' ||
          voucher.rows[0]?.counter_account_id !== payable.rows[0]?.payable_gl_account_id) {
        invoiceLedgerMatch = false;
        mismatches.push({ kind:'PAYMENT_POSTED', detail:`${payment.payment_number}: دفتر/تخصيص/سند غير مطابق` });
      }
    } else if (payment.status === 'VOID') {
      // إلغاء مسودة: بلا سند/دفتر. إلغاء مرحّل: PAYMENT + PAYMENT_REVERSAL + سند VOID.
      if (!voucherId) {
        if (l.pay_cnt !== 0 || l.rev_cnt !== 0) {
          voidReversalOk = false;
          mismatches.push({
            kind: 'PAYMENT_VOID',
            detail: `${payment.payment_number}: إلغاء مسودة يحتوي حركات دفتر غير متوقعة`,
          });
        }
      } else if (
        l.pay_cnt !== 1 ||
        l.rev_cnt !== 1 ||
        !moneyEquals(l.debit, payment.amount) ||
        !moneyEquals(l.credit, payment.amount) ||
        !['VOID', 'POSTED'].includes(voucher.rows[0]?.status ?? '')
      ) {
        voidReversalOk = false;
        mismatches.push({ kind: 'PAYMENT_VOID', detail: `${payment.payment_number}: عكس الدفعة غير مطابق` });
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

  // صافي Payables من الفواتير وسندات الدفعات المرتبطة صراحةً بها.
  const apFromSources = await txQuery<{ net: string }>(
    client,
    `SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines jl
     JOIN accounts.journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status = 'POSTED'
       AND (
         je.source_type IN ('SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_REVERSAL')
         OR je.id IN (
           SELECT cv.journal_entry_id FROM accounts.supplier_payments sp
           JOIN accounts.cash_vouchers cv ON cv.id=sp.cash_voucher_id
           WHERE sp.status IN ('POSTED','VOID') AND cv.journal_entry_id IS NOT NULL
           UNION
           SELECT cv.reversal_journal_entry_id FROM accounts.supplier_payments sp
           JOIN accounts.cash_vouchers cv ON cv.id=sp.cash_voucher_id
           WHERE sp.status = 'VOID' AND cv.reversal_journal_entry_id IS NOT NULL
           UNION
           SELECT bv.journal_entry_id FROM accounts.supplier_payments sp
           JOIN accounts.bank_vouchers bv ON bv.id=sp.bank_voucher_id
           WHERE sp.status IN ('POSTED','VOID') AND bv.journal_entry_id IS NOT NULL
           UNION
           SELECT bv.reversal_journal_entry_id FROM accounts.supplier_payments sp
           JOIN accounts.bank_vouchers bv ON bv.id=sp.bank_voucher_id
           WHERE sp.status = 'VOID' AND bv.reversal_journal_entry_id IS NOT NULL
         )
       )
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

  // أيتام: دفتر بلا قيد / قيود ترحيل بلا دفتر INVOICE
  const ledgerNoJe = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n
     FROM accounts.supplier_ledger_entries
     WHERE entry_type IN ('INVOICE', 'INVOICE_REVERSAL')
       AND journal_entry_id IS NULL`
  );
  if ((ledgerNoJe.rows[0]?.n ?? 0) > 0) {
    invoiceLedgerMatch = false;
    mismatches.push({
      kind: 'LEDGER_WITHOUT_JOURNAL',
      detail: `count=${ledgerNoJe.rows[0].n}`,
    });
  }

  const jeNoLedger = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n
     FROM accounts.journal_entries je
     WHERE je.status = 'POSTED'
       AND je.source_type = 'SUPPLIER_INVOICE'
       AND NOT EXISTS (
         SELECT 1 FROM accounts.supplier_ledger_entries le
         WHERE le.source_id = je.source_id
           AND le.entry_type = 'INVOICE'
       )`
  );
  if ((jeNoLedger.rows[0]?.n ?? 0) > 0) {
    invoiceLedgerMatch = false;
    mismatches.push({
      kind: 'JOURNAL_WITHOUT_LEDGER',
      detail: `count=${jeNoLedger.rows[0].n}`,
    });
  }

  const postedCount = posted.rows.filter((r) => ['POSTED','PARTIALLY_PAID','PAID'].includes(r.status)).length;
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
