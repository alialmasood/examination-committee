/**
 * تسوية مطالبات الطلبة والأقساط وخطط الرسوم — 5.C.1
 * (بدون استيراد دائري من student-reliefs / student-collections)
 */
import {
  moneyEquals,
  moneyIsZero,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import { deriveInstallmentStatus } from './student-installment-status';
import {
  loadStudentCharge,
  type StudentChargeRow,
  type StudentChargeStatus,
} from './student-charges';
import {
  listPlanInstallments,
  loadStudentBillingPlan,
  loadStudentInstallment,
} from './student-billing-plans';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

function resolveChargeStatusAfterSettlement(
  original: string,
  outstanding: string
): StudentChargeStatus {
  if (moneyIsZero(outstanding)) return 'SETTLED';
  if (moneyEquals(outstanding, original)) return 'POSTED';
  return 'PARTIALLY_SETTLED';
}

export async function sumPostedCollectionsOnCharge(
  client: TxClient,
  chargeId: string
): Promise<string> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(sca.allocated_amount), 0)::text AS total
     FROM accounts.student_collection_allocations sca
     JOIN accounts.student_collections sc ON sc.id = sca.collection_id
     WHERE sca.student_charge_id = $1::uuid
       AND sc.status = 'POSTED'`,
    [chargeId]
  );
  return normalizeMoneyInput(r.rows[0]?.total ?? '0');
}

export async function sumPostedReliefsOnCharge(
  client: TxClient,
  chargeId: string
): Promise<string> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(sr.approved_amount), 0)::text AS total
     FROM accounts.student_reliefs sr
     WHERE sr.student_charge_id = $1::uuid
       AND sr.status = 'POSTED'`,
    [chargeId]
  );
  return normalizeMoneyInput(r.rows[0]?.total ?? '0');
}

export function calculateChargeOutstanding(
  original: string,
  collectionsPosted: string,
  reliefsPosted: string
): string {
  const origMillis = moneyToMillis(normalizeMoneyInput(original));
  const collMillis = moneyToMillis(normalizeMoneyInput(collectionsPosted));
  const reliefMillis = moneyToMillis(normalizeMoneyInput(reliefsPosted));
  const outMillis = origMillis - collMillis - reliefMillis;
  if (outMillis < BigInt(0)) {
    return '0.000';
  }
  return millisToMoney(outMillis);
}

export async function recalculateStudentChargeSettlement(
  client: TxClient,
  chargeId: string
): Promise<StudentChargeRow> {
  const charge = await loadStudentCharge(client, chargeId, true);
  if (charge.status === 'VOID' || charge.status === 'DRAFT') {
    return charge;
  }

  const collections = await sumPostedCollectionsOnCharge(client, chargeId);
  const reliefs = await sumPostedReliefsOnCharge(client, chargeId);
  const original = normalizeMoneyInput(charge.original_amount);
  const outstanding = calculateChargeOutstanding(original, collections, reliefs);
  const status = resolveChargeStatusAfterSettlement(original, outstanding);

  const upd = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
       outstanding_amount = $2::numeric,
       status = $3,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [charge.id, outstanding, status]
  );
  return upd.rows[0];
}

export async function sumPostedReliefsOnInstallment(
  client: TxClient,
  installmentId: string
): Promise<string> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(sr.approved_amount), 0)::text AS total
     FROM accounts.student_reliefs sr
     WHERE sr.student_installment_id = $1::uuid
       AND sr.status = 'POSTED'`,
    [installmentId]
  );
  return normalizeMoneyInput(r.rows[0]?.total ?? '0');
}

export async function recalculateStudentInstallmentSettlement(
  client: TxClient,
  installmentId: string,
  asOfDate?: string
): Promise<void> {
  const inst = await loadStudentInstallment(client, installmentId, true);
  const relief = await sumPostedReliefsOnInstallment(client, installmentId);
  const paid = normalizeMoneyInput(inst.paid_amount);
  const amount = normalizeMoneyInput(inst.amount);
  const outstanding = millisToMoney(
    moneyToMillis(amount) -
      moneyToMillis(paid) -
      moneyToMillis(relief)
  );
  const dueDate =
    inst.due_date instanceof Date
      ? inst.due_date.toISOString().slice(0, 10)
      : String(inst.due_date).slice(0, 10);
  const status = deriveInstallmentStatus(
    paid,
    amount,
    dueDate,
    asOfDate,
    outstanding
  );

  await txQuery(
    client,
    `UPDATE accounts.student_installments SET
       relief_amount = $2::numeric,
       outstanding_amount = $3::numeric,
       status = $4,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [inst.id, relief, outstanding, status]
  );
}

export async function recalculateStudentBillingPlanSettlement(
  client: TxClient,
  planId: string
): Promise<void> {
  const plan = await loadStudentBillingPlan(client, planId, true);
  const installments = await listPlanInstallments(client, planId);

  const anyCancelled = installments.some((i) => i.status === 'CANCELLED');
  const allSettled =
    installments.length > 0 &&
    installments.every(
      (i) =>
        i.status === 'PAID' ||
        moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
    );
  const anyNotSettled = installments.some(
    (i) =>
      i.status !== 'PAID' &&
      !moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
  );

  if (allSettled && !anyCancelled) {
    const paidSum = sumMoney(
      installments.map((i) => normalizeMoneyInput(i.paid_amount))
    );
    const reliefSum = sumMoney(
      installments.map((i) =>
        normalizeMoneyInput(
          (i as { relief_amount?: string }).relief_amount ?? '0'
        )
      )
    );
    const settledSum = millisToMoney(
      moneyToMillis(paidSum) + moneyToMillis(reliefSum)
    );
    const total = normalizeMoneyInput(plan.total_amount);
    const allOutstandingZero = installments.every((i) =>
      moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
    );
    if (moneyEquals(settledSum, total) && allOutstandingZero) {
      await txQuery(
        client,
        `UPDATE accounts.student_billing_plans SET
           status = 'COMPLETED',
           updated_at = NOW(),
           version = version + 1
         WHERE id = $1::uuid AND status = 'ACTIVE'`,
        [planId]
      );
      return;
    }
  }

  if (anyNotSettled || anyCancelled) {
    await txQuery(
      client,
      `UPDATE accounts.student_billing_plans SET
         status = 'ACTIVE',
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid AND status = 'COMPLETED'`,
      [planId]
    );
  }
}
