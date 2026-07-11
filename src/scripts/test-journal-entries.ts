/**
 * اختبارات نواة القيود — تنشئ بيانات اختبار ثم تنظّفها.
 * التشغيل: npx tsx src/scripts/test-journal-entries.ts
 */
import { closePool, query } from '../lib/db';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  assertOptimisticVersion,
  createReversalEntry,
  loadJournalEntry,
  loadJournalLines,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { assertJournalTransition } from '../lib/accounts/journal-transitions';
import { moneyEquals, normalizeMoneyInput } from '../lib/accounts/money';
import { AccountsHttpError } from '../lib/accounts/auth';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '../lib/accounts/with-transaction';

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err: unknown) {
  console.error(`❌ ${name}`, err);
  process.exitCode = 1;
}

async function main() {
  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) {
    const any = await query(
      `SELECT id FROM student_affairs.users WHERE is_active LIMIT 1`
    );
    if (!any.rows[0]) throw new Error('لا يوجد مستخدم');
    user.rows[0] = any.rows[0];
  }
  const userId = user.rows[0].id as string;

  // تهيئة سنة/فترة اختبار إن لم توجد ACTIVE
  let year = await query(
    `SELECT id, start_date, end_date FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  let createdTestYear = false;
  if (!year.rows[0]) {
    const insY = await query(
      `INSERT INTO accounts.fiscal_years
        (code, name_ar, start_date, end_date, status, is_default, created_by)
       VALUES ('TY2026','سنة اختبار القيود','2026-01-01','2026-12-31','ACTIVE',FALSE,$1)
       RETURNING id, start_date, end_date`,
      [userId]
    );
    year = insY;
    createdTestYear = true;
    await query(
      `INSERT INTO accounts.fiscal_periods
        (fiscal_year_id, period_number, code, name_ar, start_date, end_date, status, created_by)
       VALUES ($1,1,'2026-01','يناير 2026','2026-01-01','2026-01-31','OPEN',$2)`,
      [insY.rows[0].id, userId]
    );
    const { createDefaultSequencesForYear } = await import(
      '../lib/accounts/document-sequences'
    );
    await withTransaction(async (client) => {
      await createDefaultSequencesForYear(client, insY.rows[0].id as string);
    });
    ok('إنشاء سنة/فترة اختبار مؤقتة');
  }

  const yearId = year.rows[0].id as string;

  const period = await query(
    `SELECT id, start_date, end_date FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1 AND status = 'OPEN' ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا توجد فترة OPEN');
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string | Date);

  const accounts = await query(
    `SELECT id, code, requires_cost_center FROM accounts.chart_of_accounts
     WHERE allow_posting AND is_active AND NOT requires_cost_center
     ORDER BY code LIMIT 2`
  );
  if (accounts.rows.length < 2) throw new Error('يلزم حسابان تفصيليان بدون مركز كلفة للاختبار');
  const a1 = accounts.rows[0].id as string;
  const a2 = accounts.rows[1].id as string;

  const groupAcc = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE is_group AND is_active LIMIT 1`
  );

  const ccRequired = await query(
    `SELECT id, code FROM accounts.chart_of_accounts
     WHERE allow_posting AND is_active AND requires_cost_center LIMIT 1`
  );
  const activeCc = await query(
    `SELECT id FROM accounts.cost_centers WHERE is_active LIMIT 1`
  );

  // 1) مسودة بلا سطور
  const draftEmpty = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await assertFiscalContextForEntry(client, {
      fiscalYearId: yearId,
      fiscalPeriodId: periodId,
      entryDate,
    });
    const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
      client,
      [],
      'draft'
    );
    const num = await allocateJournalEntryNumber(client, yearId);
    const ins = await txQuery<{ id: string }>(
      client,
      `INSERT INTO accounts.journal_entries
        (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
         description, total_debit, total_credit, status, created_by)
       VALUES ($1,$2,$3,$4::date,'MANUAL','اختبار مسودة فارغة',$5::numeric,$6::numeric,'DRAFT',$7)
       RETURNING id`,
      [num, yearId, periodId, entryDate, totalDebit, totalCredit, userId]
    );
    await replaceJournalLines(client, ins.rows[0].id, lines);
    return { id: ins.rows[0].id, num };
  });
  ok(`DRAFT بلا سطور ${draftEmpty.num}`);

  // 2) مسودة غير متوازنة
  await withTransaction(async (client) => {
    const { totalDebit, totalCredit } = await normalizeAndValidateLines(
      client,
      [
        { account_id: a1, debit_amount: '100', credit_amount: '0' },
        { account_id: a2, debit_amount: '0', credit_amount: '50' },
      ],
      'draft'
    );
    if (moneyEquals(totalDebit, totalCredit)) throw new Error('expected unbalanced');
  });
  ok('DRAFT غير متوازن مسموح في وضع draft');

  // 3-6) سطور غير صالحة
  await withTransaction(async (client) => {
    try {
      await normalizeAndValidateLines(
        client,
        [{ account_id: a1, debit_amount: '10', credit_amount: '5' }],
        'draft'
      );
      throw new Error('should fail both sides');
    } catch (e) {
      if (!(e instanceof AccountsHttpError)) throw e;
      ok('منع مدين ودائن معاً');
    }

    try {
      await normalizeAndValidateLines(
        client,
        [{ account_id: a1, debit_amount: '-1', credit_amount: '0' }],
        'draft'
      );
      throw new Error('should fail negative');
    } catch (e) {
      if (!(e instanceof AccountsHttpError)) throw e;
      ok('منع مبلغ سالب');
    }

    if (groupAcc.rows[0]) {
      try {
        await normalizeAndValidateLines(
          client,
          [{ account_id: groupAcc.rows[0].id, debit_amount: '10', credit_amount: '0' }],
          'draft'
        );
        throw new Error('should fail group');
      } catch (e) {
        if (!(e instanceof AccountsHttpError)) throw e;
        ok('منع حساب تجميعي');
      }
    }

    if (ccRequired.rows[0]) {
      try {
        await normalizeAndValidateLines(
          client,
          [
            {
              account_id: ccRequired.rows[0].id,
              debit_amount: '10',
              credit_amount: '0',
            },
          ],
          'draft'
        );
        throw new Error('should require cc');
      } catch (e) {
        if (!(e instanceof AccountsHttpError)) throw e;
        ok('إلزام مركز الكلفة');
      }

      if (activeCc.rows[0]) {
        await normalizeAndValidateLines(
          client,
          [
            {
              account_id: ccRequired.rows[0].id,
              cost_center_id: activeCc.rows[0].id,
              debit_amount: '10',
              credit_amount: '0',
            },
            { account_id: a2, debit_amount: '0', credit_amount: '10' },
          ],
          'strict'
        );
        ok('قبول مركز كلفة فعّال مع حساب يتطلبه');
      }
    }
  });

  // دورة حياة كاملة + عكس
  const lifecycle = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    const validated = await normalizeAndValidateLines(
      client,
      [
        { account_id: a1, debit_amount: '250.500', credit_amount: '0' },
        { account_id: a2, debit_amount: '0', credit_amount: '250.500' },
      ],
      'strict'
    );
    const num = await allocateJournalEntryNumber(client, yearId);
    const ins = await txQuery<{ id: string; version: number; entry_number: string }>(
      client,
      `INSERT INTO accounts.journal_entries
        (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
         description, total_debit, total_credit, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4::date,'MANUAL','اختبار دورة حياة',$5::numeric,$6::numeric,'DRAFT',$7,$7)
       RETURNING id, version, entry_number`,
      [num, yearId, periodId, entryDate, validated.totalDebit, validated.totalCredit, userId]
    );
    await replaceJournalLines(client, ins.rows[0].id, validated.lines);

    // منع إرسال غير متوازن
    try {
      await normalizeAndValidateLines(
        client,
        [{ account_id: a1, debit_amount: '1', credit_amount: '0' }],
        'strict'
      );
      throw new Error('strict should fail');
    } catch (e) {
      if (!(e instanceof AccountsHttpError)) throw e;
    }

    assertJournalTransition('submit', 'DRAFT');
    await txQuery(
      client,
      `UPDATE accounts.journal_entries SET status='PENDING_REVIEW', version=version+1 WHERE id=$1`,
      [ins.rows[0].id]
    );
    assertJournalTransition('review', 'PENDING_REVIEW');
    await txQuery(
      client,
      `UPDATE accounts.journal_entries SET status='REVIEWED', reviewed_by=$2, reviewed_at=NOW(), version=version+1 WHERE id=$1`,
      [ins.rows[0].id, userId]
    );
    assertJournalTransition('approve', 'REVIEWED');
    await txQuery(
      client,
      `UPDATE accounts.journal_entries SET status='APPROVED', approved_by=$2, approved_at=NOW(), version=version+1 WHERE id=$1`,
      [ins.rows[0].id, userId]
    );
    assertJournalTransition('post', 'APPROVED');
    await txQuery(
      client,
      `UPDATE accounts.journal_entries
       SET status='POSTED', posted_by=$2, posted_at=NOW(),
           total_debit=$3::numeric, total_credit=$4::numeric, version=version+1
       WHERE id=$1`,
      [ins.rows[0].id, userId, validated.totalDebit, validated.totalCredit]
    );

    const posted = await loadJournalEntry(client, ins.rows[0].id, true);
    try {
      assertOptimisticVersion(posted.version, posted.version - 1);
      throw new Error('version should conflict');
    } catch (e) {
      if (!(e instanceof AccountsHttpError) || e.status !== 409) throw e;
      ok('optimistic concurrency 409');
    }

    const reversal = await createReversalEntry(client, {
      original: posted,
      reversalDate: entryDate,
      reason: 'اختبار عكس',
      userId,
    });

    const after = await loadJournalEntry(client, posted.id);
    if (after.status !== 'REVERSED') throw new Error('original not reversed');
    if (after.reversal_entry_id !== reversal.id) throw new Error('link missing');

    const revLines = await loadJournalLines(client, reversal.id);
    const origLines = await loadJournalLines(client, posted.id);
    if (normalizeMoneyInput(revLines[0].debit_amount) !== normalizeMoneyInput(origLines[0].credit_amount)) {
      throw new Error('flip failed');
    }

    try {
      await createReversalEntry(client, {
        original: after,
        reversalDate: entryDate,
        reason: 'مرة ثانية',
        userId,
      });
      throw new Error('double reverse should fail');
    } catch (e) {
      if (!(e instanceof AccountsHttpError)) throw e;
      ok('منع عكس مرتين');
    }

    return {
      postedId: posted.id,
      reversalId: reversal.id,
      entryNumber: posted.entry_number,
      reversalNumber: reversal.entry_number,
    };
  });
  ok(`دورة حياة + عكس ${lifecycle.entryNumber} → ${lifecycle.reversalNumber}`);

  // دفتر اليومية POSTED فقط — العكسي مرحّل أيضاً
  const book = await query(
    `SELECT COUNT(*)::int AS c FROM accounts.journal_entry_lines l
     JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE e.id = ANY($1::uuid[]) AND e.status = 'POSTED'`,
    [[lifecycle.reversalId]]
  );
  if (book.rows[0].c < 2) throw new Error('journal book missing posted reversal lines');
  ok('دفتر اليومية يرى قيد عكسي POSTED');

  // حذف المسودة الفارغة — الرقم لا يُعاد
  const deletedNum = draftEmpty.num;
  await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [draftEmpty.id]);
  const reused = await query(
    `SELECT 1 FROM accounts.journal_entries WHERE entry_number = $1 AND fiscal_year_id = $2`,
    [deletedNum, yearId]
  );
  if (reused.rows.length > 0) throw new Error('number reused unexpectedly');
  ok('حذف مسودة دون إعادة استخدام الرقم');

  // تنظيف قيود الاختبار المتبقية
  await query(`DELETE FROM accounts.journal_entries WHERE id = ANY($1::uuid[])`, [
    [lifecycle.postedId, lifecycle.reversalId],
  ]);
  ok('تنظيف بيانات الاختبار');

  if (createdTestYear) {
    await query(`DELETE FROM accounts.document_sequences WHERE fiscal_year_id = $1`, [yearId]);
    await query(`DELETE FROM accounts.fiscal_periods WHERE fiscal_year_id = $1`, [yearId]);
    await query(`DELETE FROM accounts.fiscal_years WHERE id = $1`, [yearId]);
    ok('حذف سنة الاختبار المؤقتة');
  }

  console.log('—— انتهت اختبارات القيود ——');
}

main()
  .catch((e) => fail('fatal', e))
  .finally(() => closePool());
