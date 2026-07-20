/**
 * CLI: تحقق تكامل إرسال الرواتب للمراجعة 9.B.2
 * npm run accounts:verify-payroll-submit-review-integration
 * npm run accounts:verify-payroll-submit-review-integration:strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollSubmitReviewIntegration } from '../lib/accounts/verify-payroll-submit-review-integration';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق تكامل إرسال الرواتب للمراجعة (9.B.2)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollSubmitReviewIntegration(c, { strict })
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
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
