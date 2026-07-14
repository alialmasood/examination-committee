/**
 * اختبارات تزامن الأقفال الاستشارية على مستوى المورد المحاسبي (Sprint A).
 * npm run test:accounting-locks
 *
 * يثبت عبر PostgreSQL مباشرة (بدون الاعتماد على توقيتات هشة):
 * 1) نفس المورد (BANK_ACCOUNT) يسلسل العمليات — معاملة تحمل القفل، ومحاولة موازية
 *    عبر pg_try_advisory_xact_lock على نفس المفتاح تفشل (false) طالما المعاملة الأولى مفتوحة،
 *    وتنجح (true) بعد COMMIT.
 * 2) موردان مختلفان من نوع BANK_ACCOUNT لا يتعارضان — لا قفل عالمي للبنوك بعد الآن.
 * 3) نفس الاختبار لـ CASHBOX (مورد واحد يسلسل، موردان مختلفان لا يتعارضان).
 * 4) ترتيب الموارد المعكوس (A+B) و (B+A) في acquireAccountingResourceLocks
 *    ينتج نفس تسلسل المفاتيح المُقفلة (dedupe + sort ثابت).
 * 5) (اختياري) إن توفّرت بيانات — سندا صرف مصرفي متزامنان على حساب برصيد منخفض:
 *    ينجح واحد فقط (أو كلاهما إن كان الرصيد كافياً لكل منهما)، بدون رصيد سالب.
 *    ينشئ بيانات DEMO مؤقتة تحت كود DEMO-LOCKTEST ويحذفها في النهاية.
 */
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { closePool, pool, query } from '../lib/db';
import {
  ADVISORY_LOCK_NAMESPACE_ACCOUNTING_RESOURCE,
  accountingLockKey,
  acquireAccountingResourceLocks,
  bankAccountLock,
  cashboxLock,
} from '../lib/accounts/accounting-locks';
import { createBank } from '../lib/accounts/banks';
import { createBankBranch } from '../lib/accounts/bank-branches';
import { createBankAccount } from '../lib/accounts/bank-accounts';
import {
  calculateBankAccountBookBalance,
  createBankVoucher,
  postBankVoucher,
} from '../lib/accounts/bank-vouchers';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { normalizeMoneyInput } from '../lib/accounts/money';
import { acquireBanksLock, acquireJournalEntriesLock, withTransaction } from '../lib/accounts/with-transaction';

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}

/** فحص فوري (implicit transaction) لحالة قفل استشاري — لا يُبقي القفل بعد انتهاء الاستعلام. */
async function tryLockOnce(client: PoolClient, key: string): Promise<boolean> {
  const r = await client.query<{ got: boolean }>(
    `SELECT pg_try_advisory_xact_lock($1::integer, hashtext($2::text)) AS got`,
    [ADVISORY_LOCK_NAMESPACE_ACCOUNTING_RESOURCE, key]
  );
  return Boolean(r.rows[0]?.got);
}

/**
 * يثبت: بينما عميل A يحمل قفل المورد (داخل معاملة مفتوحة)،
 * محاولة عميل B لنفس المفتاح تفشل؛ وبعد COMMIT تنجح.
 * محاولة عميل C لمفتاح مختلف تنجح فوراً (لا تعارض بين موارد مختلفة).
 */
async function assertResourceSerializes(params: {
  label: string;
  domain: 'BANK_ACCOUNT' | 'CASHBOX';
  sameId: string;
  otherId: string;
}): Promise<void> {
  const sameKey = accountingLockKey(params.domain, params.sameId);
  const otherKey = accountingLockKey(params.domain, params.otherId);

  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await acquireAccountingResourceLocks(holder, [
      { domain: params.domain, resourceId: params.sameId },
    ]);

    // نفس المفتاح — يجب أن يفشل try_lock طالما holder مفتوحة
    const blocked = await pool.connect();
    let sameBlocked: boolean;
    try {
      sameBlocked = await tryLockOnce(blocked, sameKey);
    } finally {
      blocked.release();
    }
    if (sameBlocked === false) {
      ok(`${params.label} — نفس المورد محجوز أثناء فتح المعاملة الأولى`);
    } else {
      fail(`${params.label} — كان يجب أن يفشل try_lock على نفس المورد`, { sameBlocked });
    }

    // مورد مختلف — يجب أن ينجح فوراً بلا انتظار (لا قفل عالمي)
    const other = await pool.connect();
    let otherOk: boolean;
    try {
      otherOk = await tryLockOnce(other, otherKey);
    } finally {
      other.release();
    }
    if (otherOk === true) {
      ok(`${params.label} — مورد مختلف من نفس النوع لا يتعارض (لا قفل عالمي)`);
    } else {
      fail(`${params.label} — مورد مختلف كان يجب أن ينجح فوراً`, { otherOk });
    }

    await holder.query('COMMIT');
  } catch (e) {
    await holder.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    holder.release();
  }

  // بعد COMMIT — يجب أن ينجح try_lock على نفس المفتاح الآن
  const after = await pool.connect();
  try {
    const nowFree = await tryLockOnce(after, sameKey);
    if (nowFree === true) {
      ok(`${params.label} — يتحرر المورد فوراً بعد COMMIT`);
    } else {
      fail(`${params.label} — كان يجب أن يتحرر المورد بعد COMMIT`, { nowFree });
    }
  } finally {
    after.release();
  }
}

