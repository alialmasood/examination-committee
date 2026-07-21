/**
 * CLI: تحقق نهائي لسلسلة الرواتب حتى الترحيل (9.C.2)
 * npm run accounts:verify-payroll-final
 * npm run accounts:verify-payroll-final:strict
 *
 * يطبع JSON مختصر: ok + modules/mismatch — exit غير صفري عند الفشل.
 */
import { closePool } from '../lib/db';
import { verifyPayrollFinal } from '../lib/accounts/verify-payroll-final';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(
    `===== تحقق نهائي لسلسلة الرواتب حتى الترحيل (9.C.2)${strict ? ' — STRICT' : ''} =====`
  );
  const result = await withTransaction((c) => verifyPayrollFinal(c, { strict }));
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        modules: result.modules,
        mismatch_count: result.mismatch_count,
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