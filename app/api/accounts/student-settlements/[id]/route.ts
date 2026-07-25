import { NextRequest, NextResponse } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { pgDateOnly } from '@/src/lib/accounts/document-sequences';
import {
  createReversalEntry,
  loadJournalEntry,
} from '@/src/lib/accounts/journal-entries';
import { STUDENT_SETTLEMENT_SOURCE_TYPE } from '@/src/lib/accounts/student-settlement-gl';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import {
  recalculateRemainingByReceipt,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Ctx = { params: Promise<{ id: string }> };

type SettlementReceiptRow = {
  id: string;
  receipt_number: string;
  student_id: string;
  pay_amount: number | string;
  settlement_date: string | Date;
  fee_year: number | string | null;
  annual_fee: number | string | null;
  student_name: string | null;
  university_id: string | null;
};

function toMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * حذف وصل قبض تسديد طالب مع عكس القيد المحاسبي (إن وُجد) وإعادة احتساب المتبقي.
 */
export async function DELETE(request: NextRequest, context: Ctx) {
  try {
    const auth = await requireAccountsAccess(request);
    if (isAuthFailure(auth)) return auth.response;

    const { id: receiptId } = await context.params;
    if (!receiptId?.trim()) {
      return NextResponse.json(
        { success: false, error: 'معرف الوصل مطلوب' },
        { status: 400 }
      );
    }

    const userId = String(auth.user?.id || '');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        userId
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'تعذر تحديد المستخدم المنفّذ لعملية المسح' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const reason =
      typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : 'مسح وصل القبض من بطاقة حساب الطالب';

    const result = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);

      const receiptRes = await txQuery<SettlementReceiptRow>(
        client,
        `SELECT
           id,
           receipt_number,
           student_id,
           pay_amount,
           settlement_date,
           fee_year,
           annual_fee,
           student_name,
           university_id
         FROM accounts.student_settlement_receipts
         WHERE id = $1::uuid
         FOR UPDATE`,
        [receiptId]
      );

      if (!receiptRes.rows[0]) {
        throw new AccountsHttpError('وصل القبض غير موجود', 404);
      }

      const receipt = receiptRes.rows[0];
      let journalReversed = false;
      let reversalEntryNumber: string | null = null;

      // ابحث عن قيد اليومية المرتبط بالوصل عبر المصدر
      const bySource = await txQuery<{ id: string }>(
        client,
        `SELECT id FROM accounts.journal_entries
         WHERE source_type = $1 AND source_id = $2::uuid
           AND COALESCE(is_reversal, FALSE) = FALSE
         ORDER BY created_at DESC
         LIMIT 1`,
        [STUDENT_SETTLEMENT_SOURCE_TYPE, receipt.id]
      );
      const journalId = bySource.rows[0]?.id || null;

      if (journalId) {
        const journal = await loadJournalEntry(client, journalId, true);
        if (journal.status === 'POSTED' && !journal.reversal_entry_id) {
          const reversalDate = todayIsoDate();
          const reversal = await createReversalEntry(client, {
            original: journal,
            reversalDate,
            reason: `مسح وصل ${receipt.receipt_number}: ${reason}`,
            userId,
            ipAddress: auth.ipAddress,
            userAgent: auth.userAgent,
          });
          journalReversed = true;
          reversalEntryNumber = String(reversal.entry_number || '');
        }
      }

      await txQuery(
        client,
        `DELETE FROM accounts.student_settlement_receipts WHERE id = $1::uuid`,
        [receipt.id]
      );

      // إعادة احتساب المتبقي للوصولات المتبقية لنفس الطالب
      const remainingRes = await txQuery(
        client,
        `SELECT
           id,
           fee_year,
           pay_amount,
           after_discount,
           remaining_amount,
           annual_fee,
           settlement_date,
           created_at
         FROM accounts.student_settlement_receipts
         WHERE student_id = $1::uuid
         ORDER BY created_at ASC`,
        [receipt.student_id]
      );

      const annualFee =
        toMoney(receipt.annual_fee) ||
        remainingRes.rows.reduce((max: number, row: { annual_fee?: unknown }) => {
          const n = toMoney(row.annual_fee);
          return n > max ? n : max;
        }, 0);

      const fixed = recalculateRemainingByReceipt(
        remainingRes.rows as SettlementHistoryRow[],
        annualFee
      );

      for (const row of fixed) {
        await txQuery(
          client,
          `UPDATE accounts.student_settlement_receipts
           SET remaining_amount = $2, fee_year = $3
           WHERE id = $1::uuid`,
          [row.id, row.remaining_amount, row.fee_year]
        );
      }

      await writeFinancialAudit(client, {
        userId,
        action: 'student_settlement_receipt.deleted',
        entityType: 'student_settlement_receipt',
        entityId: receipt.id,
        oldValues: {
          receipt_number: receipt.receipt_number,
          student_id: receipt.student_id,
          pay_amount: toMoney(receipt.pay_amount),
          fee_year: receipt.fee_year,
          settlement_date: pgDateOnly(receipt.settlement_date),
          journal_entry_id: journalId,
        },
        newValues: {
          deleted: true,
          journal_reversed: journalReversed,
          reversal_entry_number: reversalEntryNumber,
          remaining_receipts: remainingRes.rows.length,
        },
        description: `مسح وصل قبض ${receipt.receipt_number} للطالب ${
          receipt.student_name || receipt.university_id || receipt.student_id
        }`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return {
        receipt_number: receipt.receipt_number,
        student_id: receipt.student_id,
        pay_amount: toMoney(receipt.pay_amount),
        fee_year: Number(receipt.fee_year || 1),
        journal_reversed: journalReversed,
        reversal_entry_number: reversalEntryNumber,
        remaining_receipts: remainingRes.rows.length,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: result.journal_reversed
        ? `تم مسح الوصل ${result.receipt_number} وعكس القيد ${result.reversal_entry_number || ''} وإعادة احتساب المتبقي`
        : `تم مسح الوصل ${result.receipt_number} وإعادة احتساب المتبقي`,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error('خطأ في مسح وصل التسديد:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر مسح وصل القبض' },
      { status: 500 }
    );
  }
}
