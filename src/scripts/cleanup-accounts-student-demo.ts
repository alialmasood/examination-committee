/**
 * حذف بيانات DEMO لحسابات الطلبة فقط — لا يمس بيانات حقيقية.
 * npm run cleanup:accounts-student-demo
 */
import { closePool, query } from '../lib/db';

async function count(sql: string, params: any[] = []) {
  const r = await query(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  console.log('===== تنظيف بيانات DEMO لحسابات الطلبة =====');

  const demoStudents = await query(
    `SELECT id::text, university_id FROM student_affairs.students
     WHERE university_id LIKE 'DEMO-STU-%'
        OR student_number LIKE 'DEMO-STU-%'`
  );
  const demoStudentIds = demoStudents.rows.map((r) => r.id);
  console.log(
    `طلاب DEMO: ${demoStudentIds.length}`,
    demoStudents.rows.map((r) => r.university_id)
  );

  const accountIds = demoStudentIds.length
    ? (
        await query(
          `SELECT id::text FROM accounts.student_accounts WHERE student_id = ANY($1::uuid[])`,
          [demoStudentIds]
        )
      ).rows.map((r) => r.id)
    : [];

  console.log(`حسابات طلاب DEMO: ${accountIds.length}`);

  // جمع معرّفات القيود المرتبطة قبل فك الربط
  const journalIds = (
    await query(
      `SELECT DISTINCT j.id::text
       FROM accounts.journal_entries j
       WHERE j.id IN (
         SELECT journal_entry_id FROM accounts.student_charges
         WHERE journal_entry_id IS NOT NULL
           AND (external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[]))
         UNION
         SELECT reversal_journal_entry_id FROM accounts.student_charges
         WHERE reversal_journal_entry_id IS NOT NULL
           AND (external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[]))
         UNION
         SELECT journal_entry_id FROM accounts.student_reliefs
         WHERE journal_entry_id IS NOT NULL
           AND (external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[]))
         UNION
         SELECT journal_entry_id FROM accounts.student_credit_notes
         WHERE journal_entry_id IS NOT NULL
           AND (external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[]))
         UNION
         SELECT journal_entry_id FROM accounts.student_ledger_entries
         WHERE journal_entry_id IS NOT NULL
           AND student_account_id = ANY($1::uuid[])
       )`,
      [accountIds.length ? accountIds : ['00000000-0000-0000-0000-000000000000']]
    )
  ).rows.map((r) => r.id);
  console.log(`قيود مرتبطة بـ DEMO: ${journalIds.length}`);

  // 1) allocations
  await query(
    `DELETE FROM accounts.student_refund_allocations
     WHERE refund_id IN (
       SELECT id FROM accounts.student_refunds
       WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])
     )`,
    [accountIds]
  );

  await query(
    `DELETE FROM accounts.student_collection_allocations
     WHERE collection_id IN (
       SELECT id FROM accounts.student_collections
       WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])
     )`,
    [accountIds]
  );

  // 2) refunds / credit notes / reliefs / collections
  await query(
    `UPDATE accounts.student_refunds
     SET cash_voucher_id = NULL, bank_voucher_id = NULL
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );
  await query(
    `DELETE FROM accounts.student_refunds
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  await query(
    `UPDATE accounts.student_credit_notes SET journal_entry_id = NULL
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  ).catch(() => undefined);
  await query(
    `DELETE FROM accounts.student_credit_notes
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  await query(
    `UPDATE accounts.student_reliefs SET journal_entry_id = NULL
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  ).catch(() => undefined);
  await query(
    `DELETE FROM accounts.student_reliefs
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  await query(
    `DELETE FROM accounts.student_collections
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  // 3) billing
  await query(
    `DELETE FROM accounts.student_installments
     WHERE billing_plan_id IN (
       SELECT id FROM accounts.student_billing_plans
       WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])
     )`,
    [accountIds]
  );
  await query(
    `DELETE FROM accounts.student_billing_plans
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  // 4) ledger + charges
  await query(
    `DELETE FROM accounts.student_ledger_entries
     WHERE student_account_id = ANY($1::uuid[])
        OR source_id IN (
          SELECT id FROM accounts.student_charges
          WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])
        )`,
    [accountIds]
  );

  await query(
    `UPDATE accounts.student_charges
     SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );
  await query(
    `DELETE FROM accounts.student_charges
     WHERE external_reference LIKE 'DEMO-%' OR student_account_id = ANY($1::uuid[])`,
    [accountIds]
  );

  // 5) accounts + fee/relief types
  if (accountIds.length) {
    await query(`DELETE FROM accounts.student_accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
  }
  await query(`DELETE FROM accounts.student_relief_types WHERE code LIKE 'DEMO-%'`);
  await query(`DELETE FROM accounts.student_fee_types WHERE code LIKE 'DEMO-%'`);

  // 6) DEMO students
  if (demoStudentIds.length) {
    await query(`DELETE FROM student_affairs.students WHERE id = ANY($1::uuid[])`, [
      demoStudentIds,
    ]);
  }

  // 7) orphan DEMO journals (lines first)
  if (journalIds.length) {
    await query(
      `UPDATE accounts.cash_vouchers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
      [journalIds]
    );
    await query(
      `UPDATE accounts.bank_vouchers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
      [journalIds]
    ).catch(() => undefined);
    await query(
      `DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])`,
      [journalIds]
    );
    await query(`DELETE FROM accounts.journal_entries WHERE id = ANY($1::uuid[])`, [journalIds]);
  }

  const leftover = {
    students: await count(
      `SELECT COUNT(*)::int n FROM student_affairs.students WHERE university_id LIKE 'DEMO-STU-%'`
    ),
    accounts: await count(
      `SELECT COUNT(*)::int n FROM accounts.student_accounts sa
       JOIN student_affairs.students s ON s.id = sa.student_id
       WHERE s.university_id LIKE 'DEMO-STU-%'`
    ),
    charges: await count(
      `SELECT COUNT(*)::int n FROM accounts.student_charges WHERE external_reference LIKE 'DEMO-%'`
    ),
    collections: await count(
      `SELECT COUNT(*)::int n FROM accounts.student_collections WHERE external_reference LIKE 'DEMO-%'`
    ),
    fees: await count(
      `SELECT COUNT(*)::int n FROM accounts.student_fee_types WHERE code LIKE 'DEMO-%'`
    ),
  };

  console.log('المتبقي بعد التنظيف:', leftover);
  if (Object.values(leftover).some((n) => n > 0)) {
    console.error('بقيت سجلات DEMO — راجع القيود اليدوية');
    process.exitCode = 1;
  } else {
    console.log('✓ الصفحة /accounts/students يجب أن تظهر فارغة الآن');
  }
  console.log('===== انتهى التنظيف =====');
  await closePool();
}

main().catch(async (e) => {
  console.error('فشل التنظيف:', e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
