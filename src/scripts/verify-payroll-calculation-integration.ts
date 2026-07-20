#!/usr/bin/env tsx
import { closePool } from '../lib/db';
import { verifyPayrollCalculationIntegration } from '../lib/accounts/verify-payroll-calculation-integration';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق تكامل احتساب الرواتب (9.A.2.3.2)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollCalculationIntegration(c, { strict })
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
        core_mismatches: result.mismatches.length,
        core_warnings: result.warnings.length,
        integration_mismatches: result.integration_mismatches.length,
        integration_warnings: result.integration_warnings.length,
        summary: result.summary,
      },
      null,
      2
    )
  );
  for (const m of result.mismatches.slice(0, 20)) {
    console.log(`  - core ${m.kind}: ${m.detail}`);
  }
  for (const m of result.integration_mismatches.slice(0, 20)) {
    console.log(`  - integration ${m.kind}: ${m.detail}`);
  }
  for (const m of result.warnings.slice(0, 10)) {
    console.log(`  - warn core ${m.kind}: ${m.detail}`);
  }
  for (const m of result.integration_warnings.slice(0, 10)) {
    console.log(`  - warn integration ${m.kind}: ${m.detail}`);
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
