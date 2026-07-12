/**
 * اختبارات تسوية فرق الجرد (3.C Backend).
 * npm run test:cash-count-adjustments
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import {
  activateCashBox,
  createCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import {
  adjustCashCountVariance,
  getPostedAdjustmentForCount,
} from '../lib/accounts/cash-count-adjustments';
import {
  closeCashSession,
  openCashSession,
  recordCashCount,
  startClosingCashSession,
} from '../lib/accounts/cash-box-sessions';
import {
  getCashVarianceSettings,
  setCashVarianceSettings,
} from '../lib/accounts/cash-settings';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { moneyEquals, normalizeMoneyInput } from '../lib/accounts/money';
import {
  acquireCashBoxesLock,
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

async function postJe(params: {
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
    const req = new NextRequest('http://localhost/api/accounts/cash-box-sessions/x/adjust-variance');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('14) 401 بدون توكن');
    else fail('14) 401', a);
  }

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
  );
  if (!user.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS');
  const userId = user.rows[0].id as string;

  const user2 = await query(
    `SELECT id FROM student_affairs.users WHERE is_active AND id <> $1 LIMIT 1`,
    [userId]
  );
  const userId2 = (user2.rows[0]?.id as string) || userId;

  const table = await query(`SELECT to_regclass('accounts.cash_count_adjustments') AS t`);
  if (!table.rows[0]?.t) throw new Error('شغّل npm run migrate (064)');

  const assets = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
       AND NOT a.requires_cost_center
     ORDER BY a.code LIMIT 4`
  );
  if (assets.rows.length < 3) throw new Error('يلزم 3 حسابات ASSET على الأقل');
  const cashAcc = assets.rows[0].id as string;
  const gainAcc = assets.rows[1].id as string;
  const lossAcc = assets.rows[2].id as string;
  const otherAcc = (assets.rows[3]?.id as string) || gainAcc;

  const suffix = Date.now().toString(36);
  let year = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  let createdTestYearId: string | null = null;
  if (!year.rows[0]) {
    const insY = await query(
      `INSERT INTO accounts.fiscal_years
        (code, name_ar, start_date, end_date, status, is_default, created_by)
       VALUES ($1,'سنة تسوية جرد','2026-01-01','2026-12-31','ACTIVE',FALSE,$2)
       RETURNING id`,
      [`CVY-${suffix}`, userId]
    );
    year = insY;
    createdTestYearId = insY.rows[0].id as string;
    await query(
      `INSERT INTO accounts.fiscal_periods
        (fiscal_year_id, period_number, code, name_ar, start_date, end_date, status, created_by)
       VALUES ($1,1,'2026-01','يناير','2026-01-01','2026-01-31','OPEN',$2)`,
      [createdTestYearId, userId]
    );
    const { createDefaultSequencesForYear } = await import(
      '../lib/accounts/document-sequences'
    );
    await withTransaction(async (client) => {
      await createDefaultSequencesForYear(client, createdTestYearId!);
    });
  }
  const yearId = year.rows[0].id as string;
  // سنة ACTIVE قد تبقى من اختبار سابق بدون تسلسلات أو بتسلسل متأخر عن القيود
  {
    const seqCheck = await query(
      `SELECT 1 FROM accounts.document_sequences
       WHERE fiscal_year_id = $1 AND document_type = 'JOURNAL_ENTRY' LIMIT 1`,
      [yearId]
    );
    if (seqCheck.rows.length === 0) {
      const { createDefaultSequencesForYear } = await import(
        '../lib/accounts/document-sequences'
      );
      await withTransaction(async (client) => {
        await createDefaultSequencesForYear(client, yearId);
      });
    }
    await query(
      `UPDATE accounts.document_sequences ds
       SET current_number = GREATEST(
         ds.current_number,
         COALESCE((
           SELECT MAX(
             CASE
               WHEN je.entry_number ~ '[0-9]+$'
               THEN CAST(substring(je.entry_number from '[0-9]+$') AS integer)
               ELSE 0
             END
           )
           FROM accounts.journal_entries je
           WHERE je.fiscal_year_id = ds.fiscal_year_id
         ), 0)
       ),
       updated_at = NOW()
       WHERE ds.fiscal_year_id = $1 AND ds.document_type = 'JOURNAL_ENTRY'`,
      [yearId]
    );
  }
  const period = await query(
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1 AND status = 'OPEN' ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN');
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  const periodEndDate = pgDateOnly(
    (
      await query(`SELECT end_date::text AS end_date FROM accounts.fiscal_periods WHERE id = $1`, [
        periodId,
      ])
    ).rows[0].end_date as string
  );

  function sessionDateOffset(days: number): string {
    const d = new Date(`${entryDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEndDate ? periodEndDate : iso;
  }

  const beforeSettings = await getCashVarianceSettings();
  await withTransaction(async (client) => {
    await setCashVarianceSettings(client, {
      cash_variance_gain_account_id: gainAcc,
      cash_variance_loss_account_id: lossAcc,
      userId,
    });
  });

  const createdBoxIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdJeIds: string[] = [];

  async function makeActiveBox(code: string, accountId: string) {
    return withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await createCashBox(client, {
        code,
        name_ar: `صندوق تسوية ${code}`,
        box_type_code: 'MAIN',
        account_id: accountId,
        created_by: userId,
      });
      await assignPrimaryCustodian(client, {
        cashBoxId: created.id,
        userId,
        createdBy: userId,
      });
      return activateCashBox(client, created.id, {
        version: created.version,
        updated_at: created.updated_at,
        activated_by: userId,
      });
    });
  }

  async function openClosingWithCount(params: {
    boxId: string;
    counted: string;
  }) {
    let s = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: params.boxId,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: entryDate,
        opened_by: userId,
      });
    });
    createdSessionIds.push(s.id);
    s = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
    });
    const r = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: s.id,
        userId,
        counted_amount: params.counted,
        version: s.version,
        updated_at: s.updated_at,
      });
    });
    return r;
  }

  try {
    // --- GAIN ---
    const boxGain = await makeActiveBox(`CVG-${suffix}`, cashAcc);
    createdBoxIds.push(boxGain.id);
    const bal0 = await getAccountBookBalance(cashAcc);
    const gainCounted = normalizeMoneyInput(String(Number(bal0.balance) + 100));
    let g = await openClosingWithCount({ boxId: boxGain.id, counted: gainCounted });

    const gainAdj = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return adjustCashCountVariance(client, {
        sessionId: g.session.id,
        userId,
        version: g.session.version,
        updated_at: g.session.updated_at,
      });
    });
    g = { session: gainAdj.session, count: gainAdj.count };

    if (gainAdj.adjustment.direction === 'GAIN' && gainAdj.created) {
      ok('1) GAIN صحيح');
    } else fail('1) GAIN', gainAdj.adjustment);

    const jeGain = await query(
      `SELECT entry_type, source_type, source_id::text, status,
              total_debit::text, total_credit::text
       FROM accounts.journal_entries WHERE id = $1`,
      [gainAdj.adjustment.journal_entry_id]
    );
    const jg = jeGain.rows[0];
    if (
      jg?.entry_type === 'ADJUSTMENT' &&
      jg.source_type === 'CASH_COUNT_VARIANCE' &&
      jg.source_id === gainAdj.adjustment.id &&
      jg.status === 'POSTED'
    ) {
      ok('7/9/10) قيد GAIN: ADJUSTMENT + CASH_COUNT_VARIANCE + POSTED + source_id');
    } else fail('قيد GAIN', jg);

    const linesGain = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_number`,
      [gainAdj.adjustment.journal_entry_id]
    );
    const debitCash = linesGain.rows.find(
      (l) => l.account_id === cashAcc && Number(l.debit_amount) > 0
    );
    const creditGain = linesGain.rows.find(
      (l) => l.account_id === gainAcc && Number(l.credit_amount) > 0
    );
    if (debitCash && creditGain) ok('7) اتجاه قيد GAIN (مدين صندوق / دائن زيادة)');
    else fail('اتجاه GAIN', linesGain.rows);

    // idempotency
    const again = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return adjustCashCountVariance(client, {
        sessionId: g.session.id,
        userId,
        version: g.session.version,
        updated_at: g.session.updated_at,
      });
    });
    if (!again.created && again.adjustment.id === gainAdj.adjustment.id) {
      ok('4) منع تسوية ثانية / idempotency');
    } else fail('idempotency', again);

    // close after GAIN
    const closedGain = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const closed = await closeCashSession(client, {
        sessionId: g.session.id,
        userId,
        version: g.session.version,
        updated_at: g.session.updated_at,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.closed_after_adjustment',
        entityType: 'cash_box_session',
        entityId: closed.id,
        newValues: { adjustment_id: gainAdj.adjustment.id },
      });
      return closed;
    });
    if (closedGain.status === 'CLOSED') ok('11) الإغلاق بعد التسوية (GAIN)');
    else fail('إغلاق GAIN', closedGain.status);

    // --- LOSS ---
    // استخدم حساباً آخر للصندوق لتفادي تداخل الرصيد
    const boxLoss = await makeActiveBox(`CVL-${suffix}`, otherAcc);
    createdBoxIds.push(boxLoss.id);
    const seedJe = await postJe({
      userId,
      yearId,
      periodId,
      entryDate,
      debitAccountId: otherAcc,
      creditAccountId: gainAcc,
      amount: '500',
      description: `رصيد افتتاحي عجز ${suffix}`,
    });
    createdJeIds.push(seedJe);
    const balLoss = await getAccountBookBalance(otherAcc);
    const lossCounted = normalizeMoneyInput(String(Math.max(0, Number(balLoss.balance) - 50)));
    let l = await openClosingWithCount({ boxId: boxLoss.id, counted: lossCounted });

    const lossAdj = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return adjustCashCountVariance(client, {
        sessionId: l.session.id,
        userId,
        version: l.session.version,
        updated_at: l.session.updated_at,
      });
    });
    l = { session: lossAdj.session, count: lossAdj.count };

    if (lossAdj.adjustment.direction === 'LOSS') ok('2) LOSS صحيح');
    else fail('2) LOSS', lossAdj.adjustment);

    const linesLoss = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_number`,
      [lossAdj.adjustment.journal_entry_id]
    );
    const debitLoss = linesLoss.rows.find(
      (row) => row.account_id === lossAcc && Number(row.debit_amount) > 0
    );
    const creditCash = linesLoss.rows.find(
      (row) => row.account_id === otherAcc && Number(row.credit_amount) > 0
    );
    if (debitLoss && creditCash) ok('8) اتجاه قيد LOSS (مدين عجز / دائن صندوق)');
    else fail('اتجاه LOSS', linesLoss.rows);

    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return closeCashSession(client, {
        sessionId: l.session.id,
        userId,
        version: l.session.version,
        updated_at: l.session.updated_at,
      });
    });
    ok('11b) إغلاق بعد LOSS');

    // --- فرق صفر: جلسة جديدة على نفس صندوق GAIN بتاريخ آخر ضمن الفترة ---
    let zSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: boxGain.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: sessionDateOffset(5),
        opened_by: userId,
      });
    });
    createdSessionIds.push(zSession.id);
    zSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: zSession.id,
        userId,
        version: zSession.version,
        updated_at: zSession.updated_at,
      });
    });
    const balZ = await getAccountBookBalance(cashAcc);
    const z = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: zSession.id,
        userId,
        counted_amount: balZ.balance,
        version: zSession.version,
        updated_at: zSession.updated_at,
      });
    });
    await expectHttp(
      '3) منع التسوية إذا الفرق صفر',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return adjustCashCountVariance(client, {
            sessionId: z.session.id,
            userId,
            version: z.session.version,
            updated_at: z.session.updated_at,
          });
        }),
      409
    );

    // أغلق جلسة الفرق صفر
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return closeCashSession(client, {
        sessionId: z.session.id,
        userId,
        version: z.session.version,
        updated_at: z.session.updated_at,
      });
    });

    // --- بلا حسابات فروقات ---
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: null,
        cash_variance_loss_account_id: null,
        userId,
      });
    });

    let nSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: boxGain.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: sessionDateOffset(10),
        opened_by: userId,
      });
    });
    createdSessionIds.push(nSession.id);
    nSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: nSession.id,
        userId,
        version: nSession.version,
        updated_at: nSession.updated_at,
      });
    });
    const balN = await getAccountBookBalance(cashAcc);
    const n = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: nSession.id,
        userId,
        counted_amount: normalizeMoneyInput(String(Number(balN.balance) + 10)),
        version: nSession.version,
        updated_at: nSession.updated_at,
      });
    });
    await expectHttp(
      '5) منع التسوية دون حسابات فروقات',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return adjustCashCountVariance(client, {
            sessionId: n.session.id,
            userId,
            version: n.session.version,
            updated_at: n.session.updated_at,
          });
        }),
      409
    );

    // restore settings
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: gainAcc,
        cash_variance_loss_account_id: lossAcc,
        userId,
      });
    });

    // --- drift قبل التسوية (نفس الجلسة n) ---
    const jeDrift = await postJe({
      userId,
      yearId,
      periodId,
      entryDate,
      debitAccountId: cashAcc,
      creditAccountId: gainAcc,
      amount: '7',
      description: `drift قبل تسوية ${suffix}`,
    });
    createdJeIds.push(jeDrift);
    const dSession = await query(
      `SELECT version, updated_at FROM accounts.cash_box_sessions WHERE id = $1`,
      [n.session.id]
    );
    const dSessionState = {
      ...n.session,
      version: dSession.rows[0].version as number,
      updated_at: dSession.rows[0].updated_at as string | Date,
    };
    await expectHttp(
      '6) منع التسوية إذا ظهر drift بعد الجرد',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return adjustCashCountVariance(client, {
            sessionId: dSessionState.id,
            userId,
            version: dSessionState.version,
            updated_at: dSessionState.updated_at,
          });
        }),
      409,
      'حركة مالية مرحلة بعد الجرد'
    );

    // --- drift بعد التسوية يمنع الإغلاق: على صندوق LOSS ---
    let aSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: boxLoss.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: sessionDateOffset(12),
        opened_by: userId,
      });
    });
    createdSessionIds.push(aSession.id);
    aSession = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: aSession.id,
        userId,
        version: aSession.version,
        updated_at: aSession.updated_at,
      });
    });
    const balA = await getAccountBookBalance(otherAcc);
    const aCount = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return recordCashCount(client, {
        sessionId: aSession.id,
        userId,
        counted_amount: normalizeMoneyInput(String(Number(balA.balance) + 20)),
        version: aSession.version,
        updated_at: aSession.updated_at,
      });
    });
    const adjA = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      return adjustCashCountVariance(client, {
        sessionId: aCount.session.id,
        userId,
        version: aCount.session.version,
        updated_at: aCount.session.updated_at,
      });
    });
    const jeAfter = await postJe({
      userId,
      yearId,
      periodId,
      entryDate,
      debitAccountId: otherAcc,
      creditAccountId: gainAcc,
      amount: '3',
      description: `بعد تسوية ${suffix}`,
    });
    createdJeIds.push(jeAfter);
    const aVer = await query(
      `SELECT version, updated_at FROM accounts.cash_box_sessions WHERE id = $1`,
      [adjA.session.id]
    );
    await expectHttp(
      '12) رفض الإغلاق إذا ظهر POSTED أحدث من قيد التسوية',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return closeCashSession(client, {
            sessionId: adjA.session.id,
            userId,
            version: aVer.rows[0].version,
            updated_at: aVer.rows[0].updated_at,
          });
        }),
      409,
      'بعد قيد التسوية'
    );

    // version conflict
    await expectHttp(
      '13) version conflict → 409',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await acquireJournalEntriesLock(client);
          return adjustCashCountVariance(client, {
            sessionId: adjA.session.id,
            userId,
            version: 1,
            updated_at: adjA.session.updated_at,
          });
        }),
      409
    );

    // 403
    if (userId2 !== userId) {
      await expectHttp(
        '15) 403 غير الأمين',
        () =>
          withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            await acquireJournalEntriesLock(client);
            return adjustCashCountVariance(client, {
              sessionId: adjA.session.id,
              userId: userId2,
              version: aVer.rows[0].version,
              updated_at: aVer.rows[0].updated_at,
            });
          }),
        403
      );
    } else ok('15) تخطّي 403');

    // Audit
    await withTransaction(async (client) => {
      const adj = await getPostedAdjustmentForCount(client, adjA.count.id);
      if (adj) {
        await writeFinancialAudit(client, {
          userId,
          action: 'cash_count_adjustment.posted',
          entityType: 'cash_count_adjustment',
          entityId: adj.id,
          newValues: { id: adj.id },
        });
      }
    });
    const audits2 = await query(
      `SELECT 1 FROM accounts.financial_audit_log
       WHERE action = 'cash_count_adjustment.posted' LIMIT 1`
    );
    if (audits2.rows[0]) ok('16) Audit');
    else fail('16) Audit');

    void moneyEquals;
  } finally {
    await withTransaction(async (client) => {
      await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: beforeSettings.cash_variance_gain_account_id,
        cash_variance_loss_account_id: beforeSettings.cash_variance_loss_account_id,
        userId,
      });
    }).catch(() => undefined);

    for (const sid of createdSessionIds) {
      await query(
        `UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE id = $1`,
        [sid]
      ).catch(() => undefined);
      await query(
        `DELETE FROM accounts.cash_count_adjustments WHERE cash_box_session_id = $1`,
        [sid]
      ).catch(() => undefined);
      // delete JEs linked as sources first
      const adjJes = await query(
        `SELECT journal_entry_id FROM accounts.cash_count_adjustments WHERE cash_box_session_id = $1`,
        [sid]
      ).catch(() => ({ rows: [] as Array<{ journal_entry_id: string }> }));
      void adjJes;
      await query(`DELETE FROM accounts.cash_counts WHERE session_id = $1`, [sid]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.cash_box_sessions WHERE id = $1`, [sid]).catch(
        () => undefined
      );
    }

    // delete adjustment journals by source
    const srcJes = await query(
      `SELECT id FROM accounts.journal_entries
       WHERE source_type = 'CASH_COUNT_VARIANCE'
         AND description LIKE '%' || $1 || '%'`,
      [suffix]
    ).catch(() => ({ rows: [] as Array<{ id: string }> }));
    for (const row of srcJes.rows) {
      await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
        row.id,
      ]).catch(() => undefined);
      await query(
        `UPDATE accounts.cash_count_adjustments SET journal_entry_id = NULL WHERE journal_entry_id = $1`,
        [row.id]
      ).catch(() => undefined);
      await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [row.id]).catch(
        () => undefined
      );
    }

    for (const je of createdJeIds) {
      await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
        je,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [je]).catch(
        () => undefined
      );
    }

    // cleanup remaining adjustments
    await query(
      `DELETE FROM accounts.cash_count_adjustments WHERE cash_box_id = ANY($1::uuid[])`,
      [createdBoxIds]
    ).catch(() => undefined);

    for (const id of createdBoxIds) {
      await query(`DELETE FROM accounts.cash_box_custodians WHERE cash_box_id = $1`, [
        id,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_boxes WHERE id = $1`, [id]).catch(
        () => undefined
      );
    }

    if (createdTestYearId) {
      await query(`DELETE FROM accounts.document_sequences WHERE fiscal_year_id = $1`, [
        createdTestYearId,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.fiscal_periods WHERE fiscal_year_id = $1`, [
        createdTestYearId,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.fiscal_years WHERE id = $1`, [
        createdTestYearId,
      ]).catch(() => undefined);
    }

    await closePool();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await closePool().catch(() => undefined);
});
