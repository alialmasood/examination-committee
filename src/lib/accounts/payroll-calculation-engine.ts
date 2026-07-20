/**
 * نواة احتساب تشغيل الرواتب 9.A.2.3.1
 *
 * DRAFT → CALCULATING → CALCULATED داخل معاملة واحدة.
 * بلا API عام · بلا Recalculate · بلا UI.
 */
import { createHash } from 'crypto';
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import { payrollPeriodLock, payrollRunLock } from './accounting-locks';
import {
  calculateFixedAmount,
  calculatePercentageOfBasic,
} from './payroll-calculation-formulas';
import {
  buildCalcIssue,
  PAYROLL_CALC_ISSUE,
  type PayrollCalcIssueDraft,
} from './payroll-calculation-issues';
import { resolveActiveContract } from './payroll-contract-resolver';
import { resolveComponentSources } from './payroll-component-resolver';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPeriod } from './payroll-periods';
import {
  clearRunCalculationArtifacts,
  insertRunIssue,
  insertRunLine,
  insertRunPersonSnapshot,
  loadRunCalculationArtifacts,
} from './payroll-run-snapshots';
import {
  loadPayrollRun,
  serializePayrollRun,
  type PayrollRunRow,
} from './payroll-runs';
import {
  buildPersonSnapshotJson,
  buildRunSnapshotHash,
} from './payroll-snapshot-builder';
import {
  countPayrollRunScopeMembers,
  resolvePayrollRunPersons,
} from './payroll-scope-resolver';
import {
  assertPayrollConcurrency,
  dateStr,
  requirePayrollUuid,
} from './payroll-validation';
import {
  millisToMoney,
  moneyToMillisSigned,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SUPPORTED_METHODS = new Set(['FIXED_AMOUNT', 'PERCENTAGE_OF_BASIC']);

function millisToSignedMoney(millis: bigint): string {
  if (millis < BigInt(0)) {
    const abs = millisToMoney(-millis);
    return abs === '0.000' ? '0.000' : `-${abs}`;
  }
  return millisToMoney(millis);
}

/** أسطر اللقطة تخزّن percentage عبر مسار المال (حتى 3 منازل). */
function percentageForLine(value: string): string {
  const raw = String(value).trim().replace(/,/g, '');
  const m = raw.match(/^(?:0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!m) throw new AccountsHttpError('النسبة غير صالحة', 400);
  const [intPart, frac = ''] = raw.split('.');
  return `${intPart}.${(frac + '000').slice(0, 3)}`;
}

export type CalculatePayrollRunResult = {
  run: ReturnType<typeof serializePayrollRun>;
  summary: {
    people_count: number;
    calculated_people: number;
    error_people: number;
    excluded_people: number;
    warning_count: number;
    error_count: number;
    gross_total: string;
    deduction_total: string;
    employer_contribution_total: string;
    net_total: string;
  };
  issues: { blocking: number; warnings: number };
  idempotent_replay: boolean;
};

/** يحوّل مفتاح التكرار إلى UUID يُخزَّن في calculation_request_id. */
export function mapIdempotencyKeyToRequestId(key: unknown): string {
  const raw = String(key ?? '').trim();
  if (!raw) throw new AccountsHttpError('مفتاح التكرار (idempotency_key) مطلوب', 400);
  if (raw.length > 128) {
    throw new AccountsHttpError('مفتاح التكرار طويل جداً', 400);
  }
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const digest = createHash('sha256').update(`payroll-calc:${raw}`, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadActiveAssignments(
  client: TxClient,
  personId: string,
  calcDate: string
) {
  const r = await txQuery<{
    id: string;
    assignment_code: string;
    assignment_type: string;
    effective_from: string;
    effective_to: string | null;
    department_id: string | null;
  }>(
    client,
    `SELECT id, assignment_code, assignment_type,
            effective_from::text, effective_to::text, department_id
     FROM accounts.payroll_assignments
     WHERE payroll_person_id = $1::uuid
       AND status = 'ACTIVE'
       AND effective_from <= $2::date
       AND (effective_to IS NULL OR effective_to >= $2::date)
     ORDER BY assignment_code ASC, id ASC`,
    [personId, calcDate]
  );
  return r.rows.map((a) => ({
    id: a.id,
    assignment_code: a.assignment_code,
    assignment_type: a.assignment_type,
    effective_from: String(a.effective_from).slice(0, 10),
    effective_to: a.effective_to == null ? null : String(a.effective_to).slice(0, 10),
    department_id: a.department_id,
  }));
}

async function resolveCollegeIdForDepartment(
  client: TxClient,
  departmentId: string | null
): Promise<string | null> {
  if (!departmentId) return null;
  const r = await txQuery<{ college_id: string | null }>(
    client,
    `SELECT college_id FROM student_affairs.departments WHERE id=$1::uuid`,
    [departmentId]
  );
  return r.rows[0]?.college_id ?? null;
}

type LineDraft = {
  payroll_component_id: string;
  payroll_assignment_id: string | null;
  payroll_component_assignment_id: string;
  component_code_snapshot: string;
  component_name_snapshot: string;
  component_type: string;
  calculation_method: string;
  calculation_base_type: string;
  percentage: string | null;
  base_amount: string | null;
  calculated_amount: string;
  source_effective_from: string;
  source_effective_to: string | null;
  sequence: number;
};

function computePersonLines(
  sources: Awaited<ReturnType<typeof resolveComponentSources>>,
  contractBase: string,
  currencyCode: string,
  calcDate: string
): { lines: LineDraft[]; blocking: PayrollCalcIssueDraft[]; warnings: PayrollCalcIssueDraft[] } {
  const blocking: PayrollCalcIssueDraft[] = [];
  const warnings: PayrollCalcIssueDraft[] = [];
  const lines: LineDraft[] = [];
  const seen = new Set<string>();

  let seq = 0;
  for (const src of sources) {
    const identity = `${src.payroll_component_id}|${src.payroll_assignment_id ?? '0'}|${src.pca_id}`;
    if (seen.has(identity)) {
      blocking.push(
        buildCalcIssue(PAYROLL_CALC_ISSUE.DUPLICATE_COMPONENT_SOURCE, {
          entity_type: 'LINE',
          entity_id: src.pca_id,
        })
      );
      continue;
    }
    seen.add(identity);

    const componentEffective =
      src.component_is_active &&
      src.component_effective_from <= calcDate &&
      (src.component_effective_to == null || src.component_effective_to >= calcDate);
    if (!componentEffective) {
      blocking.push(
        buildCalcIssue(PAYROLL_CALC_ISSUE.INACTIVE_COMPONENT, {
          entity_type: 'COMPONENT',
          entity_id: src.payroll_component_id,
        })
      );
      continue;
    }

    if (!SUPPORTED_METHODS.has(src.method)) {
      blocking.push(
        buildCalcIssue(PAYROLL_CALC_ISSUE.UNSUPPORTED_METHOD, {
          entity_type: 'COMPONENT',
          entity_id: src.payroll_component_id,
          details_json: { method: src.method },
        })
      );
      continue;
    }

    try {
      let calculated: string;
      let baseAmount: string | null = null;
      let percentage: string | null = null;

      if (src.method === 'FIXED_AMOUNT') {
        if (src.base_type !== 'NONE') {
          blocking.push(
            buildCalcIssue(PAYROLL_CALC_ISSUE.UNSUPPORTED_BASE, {
              entity_type: 'COMPONENT',
              entity_id: src.payroll_component_id,
              details_json: { method: src.method, base_type: src.base_type },
            })
          );
          continue;
        }
        const amount = src.amount ?? src.default_amount;
        if (amount == null || String(amount).trim() === '') {
          blocking.push(
            buildCalcIssue(PAYROLL_CALC_ISSUE.INVALID_AMOUNT, {
              entity_type: 'PCA',
              entity_id: src.pca_id,
            })
          );
          continue;
        }
        const r = calculateFixedAmount(amount, currencyCode);
        calculated = r.calculated;
      } else {
        // PERCENTAGE_OF_BASIC
        if (src.base_type !== 'CONTRACT_BASIC') {
          blocking.push(
            buildCalcIssue(PAYROLL_CALC_ISSUE.UNSUPPORTED_BASE, {
              entity_type: 'COMPONENT',
              entity_id: src.payroll_component_id,
              details_json: { method: src.method, base_type: src.base_type },
            })
          );
          continue;
        }
        if (src.percentage == null || String(src.percentage).trim() === '') {
          blocking.push(
            buildCalcIssue(PAYROLL_CALC_ISSUE.INVALID_PERCENTAGE, {
              entity_type: 'PCA',
              entity_id: src.pca_id,
            })
          );
          continue;
        }
        const r = calculatePercentageOfBasic(contractBase, src.percentage, currencyCode);
        calculated = r.calculated;
        baseAmount = r.baseAmount;
        percentage = percentageForLine(String(src.percentage));
      }

      seq += 1;
      lines.push({
        payroll_component_id: src.payroll_component_id,
        payroll_assignment_id: src.payroll_assignment_id,
        payroll_component_assignment_id: src.pca_id,
        component_code_snapshot: src.component_code,
        component_name_snapshot: src.component_name_ar,
        component_type: src.component_type,
        calculation_method: src.method,
        calculation_base_type: src.base_type,
        percentage,
        base_amount: baseAmount,
        calculated_amount: calculated,
        source_effective_from: src.effective_from,
        source_effective_to: src.effective_to,
        sequence: seq,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'CALC_ERROR';
      if (msg === 'INVALID_PERCENTAGE') {
        blocking.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.INVALID_PERCENTAGE, {
            entity_type: 'PCA',
            entity_id: src.pca_id,
          })
        );
      } else if (msg === 'INVALID_MONEY') {
        blocking.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.INVALID_AMOUNT, {
            entity_type: 'PCA',
            entity_id: src.pca_id,
          })
        );
      } else {
        blocking.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.UNSUPPORTED_METHOD, {
            entity_type: 'PCA',
            entity_id: src.pca_id,
            details_json: { error: msg.slice(0, 80) },
          })
        );
      }
    }
  }

  return { lines, blocking, warnings };
}

