/**
 * npm run accounts:verify-supplier-payables
 * npm run accounts:verify-supplier-payables -- --strict
 */
import { closePool } from '../lib/db';
import {
  hasUnexplainedGlActivity,
  verifySupplierPayables,
} from '../lib/accounts/verify-supplier-payables';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');
  const result = await withTransaction((client) =>
    verifySupplierPayables(client)
  );

  console.log('===== تحقق ذمم الموردين (Supplier Payables 6.A) =====');
  console.log(`الوضع: ${strict ? 'strict' : 'عادي'}`);
  console.log(`ok: ${result.ok}`);
  console.log(`invoice_ledger_match: ${result.invoice_ledger_match}`);
  console.log(`void_reversal_ok: ${result.void_reversal_ok}`);
  console.log(`outstanding_ok: ${result.outstanding_ok}`);
  console.log(`gl_subledger_match: ${result.gl_subledger_match}`);
  console.log(`unexplained_gl_activity: ${result.unexplained_gl_activity}`);
  console.log('الملخص:', JSON.stringify(result.summary, null, 2));
  if (result.mismatches.length) {
    console.log('فروق:');
    for (const m of result.mismatches.slice(0, 40)) {
      console.log(`  - ${m.kind}: ${m.detail}`);
    }
  }

  if (!result.ok) {
    console.error('❌ فشل التحقق العادي لذمم الموردين');
    process.exitCode = 1;
    return;
  }

  if (strict && hasUnexplainedGlActivity(result)) {
    console.error(
      '❌ --strict: نشاط GL غير مفسَّر على Payables ≠ 0'
    );
    process.exitCode = 1;
    return;
  }

  console.log('✅ تحقق ذمم الموردين ناجح');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
