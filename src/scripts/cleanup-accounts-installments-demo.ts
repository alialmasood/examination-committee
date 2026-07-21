/**
 * حذف بيانات تجريبية تظهر في /accounts/installments
 * (طلاب payment_status=paid/pending ذوو معرفات اختبار — مع الإبقاء على SH%).
 *
 * npm run cleanup:accounts-installments-demo
 */
import { closePool, query } from '../lib/db';

const TEST_STUDENT_FILTER = `
  (
    university_id ~ '^(DTL|DB|SR|DEMO|CN)'
    OR university_id ILIKE 'DTP%'
    OR full_name_ar ILIKE '%اختبار%'
    OR full_name_ar ILIKE '%DEMO%'
    OR full_name_ar ILIKE '%طالب 5.%'
  )
  AND university_id NOT ILIKE 'SH%'
`;

async function count(sql: string, params: any[] = []) {
  const r = await query(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  console.log('===== تنظيف بيانات تجريبية — /accounts/installments =====');

  const students = await query(
    `SELECT id::text, university_id FROM student_affairs.students
     WHERE ${TEST_STUDENT_FILTER}`
  );
  const ids = students.rows.map((r) => r.id);
  console.log(`طلاب مستهدفون: ${ids.length}`);
  if (!ids.length) {
    console.log('لا يوجد شيء للحذف');
    await closePool();
    return;
  }

  const accountIds = (
    await query(
      `SELECT id::text FROM accounts.student_accounts WHERE student_id = ANY($1::uuid[])`,
      [ids]
    )
  ).rows.map((r) => r.id);
  console.log(`حسابات مالية مرتبطة: ${accountIds.length}`);

  // —— حسابات الطلبة المرتبطة (إن وُجدت) ——
  if (accountIds.length) {
    await query(
      `DELETE FROM accounts.student_refund_allocations
       WHERE refund_id IN (
         SELECT id FROM accounts.student_refunds WHERE student_account_id = ANY($1::uuid[])
       )`,
      [accountIds]
    );
    await query(
      `DELETE FROM accounts.student_collection_allocations
       WHERE collection_id IN (
         SELECT id FROM accounts.student_collections WHERE student_account_id = ANY($1::uuid[])
       )`,
      [accountIds]
    );
    await query(
      `UPDATE accounts.student_refunds SET cash_voucher_id=NULL, bank_voucher_id=NULL
       WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(`DELETE FROM accounts.student_refunds WHERE student_account_id = ANY($1::uuid[])`, [
      accountIds,
    ]);
    await query(
      `DELETE FROM accounts.student_credit_notes WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(`DELETE FROM accounts.student_reliefs WHERE student_account_id = ANY($1::uuid[])`, [
      accountIds,
    ]);
    await query(
      `DELETE FROM accounts.student_collections WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(
      `DELETE FROM accounts.student_installments
       WHERE billing_plan_id IN (
         SELECT id FROM accounts.student_billing_plans WHERE student_account_id = ANY($1::uuid[])
       )`,
      [accountIds]
    );
    await query(
      `DELETE FROM accounts.student_billing_plans WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(
      `DELETE FROM accounts.student_ledger_entries WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(
      `UPDATE accounts.student_charges
       SET journal_entry_id=NULL, reversal_journal_entry_id=NULL
       WHERE student_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
    await query(`DELETE FROM accounts.student_charges WHERE student_account_id = ANY($1::uuid[])`, [
      accountIds,
    ]);
    await query(`DELETE FROM accounts.student_accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
  }

  // خطط/أقساط يتيمة بمراجع اختبار
  await query(
    `DELETE FROM accounts.student_collection_allocations
     WHERE student_installment_id IN (
       SELECT si.id FROM accounts.student_installments si
       JOIN accounts.student_billing_plans bp ON bp.id = si.billing_plan_id
       WHERE bp.external_reference ILIKE 'TPL-%' OR bp.external_reference ILIKE 'TST-%'
          OR bp.external_reference ILIKE 'DEMO-%'
     )`
  ).catch(() => undefined);

  await query(
    `DELETE FROM accounts.student_installments
     WHERE billing_plan_id IN (
       SELECT id FROM accounts.student_billing_plans
       WHERE external_reference ILIKE 'TPL-%' OR external_reference ILIKE 'TST-%'
          OR external_reference ILIKE 'DEMO-%'
     )`
  );
  await query(
    `DELETE FROM accounts.student_billing_plans
     WHERE external_reference ILIKE 'TPL-%' OR external_reference ILIKE 'TST-%'
        OR external_reference ILIKE 'DEMO-%'`
  );

  // —— حذف طلاب الاختبار من شؤون الطلبة ——
  // فك أي جداول شؤون مرتبطة شائعة إن وُجدت
  for (const tbl of [
    'student_documents',
    'student_notes',
    'student_history',
    'student_attachments',
  ]) {
    await query(
      `DELETE FROM student_affairs.${tbl} WHERE student_id = ANY($1::uuid[])`,
      [ids]
    ).catch(() => undefined);
  }

  await query(`DELETE FROM student_affairs.students WHERE id = ANY($1::uuid[])`, [ids]);

  const leftoverTest = await count(
    `SELECT COUNT(*)::int n FROM student_affairs.students WHERE ${TEST_STUDENT_FILTER}`
  );
  const paidLeft = await count(
    `SELECT COUNT(*)::int n FROM student_affairs.students
     WHERE COALESCE((to_jsonb(students)->>'payment_status'), 'pending') = 'paid'`
  );
  const paidSh = await count(
    `SELECT COUNT(*)::int n FROM student_affairs.students
     WHERE COALESCE((to_jsonb(students)->>'payment_status'), 'pending') = 'paid'
       AND university_id ILIKE 'SH%'`
  );
  const pendingLeft = await count(
    `SELECT COUNT(*)::int n FROM student_affairs.students
     WHERE COALESCE(payment_status, (to_jsonb(students)->>'payment_status'), 'pending') = 'pending'`
  );

  console.log('المتبقي:', {
    test_students: leftoverTest,
    paid_total: paidLeft,
    paid_SH_kept: paidSh,
    pending: pendingLeft,
  });

  if (leftoverTest > 0) {
    console.error('بقيت طلاب اختبار — راجع قيود FK');
    process.exitCode = 1;
  } else {
    console.log('✓ نُظّفت البيانات التجريبية من صفحة الأقساط (أُبقي طلاب SH إن وُجدوا)');
  }

  await closePool();
}

main().catch(async (e) => {
  console.error('فشل التنظيف:', e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
