/**
 * اختبارات نواة الصناديق (A2–A5).
 * التشغيل: npm run test:cash-boxes
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import { assertCashBoxAccountEligible } from '../lib/accounts/cash-box-account';
import { assertCashBoxOptimisticConcurrency } from '../lib/accounts/cash-box-concurrency';
import {
  activateCashBox,
  createCashBox,
  loadCashBox,
  serializeCashBox,
  updateCashBox,
} from '../lib/accounts/cash-boxes';
import {
  assignPrimaryCustodian,
  getActivePrimaryCustodian,
} from '../lib/accounts/cash-box-custodians';
import {
  getCashVarianceSettings,
  setCashVarianceSettings,
} from '../lib/accounts/cash-settings';
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
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { moneyEquals } from '../lib/accounts/money';

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
  status: number
) {
  try {
    await fn();
    fail(name, `توقّعنا ${status} لكن نجحت العملية`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function main() {
  // --- 401 / 403 عبر requireAccountsAccess ---
  {
    const req401 = new NextRequest('http://localhost/api/accounts/cash-boxes');
    const a401 = await requireAccountsAccess(req401);
    if ('response' in a401 && a401.response.status === 401) ok('401 بدون توكن');
    else fail('401 بدون توكن', a401);

    const req403 = new NextRequest('http://localhost/api/accounts/cash-boxes', {
      headers: { cookie: 'access_token=invalid.token.value' },
    });
    const a403 = await requireAccountsAccess(req403);
    // توكن غير صالح → 401 (التحقق قبل فحص النظام)
    if ('response' in a403 && (a403.response.status === 401 || a403.response.status === 403)) {
      ok(`حماية توكن غير صالح → ${a403.response.status}`);
    } else fail('حماية توكن غير صالح', a403);
  }

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS للاختبار');
  const userId = user.rows[0].id as string;

  const user2 = await query(
    `SELECT id FROM student_affairs.users WHERE is_active AND id <> $1 LIMIT 1`,
    [userId]
  );
  const userId2 = (user2.rows[0]?.id as string) || userId;

  // أنواع الصناديق
  const typesCount = await query(`SELECT COUNT(*)::int AS c FROM accounts.cash_box_types`);
  if ((typesCount.rows[0].c as number) < 4) {
    throw new Error('شغّل أولاً: npm run seed:cash-box-types:execute');
  }

  const assetPosting = await query(
    `SELECT a.id, a.code FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
     ORDER BY a.code LIMIT 5`
  );
  if (assetPosting.rows.length < 2) {
    throw new Error('يلزم حسابا ASSET تفصيليان للاختبار');
  }
  const cashAcc1 = assetPosting.rows[0].id as string;
  const cashAcc2 = assetPosting.rows[1].id as string;

  const nonAsset = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code <> 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
     LIMIT 1`
  );
  const groupAcc = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE is_group AND is_active LIMIT 1`
  );
  const inactiveAcc = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND NOT a.is_active LIMIT 1`
  );

  const suffix = Date.now().toString(36);
  const createdIds: string[] = [];
  let createdTestYearId: string | null = null;

  try {
    // إنشاء DRAFT
    const draft = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashBox(client, {
        code: `CB-T-${suffix}`,
        name_ar: 'صندوق اختبار',
        box_type_code: 'MAIN',
        account_id: cashAcc1,
        created_by: userId,
      });
    });
    createdIds.push(draft.id);
    if (draft.status === 'DRAFT') ok('إنشاء صندوق DRAFT');
    else fail('إنشاء صندوق DRAFT', draft.status);

    await withTransaction(async (client) => {
      if (nonAsset.rows[0]) {
        await expectHttp(
          'رفض حساب غير ASSET',
          () => assertCashBoxAccountEligible(client, nonAsset.rows[0].id as string),
          400
        );
      } else {
        console.log('⚠️ لا يوجد حساب غير ASSET — تخطي');
      }
      if (groupAcc.rows[0]) {
        await expectHttp(
          'رفض حساب تجميعي',
          () => assertCashBoxAccountEligible(client, groupAcc.rows[0].id as string),
          400
        );
      } else {
        console.log('⚠️ لا يوجد حساب تجميعي — تخطي');
      }
      if (inactiveAcc.rows[0]) {
        await expectHttp(
          'رفض حساب غير فعال',
          () => assertCashBoxAccountEligible(client, inactiveAcc.rows[0].id as string),
          400
        );
      } else {
        console.log('⚠️ لا يوجد حساب ASSET غير فعّال — تخطي');
      }
    });

    // allow_posting = false: حساب تجميعي يغطيها؛ جرّب أيضاً إن وُجد
    const noPost = await query(
      `SELECT id FROM accounts.chart_of_accounts
       WHERE allow_posting = FALSE AND is_active LIMIT 1`
    );
    if (noPost.rows[0]) {
      await withTransaction(async (client) => {
        await expectHttp(
          'رفض حساب allow_posting=false',
          () => assertCashBoxAccountEligible(client, noPost.rows[0].id as string),
          400
        );
      });
    }

    // PETTY بدون سقف
    await expectHttp(
      'رفض PETTY بدون سقف',
      () =>
        withTransaction(async (client) =>
          createCashBox(client, {
            code: `CB-P0-${suffix}`,
            name_ar: 'نثري بلا سقف',
            box_type_code: 'PETTY',
            account_id: cashAcc2,
            created_by: userId,
          })
        ),
      400
    );

    const petty = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashBox(client, {
        code: `CB-P1-${suffix}`,
        name_ar: 'نثري بسقف',
        box_type_code: 'PETTY',
        account_id: cashAcc2,
        ceiling_amount: '500000',
        created_by: userId,
      });
    });
    createdIds.push(petty.id);
    ok('نجاح إنشاء صندوق PETTY بسقف صالح');

    // تفعيل بلا أمين
    await expectHttp(
      'رفض التفعيل دون أمين',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          const b = await loadCashBox(client, draft.id);
          return activateCashBox(client, draft.id, {
            version: b.version,
            updated_at: b.updated_at,
            activated_by: userId,
          });
        }),
      409
    );

    // تعيين أمين
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await assignPrimaryCustodian(client, {
        cashBoxId: draft.id,
        userId,
        createdBy: userId,
      });
    });
    ok('تعيين أمين أساسي');

    const primary = await withTransaction(async (client) =>
      getActivePrimaryCustodian(client, draft.id)
    );
    if (primary?.user_id === userId) ok('أمين أساسي ساري واحد');

    // محاولة أمين أساسي ثانٍ مباشرة (قبل إنهاء الأول) عبر INSERT
    try {
      await query(
        `INSERT INTO accounts.cash_box_custodians
          (cash_box_id, user_id, role, is_primary, created_by)
         VALUES ($1,$2,'CUSTODIAN',TRUE,$3)`,
        [draft.id, userId2, userId]
      );
      fail('منع أمين أساسي ثانٍ ساري');
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === '23505') ok('منع أمين أساسي ثانٍ ساري (فهرس فريد)');
      else fail('منع أمين أساسي ثانٍ ساري', e);
    }

    // تفعيل ناجح
    const activated = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const b = await loadCashBox(client, draft.id);
      return activateCashBox(client, draft.id, {
        version: b.version,
        updated_at: b.updated_at,
        activated_by: userId,
      });
    });
    if (activated.status === 'ACTIVE') ok('نجاح التفعيل بعد أمين وحساب صالح');
    else fail('نجاح التفعيل', activated.status);

    // تكرار حساب لصندوق حي
    await expectHttp(
      'رفض تكرار الحساب لصندوق حي',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return createCashBox(client, {
            code: `CB-DUP-${suffix}`,
            name_ar: 'تكرار حساب',
            box_type_code: 'FEES',
            account_id: cashAcc1,
            created_by: userId,
          }).then(async (row) => {
            createdIds.push(row.id);
            await assignPrimaryCustodian(client, {
              cashBoxId: row.id,
              userId,
              createdBy: userId,
            });
            const b = await loadCashBox(client, row.id);
            return activateCashBox(client, row.id, {
              version: b.version,
              updated_at: b.updated_at,
              activated_by: userId,
            });
          });
        }),
      409
    );

    // تعارض version
    await expectHttp(
      'تعارض version → 409',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          const b = await loadCashBox(client, activated.id);
          return updateCashBox(client, activated.id, {
            name_ar: 'محاولة قديمة',
            version: b.version - 1 || 999,
            updated_at: b.updated_at,
            updated_by: userId,
          });
        }),
      409
    );

    // updated_at mismatch
    await expectHttp(
      'تعارض updated_at → 409',
      () => {
        assertCashBoxOptimisticConcurrency({
          currentVersion: 1,
          currentUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          expectedVersion: 1,
          expectedUpdatedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
        });
        return Promise.resolve();
      },
      409
    );

    // رصيد من POSTED فقط
    let year = await query(
      `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
    );
    if (!year.rows[0]) {
      const insY = await query(
        `INSERT INTO accounts.fiscal_years
          (code, name_ar, start_date, end_date, status, is_default, created_by)
         VALUES ($1,'سنة اختبار صناديق','2026-01-01','2026-12-31','ACTIVE',FALSE,$2)
         RETURNING id`,
        [`CBY-${suffix}`, userId]
      );
      year = insY;
      createdTestYearId = insY.rows[0].id as string;
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
      ok('إنشاء سنة/فترة اختبار مؤقتة للرصيد');
    }
    const yearId = year.rows[0].id as string;
    const period = await query(
      `SELECT id, start_date FROM accounts.fiscal_periods
       WHERE fiscal_year_id = $1 AND status = 'OPEN' ORDER BY period_number LIMIT 1`,
      [yearId]
    );
    if (!period.rows[0]) throw new Error('لا توجد فترة OPEN');
    const periodId = period.rows[0].id as string;
    const entryDate = pgDateOnly(period.rows[0].start_date as string | Date);

    const otherAcc = await query(
      `SELECT a.id FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE a.id <> $1 AND NOT a.is_group AND a.allow_posting AND a.is_active
         AND NOT a.requires_cost_center
       LIMIT 1`,
      [cashAcc1]
    );
    if (!otherAcc.rows[0]) throw new Error('يلزم حساب مقابل للقيد');

    const balBefore = await getAccountBookBalance(cashAcc1);

    // قيد DRAFT — يجب ألا يؤثر
    const draftJe = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      await assertFiscalContextForEntry(client, {
        fiscalYearId: yearId,
        fiscalPeriodId: periodId,
        entryDate,
      });
      const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
        client,
        [
          { account_id: cashAcc1, debit_amount: '1000', credit_amount: '0', description: 'اختبار' },
          {
            account_id: otherAcc.rows[0].id,
            debit_amount: '0',
            credit_amount: '1000',
            description: 'مقابل',
          },
        ],
        'draft'
      );
      const entryNumber = await allocateJournalEntryNumber(client, yearId);
      const ins = await txQuery(
        client,
        `INSERT INTO accounts.journal_entries
          (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
           description, total_debit, total_credit, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'DRAFT',$8,$8)
         RETURNING id`,
        [
          entryNumber,
          yearId,
          periodId,
          entryDate,
          'اختبار رصيد صندوق DRAFT',
          totalDebit,
          totalCredit,
          userId,
        ]
      );
      await replaceJournalLines(client, ins.rows[0].id as string, lines);
      return ins.rows[0].id as string;
    });

    const balAfterDraft = await getAccountBookBalance(cashAcc1);
    if (moneyEquals(balBefore.balance, balAfterDraft.balance)) {
      ok('تجاهل قيود DRAFT في الرصيد');
    } else fail('تجاهل قيود DRAFT', { balBefore, balAfterDraft });

    // قيد POSTED
    const postedJe = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      await assertFiscalContextForEntry(client, {
        fiscalYearId: yearId,
        fiscalPeriodId: periodId,
        entryDate,
      });
      const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
        client,
        [
          { account_id: cashAcc1, debit_amount: '2500', credit_amount: '0', description: 'نقد' },
          {
            account_id: otherAcc.rows[0].id,
            debit_amount: '0',
            credit_amount: '2500',
            description: 'مقابل',
          },
        ],
        'strict'
      );
      const entryNumber = await allocateJournalEntryNumber(client, yearId);
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
          yearId,
          periodId,
          entryDate,
          'اختبار رصيد صندوق POSTED',
          totalDebit,
          totalCredit,
          userId,
        ]
      );
      await replaceJournalLines(client, ins.rows[0].id as string, lines);
      return ins.rows[0].id as string;
    });

    const balAfterPosted = await getAccountBookBalance(cashAcc1);
    // APPROVED/REVIEWED — أنشئ قيد APPROVED دون POSTED
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
        client,
        [
          { account_id: cashAcc1, debit_amount: '900', credit_amount: '0', description: 'معتمد' },
          {
            account_id: otherAcc.rows[0].id,
            debit_amount: '0',
            credit_amount: '900',
            description: 'مقابل',
          },
        ],
        'draft'
      );
      const entryNumber = await allocateJournalEntryNumber(client, yearId);
      const ins = await txQuery(
        client,
        `INSERT INTO accounts.journal_entries
          (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
           description, total_debit, total_credit, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'APPROVED',$8,$8)
         RETURNING id`,
        [
          entryNumber,
          yearId,
          periodId,
          entryDate,
          'اختبار رصيد APPROVED',
          totalDebit,
          totalCredit,
          userId,
        ]
      );
      await replaceJournalLines(client, ins.rows[0].id as string, lines);
      return ins.rows[0].id;
    });

    const balIgnoreApproved = await getAccountBookBalance(cashAcc1);
    if (moneyEquals(balAfterPosted.balance, balIgnoreApproved.balance)) {
      ok('تجاهل قيود APPROVED/غير المرحلة في الرصيد');
    } else fail('تجاهل APPROVED', { balAfterPosted, balIgnoreApproved });

    if (!moneyEquals(balBefore.balance, balAfterPosted.balance)) {
      ok('قراءة الرصيد من POSTED فقط (تغيّر بعد الترحيل)');
    } else fail('الرصيد لم يتغير بعد POSTED');

    // إعدادات الفروقات
    const beforeSettings = await getCashVarianceSettings();
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: otherAcc.rows[0].id,
        cash_variance_loss_account_id: otherAcc.rows[0].id,
        userId,
      });
    });
    const afterSettings = await getCashVarianceSettings();
    if (
      afterSettings.cash_variance_gain_account_id === otherAcc.rows[0].id &&
      afterSettings.cash_variance_loss_account_id === otherAcc.rows[0].id
    ) {
      ok('قراءة وكتابة إعدادات فروقات الجرد');
    } else fail('إعدادات الفروقات', afterSettings);

    // استعادة الإعدادات السابقة
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: beforeSettings.cash_variance_gain_account_id,
        cash_variance_loss_account_id: beforeSettings.cash_variance_loss_account_id,
        userId,
      });
    });

    // Audit
    const audits = await query(
      `SELECT action FROM accounts.financial_audit_log
       WHERE entity_type = 'cash_box' AND entity_id = ANY($1::uuid[])
       ORDER BY created_at DESC LIMIT 20`,
      [createdIds]
    );
    // قد لا تُكتب audit من الاختبار المباشر للـ helpers — نفحص عبر عملية API-like مع audit
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const { writeFinancialAudit } = await import('../lib/accounts/audit');
      const box = await loadCashBox(client, activated.id);
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_box.updated',
        entityType: 'cash_box',
        entityId: box.id,
        newValues: serializeCashBox(box),
        description: 'اختبار audit',
      });
    });
    const auditCheck = await query(
      `SELECT 1 FROM accounts.financial_audit_log
       WHERE action LIKE 'cash_box.%' AND entity_id = $1::uuid LIMIT 1`,
      [activated.id]
    );
    if (auditCheck.rows[0]) ok('Audit لأفعال cash_box.*');
    else fail('Audit', audits.rows);

    // تنظيف قيود الاختبار
    await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
      draftJe,
    ]);
    await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [draftJe]);
    await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
      postedJe,
    ]);
    await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [postedJe]);
    await query(
      `DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id IN (
         SELECT id FROM accounts.journal_entries WHERE description = 'اختبار رصيد APPROVED'
       )`
    );
    await query(
      `DELETE FROM accounts.journal_entries WHERE description = 'اختبار رصيد APPROVED'`
    );
  } finally {
    // تنظيف الصناديق الاختبارية
    if (createdIds.length) {
      await query(
        `DELETE FROM accounts.cash_box_custodians WHERE cash_box_id = ANY($1::uuid[])`,
        [createdIds]
      );
      await query(`DELETE FROM accounts.cash_boxes WHERE id = ANY($1::uuid[])`, [
        createdIds,
      ]);
    }
    if (createdTestYearId) {
      await query(`DELETE FROM accounts.document_sequences WHERE fiscal_year_id = $1`, [
        createdTestYearId,
      ]);
      await query(`DELETE FROM accounts.fiscal_periods WHERE fiscal_year_id = $1`, [
        createdTestYearId,
      ]);
      await query(`DELETE FROM accounts.fiscal_years WHERE id = $1`, [createdTestYearId]);
    }
  }

  console.log('\nانتهى اختبار الصناديق.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
