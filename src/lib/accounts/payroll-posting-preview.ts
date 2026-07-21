/**
 * معاينة ترحيل الرواتب — read-only · يشارك buildPayrollPostingJournal مع Core.
 * لا يحجز رقم مستند · لا ينشئ قيد · لا يغيّر DB.
 */
import { AccountsHttpError } from './auth';
import { isSupportedPayrollCurrency } from './payroll-calculation-formulas';
import { absoluteMoney, moneyIsZero, moneyToMillisSigned, millisToMoney, sumMoney } from './money';
import { buildPayrollPostingJournal } from './payroll-posting-journal-builder';
import { isPayrollRunReadyForPosting } from './payroll-posting-guard';
import { journalDisplayUrl } from './payroll-posting-http';
import { loadPayrollPeriod } from './payroll-periods';
import type { PayrollRunRow } from './payroll-runs';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollPostingPreviewLineGroup = {
  account_id: string;
  account_code: string;
  account_name: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  debit: string;
  credit: string;
};

export type PayrollPostingPreviewDto = {
  can_post: boolean;
  is_posted: boolean;
  readiness: boolean;
  blockers: string[];
  default_posting_date: string | null;
  gross_total: string | null;
  deduction_total: string | null;
  employer_contribution_total: string | null;
  net_total: string | null;
  debit_total_preview: string | null;
  credit_total_preview: string | null;
  rounding_difference: string | null;
  line_groups: PayrollPostingPreviewLineGroup[];
  posted_at: string | null;
  posted_by: { id: string; display_name: string } | null;
  journal_entry: {
    id: string;
    document_number: string;
    status: string;
    entry_type: string;
    debit_total: string;
    credit_total: string;
    display_url: string;
    entry_date: string | null;
  } | null;
  posted_snapshot_hash_short: string | null;
  posting_date: string | null;
  comment: string | null;
};

function shortHash(h: string | null | undefined): string | null {
  if (!h || !isPayrollSnapshotHash(h)) return null;
  return `${String(h).slice(0, 8)}…${String(h).slice(-6)}`;
}

