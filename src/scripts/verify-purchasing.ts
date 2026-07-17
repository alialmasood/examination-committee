/**
 * npm run accounts:verify-purchasing
 */
import { closePool } from '../lib/db';
import { verifyPurchasing } from '../lib/accounts/verify-purchasing';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const result = await withTransaction((client) => verifyPurchasing(client));

  console.log('===== تحقق المشتريات (Purchasing 7.A) =====');
  console.log(`ok: ${result.ok}`);
  console.log('الملخص:', JSON.stringify(result.summary, null, 2));
  if (result.mismatches.length) {
    console.log('فروق:');
    for (const m of result.mismatches.slice(0, 40)) {
      console.log(`  - ${m.kind}: ${m.detail}`);
    }
    if (result.mismatches.length > 40) {
      console.log(`  ... و${result.mismatches.length - 40} أخرى`);
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