function summarizeLines(lines: LineDraft[]): {
  gross: string;
  deductions: string;
  employer: string;
  net: string;
} {
  const earnings = lines
    .filter((l) => l.component_type === 'EARNING')
    .map((l) => l.calculated_amount);
  const deductionAmounts = lines
    .filter((l) => l.component_type === 'DEDUCTION')
    .map((l) => l.calculated_amount);
  const employer = lines
    .filter((l) => l.component_type === 'EMPLOYER_CONTRIBUTION')
    .map((l) => l.calculated_amount);
  const gross = sumMoney(earnings);
  const ded = sumMoney(deductionAmounts);
  const emp = sumMoney(employer);
  const net = millisToSignedMoney(
    moneyToMillisSigned(gross) - moneyToMillisSigned(ded)
  );
  return { gross, deductions: ded, employer: emp, net };
}

async function persistIssues(
  client: TxClient,
  runId: string,
  runPersonId: string | null,
  issues: PayrollCalcIssueDraft[],
  userId: string
): Promise<void> {
  for (const issue of issues) {
    await insertRunIssue(client, {
      payroll_run_id: runId,
      payroll_run_person_id: runPersonId,
      severity: issue.severity,
      issue_code: issue.issue_code,
      message_ar: issue.message_ar,
      message_en: issue.message_en,
      entity_type: issue.entity_type,
      entity_id: issue.entity_id,
      details_json: issue.details_json,
      created_by: userId,
    });
  }
}