function dateOnlyFrom(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

/**
 * يبني قسم posting لـ GET run details.
 * canPostCap: هل المستخدم يملك payroll_post.
 */
export async function buildPayrollPostingSection(
  client: TxClient,
  run: PayrollRunRow,
  opts: { canPostCap: boolean }
): Promise<PayrollPostingPreviewDto> {
  const period = await loadPayrollPeriod(client, run.payroll_period_id);
  const defaultPostingDate =
    dateOnlyFrom(period.end_date) ?? dateOnlyFrom(period.start_date);

  const blockers: string[] = [];
  const blockingIssues = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
     WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
    [run.id]
  );
  const blocking_issues_count = Number(blockingIssues.rows[0]?.n ?? 0);

  if (run.status === 'POSTED') {
    return buildPostedSection(client, run, defaultPostingDate);
  }

  if (run.status !== 'APPROVED') {
    blockers.push('STATUS_NOT_APPROVED');
  }
  if (!isSupportedPayrollCurrency(run.currency_code)) {
    blockers.push('UNSUPPORTED_CURRENCY');
  }
  if (Number(run.error_count) > 0) blockers.push('HAS_ERRORS');
  if (blocking_issues_count > 0) blockers.push('HAS_BLOCKING_ISSUES');
  if (!isPayrollSnapshotHash(run.snapshot_hash)) blockers.push('MISSING_SNAPSHOT_HASH');
  if (!isPayrollSnapshotHash(run.approved_snapshot_hash)) {
    blockers.push('MISSING_APPROVED_HASH');
  }
  if (
    isPayrollSnapshotHash(run.approved_snapshot_hash) &&
    isPayrollSnapshotHash(run.snapshot_hash) &&
    String(run.approved_snapshot_hash) !== String(run.snapshot_hash)
  ) {
    blockers.push('SNAPSHOT_DRIFT');
  }
  if (!run.approved_by || !run.approved_at) blockers.push('APPROVAL_FIELDS_INCOMPLETE');
  if (Number(run.approval_cycle ?? 0) < 1) blockers.push('INVALID_APPROVAL_CYCLE');
  if (!defaultPostingDate) blockers.push('MISSING_DEFAULT_POSTING_DATE');

  const baseReady = isPayrollRunReadyForPosting(
    {
      status: run.status,
      error_count: run.error_count,
      snapshot_hash: run.snapshot_hash,
      approved_snapshot_hash: run.approved_snapshot_hash,
    },
    {
      blocking_issues_count,
      approval_fields_complete: Boolean(run.approved_by && run.approved_at),
    }
  );

  let line_groups: PayrollPostingPreviewLineGroup[] = [];
  let gross_total: string | null = run.gross_total != null ? String(run.gross_total) : null;
  let deduction_total: string | null =
    run.deduction_total != null ? String(run.deduction_total) : null;
  let employer_contribution_total: string | null =
    run.employer_contribution_total != null
      ? String(run.employer_contribution_total)
      : null;
  let net_total: string | null = run.net_total != null ? String(run.net_total) : null;
  let debit_total_preview: string | null = null;
  let credit_total_preview: string | null = null;
  let rounding_difference: string | null = null;

  if (run.status === 'APPROVED' && baseReady && defaultPostingDate) {
    try {
      const built = await buildPayrollPostingJournal(client, {
        payrollRunId: run.id,
        calendarId: period.payroll_calendar_id,
        asOf: defaultPostingDate,
        runNumber: run.run_number,
        periodName: period.name_ar || String(period.period_code ?? ''),
      });
      gross_total = built.grossTotal;
      deduction_total = built.deductionTotal;
      employer_contribution_total = built.employerTotal;
      net_total = built.netTotal;
      debit_total_preview = built.totalDebit;
      credit_total_preview = built.totalCredit;
      const roundingLines = built.lines.filter((l) =>
        String(l.description).includes('فرق تقريب')
      );
      if (roundingLines.length) {
        rounding_difference = sumMoney(
          roundingLines.map((l) =>
            moneyIsZero(l.debit_amount) ? l.credit_amount : l.debit_amount
          )
        );
      } else {
        const diffMillis =
          moneyToMillisSigned(built.totalDebit) - moneyToMillisSigned(built.totalCredit);
        rounding_difference = absoluteMoney(millisToMoney(diffMillis));
      }

      const accountIds = [...new Set(built.lines.map((l) => l.account_id))];
      const ccIds = [
        ...new Set(
          built.lines.map((l) => l.cost_center_id).filter((x): x is string => Boolean(x))
        ),
      ];

      const accMap = new Map<string, { code: string; name: string }>();
      if (accountIds.length) {
        const acc = await txQuery<{ id: string; code: string; name_ar: string }>(
          client,
          `SELECT id::text, code, name_ar FROM accounts.chart_of_accounts WHERE id=ANY($1::uuid[])`,
          [accountIds]
        );
        for (const a of acc.rows) {
          accMap.set(a.id, { code: a.code, name: a.name_ar });
        }
      }
      const ccMap = new Map<string, string>();
      if (ccIds.length) {
        const cc = await txQuery<{ id: string; name_ar: string }>(
          client,
          `SELECT id::text, name_ar FROM accounts.cost_centers WHERE id=ANY($1::uuid[])`,
          [ccIds]
        );
        for (const c of cc.rows) ccMap.set(c.id, c.name_ar);
      }

      line_groups = built.lines.map((l) => {
        const a = accMap.get(l.account_id);
        return {
          account_id: l.account_id,
          account_code: a?.code ?? '',
          account_name: a?.name ?? '',
          cost_center_id: l.cost_center_id,
          cost_center_name: l.cost_center_id
            ? (ccMap.get(l.cost_center_id) ?? null)
            : null,
          debit: l.debit_amount,
          credit: l.credit_amount,
        };
      });
    } catch (error) {
      if (error instanceof AccountsHttpError) {
        const m = error.message || '';
        if (m.includes('ربط') || m.includes('مصروف') || m.includes('التزام') || m.includes('payable')) {
          blockers.push('GL_MAPPING_MISSING');
        } else if (m.includes('تقريب') && m.includes('يتجاوز')) {
          blockers.push('ROUNDING_EXCEEDED');
        } else if (m.includes('ROUNDING') || m.includes('تقريب')) {
          blockers.push('ROUNDING_ACCOUNT_MISSING');
        } else if (m.includes('متوازن')) {
          blockers.push('JOURNAL_UNBALANCED');
        } else if (m.includes('حساب')) {
          blockers.push('GL_ACCOUNT_INVALID');
        } else {
          blockers.push('PREVIEW_BUILD_FAILED');
        }
      } else {
        blockers.push('PREVIEW_BUILD_FAILED');
      }
    }
  } else if (run.status === 'APPROVED' && !baseReady) {
    // blockers already populated
  }

  const readiness = blockers.length === 0 && run.status === 'APPROVED';
  const can_post = opts.canPostCap && readiness;

  return {
    can_post,
    is_posted: false,
    readiness,
    blockers,
    default_posting_date: defaultPostingDate,
    gross_total,
    deduction_total,
    employer_contribution_total,
    net_total,
    debit_total_preview,
    credit_total_preview,
    rounding_difference,
    line_groups,
    posted_at: null,
    posted_by: null,
    journal_entry: null,
    posted_snapshot_hash_short: null,
    posting_date: null,
    comment: null,
  };
}

