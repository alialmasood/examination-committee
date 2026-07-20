/**
 * حل العقد الفعّال لشخص في تاريخ الاحتساب (9.A.2.3.1)
 */
import { dateStr } from './payroll-validation';
import { buildCalcIssue, PAYROLL_CALC_ISSUE, type PayrollCalcIssueDraft } from './payroll-calculation-issues';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ResolvedPayrollContract = {
  id: string;
  contract_number: string;
  base_amount: string;
  currency_code: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
  updated_at: string;
  status: string;
};

export type ResolveActiveContractResult =
  | { ok: true; contract: ResolvedPayrollContract; issue?: undefined }
  | { ok: false; contract?: undefined; issue: PayrollCalcIssueDraft };

export async function resolveActiveContract(
  client: TxClient,
  personId: string,
  calculationDate: string | Date,
  runCurrencyCode: string
): Promise<ResolveActiveContractResult> {
  const calcDate = dateStr(calculationDate);
  if (!calcDate) {
    return {
      ok: false,
      issue: buildCalcIssue(PAYROLL_CALC_ISSUE.NO_ACTIVE_CONTRACT, {
        entity_type: 'PERSON',
        entity_id: personId,
        message_ar: 'تاريخ الاحتساب غير صالح لحل العقد',
      }),
    };
  }

  const r = await txQuery<{
    id: string;
    contract_number: string;
    base_amount: string;
    currency_code: string;
    effective_from: string;
    effective_to: string | null;
    version: number;
    updated_at: Date | string;
    status: string;
  }>(
    client,
    `SELECT id, contract_number, base_amount::text, currency_code,
            effective_from::text, effective_to::text, version, updated_at, status
     FROM accounts.payroll_contracts
     WHERE payroll_person_id = $1::uuid
       AND status = 'ACTIVE'
       AND effective_from <= $2::date
       AND (effective_to IS NULL OR effective_to >= $2::date)
     ORDER BY contract_number ASC, id ASC`,
    [personId, calcDate]
  );

  if (r.rows.length === 0) {
    return {
      ok: false,
      issue: buildCalcIssue(PAYROLL_CALC_ISSUE.NO_ACTIVE_CONTRACT, {
        entity_type: 'PERSON',
        entity_id: personId,
      }),
    };
  }
  if (r.rows.length > 1) {
    return {
      ok: false,
      issue: buildCalcIssue(PAYROLL_CALC_ISSUE.MULTIPLE_ACTIVE_CONTRACTS, {
        entity_type: 'PERSON',
        entity_id: personId,
        details_json: { contract_ids: r.rows.map((c) => c.id) },
      }),
    };
  }

  const row = r.rows[0];
  const contract: ResolvedPayrollContract = {
    id: row.id,
    contract_number: row.contract_number,
    base_amount: row.base_amount,
    currency_code: String(row.currency_code).toUpperCase(),
    effective_from: String(row.effective_from).slice(0, 10),
    effective_to: row.effective_to == null ? null : String(row.effective_to).slice(0, 10),
    version: Number(row.version),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString(),
    status: row.status,
  };

  const runCur = String(runCurrencyCode).trim().toUpperCase();
  if (contract.currency_code !== runCur) {
    return {
      ok: false,
      issue: buildCalcIssue(PAYROLL_CALC_ISSUE.CURRENCY_MISMATCH, {
        entity_type: 'CONTRACT',
        entity_id: contract.id,
        details_json: {
          contract_currency: contract.currency_code,
          run_currency: runCur,
        },
      }),
    };
  }

  return { ok: true, contract };
}
