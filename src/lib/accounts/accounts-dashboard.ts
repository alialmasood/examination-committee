/**
 * تجميع إحصائيات لوحة تحكم نظام الحسابات.
 */
import { getSupplierDashboardSummary } from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type AccountsDashboardStats = {
  generated_at: string;
  fiscal: {
    default_year_code: string | null;
    default_year_status: string | null;
    open_periods: number;
    total_years: number;
  };
  overview: {
    chart_accounts: number;
    cost_centers: number;
    journal_entries: {
      total: number;
      drafts: number;
      pending_review: number;
      approved: number;
      posted: number;
      reversed: number;
    };
  };
  students: {
    total_accounts: number;
    active_accounts: number;
    suspended_accounts: number;
    total_receivable_balance: string;
    posted_collections: number;
    collections_total: string;
    pending_installments: number;
    overdue_installments: number;
  };
  cash: {
    boxes: { total: number; active: number; draft: number; suspended: number };
    sessions: { total: number; open: number; closing: number; closed: number };
    vouchers: {
      total: number;
      posted: number;
      receipts_total: string;
      payments_total: string;
      net_movement: string;
    };
    transfers: {
      total: number;
      draft: number;
      dispatched: number;
      received: number;
      cancelled: number;
    };
  };
  banks: {
    banks: { total: number; active: number };
    accounts: { total: number; active: number };
    vouchers: {
      total: number;
      posted: number;
      receipts_total: string;
      payments_total: string;
      net_movement: string;
    };
    transfers: { total: number; posted: number; draft: number; voided: number };
    statements: { total: number; draft: number; in_progress: number; reconciled: number; closed: number };
  };
  suppliers: {
    active_suppliers: number;
    total_payables: string;
    remaining_payables: string;
    draft_invoices: number;
    posted_invoices: number;
    due_invoices: number;
    overdue_invoices: number;
  };
  purchasing: {
    purchase_orders: { total: number; draft: number; approved: number; closed: number; cancelled: number };
    receipts: { total: number; draft: number; posted: number };
  };
  fixed_assets: {
    total: number;
    draft: number;
    active: number;
    suspended: number;
    disposed: number;
  };
  payroll: {
    active_people: number;
    active_contracts: number;
    open_periods: number;
    runs: { total: number; draft: number; calculated: number; cancelled: number };
    latest_calculated: {
      run_number: string | null;
      people_count: number;
      error_count: number;
      net_total: string;
      calculated_at: string | null;
    } | null;
  };
};

function row1<T extends Record<string, unknown>>(rows: T[]): T {
  return (rows[0] ?? {}) as T;
}

function netMoney(receipts: string, payments: string): string {
  const r = Number(receipts || 0);
  const p = Number(payments || 0);
  return String(r - p);
}

