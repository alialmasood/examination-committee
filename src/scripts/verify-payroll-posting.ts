/**
 * CLI: تحقق ترحيل الرواتب 9.C.1
 * npm run accounts:verify-payroll-posting
 * npm run accounts:verify-payroll-posting:strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollPosting } from '../lib/accounts/verify-payroll-posting';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(`===== تحقق ترحيل الرواتب (9.C.1)${strict ? ' — STRICT' : ''} =====`);
  const result = await withTransaction((c) => verifyPayrollPosting(c, { strict }));
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
        mismatch_count: result.mismatch_count,
        warnings: result.warnings.length,
        summary: result.summary,
        sample: result.mismatches.slice(0, 8),
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
