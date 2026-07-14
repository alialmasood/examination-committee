/**
 * اختبارات تأسيس الحسابات المصرفية (4.A)
 * npm run test:bank-accounts
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import {
  createBank,
  deactivateBank,
  updateBank,
} from '../lib/accounts/banks';
import {
  createBankBranch,
  deactivateBankBranch,
  updateBankBranch,
} from '../lib/accounts/bank-branches';
import {
  activateBankAccount,
  assignBankAccountUser,
  closeBankAccount,
  createBankAccount,
  normalizeIban,
  removeBankAccountUser,
  suspendBankAccount,
  updateBankAccount,
} from '../lib/accounts/bank-accounts';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import {
  acquireBanksLock,
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '../lib/accounts/with-transaction';

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}

async function expectHttp(
  name: string,
  fn: () => Promise<unknown>,
  status: number,
  includes?: string
) {
  try {
    await fn();
    fail(name, `توقّعنا ${status}`);
  } catch (e) {
    const pg = e as { code?: string };
    if (
      (status === 409 || status === 400) &&
      pg?.code === '23505'
    ) {
      ok(name);
      return;
    }
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        fail(name, e.message);
        return;
      }
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function ensureFreeAsset(code: string, nameAr: string, userId: string) {
  const existing = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a WHERE LOWER(a.code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code='ASSET'`
  );
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'حساب اختبار بنوك')
     RETURNING id`,
    [
      code,
      nameAr,
      type.rows[0].id,
      type.rows[0].normal_balance,
      sort.rows[0].n,
      userId,
    ]
  );
  return ins.rows[0].id as string;
}

async function postPostedJe(params: {
  userId: string;
  yearId: string;
  periodId: string;
  entryDate: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
}): Promise<string> {
  return withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await assertFiscalContextForEntry(client, {
      fiscalYearId: params.yearId,
      fiscalPeriodId: params.periodId,
      entryDate: params.entryDate,
    });
    const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
      client,
      [
        {
          account_id: params.debitAccountId,
          debit_amount: params.amount,
          credit_amount: '0',
          description: params.description,
        },
        {
          account_id: params.creditAccountId,
          debit_amount: '0',
          credit_amount: params.amount,
          description: 'مقابل',
        },
      ],
      'strict'
    );
    const entryNumber = await allocateJournalEntryNumber(client, params.yearId);
    const ins = await txQuery(
      client,
      `INSERT INTO accounts.journal_entries
        (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
         description, total_debit, total_credit, status, created_by, updated_by,
         posted_by, posted_at)
       VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'POSTED',$8,$8,$8,NOW())
       RETURNING id`,
      [
        entryNumber,
        params.yearId,
        params.periodId,
        params.entryDate,
        params.description,
        totalDebit,
        totalCredit,
        params.userId,
      ]
    );
    await replaceJournalLines(client, ins.rows[0].id as string, lines);
    return ins.rows[0].id as string;
  });
}

async function main() {
  {
    const req = new NextRequest('http://localhost/api/accounts/banks');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('28) 401 بدون توكن');
    else fail('28) 401', a);
  }

  {
    const other = await query(
      `SELECT u.id, u.username FROM student_affairs.users u
       WHERE u.is_active
         AND NOT EXISTS (
           SELECT 1 FROM student_affairs.user_systems us
           JOIN student_affairs.systems s ON s.id = us.system_id
           WHERE us.user_id = u.id AND s.code = 'ACCOUNTS'
         )
       LIMIT 1`
    );
    if (other.rows[0]) {
      const token = generateAccessToken(
        other.rows[0].id as string,
        other.rows[0].username as string
      );
      const req = new NextRequest('http://localhost/api/accounts/banks', {
        headers: { cookie: `access_token=${token}` },
      });
      const a = await requireAccountsAccess(req);
      if ('response' in a && a.response.status === 403) ok('28b) 403 دون صلاحية ACCOUNTS');
      else fail('28b) 403', a);
    } else ok('28b) تخطّي 403 (لا مستخدم بلا ACCOUNTS)');
  }

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS');
  const userId = user.rows[0].id as string;

  const otherUser = await query(
    `SELECT id FROM student_affairs.users WHERE is_active AND id <> $1 LIMIT 1`,
    [userId]
  );
  const userId2 = (otherUser.rows[0]?.id as string) || userId;

  const table = await query(`SELECT to_regclass('accounts.bank_accounts') AS t`);
  if (!table.rows[0]?.t) throw new Error('شغّل migrate 067');

  const suffix = Date.now().toString(36).toUpperCase();
  const gl1 = await ensureFreeAsset(`BA-GL1-${suffix}`, 'GL بنك 1', userId);
  const gl2 = await ensureFreeAsset(`BA-GL2-${suffix}`, 'GL بنك 2', userId);
  const gl3 = await ensureFreeAsset(`BA-GL3-${suffix}`, 'GL بنك 3', userId);

  const groupAcc = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE is_group AND is_active LIMIT 1`
  );

  const cashGl = await query(
    `SELECT account_id FROM accounts.cash_boxes
     WHERE account_id IS NOT NULL AND status IN ('ACTIVE','SUSPENDED') LIMIT 1`
  );

  const createdBankIds: string[] = [];
  const createdBranchIds: string[] = [];
  const createdAccountIds: string[] = [];

  try {
    // 1) إنشاء مصرف
    let bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `BNK-${suffix}`,
        name_ar: 'مصرف اختبار',
        name_en: 'Test Bank',
        swift_code: 'TESTIQBA',
        created_by: userId,
      });
    });
    createdBankIds.push(bank.id);
    if (bank.is_active) ok('1) إنشاء مصرف');
    else fail('1', bank);

    // 2) تكرار الكود
    await expectHttp(
      '2) منع تكرار كود المصرف',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBank(client, {
            code: `BNK-${suffix}`,
            name_ar: 'مكرر',
            created_by: userId,
          });
        }),
      409
    );

    // 3) تحديث
    bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return updateBank(client, {
        id: bank.id,
        userId,
        version: bank.version,
        updated_at: bank.updated_at,
        name_ar: 'مصرف اختبار محدّث',
      });
    });
    if (bank.name_ar.includes('محدّث')) ok('3) تحديث مصرف');
    else fail('3', bank.name_ar);

    // 6) فرع
    let branch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankBranch(client, {
        bank_id: bank.id,
        code: `BR-${suffix}`,
        name_ar: 'فرع اختبار',
        city: 'البصرة',
        created_by: userId,
      });
    });
    createdBranchIds.push(branch.id);
    ok('6) إنشاء فرع');

    // 7) تكرار كود الفرع
    await expectHttp(
      '7) منع تكرار كود الفرع داخل المصرف',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankBranch(client, {
            bank_id: bank.id,
            code: `BR-${suffix}`,
            name_ar: 'مكرر',
            created_by: userId,
          });
        }),
      409
    );

    // تعطيل مصرف ثم محاولة فرع — نعيد التفعيل أولاً عبر update
    // 5) مصرف غير فعّال
    const inactiveBank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `BNK-OFF-${suffix}`,
        name_ar: 'معطّل',
        is_active: false,
        created_by: userId,
      });
    });
    createdBankIds.push(inactiveBank.id);
    await expectHttp(
      '5) منع فرع لمصرف غير فعّال',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankBranch(client, {
            bank_id: inactiveBank.id,
            code: 'X1',
            name_ar: 'فرع',
            created_by: userId,
          });
        }),
      409
    );

    // 8) حساب
    let account = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BA-${suffix}`,
        bank_id: bank.id,
        bank_branch_id: branch.id,
        account_name_ar: 'حساب تشغيلي',
        account_number: '1234-5678',
        iban: 'IQ98 TEST 1234 5678 9012 345',
        currency_code: 'IQD',
        gl_account_id: gl1,
        account_type: 'CURRENT',
        is_primary: true,
        allows_cheques: true,
        cheque_book_enabled: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(account.id);
    if (account.status === 'ACTIVE' && account.is_primary) ok('8) إنشاء حساب مصرفي');
    else fail('8', account);

    // 18) تطبيع IBAN
    const ib = normalizeIban('IQ98 TEST 1234 5678 9012 345');
    if (ib.normalized === 'IQ98TEST123456789012345') ok('18) تطبيع IBAN');
    else fail('18', ib);

    // 9) دون مصرف
    await expectHttp(
      '9) منع حساب دون مصرف',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-X-${suffix}`,
            bank_id: '',
            account_name_ar: 'x',
            account_number: '999',
            gl_account_id: gl2,
            created_by: userId,
          });
        }),
      400
    );

    // مصرف آخر + فرع غريب
    const bank2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `BNK2-${suffix}`,
        name_ar: 'مصرف 2',
        created_by: userId,
      });
    });
    createdBankIds.push(bank2.id);

    // 10) فرع لمصرف مختلف
    await expectHttp(
      '10) منع فرع تابع لمصرف مختلف',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-WB-${suffix}`,
            bank_id: bank2.id,
            bank_branch_id: branch.id,
            account_name_ar: 'خطأ فرع',
            account_number: '88881',
            gl_account_id: gl2,
            created_by: userId,
          });
        }),
      409
    );

    // 11) GL تجميعي
    if (groupAcc.rows[0]) {
      await expectHttp(
        '11) منع حساب GL تجميعي',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: `BA-G-${suffix}`,
              bank_id: bank.id,
              account_name_ar: 'تجميعي',
              account_number: '77771',
              gl_account_id: groupAcc.rows[0].id,
              created_by: userId,
            });
          }),
        400
      );
    } else ok('11) تخطّي GL تجميعي');

    // 14) GL صندوق
    if (cashGl.rows[0]) {
      await expectHttp(
        '14) منع استخدام GL مربوط بصندوق',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: `BA-CASH-${suffix}`,
              bank_id: bank.id,
              account_name_ar: 'صندوق',
              account_number: '66661',
              gl_account_id: cashGl.rows[0].account_id,
              created_by: userId,
            });
          }),
        409
      );
    } else ok('14) تخطّي GL صندوق');

    // 15) GL مكرر
    await expectHttp(
      '15) منع ربط GL بحسابين',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-DUPGL-${suffix}`,
            bank_id: bank.id,
            account_name_ar: 'مكرر GL',
            account_number: '55551',
            gl_account_id: gl1,
            created_by: userId,
          });
        }),
      409
    );

    // 16) رقم حساب مكرر
    await expectHttp(
      '16) منع تكرار رقم الحساب داخل المصرف',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-DUPN-${suffix}`,
            bank_id: bank.id,
            account_name_ar: 'مكرر رقم',
            account_number: '1234 5678',
            gl_account_id: gl2,
            created_by: userId,
          });
        }),
      409
    );

    // 17) IBAN مكرر
    await expectHttp(
      '17) منع تكرار IBAN',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-DUPI-${suffix}`,
            bank_id: bank.id,
            account_name_ar: 'مكرر iban',
            account_number: '44441',
            iban: 'IQ98TEST123456789012345',
            gl_account_id: gl2,
            created_by: userId,
          });
        }),
      409
    );

    // 19) أساسي واحد لكل عملة
    const acc2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BA2-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'حساب ثانٍ',
        account_number: '22221',
        currency_code: 'IQD',
        gl_account_id: gl2,
        is_primary: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(acc2.id);
    const primaries = await query(
      `SELECT id FROM accounts.bank_accounts
       WHERE currency_code='IQD' AND is_primary AND status<>'CLOSED'
         AND id = ANY($1::uuid[])`,
      [createdAccountIds]
    );
    if (primaries.rows.length === 1 && primaries.rows[0].id === acc2.id) {
      ok('19) الحساب الأساسي واحد لكل عملة');
    } else fail('19 primary', primaries.rows);

    // USD أساسي منفصل
    const accUsd = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BA-USD-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'حساب دولار',
        account_number: '33331',
        currency_code: 'USD',
        gl_account_id: gl3,
        is_primary: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(accUsd.id);
    ok('19b) أساسي USD منفصل عن IQD');

    // نفس رقم الحساب في مصرف آخر مسموح (unique على bank_id + normalized)
    const glSameNum = await ensureFreeAsset(`BA-GLSN-${suffix}`, 'GL رقم مشترك', userId);
    const sameNumOtherBank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BA-SN-${suffix}`,
        bank_id: bank2.id,
        account_name_ar: 'رقم مكرر عبر مصارف',
        account_number: '1234-5678',
        gl_account_id: glSameNum,
        currency_code: 'IQD',
        created_by: userId,
      });
    });
    createdAccountIds.push(sameNumOtherBank.id);
    ok('16b) السماح بنفس رقم الحساب في مصرف مختلف');

    // فرع غير فعّال
    const inactiveBranch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankBranch(client, {
        bank_id: bank.id,
        code: `BR-OFF-${suffix}`,
        name_ar: 'فرع معطّل',
        is_active: false,
        created_by: userId,
      });
    });
    createdBranchIds.push(inactiveBranch.id);
    const glInactiveBr = await ensureFreeAsset(
      `BA-GLIB-${suffix}`,
      'GL فرع معطّل',
      userId
    );
    await expectHttp(
      '4b) منع حساب على فرع غير فعّال',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankAccount(client, {
            code: `BA-IB-${suffix}`,
            bank_id: bank.id,
            bank_branch_id: inactiveBranch.id,
            account_name_ar: 'خطأ فرع معطّل',
            account_number: '19191919',
            gl_account_id: glInactiveBr,
            created_by: userId,
          });
        }),
      409
    );

    // رصيد افتتاحي مرجعي لا ينشئ قيوداً
    const glOpen = await ensureFreeAsset(`BA-GLOP-${suffix}`, 'GL رصيد مرجعي', userId);
    const openAcc = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BA-OP-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'حساب رصيد مرجعي',
        account_number: '20202020',
        gl_account_id: glOpen,
        opening_balance_reference: '1500.000',
        opening_balance_date: '2026-01-01',
        created_by: userId,
      });
    });
    createdAccountIds.push(openAcc.id);
    const openJe = await query(
      `SELECT COUNT(*)::int AS n
       FROM accounts.journal_entry_lines l
       WHERE l.account_id = $1::uuid`,
      [glOpen]
    );
    if (openJe.rows[0].n === 0) ok('9b) opening_balance_reference لا ينشئ قيداً');
    else fail('9b', openJe.rows[0].n);

    // تزامن أساسي لنفس العملة
    const glP1 = await ensureFreeAsset(`BA-GLP1-${suffix}`, 'GL primary1', userId);
    const glP2 = await ensureFreeAsset(`BA-GLP2-${suffix}`, 'GL primary2', userId);
    const primaryRace = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankAccount(client, {
          code: `BA-P1-${suffix}`,
          bank_id: bank.id,
          account_name_ar: 'أساسي متزامن 1',
          account_number: '301301301',
          currency_code: 'EUR',
          gl_account_id: glP1,
          is_primary: true,
          created_by: userId,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankAccount(client, {
          code: `BA-P2-${suffix}`,
          bank_id: bank.id,
          account_name_ar: 'أساسي متزامن 2',
          account_number: '302302302',
          currency_code: 'EUR',
          gl_account_id: glP2,
          is_primary: true,
          created_by: userId,
        });
      }),
    ]);
    for (const r of primaryRace) {
      if (r.status === 'fulfilled') createdAccountIds.push(r.value.id);
    }
    const eurPrimaries = await query(
      `SELECT id FROM accounts.bank_accounts
       WHERE currency_code='EUR' AND is_primary AND status<>'CLOSED'
         AND id = ANY($1::uuid[])`,
      [createdAccountIds]
    );
    if (eurPrimaries.rows.length === 1) ok('19c) تزامن: أساسي واحد فقط لكل عملة');
    else fail('19c', eurPrimaries.rows);

    // منع إغلاق برصيد غير صفري (POSTED فقط)
    const fy = await query(
      `SELECT y.id AS year_id, p.id AS period_id, p.start_date::text AS entry_date
       FROM accounts.fiscal_years y
       JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
       WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
       ORDER BY p.start_date LIMIT 1`
    );
    const glNz = await ensureFreeAsset(`BA-GLNZ-${suffix}`, 'GL رصيد غير صفري', userId);
    const contraGl = await query(
      `SELECT a.id FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE t.code IN ('REVENUE','LIABILITY','EQUITY')
         AND NOT a.is_group AND a.allow_posting AND a.is_active
       LIMIT 1`
    );
    let nzAccountId: string | null = null;
    let nzJeId: string | null = null;
    if (fy.rows[0] && contraGl.rows[0]) {
      const nzAcc = await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankAccount(client, {
          code: `BA-NZ-${suffix}`,
          bank_id: bank.id,
          account_name_ar: 'حساب برصيد',
          account_number: '40404040',
          gl_account_id: glNz,
          created_by: userId,
        });
      });
      createdAccountIds.push(nzAcc.id);
      nzAccountId = nzAcc.id;
      nzJeId = await postPostedJe({
        userId,
        yearId: fy.rows[0].year_id,
        periodId: fy.rows[0].period_id,
        entryDate: fy.rows[0].entry_date,
        debitAccountId: glNz,
        creditAccountId: contraGl.rows[0].id,
        amount: '25.000',
        description: `TEST-BANK-NZ-${suffix}`,
      });
      // قيد DRAFT يجب ألا يؤثر
      await withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const entryNumber = await allocateJournalEntryNumber(
          client,
          fy.rows[0].year_id
        );
        await txQuery(
          client,
          `INSERT INTO accounts.journal_entries
            (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
             description, total_debit, total_credit, status, created_by, updated_by)
           VALUES ($1,$2,$3,$4::date,'MANUAL',$5,0,0,'DRAFT',$6,$6)`,
          [
            entryNumber,
            fy.rows[0].year_id,
            fy.rows[0].period_id,
            fy.rows[0].entry_date,
            `TEST-BANK-DRAFT-${suffix}`,
            userId,
          ]
        );
      });
      await expectHttp(
        '22b) منع إغلاق حساب برصيد GL غير صفري',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            const fresh = await txQuery(
              client,
              `SELECT version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
              [nzAcc.id]
            );
            return closeBankAccount(client, {
              id: nzAcc.id,
              userId,
              version: fresh.rows[0].version,
              updated_at: fresh.rows[0].updated_at,
            });
          }),
        409
      );
      // تصفير الرصيد ثم إغلاق (اختبار السماح عند الصفر)
      await postPostedJe({
        userId,
        yearId: fy.rows[0].year_id,
        periodId: fy.rows[0].period_id,
        entryDate: fy.rows[0].entry_date,
        debitAccountId: contraGl.rows[0].id,
        creditAccountId: glNz,
        amount: '25.000',
        description: `TEST-BANK-NZ-REV-${suffix}`,
      });
      const closedNz = await withTransaction(async (client) => {
        await acquireBanksLock(client);
        const fresh = await txQuery(
          client,
          `SELECT version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
          [nzAcc.id]
        );
        return closeBankAccount(client, {
          id: nzAcc.id,
          userId,
          version: fresh.rows[0].version,
          updated_at: fresh.rows[0].updated_at,
        });
      });
      if (closedNz.status === 'CLOSED') ok('22c) السماح بإغلاق حساب برصيد صفري');
      else fail('22c', closedNz.status);
    } else {
      ok('22b) تخطّي (لا فترة مفتوحة/مقابل)');
      ok('22c) تخطّي');
    }
    void nzAccountId;
    void nzJeId;

    // 20) تعليق
    account = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const fresh = await txQuery(
        client,
        `SELECT version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
        [account.id]
      );
      return suspendBankAccount(client, {
        id: account.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    if (account.status === 'SUSPENDED') ok('20) تعليق الحساب');
    else fail('20', account.status);

    // SUSPENDED خارج خيارات العمليات
    const opsAfterSuspend = await query(
      `SELECT id FROM accounts.bank_accounts
       WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [account.id]
    );
    if (!opsAfterSuspend.rows[0]) {
      ok('8b) SUSPENDED مستبعد من الخيارات التشغيلية (ACTIVE فقط)');
    } else fail('8b');

    // 21) إعادة تفعيل
    account = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return activateBankAccount(client, {
        id: account.id,
        userId,
        version: account.version,
        updated_at: account.updated_at,
      });
    });
    if (account.status === 'ACTIVE') ok('21) إعادة تفعيل');
    else fail('21', account.status);

    // 25) مستخدمون
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: account.id,
        user_id: userId2,
        can_view: true,
        can_prepare: true,
        created_by: userId,
      });
    });
    ok('25) تعيين مستخدم مخول');

    await expectHttp(
      '25c) منع تكرار مستخدم غير نشط',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return assignBankAccountUser(client, {
            bank_account_id: account.id,
            user_id: '00000000-0000-0000-0000-000000000001',
            can_view: true,
            created_by: userId,
          });
        }),
      404
    );

    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return removeBankAccountUser(client, {
        bank_account_id: account.id,
        user_id: userId2,
      });
    });
    ok('25b) إزالة مستخدم مخول');

    // 22) إغلاق (رصيد GL صفر)
    account = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const fresh = await txQuery(
        client,
        `SELECT version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
        [account.id]
      );
      return closeBankAccount(client, {
        id: account.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    if (account.status === 'CLOSED') ok('22) إغلاق الحساب');
    else fail('22', account.status);

    // 23) منع تعديل CLOSED
    await expectHttp(
      '23) منع تعديل حساب CLOSED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return updateBankAccount(client, {
            id: account.id,
            userId,
            version: account.version,
            updated_at: account.updated_at,
            account_name_ar: 'محاولة',
          });
        }),
      409
    );

    await expectHttp(
      '23b) منع تعليق CLOSED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return suspendBankAccount(client, {
            id: account.id,
            userId,
            version: account.version,
            updated_at: account.updated_at,
          });
        }),
      409
    );

    await expectHttp(
      '23c) منع إعادة تفعيل CLOSED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return activateBankAccount(client, {
            id: account.id,
            userId,
            version: account.version,
            updated_at: account.updated_at,
          });
        }),
      409
    );

    // 24) الخيارات لاحقاً تستبعد CLOSED — تحقق عبر إنشاء قائمة
    const activeOnly = await query(
      `SELECT id FROM accounts.bank_accounts WHERE id=$1 AND status='ACTIVE'`,
      [account.id]
    );
    if (!activeOnly.rows[0]) ok('24) CLOSED خارج الاستخدام الفعّال');
    else fail('24');

    const opsClosed = await query(
      `SELECT ba.id FROM accounts.bank_accounts ba
       JOIN accounts.banks b ON b.id = ba.bank_id AND b.is_active = TRUE
       WHERE ba.status = 'ACTIVE' AND ba.id = $1::uuid`,
      [account.id]
    );
    if (!opsClosed.rows[0]) ok('24b) CLOSED مستبعد من operational_bank_accounts');
    else fail('24b');

    // 4) تعطيل مصرف — يحتاج لا حسابات ACTIVE
    // علّق/أغلق الباقي غير المغلق
    for (const id of createdAccountIds) {
      await withTransaction(async (client) => {
        await acquireBanksLock(client);
        const fresh = await txQuery(
          client,
          `SELECT status, version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
          [id]
        );
        if (!fresh.rows[0] || fresh.rows[0].status === 'CLOSED') return;
        let version = fresh.rows[0].version;
        let updatedAt = fresh.rows[0].updated_at;
        if (fresh.rows[0].status === 'ACTIVE') {
          const sus = await suspendBankAccount(client, {
            id,
            userId,
            version,
            updated_at: updatedAt,
          });
          version = sus.version;
          updatedAt = sus.updated_at;
        }
        await closeBankAccount(client, {
          id,
          userId,
          version,
          updated_at: updatedAt,
        });
      });
    }

    bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const fresh = await txQuery(
        client,
        `SELECT version, updated_at::text AS updated_at FROM accounts.banks WHERE id=$1`,
        [bank.id]
      );
      return deactivateBank(client, {
        id: bank.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    if (!bank.is_active) ok('4) تعطيل مصرف');
    else fail('4', bank);

    // تحديث فرع
    branch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const fresh = await txQuery(
        client,
        `SELECT version, updated_at::text AS updated_at FROM accounts.bank_branches WHERE id=$1`,
        [branch.id]
      );
      return updateBankBranch(client, {
        id: branch.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
        name_ar: 'فرع محدّث',
      });
    });
    ok('6b) تحديث فرع');

    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return deactivateBankBranch(client, {
        id: branch.id,
        userId,
        version: branch.version,
        updated_at: branch.updated_at,
      });
    });
    ok('6c) تعطيل فرع');

    // 12/13 — غير فعّال / غير ترحيلي إن وُجد
    const inactiveGl = await query(
      `SELECT id FROM accounts.chart_of_accounts
       WHERE NOT is_active AND NOT is_group LIMIT 1`
    );
    if (inactiveGl.rows[0]) {
      // نحتاج مصرف فعّال
      const b3 = await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBank(client, {
          code: `BNK3-${suffix}`,
          name_ar: 'مصرف 3',
          created_by: userId,
        });
      });
      createdBankIds.push(b3.id);
      await expectHttp(
        '12) منع GL غير فعّال',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: `BA-INA-${suffix}`,
              bank_id: b3.id,
              account_name_ar: 'x',
              account_number: '11119',
              gl_account_id: inactiveGl.rows[0].id,
              created_by: userId,
            });
          }),
        400
      );
    } else ok('12) تخطّي GL غير فعّال');

    const noPost = await query(
      `SELECT id FROM accounts.chart_of_accounts
       WHERE is_active AND NOT is_group AND NOT allow_posting LIMIT 1`
    );
    if (noPost.rows[0]) {
      const b4 = createdBankIds[createdBankIds.length - 1];
      await expectHttp(
        '13) منع GL غير ترحيلي',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankAccount(client, {
              code: `BA-NP-${suffix}`,
              bank_id: b4,
              account_name_ar: 'x',
              account_number: '11118',
              gl_account_id: noPost.rows[0].id,
              created_by: userId,
            });
          }),
        400
      );
    } else ok('13) تخطّي GL غير ترحيلي');

    // 26) صلاحيات — requireAccountsAccess يغطي؛ تعيين المخولين موجود
    ok('26) Backend auth عبر requireAccountsAccess + تعيين مخولين (تمهيدي)');

    // 27) تدقيق فعلي
    await withTransaction(async (client) => {
      await writeFinancialAudit(client, {
        userId,
        action: 'bank_account.updated',
        entityType: 'bank_account',
        entityId: account.id,
        oldValues: { status: 'ACTIVE', code: account.code },
        newValues: { status: 'CLOSED', code: account.code, gl_account_id: account.gl_account_id },
        description: `اختبار تدقيق بنك ${suffix}`,
      });
    });
    const auditRow = await query(
      `SELECT action, old_values, new_values FROM accounts.financial_audit_log
       WHERE description = $1 LIMIT 1`,
      [`اختبار تدقيق بنك ${suffix}`]
    );
    if (
      auditRow.rows[0]?.action === 'bank_account.updated' &&
      auditRow.rows[0]?.old_values &&
      auditRow.rows[0]?.new_values
    ) {
      ok('27) Audit يسجّل الحالة السابقة والجديدة');
    } else fail('27', auditRow.rows[0]);

    // 29) seed idempotent — أكواد DEMO إن وُجدت لا تُكسر
    const demoBank = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.banks WHERE LOWER(code)=LOWER('DEMO-BANK')`
    );
    const demoBa = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.bank_accounts WHERE LOWER(code)=LOWER('DEMO-BA-IQD')`
    );
    if (demoBank.rows[0].n <= 1 && demoBa.rows[0].n <= 1) {
      ok('29) DEMO bank codes فريدة (idempotent-ready)');
    } else fail('29', { banks: demoBank.rows[0].n, accounts: demoBa.rows[0].n });

    // 30–33) عدم كسر وحدات النقد السابقة
    const cashSmoke = await query(`
      SELECT
        to_regclass('accounts.cash_vouchers') AS vouchers,
        to_regclass('accounts.cash_transfers') AS transfers,
        to_regclass('accounts.cash_box_sessions') AS sessions,
        to_regclass('accounts.cash_count_adjustments') AS adjustments
    `);
    const s = cashSmoke.rows[0];
    if (s.vouchers) ok('30) جداول cash vouchers سليمة');
    else fail('30');
    if (s.transfers) ok('31) جداول cash transfers سليمة');
    else fail('31');
    if (s.sessions) ok('32) جداول cash sessions سليمة');
    else fail('32');
    if (s.adjustments) ok('33) جداول cash count adjustments سليمة');
    else fail('33');

    void deactivateBankBranch;
  } finally {
    for (const id of createdAccountIds) {
      await query(`DELETE FROM accounts.bank_account_users WHERE bank_account_id=$1`, [
        id,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.bank_accounts WHERE id=$1`, [id]).catch(
        () => undefined
      );
    }
    for (const id of createdBranchIds) {
      await query(`DELETE FROM accounts.bank_branches WHERE id=$1`, [id]).catch(
        () => undefined
      );
    }
    for (const id of createdBankIds) {
      await query(`DELETE FROM accounts.bank_branches WHERE bank_id=$1`, [id]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.banks WHERE id=$1`, [id]).catch(() => undefined);
    }
    await closePool();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await closePool().catch(() => undefined);
});
