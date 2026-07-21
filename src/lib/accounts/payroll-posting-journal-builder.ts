/**
 * بناء سطور قيد ترحيل الرواتب المجمّعة 9.C.1
 */
import { AccountsHttpError } from './auth';
import {
  absoluteMoney,
  moneyEquals,
  moneyIsZero,
  moneyToMillisSigned,
  millisToMoney,
  sumMoney,
} from './money';
import {
  PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD,
} from './payroll-posting-idempotency';
import {
  resolveComponentGlAccounts,
  resolveDefaultPayableAndRounding,
} from './payroll-posting-mapping';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BuiltPayrollJournalLine = {
  account_id: string;
  cost_center_id: string | null;
  debit_amount: string;
  credit_amount: string;
  description: string;
};

export type BuiltPayrollJournal = {
  lines: BuiltPayrollJournalLine[];
  totalDebit: string;
  totalCredit: string;
  grossTotal: string;
  deductionTotal: string;
  employerTotal: string;
  netTotal: string;
  accountIds: string[];
};

type AggKey = string;

function aggKey(accountId: string, costCenterId: string | null, side: 'D' | 'C'): AggKey {
  return `${side}|${accountId}|${costCenterId ?? ''}`;
}

export async function buildPayrollPostingJournal(
  client: TxClient,
  opts: {
    payrollRunId: string;
    calendarId: string | null;
    asOf: string;
    runNumber: string;
    periodName: string;
  }
): Promise<BuiltPayrollJournal> {
  const linesR = await txQuery<{
    payroll_component_id: string;
    component_type: string;
    component_name_snapshot: string;
    calculated_amount: string;
    cost_center_id: string | null;
  }>(
    client,
    `SELECT l.payroll_component_id::text, l.component_type, l.component_name_snapshot,
            l.calculated_amount::text,
            p.cost_center_id_snapshot::text AS cost_center_id
     FROM accounts.payroll_run_lines l
     JOIN accounts.payroll_run_people p ON p.id = l.payroll_run_person_id
     WHERE l.payroll_run_id = $1::uuid
       AND p.superseded = FALSE
       AND p.calculation_status = 'CALCULATED'`,
    [opts.payrollRunId]
  );

  if (!linesR.rows.length) {
    throw new AccountsHttpError('تعذر ترحيل تشغيل بلا أسطر لقطة محسوبة', 422);
  }

  const debitMap = new Map<string, { account_id: string; cost_center_id: string | null; amount: string; label: string }>();
  const creditMap = new Map<string, { account_id: string; cost_center_id: string | null; amount: string; label: string }>();

  const add = (
    map: typeof debitMap,
    accountId: string,
    costCenterId: string | null,
    amount: string,
    label: string,
    side: 'D' | 'C'
  ) => {
    if (moneyIsZero(amount)) return;
    const k = aggKey(accountId, costCenterId, side);
    const prev = map.get(k);
    if (prev) {
      prev.amount = sumMoney([prev.amount, amount]);
    } else {
      map.set(k, { account_id: accountId, cost_center_id: costCenterId, amount, label });
    }
  };

  const componentCache = new Map<string, { expenseId: string | null; liabilityId: string | null }>();

  for (const row of linesR.rows) {
    let gl = componentCache.get(row.payroll_component_id);
    if (!gl) {
      gl = await resolveComponentGlAccounts(
        client,
        row.payroll_component_id,
        opts.calendarId,
        opts.asOf
      );
      componentCache.set(row.payroll_component_id, gl);
    }
    const cc = row.cost_center_id;
    const amt = row.calculated_amount;
    const type = String(row.component_type);

    if (type === 'EARNING') {
      if (!gl.expenseId) {
        throw new AccountsHttpError(
          `تعذر ترحيل الرواتب: حساب مصروف مفقود للمكوّن «${row.component_name_snapshot}»`,
          422
        );
      }
      add(debitMap, gl.expenseId, cc, amt, `مصروف — ${row.component_name_snapshot}`, 'D');
    } else if (type === 'DEDUCTION') {
      if (!gl.liabilityId) {
        throw new AccountsHttpError(
          `تعذر ترحيل الرواتب: حساب التزام استقطاع مفقود للمكوّن «${row.component_name_snapshot}»`,
          422
        );
      }
      add(creditMap, gl.liabilityId, cc, amt, `استقطاع — ${row.component_name_snapshot}`, 'C');
    } else if (type === 'EMPLOYER_CONTRIBUTION') {
      if (!gl.expenseId || !gl.liabilityId) {
        throw new AccountsHttpError(
          `تعذر ترحيل الرواتب: حسابا مساهمة صاحب العمل ناقصان للمكوّن «${row.component_name_snapshot}»`,
          422
        );
      }
      add(debitMap, gl.expenseId, cc, amt, `مصروف مساهمة — ${row.component_name_snapshot}`, 'D');
      add(creditMap, gl.liabilityId, cc, amt, `مساهمة مستحقة — ${row.component_name_snapshot}`, 'C');
    }
  }

  const peopleTot = await txQuery<{
    gross: string;
    ded: string;
    emp: string;
    net: string;
  }>(
    client,
    `SELECT
       COALESCE(SUM(gross_amount),0)::text AS gross,
       COALESCE(SUM(deductions_amount),0)::text AS ded,
       COALESCE(SUM(employer_contributions_amount),0)::text AS emp,
       COALESCE(SUM(net_amount),0)::text AS net
     FROM accounts.payroll_run_people
     WHERE payroll_run_id=$1::uuid AND superseded=FALSE AND calculation_status='CALCULATED'`,
    [opts.payrollRunId]
  );
  const grossTotal = peopleTot.rows[0]?.gross ?? '0';
  const deductionTotal = peopleTot.rows[0]?.ded ?? '0';
  const employerTotal = peopleTot.rows[0]?.emp ?? '0';
  const netTotal = peopleTot.rows[0]?.net ?? '0';

  const { payableId, roundingId } = await resolveDefaultPayableAndRounding(
    client,
    opts.calendarId,
    opts.asOf
  );
  if (!moneyIsZero(netTotal)) {
    add(creditMap, payableId, null, netTotal, 'صافي الرواتب المستحقة', 'C');
  }

  let totalDebit = sumMoney([...debitMap.values()].map((x) => x.amount));
  let totalCredit = sumMoney([...creditMap.values()].map((x) => x.amount));
  const diffMillis =
    moneyToMillisSigned(totalDebit) - moneyToMillisSigned(totalCredit);
  const absDiff = absoluteMoney(millisToMoney(diffMillis));
  const threshold = PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD;

  if (!moneyIsZero(absDiff)) {
    if (moneyToMillisSigned(absDiff) > moneyToMillisSigned(threshold)) {
      throw new AccountsHttpError(
        `تعذر ترحيل الرواتب: فرق التوازن ${absDiff} يتجاوز حد التقريب المسموح (${threshold} د.ع)`,
        422
      );
    }
    if (!roundingId) {
      throw new AccountsHttpError(
        'تعذر ترحيل الرواتب: يوجد فرق تقريب ولا يوجد حساب ROUNDING معرّف',
        422
      );
    }
    if (diffMillis > BigInt(0)) {
      // مدين أكبر → دائن تقريب
      add(creditMap, roundingId, null, absDiff, 'فرق تقريب ترحيل الرواتب', 'C');
    } else {
      add(debitMap, roundingId, null, absDiff, 'فرق تقريب ترحيل الرواتب', 'D');
    }
    totalDebit = sumMoney([...debitMap.values()].map((x) => x.amount));
    totalCredit = sumMoney([...creditMap.values()].map((x) => x.amount));
  }

  if (!moneyEquals(totalDebit, totalCredit) || moneyIsZero(totalDebit)) {
    throw new AccountsHttpError('تعذر ترحيل الرواتب: القيد غير متوازن أو بلا مبالغ', 422);
  }

  const out: BuiltPayrollJournalLine[] = [];
  const descBase = `ترحيل رواتب ${opts.runNumber} — ${opts.periodName}`;
  for (const v of debitMap.values()) {
    out.push({
      account_id: v.account_id,
      cost_center_id: v.cost_center_id,
      debit_amount: v.amount,
      credit_amount: '0',
      description: `${descBase} · ${v.label}`,
    });
  }
  for (const v of creditMap.values()) {
    out.push({
      account_id: v.account_id,
      cost_center_id: v.cost_center_id,
      debit_amount: '0',
      credit_amount: v.amount,
      description: `${descBase} · ${v.label}`,
    });
  }

  // ترتيب حتمي للسطور
  out.sort((a, b) => {
    const ak = `${a.account_id}|${a.cost_center_id ?? ''}|${a.debit_amount}|${a.credit_amount}`;
    const bk = `${b.account_id}|${b.cost_center_id ?? ''}|${b.debit_amount}|${b.credit_amount}`;
    return ak.localeCompare(bk);
  });

  const accountIds = [...new Set(out.map((l) => l.account_id))];
  return {
    lines: out,
    totalDebit,
    totalCredit,
    grossTotal,
    deductionTotal,
    employerTotal,
    netTotal,
    accountIds,
  };
}
