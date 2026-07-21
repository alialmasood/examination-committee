/**
 * CLI: تحقق نهائي لمسار اعتماد الرواتب 9.B.4
 * npm run accounts:verify-payroll-approval-workflow
 * npm run accounts:verify-payroll-approval-workflow:strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollApprovalWorkflow } from '../lib/accounts/verify-payroll-approval-workflow';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق مسار اعتماد الرواتب النهائي (9.B.4)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) =>
    verifyPayrollApprovalWorkflow(c, { strict })
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        strict: result.strict,
        mismatch_count: result.mismatch_count,
        mismatches: result.mismatches.length,
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
