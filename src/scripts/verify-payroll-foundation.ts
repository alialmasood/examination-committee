/**
 * npm run accounts:verify-payroll-foundation
 * npm run accounts:verify-payroll-foundation:strict
 * npx tsx src/scripts/verify-payroll-foundation.ts --strict
 */
import { closePool } from '../lib/db';
import { verifyPayrollFoundation } from '../lib/accounts/verify-payroll-foundation';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');
  const result = await withTransaction((client) => verifyPayrollFoundation(client, { strict }));

  console.log('===== تحقق أساس الرواتب (Payroll Foundation 9.A.1) =====');
  console.log(`strict: ${result.strict}`);
  console.log(`ok: ${result.ok}`);
  console.log(`mismatches: ${result.mismatches.length}`);
  console.log(`warnings: ${result.warnings.length}`);
  console.log(`unexplained: ${result.unexplained.length}`);
  console.log('الملخص:', JSON.stringify(result.summary, null, 2));
  if (result.mismatches.length) {
    console.log('فروق:');
    for (const m of result.mismatches.slice(0, 50)) console.log(`  - ${m.kind}: ${m.detail}`);
  }
  if (result.warnings.length) {
    console.log('تحذيرات:');
    for (const m of result.warnings.slice(0, 30)) console.log(`  - ${m.kind}: ${m.detail}`);
  }
  if (result.unexplained.length) {
    console.log('غير مفسَّر:');
    for (const m of result.unexplained.slice(0, 30)) console.log(`  - ${m.kind}: ${m.detail}`);
  }

  if (!result.ok) {
    console.error('❌ فشل تحقق أساس الرواتب');
    process.exitCode = 1;
    return;
  }
  console.log('✅ تحقق أساس الرواتب ناجح');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
