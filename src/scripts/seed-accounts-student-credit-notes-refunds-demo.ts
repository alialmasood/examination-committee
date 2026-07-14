/**
 * بيانات عرض 5.C.2 — Credit Notes & Refunds DEMO (idempotent).
 */
import { query } from '../lib/db';
import {
  approveStudentCreditNote,
  createStudentCreditNote,
  postStudentCreditNote,
  submitStudentCreditNote,
  voidStudentCreditNote,
} from '../lib/accounts/student-credit-notes';
import {
  approveStudentRefund,
  createStudentRefund,
  postStudentRefund,
  submitStudentRefund,
  voidStudentRefund,
} from '../lib/accounts/student-refunds';
import {
  createStudentCharge,
  postStudentCharge,
} from '../lib/accounts/student-charges';
import {
  createStudentCollection,
  postStudentCollection,
} from '../lib/accounts/student-collections';
import {
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '../lib/accounts/with-transaction';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';

const M = {
  /** مطالبات إشعارات تخفيض الذمة (لا تحتاج رصيد دائن) */
  studentUniDebt: 'DEMO-STU-001',
  /** رصيد دائن + استردادات على حساب منفصل بلا ذمة قائمة */
  studentUniCredit: 'DEMO-STU-002',
  feeTuition: 'DEMO-FEE-TUITION',
  adjGl: 'DEMO-CN-ADJ-EXP',
  charge: 'DEMO-SCH-CN-BASE',
  chargeCredit: 'DEMO-SCH-CN-CREDIT-V2',
  cnDraft: 'DEMO-SCN-DRAFT',
  cnPending: 'DEMO-SCN-PENDING',
  cnApproved: 'DEMO-SCN-APPROVED',
  cnPosted: 'DEMO-SCN-POSTED',
  cnVoid: 'DEMO-SCN-VOID',
  cnCredit: 'DEMO-SCN-CREDIT-BAL-V2',
  refundCash: 'DEMO-SRF-CASH-V2',
  refundBank: 'DEMO-SRF-BANK-V2',
  refundDraft: 'DEMO-SRF-DRAFT-V2',
  refundVoid: 'DEMO-SRF-VOID-V2',
  collection: 'DEMO-SCL-CN-CREDIT-V2',
} as const;

async function ensureAdjGl(userId: string): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE UPPER(code)=UPPER($1)`,
    [M.adjGl]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code='EXPENSE'`
  );
  if (!type.rows[0]) throw new Error('EXPENSE missing');
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'DEMO CN adj 5.C.2')
     RETURNING id`,
    [
      M.adjGl,
      'مصروف تعديل إيراد طلبة DEMO',
      type.rows[0].id,
      type.rows[0].normal_balance,
      sort.rows[0].n,
      userId,
    ]
  );
  return ins.rows[0].id as string;
}

async function cleanupDemoRefundFundingPollution(
  userId: string,
  entryDate: string,
  adjGlId: string
): Promise<void> {
  const vouchers = await query(
    `SELECT cv.voucher_number, cv.amount::text AS amount, cv.counter_account_id,
            cv.fiscal_year_id, cv.fiscal_period_id
     FROM accounts.cash_vouchers cv
     JOIN accounts.chart_of_accounts coa ON coa.id = cv.counter_account_id
     WHERE cv.voucher_type = 'CASH_RECEIPT'
       AND cv.status = 'POSTED'
       AND cv.description ILIKE '%تمويل صندوق لاسترداد 5.C.2%'
       AND coa.code ILIKE 'DEMO-RECV%'`
  );
  if (!vouchers.rows.length) return;

  const fiscal = await query(
    `SELECT y.id AS year_id, p.id AS period_id
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
       AND p.start_date <= $1::date AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`,
    [entryDate]
  );
  if (!fiscal.rows[0]) {
    console.log('⚠ لا فترة مالية مفتوحة — تخطّي تنظيف تمويل DEMO');
    return;
  }

  for (const v of vouchers.rows) {
    const ref = `DEMO-5C2-CLEANUP-FUNDING-${v.voucher_number as string}`;
    const exists = await query(
      `SELECT 1 FROM accounts.journal_entries
       WHERE reference_number = $1 OR description = $1
       LIMIT 1`,
      [ref]
    );
    if (exists.rows[0]) {
      console.log(`✓ cleanup ${ref} موجود`);
      continue;
    }
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      await assertFiscalContextForEntry(client, {
        fiscalYearId: fiscal.rows[0].year_id as string,
        fiscalPeriodId: fiscal.rows[0].period_id as string,
        entryDate,
      });
      const amount = v.amount as string;
      const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
        client,
        [
          {
            account_id: v.counter_account_id as string,
            debit_amount: amount,
            credit_amount: '0',
            description: ref,
          },
          {
            account_id: adjGlId,
            debit_amount: '0',
            credit_amount: amount,
            description: ref,
          },
        ],
        'strict'
      );
      const entryNumber = await allocateJournalEntryNumber(
        client,
        fiscal.rows[0].year_id as string
      );
      const ins = await txQuery(
        client,
        `INSERT INTO accounts.journal_entries
          (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
           reference_number, description, total_debit, total_credit, status,
           created_by, updated_by, posted_by, posted_at)
         VALUES ($1,$2::uuid,$3::uuid,$4::date,'ADJUSTMENT',$5::text,$6::text,$7::numeric,$8::numeric,
                 'POSTED',$9::uuid,$9::uuid,$9::uuid,NOW())
         RETURNING id`,
        [
          entryNumber,
          fiscal.rows[0].year_id,
          fiscal.rows[0].period_id,
          entryDate,
          ref,
          ref,
          totalDebit,
          totalCredit,
          userId,
        ]
      );
      await replaceJournalLines(client, ins.rows[0].id as string, lines);
    });
    console.log(`✓ cleanup ${ref}`);
  }
}

async function existsExt(table: string, ext: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM accounts.${table} WHERE external_reference=$1 LIMIT 1`,
    [ext]
  );
  return Boolean(r.rows[0]);
}

