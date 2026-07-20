#!/usr/bin/env tsx
import { closePool } from '../lib/db';
import { verifyPayrollRecalculateCore } from '../lib/accounts/verify-payroll-recalculate-core';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق نواة إعادة احتساب الرواتب (9.A.2.4.1)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollRecalculateCore(c, { strict })
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
        mismatches: result.mismatches.length,
        warnings: result.warnings.length,
        summary: result.summary,
      },
      null,
      2
    )
  );
  for (const m of result.mismatches.slice(0, 40)) {
    console.log(`  - ${m.kind}: ${m.detail}`);
  }
  for (const w of result.warnings.slice(0, 20)) {
    console.log(`  - warn ${w.kind}: ${w.detail}`);
  }
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