async function buildSummary(
  client: TxClient,
  run: PayrollRunRow
): Promise<CalculatePayrollRunResult> {
  const artifacts = await loadRunCalculationArtifacts(client, run.id);
  let calculated = 0;
  let errorPeople = 0;
  let excluded = 0;
  for (const p of artifacts.people as Array<{ calculation_status: string }>) {
    if (p.calculation_status === 'CALCULATED') calculated += 1;
    else if (p.calculation_status === 'ERROR') errorPeople += 1;
    else if (p.calculation_status === 'EXCLUDED') excluded += 1;
  }
  let blocking = 0;
  let warnings = 0;
  for (const i of artifacts.issues as Array<{ severity: string }>) {
    if (i.severity === 'ERROR') blocking += 1;
    else warnings += 1;
  }
  return {
    run: serializePayrollRun(run),
    summary: {
      people_count: Number(run.people_count),
      calculated_people: calculated,
      error_people: errorPeople,
      excluded_people: excluded,
      warning_count: Number(run.warning_count),
      error_count: Number(run.error_count),
      gross_total: String(run.gross_total),
      deduction_total: String(run.deduction_total),
      employer_contribution_total: String(run.employer_contribution_total),
      net_total: String(run.net_total),
    },
    issues: { blocking, warnings },
    idempotent_replay: false,
  };
}

