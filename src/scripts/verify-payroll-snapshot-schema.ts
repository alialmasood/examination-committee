#!/usr/bin/env tsx
import { closePool } from '../lib/db';
import { verifyPayrollSnapshotSchema } from '../lib/accounts/verify-payroll-snapshot-schema';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main() {
  const strict = process.argv.includes('--strict');
  console.log(`===== تحقق مخطط لقطة الاحتساب (Payroll Snapshot Schema 9.A.2.2)${strict ? ' — STRICT' : ''} =====`);
  const result = await withTransaction((c) => verifyPayrollSnapshotSchema(c, { strict }));
  console.log(JSON.stringify({
    ok: result.ok,
    strict: result.strict,
    mismatches: result.mismatches.length,
    warnings: result.warnings.length,
    unexplained: result.unexplained.length,
    summary: result.summary,
  }, null, 2));
  if (result.mismatches.length) {
    for (const m of result.mismatches.slice(0, 20)) {
      console.log(`  - ${m.kind}: ${m.detail}`);
    }
  }
  if (result.warnings.length) {
    for (const m of result.warnings.slice(0, 20)) {
      console.log(`  - warn ${m.kind}: ${m.detail}`);
    }
  }
  if (result.unexplained.length) {
    for (const m of result.unexplained.slice(0, 20)) {
      console.log(`  - unexplained ${m.kind}: ${m.detail}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closePool(); });