export async function getAccountsDashboardStats(client: TxClient): Promise<AccountsDashboardStats> {
  const [
    fiscal,
    chartAccounts,
    costCenters,
    journal,
    students,
    studentBalance,
    collections,
    installments,
    cashBoxes,
    cashSessions,
    cashVouchers,
    cashTransfers,
    banks,
    bankAccounts,
    bankVouchers,
    bankTransfers,
    bankStatements,
    purchaseOrders,
    purchaseReceipts,
    fixedAssets,
    payrollPeople,
    payrollContracts,
    payrollPeriods,
    payrollRuns,
    latestRun,
    supplierSummary,
  ] = await Promise.all([
    txQuery<{
      default_year_code: string | null;
      default_year_status: string | null;
      open_periods: number;
      total_years: number;
    }>(
      client,
      `SELECT
         (SELECT code FROM accounts.fiscal_years WHERE is_default = TRUE LIMIT 1) AS default_year_code,
         (SELECT status FROM accounts.fiscal_years WHERE is_default = TRUE LIMIT 1) AS default_year_status,
         (SELECT COUNT(*)::int FROM accounts.fiscal_periods fp
           JOIN accounts.fiscal_years fy ON fy.id = fp.fiscal_year_id
           WHERE fp.status = 'OPEN' AND fy.is_default = TRUE) AS open_periods,
         (SELECT COUNT(*)::int FROM accounts.fiscal_years) AS total_years`
    ),
    txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.chart_of_accounts WHERE is_active = TRUE AND NOT is_group`
    ),
    txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.cost_centers WHERE is_active = TRUE`
    ),
    txQuery<{
      total: number;
      drafts: number;
      pending_review: number;
      approved: number;
      posted: number;
      reversed: number;
    }>(
      client,
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS drafts,
         COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW')::int AS pending_review,
         COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
         COUNT(*) FILTER (WHERE status = 'REVERSED')::int AS reversed
       FROM accounts.journal_entries`
    ),
    txQuery<{ total: number; active: number; suspended: number }>(
      client,
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended
       FROM accounts.student_accounts`
    ),
    txQuery<{ balance: string }>(
      client,
      `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text AS balance
       FROM accounts.student_ledger_entries
       WHERE entry_type <> 'OPENING_REFERENCE'`
    ),
    txQuery<{ n: number; total: string }>(
      client,
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(amount) FILTER (WHERE status = 'POSTED'), 0)::text AS total
       FROM accounts.student_collections`
    ),
    txQuery<{ pending: number; overdue: number }>(
      client,
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('PENDING','DUE','PARTIALLY_PAID') AND outstanding_amount > 0)::int AS pending,
         COUNT(*) FILTER (WHERE status IN ('PENDING','DUE','PARTIALLY_PAID') AND outstanding_amount > 0
           AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
       FROM accounts.student_installments`
    ),
    txQuery<{ total: number; active: number; draft: number; suspended: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended
       FROM accounts.cash_boxes`
    ),
    txQuery<{ total: number; open: number; closing: number; closed: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
              COUNT(*) FILTER (WHERE status = 'CLOSING')::int AS closing,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed
       FROM accounts.cash_box_sessions`
    ),
    txQuery<{
      total: number;
      posted: number;
      receipts_total: string;
      payments_total: string;
    }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
              COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_RECEIPT' AND status = 'POSTED'), 0)::text AS receipts_total,
              COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_PAYMENT' AND status = 'POSTED'), 0)::text AS payments_total
       FROM accounts.cash_vouchers`
    ),
    txQuery<{ total: number; draft: number; dispatched: number; received: number; cancelled: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'DISPATCHED')::int AS dispatched,
              COUNT(*) FILTER (WHERE status = 'RECEIVED')::int AS received,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
       FROM accounts.cash_transfers`
    ),
    txQuery<{ total: number; active: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM accounts.banks`
    ),
    txQuery<{ total: number; active: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
       FROM accounts.bank_accounts`
    ),
    txQuery<{
      total: number;
      posted: number;
      receipts_total: string;
      payments_total: string;
    }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
              COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'BANK_RECEIPT' AND status = 'POSTED'), 0)::text AS receipts_total,
              COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'BANK_PAYMENT' AND status = 'POSTED'), 0)::text AS payments_total
       FROM accounts.bank_vouchers`
    ),
    txQuery<{ total: number; posted: number; draft: number; voided: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS voided
       FROM accounts.bank_transfers`
    ),
    txQuery<{ total: number; draft: number; in_progress: number; reconciled: number; closed: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
              COUNT(*) FILTER (WHERE status = 'RECONCILED')::int AS reconciled,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed
       FROM accounts.bank_statements`
    ),
    txQuery<{ total: number; draft: number; approved: number; closed: number; cancelled: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
       FROM accounts.purchase_orders`
    ),
    txQuery<{ total: number; draft: number; posted: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted
       FROM accounts.purchase_receipts`
    ),
    txQuery<{ total: number; draft: number; active: number; suspended: number; disposed: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
              COUNT(*) FILTER (WHERE status = 'DISPOSED')::int AS disposed
       FROM accounts.fixed_assets`
    ),
    txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_people WHERE status = 'ACTIVE'`
    ),
    txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_contracts WHERE status = 'ACTIVE'`
    ),
    txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_periods WHERE status IN ('OPEN','PROCESSING')`
    ),
    txQuery<{ total: number; draft: number; calculated: number; cancelled: number }>(
      client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
              COUNT(*) FILTER (WHERE status = 'CALCULATED')::int AS calculated,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
       FROM accounts.payroll_runs`
    ),
    txQuery<{
      run_number: string;
      people_count: number;
      error_count: number;
      net_total: string;
      calculated_at: string | null;
    }>(
      client,
      `SELECT run_number, people_count, error_count, net_total::text, calculated_at::text
       FROM accounts.payroll_runs
       WHERE status = 'CALCULATED'
       ORDER BY calculated_at DESC NULLS LAST
       LIMIT 1`
    ),
    getSupplierDashboardSummary(client),
  ]);

  const j = row1(journal.rows);
  const st = row1(students.rows);
  const cv = row1(cashVouchers.rows);
  const bv = row1(bankVouchers.rows);
  const sup = supplierSummary;

  return {
    generated_at: new Date().toISOString(),
    fiscal: row1(fiscal.rows),
    overview: {
      chart_accounts: row1(chartAccounts.rows).n ?? 0,
      cost_centers: row1(costCenters.rows).n ?? 0,
      journal_entries: {
        total: j.total ?? 0,
        drafts: j.drafts ?? 0,
        pending_review: j.pending_review ?? 0,
        approved: j.approved ?? 0,
        posted: j.posted ?? 0,
        reversed: j.reversed ?? 0,
      },
    },
    students: {
      total_accounts: st.total ?? 0,
      active_accounts: st.active ?? 0,
      suspended_accounts: st.suspended ?? 0,
      total_receivable_balance: row1(studentBalance.rows).balance ?? '0',
      posted_collections: row1(collections.rows).n ?? 0,
      collections_total: row1(collections.rows).total ?? '0',
      pending_installments: row1(installments.rows).pending ?? 0,
      overdue_installments: row1(installments.rows).overdue ?? 0,
    },
    cash: {
      boxes: row1(cashBoxes.rows),
      sessions: row1(cashSessions.rows),
      vouchers: {
        total: cv.total ?? 0,
        posted: cv.posted ?? 0,
        receipts_total: cv.receipts_total ?? '0',
        payments_total: cv.payments_total ?? '0',
        net_movement: netMoney(cv.receipts_total ?? '0', cv.payments_total ?? '0'),
      },
      transfers: row1(cashTransfers.rows),
    },
    banks: {
      banks: row1(banks.rows),
      accounts: row1(bankAccounts.rows),
      vouchers: {
        total: bv.total ?? 0,
        posted: bv.posted ?? 0,
        receipts_total: bv.receipts_total ?? '0',
        payments_total: bv.payments_total ?? '0',
        net_movement: netMoney(bv.receipts_total ?? '0', bv.payments_total ?? '0'),
      },
      transfers: row1(bankTransfers.rows),
      statements: row1(bankStatements.rows),
    },
    suppliers: {
      active_suppliers: sup.active_suppliers,
      total_payables: sup.total_payables,
      remaining_payables: sup.remaining_payables,
      draft_invoices: sup.draft_invoices,
      posted_invoices: sup.posted_invoices,
      due_invoices: sup.due_invoices,
      overdue_invoices: sup.overdue_invoices,
    },
    purchasing: {
      purchase_orders: row1(purchaseOrders.rows),
      receipts: row1(purchaseReceipts.rows),
    },
    fixed_assets: row1(fixedAssets.rows),
    payroll: {
      active_people: row1(payrollPeople.rows).n ?? 0,
      active_contracts: row1(payrollContracts.rows).n ?? 0,
      open_periods: row1(payrollPeriods.rows).n ?? 0,
      runs: row1(payrollRuns.rows),
      latest_calculated: latestRun.rows[0]
        ? {
            run_number: latestRun.rows[0].run_number,
            people_count: latestRun.rows[0].people_count,
            error_count: latestRun.rows[0].error_count,
            net_total: latestRun.rows[0].net_total,
            calculated_at: latestRun.rows[0].calculated_at,
          }
        : null,
    },
  };
}
