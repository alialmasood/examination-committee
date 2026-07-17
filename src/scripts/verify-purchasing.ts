/**
 * npm run accounts:verify-purchasing
 * npm run accounts:verify-purchasing:strict
 * npx tsx src/scripts/verify-purchasing.ts --strict
 */
import { closePool } from '../lib/db';
import { verifyPurchasing } from '../lib/accounts/verify-purchasing';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');
  const result = await withTransaction((client) => verifyPurchasing(client, { strict }));

  console.log('===== تحقق المشتريات (Purchasing 7.A) =====');
  console.log(`strict: ${result.strict}`);
  console.log(`ok: ${result.ok}`);
  console.log(`mismatches: ${result.mismatches.length}`);
  console.log(`warnings: ${result.warnings.length}`);
  console.log(`unexplained: ${result.unexplained.length}`);
  console.log('الملخص:', JSON.stringify(result.summary, null, 2));
  if (result.mismatches.length) {
    console.log('فروق:');
    for (const m of result.mismatches.slice(0, 40)) {
      console.log(`  - ${m.kind}: ${m.detail}`);
    }
  }
  if (result.warnings.length) {
    console.log('تحذيرات:');
    for (const m of result.warnings.slice(0, 20)) {
      console.log(`  - ${m.kind}: ${m.detail}`);
    }
  }

  if (!result.ok) {
    console.error('❌ فشل التحقق للمشتريات');
    process.exitCode = 1;
    return;
  }
  console.log('✅ تحقق المشتريات ناجح');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
