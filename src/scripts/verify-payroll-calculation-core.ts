#!/usr/bin/env tsx
import { closePool } from '../lib/db';
import { verifyPayrollCalculationCore } from '../lib/accounts/verify-payroll-calculation-core';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق نواة احتساب الرواتب (9.A.2.3.1)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) => verifyPayrollCalculationCore(c, { strict }));
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
  for (const m of result.mismatches.slice(0, 30)) {
    console.log(`  - ${m.kind}: ${m.detail}`);
  }
  for (const m of result.warnings.slice(0, 20)) {
    console.log(`  - warn ${m.kind}: ${m.detail}`);
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