export async function seedStudentCreditNotesRefundsDemo(params: {
  userId: string;
  entryDate: string;
}): Promise<void> {
  console.log('\n——— 5.C.2: إشعارات دائنة واستردادات DEMO ———');

  const studentDebt = await query(
    `SELECT s.id, sa.id AS account_id
     FROM student_affairs.students s
     JOIN accounts.student_accounts sa ON sa.student_id=s.id
     WHERE s.university_id=$1 LIMIT 1`,
    [M.studentUniDebt]
  );
  const studentCredit = await query(
    `SELECT s.id, sa.id AS account_id
     FROM student_affairs.students s
     JOIN accounts.student_accounts sa ON sa.student_id=s.id
     WHERE s.university_id=$1 LIMIT 1`,
    [M.studentUniCredit]
  );
  if (!studentDebt.rows[0]) {
    console.log(`⚠ ${M.studentUniDebt} غير موجود — تخطّي 5.C.2`);
    return;
  }
  if (!studentCredit.rows[0]) {
    console.log(`⚠ ${M.studentUniCredit} غير موجود — تخطّي استردادات 5.C.2`);
  }
  const fee = await query(
    `SELECT id FROM accounts.student_fee_types WHERE UPPER(code)=UPPER($1)`,
    [M.feeTuition]
  );
  if (!fee.rows[0]) {
    console.log(`⚠ ${M.feeTuition} غير موجود — تخطّي 5.C.2`);
    return;
  }
  const bank = await query(
    `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER('DEMO-BA-IQD') LIMIT 1`
  );
  const cash = await query(
    `SELECT cb.id AS box_id, s.id AS session_id
     FROM accounts.cash_boxes cb
     JOIN accounts.cash_box_sessions s ON s.cash_box_id=cb.id AND s.status='OPEN'
     WHERE LOWER(cb.code)=LOWER('DEMO-CB-MAIN')
     ORDER BY s.opened_at DESC LIMIT 1`
  );

  const adjGl = await ensureAdjGl(params.userId);
  const accountId = studentDebt.rows[0].account_id as string;
  const creditAccountId = studentCredit.rows[0]?.account_id as
    | string
    | undefined;

  let chargeId: string;
  const chEx = await query(
    `SELECT id, status, version, updated_at FROM accounts.student_charges WHERE external_reference=$1`,
    [M.charge]
  );
  if (chEx.rows[0]) {
    chargeId = chEx.rows[0].id as string;
    if (chEx.rows[0].status === 'DRAFT') {
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        await postStudentCharge(client, {
          id: chargeId,
          userId: params.userId,
          version: chEx.rows[0].version,
          updated_at: chEx.rows[0].updated_at,
        });
      });
    }
  } else {
    const d = await withTransaction((client) =>
      createStudentCharge(client, {
        student_account_id: accountId,
        fee_type_id: fee.rows[0].id,
        charge_date: params.entryDate,
        original_amount: '120000',
        description: 'مطالبة عرض إشعارات دائنة 5.C.2',
        external_reference: M.charge,
        created_by: params.userId,
      })
    );
    const p = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentCharge(client, {
        id: d.id,
        userId: params.userId,
        version: d.version,
        updated_at: d.updated_at,
      });
    });
    chargeId = p.charge.id;
    console.log(`✓ مطالبة ${M.charge}`);
  }

  async function ensureCn(
    ext: string,
    amount: string,
    mode: 'DEBT_REDUCTION' | 'CREDIT_BALANCE_CREATE',
    target: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'VOID'
  ) {
    if (await existsExt('student_credit_notes', ext)) {
      console.log(`✓ ${ext} موجود`);
      return;
    }
    let row = await withTransaction((client) =>
      createStudentCreditNote(client, {
        student_charge_id: chargeId,
        application_mode: mode,
        amount,
        reason_code: 'ADMINISTRATIVE_ADJUSTMENT',
        reason: `عرض DEMO ${ext}`,
        revenue_adjustment_gl_account_id: adjGl,
        credit_note_date: params.entryDate,
        external_reference: ext,
        requested_by: params.userId,
      })
    );
    if (target === 'DRAFT') {
      console.log(`✓ مسودة ${ext}`);
      return;
    }
    row = await withTransaction((client) =>
      submitStudentCreditNote(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      })
    );
    if (target === 'PENDING_APPROVAL') {
      console.log(`✓ بانتظار ${ext}`);
      return;
    }
    row = await withTransaction((client) =>
      approveStudentCreditNote(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      })
    );
    if (target === 'APPROVED') {
      console.log(`✓ معتمد ${ext}`);
      return;
    }
    const posted = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentCreditNote(client, {
        id: row.id,
        userId: params.userId,
        version: row.version,
        updated_at: row.updated_at,
      });
    });
    if (target === 'POSTED') {
      console.log(`✓ مرحّل ${ext}`);
      return;
    }
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      await voidStudentCreditNote(client, {
        id: posted.creditNote.id,
        userId: params.userId,
        version: posted.creditNote.version,
        updated_at: posted.creditNote.updated_at,
        reason: 'إلغاء عرض DEMO',
      });
    });
    console.log(`✓ VOID ${ext}`);
  }

  await ensureCn(M.cnDraft, '3000', 'DEBT_REDUCTION', 'DRAFT');
  await ensureCn(M.cnPending, '4000', 'DEBT_REDUCTION', 'PENDING_APPROVAL');
  await ensureCn(M.cnApproved, '5000', 'DEBT_REDUCTION', 'APPROVED');
  await ensureCn(M.cnPosted, '10000', 'DEBT_REDUCTION', 'POSTED');
  await ensureCn(M.cnVoid, '2000', 'DEBT_REDUCTION', 'VOID');

  // رصيد دائن + استردادات على حساب STU-002 (بلا ذمة قائمة من مطالبات 5.C.1/5.B)
  let collectionId: string | null = null;
  if (!creditAccountId) {
    console.log('⚠ تخطّي مسار الرصيد الدائن والاسترداد');
  }
  const colEx = await query(
    `SELECT id, status, version, updated_at, amount::text AS amount
     FROM accounts.student_collections WHERE external_reference=$1`,
    [M.collection]
  );
  if (colEx.rows[0]) {
    collectionId = colEx.rows[0].id as string;
    console.log(`✓ تحصيل ${M.collection} موجود`);
  } else if (bank.rows[0] && creditAccountId) {
    const charge2ex = await query(
      `SELECT id FROM accounts.student_charges WHERE external_reference=$1 LIMIT 1`,
      [M.chargeCredit]
    );
    let c2 = charge2ex.rows[0]?.id as string | undefined;
    if (!c2) {
      const d = await withTransaction((client) =>
        createStudentCharge(client, {
          student_account_id: creditAccountId,
          fee_type_id: fee.rows[0].id,
          charge_date: params.entryDate,
          original_amount: '80000',
          description: 'مطالبة رصيد دائن DEMO',
          external_reference: M.chargeCredit,
          created_by: params.userId,
        })
      );
      const p = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return postStudentCharge(client, {
          id: d.id,
          userId: params.userId,
          version: d.version,
          updated_at: d.updated_at,
        });
      });
      c2 = p.charge.id;
    }
    const created = await withTransaction((client) =>
      createStudentCollection(client, {
        student_account_id: creditAccountId,
        collection_date: params.entryDate,
        amount: '80000',
        payment_method: 'BANK',
        bank_account_id: bank.rows[0].id,
        description: 'تحصيل لرصيد دائن DEMO',
        external_reference: M.collection,
        allocations: [
          { student_charge_id: c2!, allocated_amount: '80000' },
        ],
        created_by: params.userId,
      })
    );
    const posted = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentCollection(client, {
        id: created.collection.id,
        userId: params.userId,
        version: created.collection.version,
        updated_at: created.collection.updated_at,
      });
    });
    collectionId = posted.collection.id;
    console.log(`✓ تحصيل ${M.collection}`);
  }

  if (collectionId && creditAccountId) {
    await cleanupDemoRefundFundingPollution(params.userId, params.entryDate, adjGl);

    const creditCharge = await query(
      `SELECT id FROM accounts.student_charges WHERE external_reference=$1 LIMIT 1`,
      [M.chargeCredit]
    );
    if (creditCharge.rows[0] && !(await existsExt('student_credit_notes', M.cnCredit))) {
      let row = await withTransaction((client) =>
        createStudentCreditNote(client, {
          student_charge_id: creditCharge.rows[0].id,
          application_mode: 'CREDIT_BALANCE_CREATE',
          amount: '20000',
          reason_code: 'ADMINISTRATIVE_ADJUSTMENT',
          reason: 'إنشاء رصيد دائن DEMO',
          revenue_adjustment_gl_account_id: adjGl,
          credit_note_date: params.entryDate,
          external_reference: M.cnCredit,
          requested_by: params.userId,
        })
      );
      row = await withTransaction((client) =>
        submitStudentCreditNote(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        })
      );
      row = await withTransaction((client) =>
        approveStudentCreditNote(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        })
      );
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        await postStudentCreditNote(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        });
      });
      console.log(`✓ ${M.cnCredit} مرحّل (رصيد دائن)`);
    } else {
      console.log(`✓ ${M.cnCredit} موجود`);
    }

    async function ensureRefund(
      ext: string,
      amount: string,
      method: 'CASH' | 'BANK',
      target: 'DRAFT' | 'POSTED' | 'VOID'
    ) {
      if (await existsExt('student_refunds', ext)) {
        console.log(`✓ ${ext} موجود`);
        return;
      }
      if (method === 'CASH' && !cash.rows[0]) {
        console.log(`⚠ لا جلسة نقد مفتوحة — تخطّي ${ext}`);
        return;
      }
      if (method === 'BANK' && !bank.rows[0]) {
        console.log(`⚠ لا بنك — تخطّي ${ext}`);
        return;
      }
      let row = await withTransaction((client) =>
        createStudentRefund(client, {
          student_account_id: creditAccountId!,
          amount,
          payment_method: method,
          cash_box_id: method === 'CASH' ? cash.rows[0].box_id : undefined,
          cash_box_session_id:
            method === 'CASH' ? cash.rows[0].session_id : undefined,
          bank_account_id: method === 'BANK' ? bank.rows[0].id : undefined,
          refund_date: params.entryDate,
          reason: `عرض DEMO ${ext}`,
          beneficiary_name: 'طالب DEMO',
          external_reference: ext,
          allocations: [
            {
              student_collection_id: collectionId!,
              refunded_amount: amount,
            },
          ],
          requested_by: params.userId,
        })
      );
      if (target === 'DRAFT') {
        console.log(`✓ مسودة ${ext}`);
        return;
      }
      row = await withTransaction((client) =>
        submitStudentRefund(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        })
      );
      row = await withTransaction((client) =>
        approveStudentRefund(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        })
      );
      const posted = await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        if (method === 'CASH') await acquireCashBoxesLock(client);
        return postStudentRefund(client, {
          id: row.id,
          userId: params.userId,
          version: row.version,
          updated_at: row.updated_at,
        });
      });
      if (target === 'POSTED') {
        console.log(`✓ مرحّل ${ext}`);
        return;
      }
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        if (method === 'CASH') await acquireCashBoxesLock(client);
        await voidStudentRefund(client, {
          id: posted.refund.id,
          userId: params.userId,
          version: posted.refund.version,
          updated_at: posted.refund.updated_at,
          reason: 'إلغاء عرض DEMO',
        });
      });
      console.log(`✓ VOID ${ext}`);
    }

    await ensureRefund(M.refundDraft, '2000', 'BANK', 'DRAFT');
    await ensureRefund(M.refundCash, '5000', 'CASH', 'POSTED');
    await ensureRefund(M.refundBank, '4000', 'BANK', 'POSTED');
    await ensureRefund(M.refundVoid, '3000', 'BANK', 'VOID');
  }

  const postedCn = await query(
    `SELECT id FROM accounts.student_credit_notes WHERE external_reference=$1 LIMIT 1`,
    [M.cnPosted]
  );
  const postedRf = await query(
    `SELECT id FROM accounts.student_refunds WHERE external_reference=$1 LIMIT 1`,
    [M.refundCash]
  );
  console.log('✓ صفحات العرض 5.C.2:');
  console.log('  /accounts/students/credit-notes');
  console.log('  /accounts/students/refunds');
  if (postedCn.rows[0]) {
    console.log(`  /accounts/students/credit-notes/${postedCn.rows[0].id}`);
    console.log(`  /accounts/students/credit-notes/${postedCn.rows[0].id}/print`);
  }
  if (postedRf.rows[0]) {
    console.log(`  /accounts/students/refunds/${postedRf.rows[0].id}`);
    console.log(`  /accounts/students/refunds/${postedRf.rows[0].id}/print`);
  }
}
