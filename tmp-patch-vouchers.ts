import fs from "fs";
const path = "src/scripts/cleanup-accounts-entries-demo.ts";
let s = fs.readFileSync(path, "utf8");

function crlf(block: string) {
  return block.replace(/\n/g, "\r\n");
}

const replacements: [string, string][] = [
  [
    `{
      label: 'cash_vouchers',
      sql: \`UPDATE accounts.cash_vouchers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`,
    `{
      label: 'cash_vouchers',
      sql: \`DELETE FROM accounts.cash_vouchers
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  ],
  [
    `{
      label: 'bank_vouchers',
      sql: \`UPDATE accounts.bank_vouchers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`,
    `{
      label: 'bank_vouchers',
      sql: \`DELETE FROM accounts.bank_vouchers
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  ],
  [
    `{
      label: 'bank_transfers',
      sql: \`UPDATE accounts.bank_transfers SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`,
    `{
      label: 'bank_transfers',
      sql: \`DELETE FROM accounts.bank_transfers
            WHERE journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  ],
  [
    `{
      label: 'cash_transfers',
      sql: \`UPDATE accounts.cash_transfers
            SET dispatch_journal_entry_id = NULL,
                receipt_journal_entry_id = NULL,
                reversal_journal_entry_id = NULL
            WHERE dispatch_journal_entry_id = ANY($1::uuid[])
               OR receipt_journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
    `{
      label: 'cash_transfers',
      sql: \`DELETE FROM accounts.cash_transfers
            WHERE dispatch_journal_entry_id = ANY($1::uuid[])
               OR receipt_journal_entry_id = ANY($1::uuid[])
               OR reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  ],
];

// remove separate reversal-only updates that become redundant
const removeBlocks = [
  `{
      label: 'bank_transfers.reversal',
      sql: \`UPDATE accounts.bank_transfers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  `{
      label: 'cash_vouchers.reversal',
      sql: \`UPDATE accounts.cash_vouchers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
  `{
      label: 'bank_vouchers.reversal',
      sql: \`UPDATE accounts.bank_vouchers SET reversal_journal_entry_id = NULL
            WHERE reversal_journal_entry_id = ANY($1::uuid[])\`,
    },`,
];

for (const [a, b] of replacements) {
  const old = crlf(a);
  const neu = crlf(b);
  if (!s.includes(old)) {
    console.error("missing block:\n", a.slice(0, 80));
    process.exit(1);
  }
  s = s.replace(old, neu);
}

for (const block of removeBlocks) {
  const old = crlf(block);
  if (s.includes(old)) {
    s = s.replace(old + "\r\n    ", "");
  } else {
    console.log("remove skip", block.match(/label: '([^']+)'/)?.[1]);
  }
}

// payroll: delete postings already; for runs set status then null
const oldPay = crlf(`{
      label: 'payroll_runs.posting_journal',
      sql: \`UPDATE accounts.payroll_runs
            SET posting_journal_entry_id = NULL
            WHERE posting_journal_entry_id = ANY($1::uuid[])\`,
    },`);
const newPay = crlf(`{
      label: 'payroll_runs.posting_journal',
      sql: \`UPDATE accounts.payroll_runs
            SET status = CASE WHEN status = 'POSTED' THEN 'APPROVED' ELSE status END,
                posting_journal_entry_id = NULL,
                posted_at = NULL,
                posted_by = NULL,
                posted_snapshot_hash = NULL
            WHERE posting_journal_entry_id = ANY($1::uuid[])\`,
    },`);
if (!s.includes(oldPay)) {
  console.error("payroll block missing");
  process.exit(1);
}
s = s.replace(oldPay, newPay);

fs.writeFileSync(path, s, "utf8");
console.log("patched");
