/**
 * تحقّق (بلا كتابة) من تطابق Student Subledger مع قيود المطالبات على GL الذمم.
 *
 * npm run accounts:verify-student-receivables
 */
import { closePool } from '../lib/db';
import { verifyStudentReceivables } from '../lib/accounts/verify-student-receivables';
import { withTransaction } from '../lib/accounts/with-transaction';

async function main(): Promise<void> {
  const result = await withTransaction((client) =>
    verifyStudentReceivables(client)
  );

  console.log('===== تحقق ذمم الطلبة (Student Receivables) =====');
  console.log(`عدد الحسابات المالية: ${result.details.student_accounts_count}`);
  console.log(`عدد حركات الدفتر الفرعي: ${result.details.ledger_entries_count}`);
  console.log(
    `حسابات GL الذمم المستخدمة: ${result.details.receivable_gl_account_ids.length}`
  );
  console.log(`رصيد Subledger: ${result.subledgerBalance}`);
  console.log(`رصيد GL من قيود المطالبات: ${result.glBalance}`);
  console.log(`الفرق (Subledger − GL مطالبات): ${result.difference}`);
  console.log(
    `نشاط GL آخر على نفس الحسابات (غير مطالبات): ${result.unexplainedGlBalance}`
  );

  for (const g of result.details.gl_accounts) {
    console.log(
      `  - ${g.code ?? g.account_id}: مطالبات=${g.charge_sourced_balance} · كامل=${g.full_gl_balance}`
    );
  }

  if (result.ok) {
    console.log('✅ Subledger متطابق مع قيود STUDENT_CHARGE على GL الذمم.');
    return;
  }

  console.error('❌ عدم تطابق بين دفتر الطلبة وقيود المطالبات.');
  process.exitCode = 1;
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
