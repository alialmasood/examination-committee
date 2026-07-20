/**
 * CLI: accounts:verify-payroll-approval-core [--strict]
 */
import { closePool } from '../lib/db';
import { verifyPayrollApprovalCore } from '../lib/accounts/verify-payroll-approval-core';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  const result = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict }));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('VERIFY FAILED');
    process.exitCode = 1;
  } else {
    console.log(strict ? 'VERIFY OK (strict)' : 'VERIFY OK');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
