import fs from "fs";
const path = "src/scripts/cleanup-accounts-entries-demo.ts";
let s = fs.readFileSync(path, "utf8");
const old = `{
      label: 'cash_count_adjustments',
      sql: \`UPDATE accounts.cash_count_adjustments SET journal_entry_id = NULL
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`.replace(/\n/g, "\r\n");
const neu = `{
      label: 'cash_count_adjustments',
      sql: \`DELETE FROM accounts.cash_count_adjustments
            WHERE journal_entry_id = ANY($1::uuid[])\`,
    },`.replace(/\n/g, "\r\n");
if (!s.includes(old)) { console.error("not found"); process.exit(1); }
s = s.replace(old, neu);
fs.writeFileSync(path, s, "utf8");
console.log("ok");
