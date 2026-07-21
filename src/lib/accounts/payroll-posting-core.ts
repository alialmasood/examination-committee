/**
 * نواة ترحيل تشغيل الرواتب إلى الأستاذ العام — 9.C.1
 * APPROVED → POSTED داخل Transaction واحدة · بلا API.
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  chartAccountLock,
  documentSequenceLock,
  journalSourceLock,
  payrollPeriodLock,
  payrollRunLock,
} from './accounting-locks';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import { isSupportedPayrollCurrency } from './payroll-calculation-formulas';
import { assertPayrollRunReadyForPosting } from './payroll-posting-guard';
import {
  buildPostingRequestKeyHash,
  buildPostingRequestPayloadHash,
  maskIdempotencyKey,
  normalizePostingComment,
  normalizePostingIdempotencyKey,
} from './payroll-posting-idempotency';
import { hitPayrollPostingFailpoint } from './payroll-posting-failpoints';
import { assertAccountIdsForLocks } from './payroll-posting-mapping';
import { buildPayrollPostingJournal } from './payroll-posting-journal-builder';
import { loadPayrollPeriod } from './payroll-periods';
import { loadPayrollRun } from './payroll-runs';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { acquirePayrollLocks } from './payroll-locks';
import { verifyPayrollApprovalCore } from './verify-payroll-approval-core';
import { acquireJournalEntriesLock } from './with-transaction';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

function isoAt(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

function dateOnly(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  throw new AccountsHttpError('تاريخ الترحيل غير صالح', 400);
}

export type PostPayrollRunCoreInput = {
  runId: string;
  userId: string;
  version: unknown;
  updated_at: unknown;
  idempotency_key: unknown;
  posting_date: unknown;
  comment?: unknown;
  confirmation?: unknown;
};

export type PostPayrollRunCoreResult = {
  replayed: boolean;
  run: Awaited<ReturnType<typeof loadPayrollRun>>;
  posting: {
    id: string;
    journal_entry_id: string;
    entry_number: string;
    posting_date: string;
    posted_at: string;
    total_debit: string;
    total_credit: string;
  };
};

async function loadActorName(client: TxClient, userId: string): Promise<string> {
  const r = await txQuery<{ name: string | null }>(
    client,
    `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
    [userId]
  );
  return r.rows[0]?.name ? String(r.rows[0].name) : '';
}

async function findPostingByKey(client: TxClient, keyHash: string) {
  const r = await txQuery<{
    id: string;
    payroll_run_id: string;
    journal_entry_id: string;
    request_payload_hash: string;
    posting_date: string;
    posted_at: Date | string;
  }>(
    client,
    `SELECT id::text, payroll_run_id::text, journal_entry_id::text, request_payload_hash,
            posting_date::text, posted_at
     FROM accounts.payroll_run_postings WHERE request_key_hash=$1`,
    [keyHash]
  );
  return r.rows[0] ?? null;
}

export async function postPayrollRunCore(
  client: TxClient,
  input: PostPayrollRunCoreInput
): Promise<PostPayrollRunCoreResult> {
  if (input.confirmation !== true && input.confirmation !== 'true') {
    throw new AccountsHttpError('يجب تأكيد عملية ترحيل الرواتب', 400);
  }

  const runId = String(input.runId).trim();
  const rawKey = normalizePostingIdempotencyKey(input.idempotency_key);
  const keyHash = buildPostingRequestKeyHash(rawKey);
  const keyMasked = maskIdempotencyKey(rawKey);
  const comment = normalizePostingComment(input.comment);
  const postingDate = dateOnly(input.posting_date);
  const expectedVersion = Number(input.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AccountsHttpError('إصدار التشغيل غير صالح', 400);
  }
  const expectedUpdatedAt = isoAt(input.updated_at);

  const payloadHash = buildPostingRequestPayloadHash({
    payroll_run_id: runId,
    version: expectedVersion,
    updated_at: expectedUpdatedAt,
    posting_date: postingDate,
    comment,
    confirmation: true,
  });

  // —— 1–3: أقفال الفترة المالية تُفعَّل بعد معرفة الفترة؛ أولًا Period+Run ——
  // ترتيب: payroll period/run أولًا للقراءة، ثم fiscal FOR UPDATE، ثم حسابات، ثم allocator
  let run = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(run.payroll_period_id),
    payrollRunLock(runId),
    journalSourceLock('PAYROLL_RUN', runId),
  ]);

  // إعادة تحميل بعد القفل
  run = await loadPayrollRun(client, runId, true);
  const periodLocked = await loadPayrollPeriod(client, run.payroll_period_id);

  // Idempotency lookup
  const existing = await findPostingByKey(client, keyHash);
  hitPayrollPostingFailpoint('post_after_idempotency');

  if (existing) {
    if (existing.request_payload_hash !== payloadHash) {
      throw new AccountsHttpError('تم استخدام مفتاح العملية نفسه مع بيانات مختلفة', 409);
    }
    if (String(existing.payroll_run_id) !== runId) {
      throw new AccountsHttpError('تعارض سلامة هوية الترحيل', 409);
    }
    const postedRun = await loadPayrollRun(client, runId);
    if (postedRun.status !== 'POSTED') {
      throw new AccountsHttpError('تعذر التحقق من ترحيل سابق — تعارض سلامة', 409);
    }
    const je = await txQuery<{ entry_number: string; total_debit: string; total_credit: string }>(
      client,
      `SELECT entry_number, total_debit::text, total_credit::text
       FROM accounts.journal_entries WHERE id=$1::uuid`,
      [existing.journal_entry_id]
    );
    if (!je.rows[0]) {
      throw new AccountsHttpError('تعذر التحقق من قيد ترحيل سابق', 409);
    }
    return {
      replayed: true,
      run: postedRun,
      posting: {
        id: existing.id,
        journal_entry_id: existing.journal_entry_id,
        entry_number: je.rows[0].entry_number,
        posting_date: existing.posting_date,
        posted_at:
          existing.posted_at instanceof Date
            ? existing.posted_at.toISOString()
            : String(existing.posted_at),
        total_debit: je.rows[0].total_debit,
        total_credit: je.rows[0].total_credit,
      },
    };
  }

  // Validate APPROVED + concurrency
  if (run.status !== 'APPROVED') {
    throw new AccountsHttpError('لا يمكن ترحيل تشغيل رواتب إلا وهو معتمد (APPROVED)', 409);
  }
  if (Number(run.version) !== expectedVersion) {
    throw new AccountsHttpError('تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.', 409);
  }
  if (isoAt(run.updated_at) !== expectedUpdatedAt) {
    throw new AccountsHttpError('تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.', 409);
  }
  if (!isSupportedPayrollCurrency(run.currency_code)) {
    throw new AccountsHttpError('الإصدار الحالي من ترحيل الرواتب يدعم الدينار العراقي IQD فقط', 422);
  }

  // منع ترحيل مزدوج
  const prior = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`,
    [runId]
  );
  if (Number(prior.rows[0]?.n ?? 0) > 0 || run.posting_journal_entry_id) {
    throw new AccountsHttpError('تم ترحيل هذا التشغيل مسبقًا', 409);
  }

  const blocking = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
     WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
    [runId]
  );
  assertPayrollRunReadyForPosting(
    {
      status: run.status,
      error_count: run.error_count,
      snapshot_hash: run.snapshot_hash,
      approved_snapshot_hash: run.approved_snapshot_hash,
    },
    {
      blocking_issues_count: Number(blocking.rows[0]?.n ?? 0),
      approval_fields_complete: Boolean(
        run.approved_by && run.approved_at && run.review_snapshot_hash
      ),
    }
  );

  if (
    !isPayrollSnapshotHash(run.review_snapshot_hash) ||
    String(run.approved_snapshot_hash) !== String(run.review_snapshot_hash)
  ) {
    throw new AccountsHttpError('بصمة الاعتماد لا تطابق بصمة المراجعة', 409);
  }
  if (Number(run.approval_cycle) < 1) {
    throw new AccountsHttpError('دورة الاعتماد غير صالحة للترحيل', 409);
  }

  // Approval actions
  const acts = await txQuery<{ action: string; n: number }>(
    client,
    `SELECT action, COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
     GROUP BY action`,
    [runId, run.approval_cycle]
  );
  const amap = Object.fromEntries(acts.rows.map((a) => [a.action, Number(a.n)]));
  if (!amap.SUBMITTED_FOR_REVIEW || !amap.APPROVED || amap.REJECTED) {
    throw new AccountsHttpError('سلسلة اعتماد التشغيل غير مكتملة أو فاسدة', 409);
  }

  const verify = await verifyPayrollApprovalCore(client, { strict: true });
  const related = verify.mismatches.filter(
    (m) => !m.entity_id || m.entity_id === runId
  );
  if (related.length > 0 && verify.mismatches.some((m) => m.entity_id === runId)) {
    throw new AccountsHttpError('فشل التحقق من سلامة مسار الاعتماد قبل الترحيل', 409);
  }
  hitPayrollPostingFailpoint('post_after_approval_verify');

  // Fiscal period: صريح من payroll period أو بالبحث بالتاريخ
  let fiscalYearId = periodLocked.fiscal_year_id;
  let fiscalPeriodId = periodLocked.fiscal_period_id;
  if (!fiscalPeriodId) {
    const fp = await txQuery<{ id: string; fiscal_year_id: string }>(
      client,
      `SELECT id::text, fiscal_year_id::text FROM accounts.fiscal_periods
       WHERE fiscal_year_id=$1::uuid
         AND $2::date BETWEEN start_date AND end_date
       LIMIT 1`,
      [fiscalYearId, postingDate]
    );
    if (!fp.rows[0]) {
      throw new AccountsHttpError(
        'تعذر ترحيل الرواتب: لا توجد فترة مالية مفتوحة تغطي تاريخ الترحيل',
        409
      );
    }
    fiscalPeriodId = fp.rows[0].id;
    fiscalYearId = fp.rows[0].fiscal_year_id;
  }

  // قفل الفترة المالية صفّيًا
  await txQuery(
    client,
    `SELECT id FROM accounts.fiscal_periods WHERE id=$1::uuid FOR UPDATE`,
    [fiscalPeriodId]
  );

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: postingDate,
    requireOpenPeriod: true,
    requireActiveYear: true,
  });

  const built = await buildPayrollPostingJournal(client, {
    payrollRunId: runId,
    calendarId: periodLocked.payroll_calendar_id,
    asOf: postingDate,
    runNumber: run.run_number,
    periodName: periodLocked.name_ar || String(periodLocked.period_code ?? ''),
  });
  hitPayrollPostingFailpoint('post_after_mapping');
  hitPayrollPostingFailpoint('post_after_journal_build');

  const accountIds = await assertAccountIdsForLocks(client, built.accountIds);
  await acquirePayrollLocks(
    client,
    accountIds.map((id) => chartAccountLock(id))
  );

  // Document allocator بعد أهلية الترحيل
  await acquireJournalEntriesLock(client);
  await acquirePayrollLocks(client, [
    documentSequenceLock('JOURNAL_ENTRY', fiscalYearId),
  ]);

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    built.lines.map((l) => ({
      account_id: l.account_id,
      cost_center_id: l.cost_center_id,
      debit_amount: l.debit_amount,
      credit_amount: l.credit_amount,
      description: l.description,
    })),
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(client, fiscalYearId);
  hitPayrollPostingFailpoint('post_after_document_sequence');

  const description = `ترحيل رواتب التشغيل ${run.run_number} — ${periodLocked.name_ar || periodLocked.period_code}`;
  const actorName = await loadActorName(client, input.userId);

  const jeIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'SALARY',
       'PAYROLL_RUN', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      fiscalYearId,
      fiscalPeriodId,
      postingDate,
      runId,
      run.run_number,
      description,
      totalDebit,
      totalCredit,
      input.userId,
    ]
  );
  const journalId = jeIns.rows[0].id;
  hitPayrollPostingFailpoint('post_after_journal_header');

  await replaceJournalLines(client, journalId, lines);
  hitPayrollPostingFailpoint('post_after_journal_lines');

  const versionBefore = Number(run.version);
  const versionAfter = versionBefore + 1;
  const postedHash = String(run.approved_snapshot_hash);

  const postIns = await txQuery<{ id: string; posted_at: Date | string }>(
    client,
    `INSERT INTO accounts.payroll_run_postings
      (payroll_run_id, payroll_period_id, approval_cycle, journal_entry_id, posting_date,
       snapshot_hash, approved_snapshot_hash, request_key_hash, request_payload_hash,
       request_key_masked, posted_by, posted_by_display_name_snapshot, posted_at,
       version_before, version_after, gross_total, deduction_total,
       employer_contribution_total, net_total, fiscal_year_id, fiscal_period_id, comment)
     VALUES
      ($1::uuid, $2::uuid, $3, $4::uuid, $5::date,
       $6, $7, $8, $9,
       $10, $11::uuid, $12, NOW(),
       $13, $14, $15::numeric, $16::numeric,
       $17::numeric, $18::numeric, $19::uuid, $20::uuid, $21)
     RETURNING id::text, posted_at`,
    [
      runId,
      run.payroll_period_id,
      run.approval_cycle,
      journalId,
      postingDate,
      postedHash,
      postedHash,
      keyHash,
      payloadHash,
      keyMasked,
      input.userId,
      actorName || null,
      versionBefore,
      versionAfter,
      built.grossTotal,
      built.deductionTotal,
      built.employerTotal,
      built.netTotal,
      fiscalYearId,
      fiscalPeriodId,
      comment || null,
    ]
  );
  hitPayrollPostingFailpoint('post_after_posting_record');

  await txQuery(
    client,
    `UPDATE accounts.payroll_runs SET
       status = 'POSTED',
       posted_at = NOW(),
       posted_by = $2::uuid,
       posting_journal_entry_id = $3::uuid,
       posted_snapshot_hash = $4,
       version = $5,
       updated_by = $2::uuid,
       updated_at = NOW()
     WHERE id = $1::uuid AND version = $6`,
    [runId, input.userId, journalId, postedHash, versionAfter, versionBefore]
  );
  hitPayrollPostingFailpoint('post_after_run_update');

  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.posted',
    entityType: 'payroll_run',
    entityId: runId,
    oldValues: {
      status: 'APPROVED',
      version: versionBefore,
      approved_by: run.approved_by,
    },
    newValues: {
      status: 'POSTED',
      version: versionAfter,
      journal_entry_id: journalId,
      entry_number: entryNumber,
      posting_date: postingDate,
      posted_snapshot_hash_short: postedHash.slice(0, 12),
      request_key_masked: keyMasked,
      gross_total: built.grossTotal,
      net_total: built.netTotal,
      total_debit: totalDebit,
      total_credit: totalCredit,
    },
    description: `ترحيل تشغيل الرواتب ${run.run_number} إلى قيد ${entryNumber}`,
  });
  hitPayrollPostingFailpoint('post_after_success_audit');

  const fresh = await loadPayrollRun(client, runId);
  return {
    replayed: false,
    run: fresh,
    posting: {
      id: postIns.rows[0].id,
      journal_entry_id: journalId,
      entry_number: entryNumber,
      posting_date: postingDate,
      posted_at:
        postIns.rows[0].posted_at instanceof Date
          ? postIns.rows[0].posted_at.toISOString()
          : String(postIns.rows[0].posted_at),
      total_debit: totalDebit,
      total_credit: totalCredit,
    },
  };
}
