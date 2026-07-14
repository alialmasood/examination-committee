/**
 * بيانات عرض 4.D — كشوف/تسوية DEMO على حساب DEMO-BA-RECON المنعزل.
 * يُستدعى من seed-accounts-demo (idempotent).
 */
import { query } from '../lib/db';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import { assignBankAccountUser, createBankAccount } from '../lib/accounts/bank-accounts';
import { createBankVoucher, postBankVoucher } from '../lib/accounts/bank-vouchers';
import {
  addBankStatementLine,
  createBankStatement,
  excludeBankStatementLine,
  loadBankStatement,
  startBankReconciliation,
  updateBankStatement,
} from '../lib/accounts/bank-statements';
import {
  closeBankStatement,
  createReconciliationMatch,
  listBookItems,
  markBankStatementReconciled,
} from '../lib/accounts/bank-reconciliation';
import {
  acquireBanksLock,
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

const M = {
  account: 'DEMO-BA-RECON',
  gl: 'DEMO-BANK-GL-RECON',
  draft: 'DEMO-BST-DRAFT',
  progress: 'DEMO-BST-PROGRESS',
  closed: 'DEMO-BST-CLOSED',
} as const;

export async function seedBankReconciliationDemo(params: {
  userId: string;
  entryDate: string;
  bankId: string;
  branchId: string;
  ensureAccount: (p: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
  contraAccountId: string;
}): Promise<void> {
  const { userId, entryDate, bankId, branchId, ensureAccount, contraAccountId } = params;

  const reconGl = await ensureAccount({
    code: M.gl,
    nameAr: 'حساب بنكي GL للتسوية DEMO',
    typeCode: 'ASSET',
    userId,
  });

  let baRes = await query(
    `SELECT id FROM accounts.bank_accounts WHERE LOWER(code)=LOWER($1)`,
    [M.account]
  );
  if (!baRes.rows[0]) {
    const ba = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: M.account,
        bank_id: bankId,
        bank_branch_id: branchId,
        account_name_ar: 'حساب تسوية DEMO',
        account_number: 'RECON-DEMO-001',
        currency_code: 'IQD',
        account_type: 'CURRENT',
        gl_account_id: reconGl.id,
        is_primary: false,
        allows_receipts: true,
        allows_payments: true,
        allows_transfers: true,
        created_by: userId,
      });
    });
    baRes = { rows: [{ id: ba.id }] } as typeof baRes;
    console.log(`✓ حساب بنكي للتسوية: ${M.account}`);
  } else {
    console.log(`✓ حساب بنكي للتسوية موجود: ${M.account}`);
  }
  const baId = baRes.rows[0].id as string;

  await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return assignBankAccountUser(client, {
      bank_account_id: baId,
      user_id: userId,
      can_view: true,
      can_prepare: true,
      can_post: true,
      can_reconcile: true,
      created_by: userId,
    });
  }).catch(() => undefined);

  const book = await getAccountBookBalance(reconGl.id);
  if (Number(book.balance) < 1000) {
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      const v = await createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: baId,
        voucher_date: entryDate,
        amount: '5000',
        counter_account_id: contraAccountId,
        description: `${M.closed} تمويل أولي للتسوية`,
        created_by: userId,
      });
      return postBankVoucher(client, {
        id: v.id,
        userId,
        version: v.version,
        updated_at: v.updated_at,
      });
    });
    console.log('✓ تمويل حساب التسوية DEMO بقبض 5000');
  }

  const find = async (marker: string) => {
    const r = await query(
      `SELECT id, statement_number, status FROM accounts.bank_statements
       WHERE external_statement_reference = $1 LIMIT 1`,
      [marker]
    );
    return r.rows[0] as { id: string; statement_number: string; status: string } | undefined;
  };

  // DRAFT
  let draft = await find(M.draft);
  if (!draft) {
    draft = await withTransaction(async (client) => {
      const s = await createBankStatement(client, {
        bank_account_id: baId,
        external_statement_reference: M.draft,
        date_from: '2026-06-01',
        date_to: '2026-06-15',
        opening_balance: '0',
        closing_balance: '100',
        notes: M.draft,
        created_by: userId,
      });
      await addBankStatementLine(client, {
        statementId: s.id,
        transaction_date: '2026-06-05',
        description: `${M.draft} إيداع`,
        credit_amount: '100',
        userId,
      });
      return s;
    });
  }
  console.log(
    `✓ كشف DRAFT: ${draft.statement_number} → /accounts/banks/reconciliation/${draft.id}`
  );

  // IN_PROGRESS
  let prog = await find(M.progress);
  if (!prog) {
    prog = await withTransaction(async (client) => {
      const s = await createBankStatement(client, {
        bank_account_id: baId,
        external_statement_reference: M.progress,
        date_from: '2026-06-16',
        date_to: '2026-06-20',
        opening_balance: '100',
        closing_balance: '250',
        notes: M.progress,
        created_by: userId,
      });
      await addBankStatementLine(client, {
        statementId: s.id,
        transaction_date: '2026-06-18',
        description: `${M.progress} إيداع`,
        credit_amount: '150',
        userId,
      });
      const exclLine = await addBankStatementLine(client, {
        statementId: s.id,
        transaction_date: '2026-06-19',
        description: `${M.progress} سطر معلوماتي مستبعد`,
        credit_amount: '0.001',
        userId,
      });
      // closing = 100 + 150 + 0.001
      const started = await startBankReconciliation(client, {
        id: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
      await excludeBankStatementLine(client, {
        lineId: exclLine.id,
        userId,
        reason: 'رصيد مرحّل معلوماتي من كشف المصرف — ليس حركة حقيقية',
      });
      return updateBankStatement(client, {
        id: started.id,
        userId,
        version: started.version,
        updated_at: started.updated_at,
        closing_balance: '250.001',
      });
    });
  }
  console.log(
    `✓ كشف IN_PROGRESS: ${prog.statement_number} → /accounts/banks/reconciliation/${prog.id}`
  );

  // CLOSED — مطابقة كل حركات GL حتى entryDate
  let closed = await find(M.closed);
  if (!closed) {
    closed = await withTransaction(async (client) => {
      let s = await createBankStatement(client, {
        bank_account_id: baId,
        external_statement_reference: M.closed,
        date_from: '2026-01-01',
        date_to: entryDate,
        opening_balance: '0',
        closing_balance: '0',
        notes: M.closed,
        created_by: userId,
      });

      const books = await listBookItems(client, {
        statementId: s.id,
        unmatchedOnly: true,
        pageSize: 100,
      });
      const pending: Array<{ lineId: string; jeId: string; amount: string }> = [];
      let credits = 0;
      let debits = 0;

      for (const item of books.items) {
        if (item.side === 'DEBIT') {
          credits += Number(item.remaining_amount);
          const line = await addBankStatementLine(client, {
            statementId: s.id,
            transaction_date: item.entry_date,
            description: `${M.closed} ${item.description}`.slice(0, 200),
            bank_reference: item.bank_reference ?? item.entry_number,
            credit_amount: item.remaining_amount,
            userId,
          });
          pending.push({
            lineId: line.id,
            jeId: item.journal_entry_id,
            amount: item.remaining_amount,
          });
        } else {
          debits += Number(item.remaining_amount);
          const line = await addBankStatementLine(client, {
            statementId: s.id,
            transaction_date: item.entry_date,
            description: `${M.closed} ${item.description}`.slice(0, 200),
            bank_reference: item.bank_reference ?? item.entry_number,
            debit_amount: item.remaining_amount,
            userId,
          });
          pending.push({
            lineId: line.id,
            jeId: item.journal_entry_id,
            amount: item.remaining_amount,
          });
        }
      }

      // سطر معلوماتي: يُطابق بمبلغ رمزي عبر قيد؟ للأثر المعدّل — استبعاد سطر صغير بدون تأثير على
      // فرق التسوية يتطلب صافي صفر؛ لذلك نستبعد سطراً بعد إنشاء قيد معكوس... عملياً نؤجّل
      // سطر الاستبعاد لـ IN_PROGRESS/DRAFT. هنا نغلق بفرق صفر تام.

      s = await loadBankStatement(client, s.id);
      s = await updateBankStatement(client, {
        id: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
        closing_balance: (credits - debits).toFixed(3),
      });

      s = await startBankReconciliation(client, {
        id: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });

      for (const p of pending) {
        await createReconciliationMatch(client, {
          statementId: s.id,
          lineId: p.lineId,
          journalEntryId: p.jeId,
          matchedAmount: p.amount,
          userId,
        });
      }

      s = await markBankStatementReconciled(client, {
        statementId: s.id,
        userId,
      });
      return closeBankStatement(client, { statementId: s.id, userId });
    });
  }
  console.log(
    `✓ كشف CLOSED: ${closed.statement_number} → /accounts/banks/reconciliation/${closed.id}/print`
  );
}
