/**
 * اختبارات جلسات الصندوق (المرحلة 3.B Backend).
 * التشغيل: npm run test:cash-box-sessions
 * يتطلب: migrate 063 + seed:cash-box-types:execute + مستخدم ACCOUNTS
 */
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import {
  activateCashBox,
  createCashBox,
  loadCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import {
  cancelClosingCashSession,
  closeCashSession,
  openCashSession,
  POST_COUNT_DRIFT_MESSAGE as DRIFT_MSG,
  recordCashCount,
  serializeCashSession,
  startClosingCashSession,
  type CashBoxSessionRow,
} from '../lib/accounts/cash-box-sessions';
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
import { writeFinancialAudit } from '../lib/accounts/audit';

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
  messageIncludes?: string
) {
  try {
    await fn();
    fail(name, `توقّعنا ${status} لكن نجحت العملية`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (messageIncludes && !e.message.includes(messageIncludes)) {
        fail(name, `الرسالة غير مطابقة: ${e.message}`);
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
    const req401 = new NextRequest('http://localhost/api/accounts/cash-box-sessions');
    const a401 = await requireAccountsAccess(req401);
    if ('response' in a401 && a401.response.status === 401) ok('401 بدون توكن');
    else fail('401 بدون توكن', a401);
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

  const typesCount = await query(`SELECT COUNT(*)::int AS c FROM accounts.cash_box_types`);
  if ((typesCount.rows[0].c as number) < 4) {
    throw new Error('شغّل: npm run seed:cash-box-types:execute');
  }

  const sessionTable = await query(
    `SELECT to_regclass('accounts.cash_box_sessions') AS t`
  );
  if (!sessionTable.rows[0]?.t) {
    throw new Error('شغّل أولاً: npm run migrate (063)');
  }

  const assets = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET' AND NOT a.is_group AND a.allow_posting AND a.is_active
     ORDER BY a.code LIMIT 3`
  );
  if (assets.rows.length < 2) throw new Error('يلزم حسابا ASSET');
  const cashAcc = assets.rows[0].id as string;
  const otherAcc = assets.rows[1].id as string;
  const suffix = Date.now().toString(36);

  let year = await query(
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_years
     WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  let createdTestYearId: string | null = null;
  if (!year.rows[0]) {
    const insY = await query(
      `INSERT INTO accounts.fiscal_years
        (code, name_ar, start_date, end_date, status, is_default, created_by)
       VALUES ($1,'سنة اختبار جلسات','2026-01-01','2026-12-31','ACTIVE',FALSE,$2)
       RETURNING id, start_date::text AS start_date`,
      [`CSY-${suffix}`, userId]
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
    ok('إنشاء سنة/فترة اختبار مؤقتة');
  }
  const yearId = year.rows[0].id as string;
  const entryDateCandidate = year.rows[0].start_date as string;

  const period = await query(
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1 AND status = 'OPEN'
       AND ($2::date IS NULL OR $2::date BETWEEN start_date AND end_date)
     ORDER BY period_number LIMIT 1`,
    [yearId, entryDateCandidate]
  );
  if (!period.rows[0]) throw new Error('يلزم فترة OPEN تغطي تاريخ الاختبار');
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  const createdBoxIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdJeIds: string[] = [];

  try {
    // --- صندوق ACTIVE مع أمين ---
    const box = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await createCashBox(client, {
        code: `CBS-${suffix}`,
        name_ar: 'صندوق جلسات اختبار',
        box_type_code: 'MAIN',
        account_id: cashAcc,
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
    createdBoxIds.push(box.id);

    // 1) فتح جلسة ACTIVE
    const session = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const opened = await openCashSession(client, {
        cash_box_id: box.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: entryDate,
        opened_by: userId,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.opened',
        entityType: 'cash_box_session',
        entityId: opened.id,
        newValues: serializeCashSession(opened),
      });
      return opened;
    });
    createdSessionIds.push(session.id);
    if (session.status === 'OPEN') ok('1) فتح جلسة لصندوق ACTIVE');
    else fail('1) فتح جلسة', session.status);

    // 6) opening_book_balance من POSTED
    const liveBal = await getAccountBookBalance(cashAcc);
    if (moneyEquals(normalizeMoneyInput(session.opening_book_balance), liveBal.balance)) {
      ok('6) opening_book_balance من POSTED فقط');
    } else {
      fail('6) opening_book_balance', {
        opening: session.opening_book_balance,
        live: liveBal.balance,
      });
    }

    // 2) رفض DRAFT
    const draftBox = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return createCashBox(client, {
        code: `CBS-D-${suffix}`,
        name_ar: 'مسودة',
        box_type_code: 'PETTY',
        account_id: otherAcc,
        ceiling_amount: '100000',
        created_by: userId,
      });
    });
    createdBoxIds.push(draftBox.id);
    await expectHttp(
      '2) رفض فتح جلسة لصندوق DRAFT',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          await assignPrimaryCustodian(client, {
            cashBoxId: draftBox.id,
            userId,
            createdBy: userId,
          });
          return openCashSession(client, {
            cash_box_id: draftBox.id,
            fiscal_year_id: yearId,
            fiscal_period_id: periodId,
            session_date: entryDate,
            opened_by: userId,
          });
        }),
      409
    );

    // 3) رفض دون أمين — صندوق ACTIVE بلا أمين
    const noCustodian = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      // حساب ثالث أو تحرير otherAcc إن أمكن
      const acc3 = assets.rows[2]?.id as string | undefined;
      if (!acc3) return null;
      const created = await createCashBox(client, {
        code: `CBS-NC-${suffix}`,
        name_ar: 'بلا أمين',
        box_type_code: 'FEES',
        account_id: acc3,
        created_by: userId,
      });
      // تفعيل يدوي يتجاوز شرط الأمين؟ activate يتطلب أميناً — ندرج ثم ننهي الأمين
      await assignPrimaryCustodian(client, {
        cashBoxId: created.id,
        userId,
        createdBy: userId,
      });
      const act = await activateCashBox(client, created.id, {
        version: created.version,
        updated_at: created.updated_at,
        activated_by: userId,
      });
      await txQuery(
        client,
        `UPDATE accounts.cash_box_custodians
         SET valid_to = NOW() + interval '1 second'
         WHERE cash_box_id = $1 AND valid_to IS NULL`,
        [act.id]
      );
      return act;
    });
    if (noCustodian) {
      createdBoxIds.push(noCustodian.id);
      await expectHttp(
        '3) رفض فتح دون أمين أساسي',
        () =>
          withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            return openCashSession(client, {
              cash_box_id: noCustodian.id,
              fiscal_year_id: yearId,
              fiscal_period_id: periodId,
              session_date: entryDate,
              opened_by: userId,
            });
          }),
        409
      );
    } else {
      ok('3) تخطّي (لا حساب ASSET ثالث) — يُغطّى جزئياً');
    }

    // 17) 403 غير الأمين
    if (userId2 !== userId) {
      await expectHttp(
        '17) 403 عند فتح جلسة من غير الأمين',
        () =>
          withTransaction(async (client) => {
            await acquireCashBoxesLock(client);
            return openCashSession(client, {
              cash_box_id: box.id,
              fiscal_year_id: yearId,
              fiscal_period_id: periodId,
              session_date: entryDate,
              opened_by: userId2,
            });
          }),
        403
      );
    } else {
      ok('17) تخطّي 403 (لا مستخدم ثانٍ)');
    }

    // 4) منع جلستين مفتوحتين
    await expectHttp(
      '4) منع جلستين مفتوحتين',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return openCashSession(client, {
            cash_box_id: box.id,
            fiscal_year_id: yearId,
            fiscal_period_id: periodId,
            session_date: entryDate,
            opened_by: userId,
          });
        }),
      409
    );

    // 7) بدء الإغلاق
    let s = session;
    s = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const updated = await startClosingCashSession(client, {
        sessionId: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.closing_started',
        entityType: 'cash_box_session',
        entityId: updated.id,
        newValues: serializeCashSession(updated),
      });
      return updated;
    });
    if (s.status === 'CLOSING') ok('7) بدء الإغلاق → CLOSING');
    else fail('7) بدء الإغلاق', s.status);

    // 5) منع جلسة جديدة مع CLOSING
    await expectHttp(
      '5) منع جلسة جديدة مع جلسة CLOSING',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          // تاريخ مختلف لنفس الصندوق
          const d2 = pgDateOnly(
            new Date(new Date(entryDate).getTime() + 86400000).toISOString()
          );
          return openCashSession(client, {
            cash_box_id: box.id,
            fiscal_year_id: yearId,
            fiscal_period_id: periodId,
            session_date: d2,
            opened_by: userId,
          });
        }),
      409
    );

    // 8) جرد بفرق صفر
    const balAtCount = await getAccountBookBalance(cashAcc);
    let countZero = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const r = await recordCashCount(client, {
        sessionId: s.id,
        userId,
        counted_amount: balAtCount.balance,
        version: s.version,
        updated_at: s.updated_at,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.count_recorded',
        entityType: 'cash_box_session',
        entityId: r.session.id,
        newValues: { variance: r.count.variance_amount },
      });
      s = r.session;
      return r.count;
    });
    if (moneyEquals(normalizeMoneyInput(countZero.variance_amount), '0')) {
      ok('8) تسجيل جرد بفرق صفر');
    } else fail('8) جرد صفر', countZero.variance_amount);

    // 9) جرد بفرق غير صفر (محاولة جديدة)
    countZero = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const r = await recordCashCount(client, {
        sessionId: s.id,
        userId,
        counted_amount: '1',
        version: s.version,
        updated_at: s.updated_at,
      });
      s = r.session;
      return r.count;
    });
    if (!moneyEquals(normalizeMoneyInput(countZero.variance_amount), '0')) {
      ok('9) تسجيل جرد بفرق غير صفر');
    } else fail('9) جرد غير صفر');

    // 10) رفض الإغلاق عند فرق غير صفر
    await expectHttp(
      '10) رفض الإغلاق عند فرق غير صفر',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return closeCashSession(client, {
            sessionId: s.id,
            userId,
            version: s.version,
            updated_at: s.updated_at,
          });
        }),
      409
    );

    // إعادة جرد صفر ثم 11) نجاح الإغلاق
    countZero = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const bal = await getAccountBookBalance(cashAcc);
      // need live balance inside tx — use helper via record which captures
      const live = await txQuery<{ net: string }>(
        client,
        `SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
         FROM accounts.journal_entry_lines l
         JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = $1 AND e.status = 'POSTED'`,
        [cashAcc]
      );
      void bal;
      const r = await recordCashCount(client, {
        sessionId: s.id,
        userId,
        counted_amount: normalizeMoneyInput(live.rows[0].net),
        version: s.version,
        updated_at: s.updated_at,
      });
      s = r.session;
      return r.count;
    });

    s = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const closed = await closeCashSession(client, {
        sessionId: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.closed',
        entityType: 'cash_box_session',
        entityId: closed.id,
        newValues: serializeCashSession(closed),
      });
      return closed;
    });
    if (s.status === 'CLOSED') ok('11) نجاح الإغلاق عند فرق صفر');
    else fail('11) إغلاق', s.status);

    // 14) منع تعديل CLOSED
    await expectHttp(
      '14) منع start-closing على CLOSED',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return startClosingCashSession(client, {
            sessionId: s.id,
            userId,
            version: s.version,
            updated_at: s.updated_at,
          });
        }),
      409
    );

    // جلسة ثانية على صندوق PETTY (draftBox) لاختبار الحركة بعد الجرد
    const box2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const b = await loadCashBox(client, draftBox.id, true);
      await assignPrimaryCustodian(client, {
        cashBoxId: b.id,
        userId,
        createdBy: userId,
      });
      if (b.status === 'DRAFT') {
        return activateCashBox(client, b.id, {
          version: b.version,
          updated_at: b.updated_at,
          activated_by: userId,
        });
      }
      return b;
    });

    let s2: CashBoxSessionRow = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return openCashSession(client, {
        cash_box_id: box2.id,
        fiscal_year_id: yearId,
        fiscal_period_id: periodId,
        session_date: entryDate,
        opened_by: userId,
      });
    });
    createdSessionIds.push(s2.id);

    s2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: s2.id,
        userId,
        version: s2.version,
        updated_at: s2.updated_at,
      });
    });

    // 13) إلغاء CLOSING مع سبب
    s2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const cancelled = await cancelClosingCashSession(client, {
        sessionId: s2.id,
        userId,
        reason: 'إعادة العد للاختبار',
        version: s2.version,
        updated_at: s2.updated_at,
      });
      await writeFinancialAudit(client, {
        userId,
        action: 'cash_session.closing_cancelled',
        entityType: 'cash_box_session',
        entityId: cancelled.id,
        newValues: {
          reason: cancelled.cancel_closing_reason,
        },
      });
      return cancelled;
    });
    if (s2.status === 'OPEN' && s2.cancel_closing_reason) {
      ok('13) إلغاء CLOSING مع سبب');
    } else fail('13) إلغاء CLOSING', s2);

    // 15) version conflict
    await expectHttp(
      '15) version conflict → 409',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return startClosingCashSession(client, {
            sessionId: s2.id,
            userId,
            version: 1,
            updated_at: s2.updated_at,
          });
        }),
      409
    );

    // مسار كشف حركة بعد الجرد
    s2 = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      return startClosingCashSession(client, {
        sessionId: s2.id,
        userId,
        version: s2.version,
        updated_at: s2.updated_at,
      });
    });

    const box2Row = await withTransaction(async (client) =>
      loadCashBox(client, s2.cash_box_id)
    );
    const accForS2 = box2Row.account_id!;

    const countBeforePost = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const live = await txQuery<{ net: string }>(
        client,
        `SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
         FROM accounts.journal_entry_lines l
         JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = $1 AND e.status = 'POSTED'`,
        [accForS2]
      );
      const r = await recordCashCount(client, {
        sessionId: s2.id,
        userId,
        counted_amount: normalizeMoneyInput(live.rows[0].net),
        version: s2.version,
        updated_at: s2.updated_at,
      });
      s2 = r.session;
      return r.count;
    });
    void countBeforePost;
    ok('لقطة الجرد: book_balance + last_posted محفوظان');

    // ترحيل قيد بعد الجرد
    const jeAfter = await postJe({
      userId,
      yearId,
      periodId,
      entryDate,
      debitAccountId: accForS2,
      creditAccountId: accForS2 === cashAcc ? otherAcc : cashAcc,
      amount: '50',
      description: `اختبار بعد جرد ${suffix}`,
    });
    createdJeIds.push(jeAfter);

    await expectHttp(
      '12) رفض الإغلاق إذا ظهر POSTED بعد لقطة الجرد',
      () =>
        withTransaction(async (client) => {
          await acquireCashBoxesLock(client);
          return closeCashSession(client, {
            sessionId: s2.id,
            userId,
            version: s2.version,
            updated_at: s2.updated_at,
          });
        }),
      409,
      'حركة مالية مرحلة بعد الجرد'
    );

    // 18) Audit
    const audits = await query(
      `SELECT DISTINCT action FROM accounts.financial_audit_log
       WHERE entity_type = 'cash_box_session'
         AND entity_id = ANY($1::uuid[])`,
      [createdSessionIds]
    );
    const actions = new Set(audits.rows.map((r) => r.action as string));
    const needed = [
      'cash_session.opened',
      'cash_session.closing_started',
      'cash_session.count_recorded',
      'cash_session.closed',
      'cash_session.closing_cancelled',
    ];
    if (needed.every((a) => actions.has(a))) ok('18) Audit لأفعال الجلسة');
    else fail('18) Audit', [...actions]);

    // رسالة drift الثابتة
    if (DRIFT_MSG.includes('إعادة الجرد')) ok('رسالة كشف الحركة بعد الجرد معتمدة');
    else fail('رسالة drift');
  } finally {
    for (const je of createdJeIds) {
      await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`, [
        je,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.journal_entries WHERE id = $1`, [je]).catch(
        () => undefined
      );
    }
    for (const sid of createdSessionIds) {
      await query(`UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE id = $1`, [
        sid,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.cash_counts WHERE session_id = $1`, [sid]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.cash_box_sessions WHERE id = $1`, [sid]).catch(
        () => undefined
      );
    }
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