/** اختبار 4: ترتيب معكوس للموارد ينتج نفس تسلسل المفاتيح المُقفلة. */
async function assertOrderIndependentLockKeys(): Promise<void> {
  const a = randomUUID();
  const b = randomUUID();

  const keysAB = await withTransaction((client) =>
    acquireAccountingResourceLocks(client, [bankAccountLock(a), bankAccountLock(b)])
  );
  const keysBA = await withTransaction((client) =>
    acquireAccountingResourceLocks(client, [bankAccountLock(b), bankAccountLock(a)])
  );

  const sameOrder =
    keysAB.length === 2 &&
    keysBA.length === 2 &&
    keysAB[0] === keysBA[0] &&
    keysAB[1] === keysBA[1];

  if (sameOrder) {
    ok('4) ترتيب الموارد المعكوس (A+B / B+A) ينتج نفس تسلسل المفاتيح المُقفلة');
  } else {
    fail('4) ترتيب الموارد', { keysAB, keysBA });
  }

  // dedupe: تكرار نفس المورد مرتين لا يُنتج مفتاحين
  const keysDup = await withTransaction((client) =>
    acquireAccountingResourceLocks(client, [
      bankAccountLock(a),
      bankAccountLock(a),
      cashboxLock(b),
    ])
  );
  if (keysDup.length === 2) {
    ok('4b) تكرار نفس المورد لا يُنتج قفلاً مكرراً (dedupe)');
  } else {
    fail('4b) dedupe', keysDup);
  }
}

/**
 * اختبار 5 (اختياري): سندا صرف متزامنان على حساب مصرفي DEMO برصيد منخفض —
 * ينجح واحد فقط، دون رصيد سالب. ينظّف كل بياناته (أكواد DEMO-LOCKTEST فقط).
 */