async function buildPostedSection(
  client: TxClient,
  run: PayrollRunRow,
  defaultPostingDate: string | null
): Promise<PayrollPostingPreviewDto> {
  let posted_by: { id: string; display_name: string } | null = null;
  if (run.posted_by) {
    const u = await txQuery<{ name: string | null }>(
      client,
      `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
      [run.posted_by]
    );
    posted_by = {
      id: String(run.posted_by),
      display_name: u.rows[0]?.name ? String(u.rows[0].name) : '',
    };
  }

  let journal_entry: PayrollPostingPreviewDto['journal_entry'] = null;
  let posting_date: string | null = null;
  let comment: string | null = null;
  let debit = run.gross_total != null ? String(run.gross_total) : null;
  let credit = debit;

  if (run.posting_journal_entry_id) {
    const je = await txQuery<{
      id: string;
      entry_number: string;
      status: string;
      entry_type: string;
      total_debit: string;
      total_credit: string;
      entry_date: string;
    }>(
      client,
      `SELECT id::text, entry_number, status, entry_type,
              total_debit::text, total_credit::text, entry_date::text
       FROM accounts.journal_entries WHERE id=$1::uuid`,
      [run.posting_journal_entry_id]
    );
    if (je.rows[0]) {
      const j = je.rows[0];
      debit = j.total_debit;
      credit = j.total_credit;
      posting_date = dateOnlyFrom(j.entry_date);
      journal_entry = {
        id: j.id,
        document_number: j.entry_number,
        status: j.status,
        entry_type: j.entry_type,
        debit_total: j.total_debit,
        credit_total: j.total_credit,
        display_url: journalDisplayUrl(j.id),
        entry_date: dateOnlyFrom(j.entry_date),
      };
    }
  }

  const pr = await txQuery<{ posting_date: string; comment: string | null }>(
    client,
    `SELECT posting_date::text, comment FROM accounts.payroll_run_postings
     WHERE payroll_run_id=$1::uuid LIMIT 1`,
    [run.id]
  );
  if (pr.rows[0]) {
    posting_date = dateOnlyFrom(pr.rows[0].posting_date) ?? posting_date;
    comment = pr.rows[0].comment ?? null;
  }

  return {
    can_post: false,
    is_posted: true,
    readiness: false,
    blockers: ['ALREADY_POSTED'],
    default_posting_date: defaultPostingDate,
    gross_total: run.gross_total != null ? String(run.gross_total) : null,
    deduction_total: run.deduction_total != null ? String(run.deduction_total) : null,
    employer_contribution_total:
      run.employer_contribution_total != null
        ? String(run.employer_contribution_total)
        : null,
    net_total: run.net_total != null ? String(run.net_total) : null,
    debit_total_preview: debit,
    credit_total_preview: credit,
    rounding_difference: null,
    line_groups: [],
    posted_at: iso(run.posted_at),
    posted_by,
    journal_entry,
    posted_snapshot_hash_short: shortHash(run.posted_snapshot_hash),
    posting_date,
    comment,
  };
}
