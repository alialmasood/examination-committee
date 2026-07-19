/**
 * أعضاء نطاق التشغيل — 9.A.2.1 (PERSON_LIST فقط).
 *
 * تُدار فقط عندما يكون التشغيل DRAFT ونطاقه PERSON_LIST.
 * كل عملية تُحدِّث version التشغيل (تزامن متفائل) لمنع تعديلين متزامنين.
 * لا تجميد نهائي للنطاق هنا — التجميد الحقيقي عند Calculate في 9.A.2.3.
 */
import { AccountsHttpError } from './auth';
import { payrollPeriodLock, payrollRunLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollRun, type PayrollRunRow } from './payroll-runs';
import { assertPayrollConcurrency, iso } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ScopeMemberRow = {
  id: string;
  payroll_run_id: string;
  payroll_person_id: string;
  created_by: string;
  created_at: Date | string;
  person_code: string;
  full_name_ar: string;
  person_status: string;
};

export function serializeScopeMember(row: ScopeMemberRow) {
  return { ...row, created_at: iso(row.created_at)! };
}

function requireUuid(v: unknown, label: string): string {
  const s = String(v ?? '').trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    throw new AccountsHttpError(`${label} غير صالح`, 400);
  }
  return s;
}

export async function listScopeMembers(
  client: TxClient,
  runId: string
): Promise<ScopeMemberRow[]> {
  await loadPayrollRun(client, runId); // 404 إن لم يوجد التشغيل
  const r = await txQuery<ScopeMemberRow>(
    client,
    `SELECT m.id, m.payroll_run_id, m.payroll_person_id, m.created_by, m.created_at,
            p.person_code, p.full_name_ar, p.status AS person_status
     FROM accounts.payroll_run_scope_members m
     JOIN accounts.payroll_people p ON p.id = m.payroll_person_id
     WHERE m.payroll_run_id=$1::uuid
     ORDER BY p.person_code`,
    [runId]
  );
  return r.rows;
}

/** يحمّل التشغيل قابلاً للتعديل ويتحقق من الحالة والنطاق والتزامن قبل تعديل الأعضاء. */
async function loadDraftPersonListRun(
  client: TxClient,
  runId: string,
  version: unknown,
  updatedAt: unknown
): Promise<PayrollRunRow> {
  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [payrollPeriodLock(existing.payroll_period_id), payrollRunLock(runId)]);
  const run = await loadPayrollRun(client, runId, true);
  assertPayrollConcurrency(run, version, updatedAt);
  if (run.status !== 'DRAFT') {
    throw new AccountsHttpError('لا يمكن تعديل أعضاء النطاق إلا والتشغيل مسودة (DRAFT)', 409);
  }
  if (run.scope_type !== 'PERSON_LIST') {
    throw new AccountsHttpError('أعضاء النطاق متاحون فقط عندما يكون النطاق قائمة أشخاص', 409);
  }
  return run;
}

async function bumpRunVersion(client: TxClient, runId: string, userId: string): Promise<PayrollRunRow> {
  const r = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [runId, userId]
  );
  return r.rows[0];
}

/** الشخص يجب أن يكون موجوداً وحالته ACTIVE عند الإضافة. */
async function assertPersonActive(client: TxClient, personId: string): Promise<void> {
  const r = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM accounts.payroll_people WHERE id=$1::uuid`,
    [personId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الشخص غير موجود', 404);
  if (r.rows[0].status !== 'ACTIVE') throw new AccountsHttpError('لا يمكن إضافة شخص غير فعّال إلى النطاق', 400);
}

export async function addScopeMember(
  client: TxClient,
  p: { runId: string; personId: unknown; userId: string; version: unknown; updated_at: unknown }
): Promise<{ run: PayrollRunRow; members: ScopeMemberRow[] }> {
  const personId = requireUuid(p.personId, 'معرّف الشخص');
  const run = await loadDraftPersonListRun(client, p.runId, p.version, p.updated_at);
  await assertPersonActive(client, personId);
  const dup = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.payroll_run_scope_members
     WHERE payroll_run_id=$1::uuid AND payroll_person_id=$2::uuid LIMIT 1`,
    [run.id, personId]
  );
  if (dup.rows[0]) throw new AccountsHttpError('الشخص مضاف إلى نطاق هذا التشغيل مسبقاً', 409);
  await txQuery(
    client,
    `INSERT INTO accounts.payroll_run_scope_members (payroll_run_id, payroll_person_id, created_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid)`,
    [run.id, personId, p.userId]
  );
  const updated = await bumpRunVersion(client, run.id, p.userId);
  return { run: updated, members: await listScopeMembers(client, run.id) };
}

export async function removeScopeMember(
  client: TxClient,
  p: { runId: string; personId: unknown; userId: string; version: unknown; updated_at: unknown }
): Promise<{ run: PayrollRunRow; members: ScopeMemberRow[] }> {
  const personId = requireUuid(p.personId, 'معرّف الشخص');
  const run = await loadDraftPersonListRun(client, p.runId, p.version, p.updated_at);
  const del = await txQuery(
    client,
    `DELETE FROM accounts.payroll_run_scope_members
     WHERE payroll_run_id=$1::uuid AND payroll_person_id=$2::uuid`,
    [run.id, personId]
  );
  if ((del.rowCount ?? 0) === 0) throw new AccountsHttpError('العضو غير موجود في نطاق هذا التشغيل', 404);
  const updated = await bumpRunVersion(client, run.id, p.userId);
  return { run: updated, members: await listScopeMembers(client, run.id) };
}

export async function replaceScopeMembers(
  client: TxClient,
  p: { runId: string; personIds: unknown; userId: string; version: unknown; updated_at: unknown }
): Promise<{ run: PayrollRunRow; members: ScopeMemberRow[] }> {
  const list = Array.isArray(p.personIds) ? p.personIds : [];
  const ids = [...new Set(list.map((v) => requireUuid(v, 'معرّف الشخص')))];
  const run = await loadDraftPersonListRun(client, p.runId, p.version, p.updated_at);
  for (const id of ids) await assertPersonActive(client, id);
  await txQuery(
    client,
    `DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`,
    [run.id]
  );
  for (const id of ids) {
    await txQuery(
      client,
      `INSERT INTO accounts.payroll_run_scope_members (payroll_run_id, payroll_person_id, created_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid)`,
      [run.id, id, p.userId]
    );
  }
  const updated = await bumpRunVersion(client, run.id, p.userId);
  return { run: updated, members: await listScopeMembers(client, run.id) };
}