export async function calculatePayrollRunCore(
  client: TxClient,
  input: {
    run_id: string;
    version: unknown;
    updated_at: unknown;
    userId: string;
    idempotency_key: unknown;
  }
): Promise<CalculatePayrollRunResult> {
  const runId = requirePayrollUuid(input.run_id, 'معرّف التشغيل');
  const requestId = mapIdempotencyKeyToRequestId(input.idempotency_key);

  // 1) أقفال Period + Run ثم FOR UPDATE
  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(existing.payroll_period_id),
    payrollRunLock(runId),
  ]);
  const run = await loadPayrollRun(client, runId, true);
  const period = await loadPayrollPeriod(client, run.payroll_period_id, true);

  // 2) تزامن
  assertPayrollConcurrency(run, input.version, input.updated_at, 'تشغيل الرواتب');

  // 3) replay إن CALCULATED ونفس request id
  if (run.status === 'CALCULATED') {
    if (
      run.last_calculation_request_id &&
      String(run.last_calculation_request_id).toLowerCase() === requestId
    ) {
      const replay = await buildSummary(client, run);
      replay.idempotent_replay = true;
      return replay;
    }
    throw new AccountsHttpError(
      'التشغيل محتسب مسبقاً — استخدم Recalculate لاحقاً بمفتاح جديد',
      409
    );
  }

  if (run.status === 'CALCULATING') {
    throw new AccountsHttpError('التشغيل قيد الاحتساب حالياً', 409);
  }

  // 4) DRAFT فقط
  if (run.status !== 'DRAFT') {
    throw new AccountsHttpError(
      `لا يمكن احتساب تشغيل في حالة ${run.status}`,
      409
    );
  }

  // 5) فترة OPEN/PROCESSING + تواريخ
  if (period.status !== 'OPEN' && period.status !== 'PROCESSING') {
    throw new AccountsHttpError(
      `لا يمكن الاحتساب وفترة الرواتب في حالة ${period.status}`,
      409
    );
  }
  const calcDate = dateStr(run.calculation_date);
  if (!calcDate) throw new AccountsHttpError('تاريخ الاحتساب غير صالح', 400);
  const periodStart = dateStr(period.start_date)!;
  const periodEnd = dateStr(period.end_date)!;
  if (calcDate < periodStart || calcDate > periodEnd) {
    throw new AccountsHttpError('تاريخ الاحتساب خارج نطاق الفترة', 400);
  }
  if (run.currency_code !== period.currency_code) {
    throw new AccountsHttpError('عملة التشغيل تخالف عملة الفترة', 400);
  }

  // 6) PERSON_LIST فارغة → 422 قبل أي mutation / audit started
  if (run.scope_type === 'PERSON_LIST') {
    const n = await countPayrollRunScopeMembers(client, run.id);
    if (n === 0) {
      throw new AccountsHttpError(
        'قائمة أشخاص التشغيل فارغة — أضف أعضاءً قبل الاحتساب',
        422
      );
    }
  }

  try {
    // 7) مسح آثار سابقة
    await clearRunCalculationArtifacts(client, run.id);

    // 8) CALCULATING + attempt++ + request id
    const started = await txQuery<PayrollRunRow>(
      client,
      `UPDATE accounts.payroll_runs SET
         status = 'CALCULATING',
         calculation_request_id = $2::uuid,
         calculation_attempt_number = calculation_attempt_number + 1,
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [run.id, requestId, input.userId]
    );
    const calculatingRun = started.rows[0];

    await writeFinancialAudit(client, {
      userId: input.userId,
      action: 'payroll_run.calculation_started',
      entityType: 'payroll_run',
      entityId: run.id,
      newValues: {
        attempt: calculatingRun.calculation_attempt_number,
        calculation_request_id: requestId,
        scope_type: run.scope_type,
      },
      description: `بدء احتساب تشغيل الرواتب ${run.run_number}`,
    });

    // 9) حل الأشخاص
    const persons = await resolvePayrollRunPersons(client, {
      scope_type: run.scope_type,
      scope_ref_id: run.scope_ref_id,
      calculation_date: calcDate,
      run_id: run.id,
    });

    const personHashes: string[] = [];
    let peopleCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    const grossParts: string[] = [];
    const dedParts: string[] = [];
    const empParts: string[] = [];
    const netParts: string[] = [];

    const runIssues: PayrollCalcIssueDraft[] = [];
    if (persons.length === 0 && run.scope_type !== 'PERSON_LIST') {
      runIssues.push(
        buildCalcIssue(PAYROLL_CALC_ISSUE.RUN_EMPTY_SCOPE, {
          entity_type: 'RUN',
          entity_id: run.id,
        })
      );
      warningCount += 1;
    }

    // 10–12) لكل شخص
    for (const person of persons) {
      peopleCount += 1;

      if (person.scope_ineligible) {
        const { snapshot, snapshot_hash } = buildPersonSnapshotJson({
          person,
          contract: null,
          assignments: [],
          component_assignment_ids: [],
          calculation_date: calcDate,
          currency_code: run.currency_code,
          scope_type: run.scope_type,
          scope_ref_id: run.scope_ref_id,
          resolved_via: 'PERSON_LIST',
        });
        const rp = await insertRunPersonSnapshot(client, {
          payroll_run_id: run.id,
          payroll_person_id: person.id,
          person_code_snapshot: person.person_code,
          full_name_snapshot: person.full_name_ar,
          person_type_snapshot: person.person_type,
          college_id_snapshot: null,
          department_id_snapshot: person.department_id,
          cost_center_id_snapshot: person.default_cost_center_id,
          currency_code: run.currency_code,
          basic_amount: '0',
          gross_amount: '0',
          deductions_amount: '0',
          employer_contributions_amount: '0',
          net_amount: '0',
          calculation_status: 'EXCLUDED',
          warning_count: 1,
          error_count: 0,
          snapshot_json: snapshot,
          snapshot_hash,
          created_by: input.userId,
        });
        await persistIssues(
          client,
          run.id,
          rp.id,
          [
            buildCalcIssue(PAYROLL_CALC_ISSUE.SCOPE_PERSON_INELIGIBLE, {
              entity_type: 'PERSON',
              entity_id: person.id,
            }),
          ],
          input.userId
        );
        warningCount += 1;
        personHashes.push(snapshot_hash);
        continue;
      }

      const contractRes = await resolveActiveContract(
        client,
        person.id,
        calcDate,
        run.currency_code
      );

      if (!contractRes.ok) {
        const { snapshot, snapshot_hash } = buildPersonSnapshotJson({
          person,
          contract: null,
          assignments: [],
          component_assignment_ids: [],
          calculation_date: calcDate,
          currency_code: run.currency_code,
          scope_type: run.scope_type,
          scope_ref_id: run.scope_ref_id,
          resolved_via: run.scope_type,
        });
        const rp = await insertRunPersonSnapshot(client, {
          payroll_run_id: run.id,
          payroll_person_id: person.id,
          person_code_snapshot: person.person_code,
          full_name_snapshot: person.full_name_ar,
          person_type_snapshot: person.person_type,
          department_id_snapshot: person.department_id,
          cost_center_id_snapshot: person.default_cost_center_id,
          currency_code: run.currency_code,
          basic_amount: '0',
          gross_amount: '0',
          deductions_amount: '0',
          employer_contributions_amount: '0',
          net_amount: '0',
          calculation_status: 'ERROR',
          warning_count: 0,
          error_count: 1,
          snapshot_json: snapshot,
          snapshot_hash,
          created_by: input.userId,
        });
        await persistIssues(client, run.id, rp.id, [contractRes.issue], input.userId);
        errorCount += 1;
        personHashes.push(snapshot_hash);
        continue;
      }

      const contract = contractRes.contract;
      const assignments = await loadActiveAssignments(client, person.id, calcDate);
      const collegeId = await resolveCollegeIdForDepartment(
        client,
        assignments.find((a) => a.department_id)?.department_id ?? person.department_id
      );

      const sources = await resolveComponentSources(client, {
        personId: person.id,
        contractId: contract.id,
        calculationDate: calcDate,
      });

      const { lines, blocking, warnings } = computePersonLines(
        sources,
        contract.base_amount,
        run.currency_code,
        calcDate
      );

      const personWarnings: PayrollCalcIssueDraft[] = [...warnings];
      if (
        person.default_currency_code.toUpperCase() !== run.currency_code.toUpperCase()
      ) {
        personWarnings.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.PERSON_CURRENCY_DIFFERS, {
            entity_type: 'PERSON',
            entity_id: person.id,
          })
        );
      }

      if (blocking.length > 0) {
        const { snapshot, snapshot_hash } = buildPersonSnapshotJson({
          person,
          contract,
          assignments,
          component_assignment_ids: sources.map((s) => s.pca_id),
          calculation_date: calcDate,
          currency_code: run.currency_code,
          scope_type: run.scope_type,
          scope_ref_id: run.scope_ref_id,
          resolved_via: run.scope_type,
          college_id: collegeId,
        });
        const rp = await insertRunPersonSnapshot(client, {
          payroll_run_id: run.id,
          payroll_person_id: person.id,
          payroll_contract_id: contract.id,
          person_code_snapshot: person.person_code,
          full_name_snapshot: person.full_name_ar,
          person_type_snapshot: person.person_type,
          college_id_snapshot: collegeId,
          department_id_snapshot: person.department_id,
          cost_center_id_snapshot: person.default_cost_center_id,
          currency_code: run.currency_code,
          basic_amount: normalizeMoneyInput(contract.base_amount),
          gross_amount: '0',
          deductions_amount: '0',
          employer_contributions_amount: '0',
          net_amount: '0',
          calculation_status: 'ERROR',
          warning_count: personWarnings.length,
          error_count: blocking.length,
          snapshot_json: snapshot,
          snapshot_hash,
          created_by: input.userId,
        });
        await persistIssues(
          client,
          run.id,
          rp.id,
          [...blocking, ...personWarnings],
          input.userId
        );
        errorCount += 1;
        warningCount += personWarnings.length;
        personHashes.push(snapshot_hash);
        continue;
      }

      // شخص ناجح
      const totals = summarizeLines(lines);
      if (lines.filter((l) => l.component_type === 'EARNING').length === 0) {
        personWarnings.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.NO_EARNINGS, {
            entity_type: 'PERSON',
            entity_id: person.id,
          })
        );
      }
      if (moneyToMillisSigned(totals.net) < BigInt(0)) {
        personWarnings.push(
          buildCalcIssue(PAYROLL_CALC_ISSUE.NEGATIVE_NET, {
            entity_type: 'PERSON',
            entity_id: person.id,
          })
        );
      }

      const { snapshot, snapshot_hash } = buildPersonSnapshotJson({
        person,
        contract,
        assignments,
        component_assignment_ids: sources.map((s) => s.pca_id),
        calculation_date: calcDate,
        currency_code: run.currency_code,
        scope_type: run.scope_type,
        scope_ref_id: run.scope_ref_id,
        resolved_via: run.scope_type,
        college_id: collegeId,
      });

      const rp = await insertRunPersonSnapshot(client, {
        payroll_run_id: run.id,
        payroll_person_id: person.id,
        payroll_contract_id: contract.id,
        person_code_snapshot: person.person_code,
        full_name_snapshot: person.full_name_ar,
        person_type_snapshot: person.person_type,
        college_id_snapshot: collegeId,
        department_id_snapshot: person.department_id,
        cost_center_id_snapshot: person.default_cost_center_id,
        currency_code: run.currency_code,
        basic_amount: normalizeMoneyInput(contract.base_amount),
        gross_amount: totals.gross,
        deductions_amount: totals.deductions,
        employer_contributions_amount: totals.employer,
        net_amount: totals.net,
        calculation_status: 'CALCULATED',
        warning_count: personWarnings.length,
        error_count: 0,
        snapshot_json: snapshot,
        snapshot_hash,
        created_by: input.userId,
      });

      for (const line of lines) {
        await insertRunLine(client, {
          payroll_run_id: run.id,
          payroll_run_person_id: rp.id,
          payroll_component_id: line.payroll_component_id,
          payroll_assignment_id: line.payroll_assignment_id,
          payroll_component_assignment_id: line.payroll_component_assignment_id,
          component_code_snapshot: line.component_code_snapshot,
          component_name_snapshot: line.component_name_snapshot,
          component_type: line.component_type,
          calculation_method: line.calculation_method,
          calculation_base_type: line.calculation_base_type,
          percentage: line.percentage,
          base_amount: line.base_amount,
          calculated_amount: line.calculated_amount,
          source_effective_from: line.source_effective_from,
          source_effective_to: line.source_effective_to,
          line_source: 'GENERATED',
          sequence: line.sequence,
          created_by: input.userId,
        });
      }
      await persistIssues(client, run.id, rp.id, personWarnings, input.userId);

      warningCount += personWarnings.length;
      grossParts.push(totals.gross);
      dedParts.push(totals.deductions);
      empParts.push(totals.employer);
      netParts.push(totals.net);
      personHashes.push(snapshot_hash);
    }

    await persistIssues(client, run.id, null, runIssues, input.userId);

    // 13) إجماليات التشغيل
    const grossTotal = sumMoney(grossParts);
    const deductionTotal = sumMoney(dedParts);
    const employerTotal = sumMoney(empParts);
    const netTotal = millisToSignedMoney(
      netParts.reduce((acc, v) => acc + moneyToMillisSigned(v), BigInt(0))
    );

    let snapshotHash: string;
    try {
      snapshotHash = buildRunSnapshotHash({
        person_snapshot_hashes: personHashes,
        people_count: peopleCount,
        gross_total: grossTotal,
        deduction_total: deductionTotal,
        employer_contribution_total: employerTotal,
        net_total: netTotal,
        warning_count: warningCount,
        error_count: errorCount,
      });
    } catch {
      throw new AccountsHttpError('فشل توليد بصمة لقطة التشغيل', 500);
    }

    // 14) CALCULATED
    const final = await txQuery<PayrollRunRow>(
      client,
      `UPDATE accounts.payroll_runs SET
         status = 'CALCULATED',
         people_count = $2,
         gross_total = $3::numeric,
         deduction_total = $4::numeric,
         employer_contribution_total = $5::numeric,
         net_total = $6::numeric,
         warning_count = $7,
         error_count = $8,
         snapshot_hash = $9,
         last_calculation_request_id = calculation_request_id,
         calculated_at = NOW(),
         calculated_by = $10::uuid,
         updated_by = $10::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [
        run.id,
        peopleCount,
        grossTotal,
        deductionTotal,
        employerTotal,
        netTotal,
        warningCount,
        errorCount,
        snapshotHash,
        input.userId,
      ]
    );

    // لا PENDING
    const pending = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_people
       WHERE payroll_run_id=$1::uuid AND calculation_status='PENDING'`,
      [run.id]
    );
    if ((pending.rows[0]?.n ?? 0) > 0) {
      throw new AccountsHttpError('بقي أشخاص بحالة PENDING بعد الاحتساب', 500);
    }

    // 15) audit
    await writeFinancialAudit(client, {
      userId: input.userId,
      action: 'payroll_run.calculated',
      entityType: 'payroll_run',
      entityId: run.id,
      newValues: {
        attempt: calculatingRun.calculation_attempt_number,
        people_count: peopleCount,
        error_count: errorCount,
        warning_count: warningCount,
        gross_total: grossTotal,
        deduction_total: deductionTotal,
        employer_contribution_total: employerTotal,
        net_total: netTotal,
        snapshot_hash: snapshotHash,
        calculation_request_id: requestId,
      },
      description: `اكتمال احتساب تشغيل الرواتب ${run.run_number}`,
    });

    return buildSummary(client, final.rows[0]);
  } catch (e) {
    // فشل تقني بعد CALCULATING → rollback كامل عبر withTransaction (يبقى DRAFT).
    // Audit failed يُسجَّل خارج هذه المعاملة من المستدعي إن لزم (9.A.2.3.2).
    throw e;
  }
}
