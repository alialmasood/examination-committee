/**
 * CLI: تحقق تكامل قرار اعتماد/رفض الرواتب 9.B.3
 * npm run accounts:verify-payroll-approval-decision-integration
 * npm run accounts:verify-payroll-approval-decision-integration:strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollApprovalDecisionIntegration } from '../lib/accounts/verify-payroll-approval-decision-integration';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق تكامل قرار اعتماد/رفض الرواتب (9.B.3)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollApprovalDecisionIntegration(c, { strict })
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