async function ensureFreeAsset(code: string, nameAr: string, userId: string): Promise<string> {
  const existing = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a WHERE LOWER(a.code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`,
    ['ASSET']
  );
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'حساب اختبار أقفال التزامن — DEMO-LOCKTEST')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function runOverdraftRaceTest(): Promise<void> {
  const userRes = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!userRes.rows[0]) {
    ok('5) تخطّي اختبار السحب المتزامن — لا يوجد مستخدم ACCOUNTS');
    return;
  }
  const userId = userRes.rows[0].id as string;

  const year = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  const period = year.rows[0]
    ? await query(
        `SELECT id, start_date::text AS start_date, end_date::text AS end_date
         FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 AND status = 'OPEN'
         ORDER BY period_number LIMIT 1`,
        [year.rows[0].id]
      )
    : { rows: [] as Array<{ id: string; start_date: string; end_date: string }> };
  if (!year.rows[0] || !period.rows[0]) {
    ok('5) تخطّي اختبار السحب المتزامن — لا سنة ACTIVE أو فترة OPEN');
    return;
  }
  const entryDate = pgDateOnly(period.rows[0].start_date as string);

  const counterAcc = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('EXPENSE','REVENUE') AND NOT a.is_group
       AND a.allow_posting AND a.is_active AND NOT a.requires_cost_center
     ORDER BY a.code LIMIT 1`
  );
  if (!counterAcc.rows[0]) {
    ok('5) تخطّي اختبار السحب المتزامن — لا يوجد حساب مقابل مناسب');
    return;
  }

  const suffix = Date.now().toString(36).toUpperCase();
  const glId = await ensureFreeAsset(`DEMO-LOCKTEST-GL-${suffix}`, 'GL اختبار أقفال DEMO', userId);

  let bankId: string | null = null;
  let branchId: string | null = null;
  let bankAccountId: string | null = null;
  const voucherIds: string[] = [];

  try {
    const bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `DEMO-LOCKTEST-BNK-${suffix}`,
        name_ar: `مصرف اختبار أقفال ${suffix}`,
        created_by: userId,
      });
    });
    bankId = bank.id;

    const branch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankBranch(client, {
        bank_id: bank.id,
        code: `DEMO-LOCKTEST-BR-${suffix}`,
        name_ar: 'فرع اختبار أقفال',
        created_by: userId,
      });
    });
    branchId = branch.id;

    const bankAcc = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `DEMO-LOCKTEST-BA-${suffix}`,
        bank_id: bank.id,
        bank_branch_id: branch.id,
        account_name_ar: 'حساب اختبار أقفال DEMO',
        account_number: `LOCKTEST${suffix}`,
        currency_code: 'IQD',
        gl_account_id: glId,
        allows_receipts: true,
        allows_payments: true,
        created_by: userId,
      });
    });
    bankAccountId = bankAcc.id;

    // تمويل منخفض عمداً — 100 فقط، ثم صرفان متزامنان بـ 60 لكل منهما (المجموع 120 > 100)
    const funding = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const v = await createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: bankAcc.id,
        counter_account_id: counterAcc.rows[0].id,
        voucher_date: entryDate,
        amount: '100',
        description: `تمويل اختبار أقفال ${suffix}`,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      return postBankVoucher(client, {
        id: v.id,
        userId,
        version: v.version,
        updated_at: v.updated_at,
      });
    });
    voucherIds.push(funding.voucher.id);

    const p1 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: bankAcc.id,
        counter_account_id: counterAcc.rows[0].id,
        voucher_date: entryDate,
        amount: '60',
        description: `صرف تزامن 1 ${suffix}`,
        created_by: userId,
      });
    });
    const p2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: bankAcc.id,
        counter_account_id: counterAcc.rows[0].id,
        voucher_date: entryDate,
        amount: '60',
        description: `صرف تزامن 2 ${suffix}`,
        created_by: userId,
      });
    });
    voucherIds.push(p1.id, p2.id);

    const results = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankVoucher(client, {
          id: p1.id,
          userId,
          version: p1.version,
          updated_at: p1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankVoucher(client, {
          id: p2.id,
          userId,
          version: p2.version,
          updated_at: p2.updated_at,
        });
      }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    const finalBalance = await withTransaction((client) =>
      calculateBankAccountBookBalance(client, bankAcc.id)
    );
    const balanceOk = Number(normalizeMoneyInput(finalBalance.book_balance)) >= 0;

    if (succeeded === 1 && failed === 1 && balanceOk) {
      ok('5) سندا صرف متزامنان على DEMO منخفض الرصيد — ينجح واحد فقط بلا رصيد سالب');
    } else {
      fail('5) السحب المتزامن', { succeeded, failed, balance: finalBalance.book_balance });
    }
  } finally {
    for (const id of voucherIds) {
      await query(
        `UPDATE accounts.bank_vouchers
         SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
         WHERE id = $1`,
        [id]
      ).catch(() => undefined);
      await query(`DELETE FROM accounts.bank_vouchers WHERE id = $1`, [id]).catch(
        () => undefined
      );
    }
    if (bankAccountId) {
      await query(`DELETE FROM accounts.bank_account_users WHERE bank_account_id=$1`, [
        bankAccountId,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.bank_accounts WHERE id=$1`, [bankAccountId]).catch(
        () => undefined
      );
    }
    if (branchId) {
      await query(`DELETE FROM accounts.bank_branches WHERE id=$1`, [branchId]).catch(
        () => undefined
      );
    }
    if (bankId) {
      await query(`DELETE FROM accounts.banks WHERE id=$1`, [bankId]).catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  // 1) نفس المورد BANK_ACCOUNT يسلسل + موردان مختلفان لا يتعارضان
  await assertResourceSerializes({
    label: '1)-2) BANK_ACCOUNT',
    domain: 'BANK_ACCOUNT',
    sameId: randomUUID(),
    otherId: randomUUID(),
  });

  // 3) نفس الاختبار لـ CASHBOX
  await assertResourceSerializes({
    label: '3) CASHBOX',
    domain: 'CASHBOX',
    sameId: randomUUID(),
    otherId: randomUUID(),
  });

  // 4) ترتيب الموارد لا يغيّر تسلسل المفاتيح
  await assertOrderIndependentLockKeys();

  // 5) اختياري — سحب متزامن على رصيد منخفض
  await runOverdraftRaceTest();
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
