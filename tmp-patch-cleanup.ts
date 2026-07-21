import fs from "fs";
const path = "src/scripts/cleanup-accounts-entries-demo.ts";
let s = fs.readFileSync(path, "utf8");

function norm(block: string) {
  // match file's CRLF
  return block.replace(/\n/g, "\r\n");
}

const oldCashTransfers = norm(`{
      label: 'cash_transfers',
      sql: \`UPDATE accounts.cash_transfers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`);

const newCashTransfers = norm(`{
      label: 'cash_transfers',
      sql: \`UPDATE accounts.cash_transfers
            SET dispatch_journal_entry_id = NULL,
                receipt_journal_entry_id = NULL,
                reversal_journal_entry_id = NULL
            WHERE dispatch_journal_entry_id = ANY($1::uuid[])
               OR receipt_journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`);

if (!s.includes(oldCashTransfers)) {
  console.error("cash_transfers block not found");
  process.exit(1);
}
s = s.replace(oldCashTransfers, newCashTransfers);

const insertAfterBankTransfers = norm(`{
      label: 'bank_transfers',
      sql: \`UPDATE accounts.bank_transfers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`);

const extraAfterBank = norm(`{
      label: 'bank_transfers',
      sql: \`UPDATE accounts.bank_transfers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'bank_transfers.reversal',
      sql: \`UPDATE accounts.bank_transfers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'cash_vouchers.reversal',
      sql: \`UPDATE accounts.cash_vouchers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'bank_vouchers.reversal',
      sql: \`UPDATE accounts.bank_vouchers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'cash_box_sessions',
      sql: \`UPDATE accounts.cash_box_sessions SET opening_last_posted_entry_id = NULL
            WHERE opening_last_posted_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'cash_counts',
      sql: \`UPDATE accounts.cash_counts SET last_posted_entry_id_at_count = NULL
            WHERE last_posted_entry_id_at_count = ANY($1::uuid[])\`,
    },
    {
      label: 'depreciation_runs',
      sql: \`UPDATE accounts.depreciation_runs
            SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'asset_disposals',
      sql: \`UPDATE accounts.asset_disposals
            SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },
    {
      label: 'bank_reconciliation_matches',
      sql: \`DELETE FROM accounts.bank_reconciliation_matches
            WHERE journal_entry_id = ANY($1::uuid[])
               OR journal_entry_line_id IN (
                    SELECT id FROM accounts.journal_entry_lines
                    WHERE journal_entry_id = ANY($1::uuid[])
                  )\`,
    },
    {
      label: 'gl_balance_applications',
      sql: \`DELETE FROM accounts.gl_balance_applications
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`);

if (!s.includes(insertAfterBankTransfers)) {
  console.error("bank_transfers nullTarget block not found");
  // show nearby
  const idx = s.indexOf("label: 'bank_transfers'");
  console.log(JSON.stringify(s.slice(idx, idx + 200)));
  process.exit(1);
}
if (s.includes("bank_reconciliation_matches")) {
  console.log("bank_reconciliation_matches already present");
} else {
  s = s.replace(insertAfterBankTransfers, extraAfterBank);
}

const oldReliefs = norm(`{
      label: 'student_reliefs',
      sql: \`UPDATE accounts.student_reliefs SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`);
const newReliefs = norm(`{
      label: 'student_reliefs',
      sql: \`UPDATE accounts.student_reliefs
            SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`);
if (s.includes(oldReliefs)) s = s.replace(oldReliefs, newReliefs);
else console.log("reliefs skip");

const oldCN = norm(`{
      label: 'student_credit_notes',
      sql: \`UPDATE accounts.student_credit_notes SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`);
const newCN = norm(`{
      label: 'student_credit_notes',
      sql: \`UPDATE accounts.student_credit_notes
            SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`);
if (s.includes(oldCN)) s = s.replace(oldCN, newCN);
else console.log("credit notes skip");

fs.writeFileSync(path, s, "utf8");
console.log("patched OK");
