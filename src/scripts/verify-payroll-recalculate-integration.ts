/**
 * CLI: تحقق تكامل إعادة احتساب الرواتب 9.A.2.4.2
 * npm run accounts:verify-payroll-recalculate-integration
 * npm run accounts:verify-payroll-recalculate-integration:strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollRecalculateIntegration } from '../lib/accounts/verify-payroll-recalculate-integration';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق تكامل إعادة احتساب الرواتب (9.A.2.4.2)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollRecalculateIntegration(c, { strict })
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
        core_ok: result.core_ok,
        mismatches: result.mismatches.length,
        warnings: result.warnings.length,
        summary: result.summary,
        sample: result.mismatches.slice(0, 5),
      },
      null,
      2
    )
  );
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
