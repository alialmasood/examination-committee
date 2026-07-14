/**
 * تحقّق (بلا كتابة) من تطابق Student Subledger مع قيود المطالبات على GL الذمم.
 *
 * npm run accounts:verify-student-receivables
 * npm run accounts:verify-student-receivables -- --strict
 *
 * الوضع العادي: يفشل عند عدم تطابق A↔B (!ok / !charge_subledger_match).
 * --strict: يفشل أيضاً إن كان unexplained_gl_activity ≠ 0.
 */
import { closePool } from '../lib/db';
import {
  hasUnexplainedGlActivity,
  verifyStudentReceivables,
} from '../lib/accounts/verify-student-receivables';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');

  const result = await withTransaction((client) =>
    verifyStudentReceivables(client)
  );

  console.log('===== تحقق ذمم الطلبة (Student Receivables) =====');
  console.log(`الوضع: ${strict ? 'strict' : 'عادي'}`);
  console.log(`عدد الحسابات المالية: ${result.details.student_accounts_count}`);
  console.log(`عدد حركات الدفتر الفرعي: ${result.details.ledger_entries_count}`);
  console.log(
    `حسابات GL الذمم المستخدمة: ${result.details.receivable_gl_account_ids.length}`
  );
  console.log(`Subledger (B): ${result.total_student_subledger}`);
  console.log(
    `GL عمليات الذمم (A): ${result.charge_sourced_gl_balance} (مطالبات + تحصيلات)`
  );
  console.log(`الفرق (B − A): ${result.difference}`);
  console.log(`إجمالي GL على الذمم: ${result.total_gl_balance}`);
  console.log(`نشاط GL غير مفسَّر: ${result.unexplained_gl_activity}`);
  console.log(`تحصيلات مرحّلة: ${result.details.collections_posted_count}`);
  console.log(`allocations_sum_ok: ${result.details.allocations_sum_ok}`);
  console.log(`charge_subledger_match: ${result.charge_subledger_match}`);
  console.log(`ok: ${result.ok}`);

  const o = result.orphans;
  console.log(
    `أيتام: JE بلا دفتر=${o.journal_without_ledger.length} · دفتر بلا JE=${o.ledger_without_journal.length} · فروق مبلغ=${o.amount_mismatches.length}`
  );

  for (const g of result.details.gl_accounts) {
    console.log(
      `  - ${g.code ?? g.account_id}: عمليات=${g.charge_sourced_balance} · كامل=${g.full_gl_balance}`
    );
  }

  if (!result.ok || !result.charge_subledger_match) {
    console.error(
      '❌ عدم تطابق A↔B (عمليات الذمم ↔ الدفتر الفرعي) أو أيتام/فروق/تخصيصات.'
    );
    process.exitCode = 1;
    return;
  }

  if (strict && hasUnexplainedGlActivity(result)) {
    console.error(
      '❌ --strict: يوجد نشاط GL غير مفسَّر على حسابات الذمم (قيود غير عمليات الطلبة).'
    );
    process.exitCode = 1;
    return;
  }

  if (hasUnexplainedGlActivity(result)) {
    console.log(
      '⚠️ توجد قيود غير عمليات طلبة على نفس GL الذمم (unexplained) — الوضع العادي يعتبر A↔B ناجحاً.'
    );
  }

  console.log(
    '✅ Subledger متطابق مع قيود المطالبات وتحصيلات الطلبة على GL الذمم.'
  );
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error('❌ فشل التحقق:', e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
